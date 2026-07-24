// PRESERVED DEPLOYED ARTIFACT — DO NOT DEPLOY FROM THIS COPY AS-IS.
// Source: Cloudflare account ffd360b239936d51e85d9961fdaeb65a (Media@thetabsarasota.org)
// Worker: receipts-email-intake  (script id ec69106405e34cc4b34ea7cb4a2c8798)
// Retrieved read-only via Cloudflare API (workers_get_worker_code) on 2026-07-24.
// The ONLY modification vs. the live bundle: the hard-coded fallback INTAKE_SECRET
// literal has been replaced with the placeholder rcpt_[REDACTED_INTAKE_SECRET].
// The live bundle contains the real secret literal (see AUDIT_FINDINGS.md F-01).
// This file is a faithful rollback/reference copy, not a build input.

// receipts-email-intake.js v1.0 — deploy to the CHURCH account
//
// Purpose: catch receipts forwarded to the receipts address, pull the
// receipt attachment (image or PDF) out of the email, and hand it to the
// Receipts app's pending lane. It never touches the receipts ledger directly.
//
// Flow:
//   Email Routing -> this worker's email() handler
//     -> extract the largest image/PDF attachment
//     -> POST it to the Receipts worker /api/intake (shared secret)
//        which drops it into pending_email_receipts for a human to confirm.
//
// SECRETS (set in dashboard):
//   INTAKE_SECRET  -> the same shared secret set on the Receipts worker
//
// VARIABLES (set in dashboard, optional — sensible defaults below):
//   RECEIPTS_URL     -> default https://receipts.shanepass.workers.dev
//   ALLOWED_DOMAINS  -> comma-separated sender domains to accept.
//                       Empty/unset = accept all senders (unmatched ones are
//                       held as "unassigned" for an admin in the app).
//
// ENDPOINTS:
//   email (default) -> Email Routing entrypoint
//   GET /health     -> config check

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Read raw MIME (cap at 15 MB) ───────────────────────────────────────
async function readEmailRaw(message) {
  const reader = message.raw.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > 15 * 1024 * 1024) break;
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

function getHeader(raw, name) {
  const blank = raw.search(/\r?\n\r?\n/);
  const block = blank === -1 ? raw : raw.slice(0, blank);
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ');
  const m = unfolded.match(new RegExp('^' + name + ':\\s*(.+)$', 'im'));
  return m ? m[1].trim() : '';
}

