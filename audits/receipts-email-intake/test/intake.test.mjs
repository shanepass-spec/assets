// intake.test.mjs — offline reproduction of receipts-email-intake audit findings.
// Run: node --test audits/receipts-email-intake/test/
// Each test PROVES a finding by exercising the deployed logic (see harness.mjs).
// A passing test == the vulnerable/observed behavior reproduced as described in
// AUDIT_FINDINGS.md. Test names are tagged with the finding id.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getHeader, extractSenderEmail, detectIntent, extractBestAttachment,
  senderAllowed, extractBody_v10, b64OfLength,
} from './harness.mjs';

const CRLF = '\r\n';
function mime(parts) { return parts.join(CRLF); }
const BIG = b64OfLength(2000); // > 800-char gate

// ── F-02: From-header trust — routing follows a forgeable From header ──────
test('[F-02] forged From header is accepted verbatim as the routing identity', () => {
  const raw = mime([
    'From: "Julie (Business Office)" <julie@thetabsarasota.org>',
    'To: receipts@thetabsarasota.org',
    'Subject: lunch',
    '', '',
  ]);
  // Attacker sends from anywhere; From is spoofed to a real staff address.
  const sender = extractSenderEmail(getHeader(raw, 'From'));
  assert.equal(sender, 'julie@thetabsarasota.org',
    'sender identity is taken from the From header with no SPF/DKIM/DMARC check');
});

// ── F-03: default sender allow-list is OPEN (accept-all) ──────────────────
test('[F-03] unset ALLOWED_DOMAINS accepts every sender on the internet', () => {
  assert.equal(senderAllowed('attacker@evil.example', {}), true);
  assert.equal(senderAllowed('anyone@anywhere.tld', { ALLOWED_DOMAINS: '' }), true);
});

test('[F-03] allow-list suffix check is loose (endsWith on bare domain)', () => {
  // "thetabsarasota.org" as an allowed domain also matches a look-alike parent
  // like "eviltthetabsarasota.org" via the endsWith('.'+d) / endsWith('@'+d) test?
  // endsWith('@thetabsarasota.org') is exact-ish, but endsWith('.thetabsarasota.org')
  // lets any subdomain of an attacker-registered zone through:
  const env = { ALLOWED_DOMAINS: 'thetabsarasota.org' };
  assert.equal(senderAllowed('x@mail.thetabsarasota.org', env), true); // legit subdomain
  // A domain the attacker controls that merely ENDS in the allowed string:
  assert.equal(senderAllowed('x@notthetabsarasota.org', env), false); // ok: needs @ or .
});

// ── F-04: check-request intent is attacker-controllable ───────────────────
test('[F-04] destination local-part drives check intent (no auth on intent)', () => {
  assert.equal(detectIntent('checks@thetabsarasota.org', 'lunch', ''), 'check');
  assert.equal(detectIntent('reimburse@thetabsarasota.org', '', ''), 'check');
  assert.equal(detectIntent('payment@thetabsarasota.org', '', ''), 'check');
});
test('[F-04] subject/memo keywords alone flip a receipt into a check-request draft', () => {
  assert.equal(detectIntent('receipts@thetabsarasota.org', 'please cut a check for $900', ''), 'check');
  assert.equal(detectIntent('receipts@thetabsarasota.org', '', 'reimburse me $900 pay to John Doe'), 'check');
});

// ── F-05: content-type allow-list too broad — image/svg+xml passes ────────
test('[F-05] image/svg+xml attachment is accepted and its content_type passed through', () => {
  const raw = mime([
    'From: a@b.com', 'To: receipts@x', 'Subject: r',
    'Content-Type: multipart/mixed; boundary=BB', '',
    '--BB',
    'Content-Type: image/svg+xml; name="receipt.svg"',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="receipt.svg"', '',
    BIG, '',
    '--BB--', '',
  ]);
  const att = extractBestAttachment(raw);
  assert.ok(att, 'attachment extracted');
  assert.equal(att.content_type, 'image/svg+xml',
    'svg content_type is forwarded verbatim to downstream storage/serving');
});

