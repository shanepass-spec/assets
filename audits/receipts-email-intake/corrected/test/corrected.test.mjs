// corrected.test.mjs — regression suite for the hardened receipts-email-intake v2.0.
// Run: node --test audits/receipts-email-intake/corrected/test/corrected.test.mjs
// Imports the ACTUAL candidate module (../worker.js). No network, no secrets, no
// live resources: downstream fetch, KV, and queue are injected mocks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processEmail, sniffMediaType, domainsAligned, parseTrustedAuthResults,
  evaluateAuth, isStaffAllowlisted, isCheckAuthorized, selectValidAttachment,
} from '../worker.js';

// ── helpers ───────────────────────────────────────────────────────────────
const CRLF = '\r\n';
const AR_TRUSTED_PASS = 'mx.cloudflare.net; dmarc=pass header.from=thetabsarasota.org; dkim=pass header.d=thetabsarasota.org; spf=pass smtp.mailfrom=thetabsarasota.org';
const AR_TRUSTED_FAIL = 'mx.cloudflare.net; dmarc=fail header.from=thetabsarasota.org; dkim=fail; spf=fail smtp.mailfrom=evil.example';

const padTo = (arr, n) => { const a = arr.slice(); while (a.length < n) a.push(0); return a; };
const toB64 = (arr) => Buffer.from(Uint8Array.from(arr)).toString('base64');
const PNG  = toB64(padTo([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A], 64));
const JPEG = toB64(padTo([0xFF,0xD8,0xFF,0xE0], 64));
const PDF  = toB64(padTo([0x25,0x50,0x44,0x46,0x2D,0x31,0x2E,0x34], 64));
const GIF  = toB64(padTo([0x47,0x49,0x46,0x38,0x39,0x61], 64));
const WEBP = toB64(padTo([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50], 64));
const HEIC = toB64(padTo([0,0,0,0x18,0x66,0x74,0x79,0x70,0x68,0x65,0x69,0x63], 64));
const SVG_B64  = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'.padEnd(80, ' ')).toString('base64');
const HTML_B64 = Buffer.from('<html><body><script>fetch("/api/export")</script>total $5</body></html>'.padEnd(80, ' ')).toString('base64');