function extractSenderEmail(fromHeader) {
  if (!fromHeader) return '';
  const angle = fromHeader.match(/<([^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  const bare = fromHeader.match(/[\w.+-]+@[\w.-]+/);
  return bare ? bare[0].trim().toLowerCase() : '';
}

// ─── Attachment extraction ──────────────────────────────────────────────
// Collect every MIME boundary in the message, split the raw text on all of
// them, and scan each chunk for a base64-encoded image/* or application/pdf
// part. Return the LARGEST one (the real receipt, not a logo or signature).
function getChunks(raw) {
  const boundaries = new Set();
  const bRe = /boundary\s*=\s*("([^"]+)"|([^\s;]+))/gi;
  let bm;
  while ((bm = bRe.exec(raw)) !== null) boundaries.add(bm[2] || bm[3]);
  if (boundaries.size === 0) return null;
  const delims = Array.from(boundaries).map(b => '--' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return raw.split(new RegExp('(?:' + delims.join('|') + ')', 'g'));
}

// Every base64 image/PDF attachment in the email (not just the largest).
function extractAllAttachments(raw) {
  const chunks = getChunks(raw);
  if (!chunks) return [];
  const out = [];
  for (const chunk of chunks) {
    const headerEnd = chunk.search(/\r?\n\r?\n/);
    if (headerEnd === -1) continue;
    const headers = chunk.slice(0, headerEnd);
    const ctMatch = headers.match(/Content-Type:\s*([^;\r\n]+)/i);
    if (!ctMatch) continue;
    const ct = ctMatch[1].trim().toLowerCase();
    const isImage = ct.startsWith('image/');
    const isPdf = ct === 'application/pdf' || ct === 'application/octet-stream';
    if (!isImage && !isPdf) continue;

    const cteMatch = headers.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
    const cte = (cteMatch ? cteMatch[1] : '').trim().toLowerCase();
    if (cte && cte !== 'base64') continue; // base64 attachments only

    const fnMatch = headers.match(/filename\s*=\s*("([^"]+)"|([^\s;]+))/i);
    const filename = fnMatch ? (fnMatch[2] || fnMatch[3]) : '';

    const b64 = chunk.slice(headerEnd).replace(/^[\r\n]+/, '').replace(/[^A-Za-z0-9+/=]/g, '');
    if (b64.length < 800) continue; // too small to be a real receipt

    let resolvedCt = ct;
    if (ct === 'application/octet-stream') {
      resolvedCt = /\.pdf$/i.test(filename) ? 'application/pdf'
        : /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg';
      if (!/\.(pdf|png|jpe?g|gif|webp|heic)$/i.test(filename)) continue;
    }
    out.push({ base64: b64, content_type: resolvedCt, filename, size: b64.length });
  }
  return out;
}

function decodePart(headers, body) {
  const cteM = headers.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
  const cte = (cteM ? cteM[1] : '').trim().toLowerCase();
  let s = body.replace(/^[\r\n]+/, '');
  if (cte === 'base64') {
    try { return atob(s.replace(/[^A-Za-z0-9+/=]/g, '')); } catch (_) { return s; }
  }
  if (cte === 'quoted-printable') {
    return s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return s;
}

// When there's no attachment, capture the email body itself (Amazon/inbox receipts).
function extractBody(raw) {
  const chunks = getChunks(raw);
  let html = '', text = '';
  if (!chunks) {
    const he = raw.search(/\r?\n\r?\n/);
    return { html: '', text: he === -1 ? '' : raw.slice(he).trim().slice(0, 20000) };
  }
  for (const chunk of chunks) {
    const he = chunk.search(/\r?\n\r?\n/);
    if (he === -1) continue;
    const headers = chunk.slice(0, he);
    if (/Content-Disposition:\s*attachment/i.test(headers)) continue;
    const ctM = headers.match(/Content-Type:\s*([^;\r\n]+)/i);
    if (!ctM) continue;
    const ct = ctM[1].trim().toLowerCase();
    if (ct.startsWith('text/html') && !html) html = decodePart(headers, chunk.slice(he));
    else if (ct.startsWith('text/plain') && !text) text = decodePart(headers, chunk.slice(he));
  }
  return { html: html.slice(0, 200000), text: text.slice(0, 20000) };
}

function postIntake(env, payload) {
  const base = (env.RECEIPTS_URL || 'https://receipts.shanepass.workers.dev').replace(/\/$/, '');
  return fetch(base + '/api/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-intake-secret': env.INTAKE_SECRET || 'rcpt_[REDACTED_INTAKE_SECRET]' },
    body: JSON.stringify(payload),
  });
}

// Collapse the common "invoice + receipt for the same charge" case (Anthropic,
// Stripe, etc.) so one email = one entry, not two.
function dedupeAttachments(atts) {
  // 1) Drop byte-for-byte identical attachments.
  const seen = new Set();
  let out = [];
  for (const a of atts) {
    const key = a.base64.length + ':' + a.base64.slice(0, 64) + a.base64.slice(-64);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  // 2) If the email carries BOTH an invoice-named and a receipt-named PDF,
  //    keep the receipt (proof of payment) and drop the matching invoice.
  const hasReceipt = out.some(a => /receipt/i.test(a.filename || ''));
  if (hasReceipt) {
    out = out.filter(a => {
      const fn = a.filename || '';
      return !(/invoice/i.test(fn) && !/receipt/i.test(fn));
    });
  }
  return out;
}

function senderAllowed(sender, env) {
  const list = (env.ALLOWED_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return true;
  return list.some(d => sender.endsWith('@' + d) || sender.endsWith('.' + d));
}

async function process(message, env) {
  const raw = await readEmailRaw(message);
  const sender = extractSenderEmail(getHeader(raw, 'From'));
  const subject = getHeader(raw, 'Subject');

  if (!senderAllowed(sender, env)) return; // silently drop off-domain mail

  // 1) If there are attachments, send every one (multiple receipts per email).
  const atts = dedupeAttachments(extractAllAttachments(raw).filter(a => a.base64.length <= 14 * 1024 * 1024));
  if (atts.length) {
    for (const att of atts) {
      await postIntake(env, {
        from_addr: sender, subject,
        filename: att.filename, content_type: att.content_type, image_base64: att.base64,
      });
    }
    return;
  }

  // 2) No attachment — capture the email body itself (Amazon / inbox receipts).
  const b = extractBody(raw);
  if (b.html || b.text) {
    await postIntake(env, {
      from_addr: sender, subject,
      content_type: 'text/html', body_html: b.html, body_text: b.text,
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'receipts-email-intake',
        version: 'v1.0',
        receipts_url: env.RECEIPTS_URL || 'https://receipts.shanepass.workers.dev',
        secret_set: !!env.INTAKE_SECRET,
        allowed_domains: env.ALLOWED_DOMAINS || '(all senders)',
      });
    }
    return json({ error: 'not found' }, 404);
  },
  async email(message, env, ctx) {
    ctx.waitUntil(process(message, env));
  },
};