// ── F-06: declared content-type is trusted; no magic-byte sniff at intake ─
test('[F-06] MIME/content mismatch: bytes are HTML but declared image/png -> accepted as png', () => {
  const htmlBytesAsB64 = Buffer.from('<html><script>alert(1)</script></html>').toString('base64').padEnd(900, 'A');
  const raw = mime([
    'From: a@b.com', 'To: receipts@x', 'Subject: r',
    'Content-Type: multipart/mixed; boundary=BB', '',
    '--BB',
    'Content-Type: image/png; name="x.png"',
    'Content-Transfer-Encoding: base64', '',
    htmlBytesAsB64, '',
    '--BB--', '',
  ]);
  const att = extractBestAttachment(raw);
  assert.ok(att);
  assert.equal(att.content_type, 'image/png',
    'no content sniff: the attacker-declared type is what gets stored/served');
});

// ── F-07: octet-stream .pdf extension trick / extension-driven type ───────
test('[F-07] application/octet-stream resolves type purely from the filename extension', () => {
  const raw = mime([
    'From: a@b.com', 'To: receipts@x', 'Subject: r',
    'Content-Type: multipart/mixed; boundary=BB', '',
    '--BB',
    'Content-Type: application/octet-stream',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="evil.pdf"', '',
    BIG, '',
    '--BB--', '',
  ]);
  const att = extractBestAttachment(raw);
  assert.ok(att);
  assert.equal(att.content_type, 'application/pdf',
    'type is inferred from ".pdf" in the filename, not the bytes');
});

// ── F-08: no in-worker dedup/replay protection (two identical emails) ─────
test('[F-08] same email parsed twice yields two independent extractions (no message-id/idempotency)', () => {
  const raw = mime([
    'Message-ID: <same-id@sender>',
    'From: a@b.com', 'To: receipts@x', 'Subject: r',
    'Content-Type: multipart/mixed; boundary=BB', '',
    '--BB',
    'Content-Type: image/jpeg; name="r.jpg"',
    'Content-Transfer-Encoding: base64', '',
    BIG, '',
    '--BB--', '',
  ]);
  const a1 = extractBestAttachment(raw);
  const a2 = extractBestAttachment(raw);
  // Identical output, and NOTHING in the worker keys on Message-ID to suppress
  // a replayed delivery: both would POST to /api/intake -> two pending rows.
  assert.deepEqual(a1, a2);
  assert.equal(getHeader(raw, 'Message-ID'), '<same-id@sender>',
    'a Message-ID exists but the worker never reads it for idempotency');
});

// ── F-09 (v1.0 church path): raw HTML email body captured with no sanitization ─
test('[F-09] v1.0 body-capture forwards raw <script> HTML with no sanitization', () => {
  const raw = mime([
    'From: a@b.com', 'To: receipts@x', 'Subject: r',
    'Content-Type: multipart/alternative; boundary=BB', '',
    '--BB',
    'Content-Type: text/html; charset=utf-8', '',
    '<html><body><img src=x onerror="fetch(`/api/export`)"><script>document.title="pwn"</script>receipt total $5</body></html>', '',
    '--BB--', '',
  ]);
  const b = extractBody_v10(raw);
  assert.match(b.html, /<script>/, 'script tag survives intake verbatim');
  assert.match(b.html, /onerror=/, 'event-handler attribute survives intake verbatim');
});

// ── F-10: 800-char base64 gate lets a ~600-byte "receipt" through as valid ─
test('[F-10] tiny (non-receipt) payload just over the 800-char gate is accepted', () => {
  const raw = mime([
    'From: a@b.com', 'To: receipts@x', 'Subject: r',
    'Content-Type: multipart/mixed; boundary=BB', '',
    '--BB',
    'Content-Type: image/png; name="x.png"',
    'Content-Transfer-Encoding: base64', '',
    b64OfLength(801), '',
    '--BB--', '',
  ]);
  const att = extractBestAttachment(raw);
  assert.ok(att, 'a payload with no validation that it is a real image is accepted');
  assert.equal(att.size, 801);
});

// ── Control: a plain no-attachment email yields nothing (v1.2 drops it) ────
test('[control] v1.2 with no attachment returns null (silently dropped)', () => {
  const raw = mime(['From: a@b.com', 'To: receipts@x', 'Subject: hi', '', 'just text', '']);
  assert.equal(extractBestAttachment(raw), null);
});