function email({ from = 'julie@thetabsarasota.org', to = 'receipts@thetabsarasota.org',
  subject = 'lunch', ar = AR_TRUSTED_PASS, extraAR = [], messageId = '<m1@sender>',
  parts = [{ ct: 'image/png', filename: 'r.png', b64: PNG }] } = {}) {
  const L = [];
  if (ar !== null) L.push('Authentication-Results: ' + ar);   // trusted, prepended by ingress => FIRST
  for (const e of extraAR) L.push('Authentication-Results: ' + e); // attacker-forged, appear BELOW
  L.push('From: ' + from, 'To: ' + to, 'Subject: ' + subject, 'Message-ID: ' + messageId,
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary=BB', '');
  for (const p of parts) {
    L.push('--BB');
    L.push('Content-Type: ' + p.ct + (p.name ? `; name="${p.name}"` : ''));
    if (p.b64 !== undefined) L.push('Content-Transfer-Encoding: base64');
    if (p.filename) L.push(`Content-Disposition: attachment; filename="${p.filename}"`);
    L.push('', p.body !== undefined ? p.body : p.b64, '');
  }
  L.push('--BB--', '');
  return L.join(CRLF);
}

const msg = (raw, to = 'receipts@thetabsarasota.org') =>
  ({ raw: new Response(new TextEncoder().encode(raw)).body, to });

const mkKV = () => { const m = new Map(); return { get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, _m: m }; };
const baseEnv = (o = {}) => ({
  INTAKE_SECRET: 'test-secret-value',
  RECEIPTS_URL: 'https://downstream.invalid',
  STAFF_ALLOWLIST: 'julie@thetabsarasota.org,shane@thetabsarasota.org',
  CHECK_ALLOWLIST: 'julie@thetabsarasota.org',
  ...o,
});
const okFetch = (rec) => async (_u, opts) => { if (rec) rec.push(JSON.parse(opts.body)); return { ok: true, status: 200 }; };
const seqFetch = (seq, rec) => { let i = 0; return async (_u, opts) => { if (rec) rec.push(JSON.parse(opts.body)); const r = seq[Math.min(i, seq.length - 1)]; i++; if (r === 'throw') throw new Error('timeout'); return { ok: r < 400, status: r }; }; };
const noSleep = () => Promise.resolve();
const run = (raw, env, deps = {}, to = 'receipts@thetabsarasota.org') => processEmail(msg(raw, to), env, {}, { sleep: noSleep, fetchImpl: okFetch(), ...deps });

// ── happy paths ─────────────────────────────────────────────────────────
test('happy: authenticated allowlisted staff receipt is accepted', async () => {
  const r = await run(email(), baseEnv());
  assert.equal(r.outcome, 'accepted');
  assert.equal(r.intent, 'receipt');
  assert.equal(r.auth_method, 'dmarc');
});

test('happy: staff-forwarded PDF receipt accepted (manual forward = authenticated staff From)', async () => {
  const raw = email({ subject: 'Fwd: Amazon order', parts: [{ ct: 'application/pdf', filename: 'receipt.pdf', b64: PDF }] });
  const r = await run(raw, baseEnv());
  assert.equal(r.outcome, 'accepted');
  assert.equal(r.intent, 'receipt');
});

// ── required hostile cases ────────────────────────────────────────────────
test('forged visible From (staff name, auth aligned to attacker domain) -> rejected', async () => {
  const ar = 'mx.cloudflare.net; dmarc=fail header.from=thetabsarasota.org; dkim=pass header.d=evil.example; spf=pass smtp.mailfrom=evil.example';
  const r = await run(email({ from: 'julie@thetabsarasota.org', ar }), baseEnv());
  assert.equal(r.outcome, 'reject');
  assert.match(r.reason, /^auth_/);
});

test('forged Authentication-Results header (only trusted top line counts) -> rejected', async () => {
  // Genuine ingress line says fail; attacker injects a PASS line BELOW it.
  const r = await run(email({ ar: AR_TRUSTED_FAIL, extraAR: [AR_TRUSTED_PASS] }), baseEnv());
  assert.equal(r.outcome, 'reject');
  assert.match(r.reason, /^auth_/);
});

test('forged Authentication-Results with untrusted authserv-id -> no trusted evidence -> rejected', async () => {
  const r = await run(email({ ar: 'attacker.example; dmarc=pass; dkim=pass header.d=thetabsarasota.org' }), baseEnv());
  assert.equal(r.outcome, 'reject');
  assert.match(r.reason, /auth_untrusted_authserv|auth_no/);
});

test('SPF/DKIM/DMARC all fail -> rejected, nothing forwarded', async () => {
  const rec = [];
  const r = await run(email({ ar: AR_TRUSTED_FAIL }), baseEnv(), { fetchImpl: okFetch(rec) });
  assert.equal(r.outcome, 'reject');
  assert.equal(rec.length, 0);
});

test('unknown sender (auth passes, not on staff allowlist) -> rejected', async () => {
  const ar = 'mx.cloudflare.net; dmarc=pass header.from=amazon.com; dkim=pass header.d=amazon.com; spf=pass smtp.mailfrom=amazon.com';
  const r = await run(email({ from: 'auto-confirm@amazon.com', ar }), baseEnv());
  assert.equal(r.outcome, 'reject');
  assert.equal(r.reason, 'sender_not_allowlisted');
});

test('forwarded/ambiguous vendor sender (dkim-aligned to vendor, not staff) -> rejected', async () => {
  const ar = 'mx.cloudflare.net; dmarc=fail; dkim=pass header.d=amazon.com; spf=fail';
  const r = await run(email({ from: 'receipts@amazon.com', ar }), baseEnv());
  assert.equal(r.outcome, 'reject');
  assert.equal(r.reason, 'sender_not_allowlisted');
});

test('unauthorized check intent -> rejected, NOT downgraded or rerouted', async () => {
  const rec = [];
  // shane is staff but NOT on CHECK_ALLOWLIST; routed to a check address.
  const r = await run(email({ from: 'shane@thetabsarasota.org', to: 'checks@thetabsarasota.org' }),
    baseEnv(), { fetchImpl: okFetch(rec) }, 'checks@thetabsarasota.org');
  assert.equal(r.outcome, 'reject');
  assert.equal(r.reason, 'check_not_authorized');
  assert.equal(rec.length, 0, 'nothing forwarded — not silently downgraded to a receipt');
});

test('authorized check intent -> accepted with intent=check', async () => {
  const r = await run(email({ from: 'julie@thetabsarasota.org', to: 'checks@thetabsarasota.org' }), baseEnv(), {}, 'checks@thetabsarasota.org');
  assert.equal(r.outcome, 'accepted');
  assert.equal(r.intent, 'check');
});

test('duplicate Message-ID (same bytes) -> second is suppressed', async () => {
  const env = baseEnv({ DEDUPE_KV: mkKV() });
  const raw = email({ messageId: '<dup@sender>' });
  const first = await run(raw, env);
  const second = await run(raw, env);
  assert.equal(first.outcome, 'accepted');
  assert.equal(second.outcome, 'duplicate');
});

test('same attachment under a NEW Message-ID -> suppressed (content-hash dedupe)', async () => {
  const env = baseEnv({ DEDUPE_KV: mkKV() });
  const a = await run(email({ messageId: '<id-a@sender>' }), env);
  const b = await run(email({ messageId: '<id-b@sender>' }), env);
  assert.equal(a.outcome, 'accepted');
  assert.equal(b.outcome, 'duplicate');
  assert.equal(a.dedupe_key, b.dedupe_key);
});

test('MIME/content mismatch (declared image/png, bytes are HTML) -> rejected', async () => {
  const raw = email({ parts: [{ ct: 'image/png', filename: 'x.png', b64: HTML_B64 }] });
  const r = await run(raw, baseEnv());
  assert.equal(r.outcome, 'reject');
  assert.equal(r.reason, 'unsupported_or_mismatched_content');
});

test('SVG attachment -> rejected (active type, sniff not in allow-set)', async () => {
  const raw = email({ parts: [{ ct: 'image/svg+xml', filename: 'r.svg', b64: SVG_B64 }] });
  const r = await run(raw, baseEnv());
  assert.equal(r.outcome, 'reject');
  assert.equal(r.reason, 'unsupported_or_mismatched_content');
});

test('raw HTML body-only email (no attachment) -> rejected, nothing stored/forwarded', async () => {
  const rec = [];
  const raw = email({ parts: [{ ct: 'text/html; charset=utf-8', body: '<html><script>alert(1)</script>receipt $5</html>' }] });
  const r = await run(raw, baseEnv(), { fetchImpl: okFetch(rec) });
  assert.equal(r.outcome, 'reject');
  assert.equal(r.reason, 'no_attachment');
  assert.equal(rec.length, 0);
});

test('downstream timeout then success -> retried, accepted', async () => {
  const r = await run(email(), baseEnv(), { fetchImpl: seqFetch(['throw', 'throw', 200]) });
  assert.equal(r.outcome, 'accepted');
});

test('downstream persistent failure -> VISIBLE (throws) and dead-lettered', async () => {
  const env = baseEnv({ DEADLETTER_KV: mkKV() });
  await assert.rejects(
    () => run(email(), env, { fetchImpl: seqFetch([500, 500, 500]) }),
    /downstream_post_failed/,
  );
  assert.equal(env.DEADLETTER_KV._m.size, 1, 'dead-letter record written before throwing');
});

test('partial-write recovery: retries carry the SAME dedupe_key (downstream idempotent) ', async () => {
  const rec = [];
  const r = await run(email(), baseEnv(), { fetchImpl: seqFetch([500, 200], rec) });
  assert.equal(r.outcome, 'accepted');
  assert.equal(rec.length, 2);
  assert.equal(rec[0].dedupe_key, rec[1].dedupe_key, 'same key across retries => no duplicate ledger write');
});

// ── fail-closed + config ──────────────────────────────────────────────────
test('no INTAKE_SECRET -> fail closed, nothing forwarded', async () => {
  const rec = [];
  const env = baseEnv(); delete env.INTAKE_SECRET;
  const r = await run(email(), env, { fetchImpl: okFetch(rec) });
  assert.equal(r.outcome, 'error');
  assert.equal(r.reason, 'config_error_no_secret');
  assert.equal(rec.length, 0);
});

test('deny-by-default: empty STAFF_ALLOWLIST accepts nobody', async () => {
  const r = await run(email(), baseEnv({ STAFF_ALLOWLIST: '' }));
  assert.equal(r.outcome, 'reject');
  assert.equal(r.reason, 'sender_not_allowlisted');
});

// ── safe logging ────────────────────────────────────────────────────────
test('logs never contain the secret or receipt bytes', async () => {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try { await run(email(), baseEnv()); } finally { console.log = orig; }
  const blob = logs.join('\n');
  assert.ok(!blob.includes('test-secret-value'), 'no secret in logs');
  assert.ok(!blob.includes(PNG), 'no attachment bytes in logs');
});

// ── unit checks ───────────────────────────────────────────────────────────
test('unit: sniffMediaType recognizes allowed types and rejects svg/html', () => {
  const from = (b64) => Buffer.from(b64, 'base64');
  assert.equal(sniffMediaType(from(PNG)), 'image/png');
  assert.equal(sniffMediaType(from(JPEG)), 'image/jpeg');
  assert.equal(sniffMediaType(from(PDF)), 'application/pdf');
  assert.equal(sniffMediaType(from(GIF)), 'image/gif');
  assert.equal(sniffMediaType(from(WEBP)), 'image/webp');
  assert.equal(sniffMediaType(from(HEIC)), 'image/heic');
  assert.equal(sniffMediaType(from(SVG_B64)), null);
  assert.equal(sniffMediaType(from(HTML_B64)), null);
});

test('unit: domainsAligned relaxed alignment', () => {
  assert.equal(domainsAligned('thetabsarasota.org', 'thetabsarasota.org'), true);
  assert.equal(domainsAligned('mail.thetabsarasota.org', 'thetabsarasota.org'), true);
  assert.equal(domainsAligned('thetabsarasota.org', 'evil.example'), false);
  assert.equal(domainsAligned('', 'x'), false);
});

test('unit: parseTrustedAuthResults ignores untrusted authserv', () => {
  const raw = 'Authentication-Results: evil.example; dmarc=pass\r\nFrom: a@b\r\n\r\n';
  assert.equal(parseTrustedAuthResults(raw, 'mx.cloudflare.net').trusted, false);
});

test('unit: evaluateAuth requires alignment for component pass', () => {
  const ar = { trusted: true, dmarc: 'none', dkim: { result: 'pass', d: 'evil.example' }, spf: { result: 'fail', domain: '' } };
  assert.equal(evaluateAuth(ar, 'thetabsarasota.org').ok, false);
  const ar2 = { trusted: true, dmarc: 'none', dkim: { result: 'pass', d: 'thetabsarasota.org' }, spf: {} };
  assert.equal(evaluateAuth(ar2, 'thetabsarasota.org').ok, true);
});

test('unit: allowlists deny by default', () => {
  assert.equal(isStaffAllowlisted('a@b.com', { STAFF_ALLOWLIST: '' }), false);
  assert.equal(isCheckAuthorized('a@b.com', { CHECK_ALLOWLIST: '' }), false);
  assert.equal(isStaffAllowlisted('a@b.com', { STAFF_ALLOWLIST: 'a@b.com' }), true);
});

test('unit: selectValidAttachment picks the largest valid, rejects oversize', () => {
  const env = { MAX_ATTACHMENT_BYTES: 10 }; // tiny cap -> our 64-byte png is oversize
  const raw = email();
  assert.equal(selectValidAttachment(raw, env).reason, 'attachment_oversize');
});
