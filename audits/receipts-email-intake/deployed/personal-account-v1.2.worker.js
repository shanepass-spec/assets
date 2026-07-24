// PRESERVED DEPLOYED ARTIFACT — DO NOT DEPLOY FROM THIS COPY AS-IS.
// Source: Cloudflare account 26c8013cfb2cf72dde19e55e6cf390b1 (Shanepass@gmail.com)
// Worker: receipts-email-intake  (script id f26c03bdf9164d3d84081402b27219e4)
// Retrieved read-only via Cloudflare API (workers_get_worker_code) on 2026-07-24.
// The ONLY modification vs. the live bundle: the hard-coded fallback INTAKE_SECRET
// literal has been replaced with the placeholder rcpt_[REDACTED_INTAKE_SECRET].
// The live bundle contains the real secret literal (see AUDIT_FINDINGS.md F-01).
// This file is a faithful rollback/reference copy, not a build input.

// receipts-email-intake.js v1.2 (personal account)
//
// Purpose: catch receipts forwarded to the receipts address, pull the
// receipt attachment (image or PDF) out of the email, and hand it to the
// Receipts app's pending lane. It never touches the receipts ledger directly.
//
// NEW in v1.2: INTENT ROUTING. A forwarded item is now tagged as either a
//   statement receipt (default) or a CHECK REQUEST draft, and that tag is
//   passed to the Receipts app so it lands in the right lane. Intent is decided
//   by, in order:
//     1) the destination address the mail was routed to (message.to) — the
//        local part containing "check" / "reimburse" / "payment" => check;
//     2) a fallback keyword scan of the subject + typed note ("check request",
//        "cut a check", "reimburse", "pay to", etc.) => check;
//     3) otherwise => receipt (unchanged behavior).
//   A check draft never emails the Business Office on arrival — the Receipts
//   app holds it until the requester confirms the amount and submits it.
//
// NEW in v1.1: also reads the TYPED NOTE from the email body and passes it as
//   `memo`.
//
// Flow:
//   Email Routing -> this worker's email() handler
//     -> extract the largest image/PDF attachment
//     -> extract the sender's typed note from the body
//     -> decide intent (receipt | check)
//     -> POST it to the Receipts worker /api/intake (shared secret)
//
// SECRETS (set in dashboard):
//   INTAKE_SECRET  -> the same shared secret set on the Receipts worker
//
// VARIABLES (optional):
//   RECEIPTS_URL     -> default https://receipts.shanepass.workers.dev
//   ALLOWED_DOMAINS  -> comma-separated sender domains to accept.
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

// ─── Intent: statement receipt (default) or check-request draft ─────────
function detectIntent(toAddr, subject, memo) {
  const local = String(toAddr || '').toLowerCase().split('@')[0];
  // Strongest signal: which address it was forwarded to.
  if (local.includes('check') || local.includes('reimburse') || local.includes('payment')) return 'check';
  // Fallback: the sender said so in the subject or their typed note.
  const hay = ((subject || '') + ' ' + (memo || '')).toLowerCase();
  if (/\bcheck request\b|\bcheck req\b|\bcut a check\b|\breimburse|\bcheck for\b|\bplease pay\b|\bpay to\b/.test(hay)) return 'check';
  return 'receipt';
}

// ─── Attachment extraction ──────────────────────────────────────────────
function extractBestAttachment(raw) {
  const boundaries = new Set();
  const bRe = /boundary\s*=\s*("([^"]+)"|([^\s;]+))/gi;
  let bm;
  while ((bm = bRe.exec(raw)) !== null) {
    boundaries.add(bm[2] || bm[3]);
  }
  if (boundaries.size === 0) return null;

  const delims = Array.from(boundaries).map(b => '--' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const splitter = new RegExp('(?:' + delims.join('|') + ')', 'g');
  const chunks = raw.split(splitter);

  let best = null;
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
    if (cte && cte !== 'base64') continue;

    const fnMatch = headers.match(/filename\s*=\s*("([^"]+)"|([^\s;]+))/i);
    const filename = fnMatch ? (fnMatch[2] || fnMatch[3]) : '';

    let body = chunk.slice(headerEnd).replace(/^[\r\n]+/, '');
    const b64 = body.replace(/[^A-Za-z0-9+/=]/g, '');
    if (b64.length < 800) continue;

    let resolvedCt = ct;
    if (ct === 'application/octet-stream') {
      resolvedCt = /\.pdf$/i.test(filename) ? 'application/pdf'
        : /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg';
      if (!/\.(pdf|png|jpe?g|gif|webp|heic)$/i.test(filename)) continue;
    }

    if (!best || b64.length > best.size) {
      best = { base64: b64, content_type: resolvedCt, filename, size: b64.length };
    }
  }
  return best;
}

// ─── Body text + typed-memo extraction ──────────────────────────────────
function decodePart(body, cte) {
  cte = (cte || '').toLowerCase();
  if (cte === 'base64') {
    try {
      const clean = body.replace(/[^A-Za-z0-9+/=]/g, '');
      const bin = atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch (_) { return body; }
  }
  if (cte === 'quoted-printable') {
    return body
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return body;
}

function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"');
}

function extractBodyText(raw) {
  const boundaries = new Set();
  const bRe = /boundary\s*=\s*("([^"]+)"|([^\s;]+))/gi;
  let bm;
  while ((bm = bRe.exec(raw)) !== null) boundaries.add(bm[2] || bm[3]);

  let plain = '', html = '';
  if (boundaries.size > 0) {
    const delims = Array.from(boundaries).map(b => '--' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const splitter = new RegExp('(?:' + delims.join('|') + ')', 'g');
    const chunks = raw.split(splitter);
    for (const chunk of chunks) {
      const headerEnd = chunk.search(/\r?\n\r?\n/);
      if (headerEnd === -1) continue;
      const headers = chunk.slice(0, headerEnd);
      const ctMatch = headers.match(/Content-Type:\s*([^;\r\n]+)/i);
      if (!ctMatch) continue;
      const ct = ctMatch[1].trim().toLowerCase();
      const cteMatch = headers.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
      const cte = (cteMatch ? cteMatch[1] : '').trim().toLowerCase();
      const part = chunk.slice(headerEnd).replace(/^[\r\n]+/, '');
      if (ct === 'text/plain' && !plain) plain = decodePart(part, cte);
      else if (ct === 'text/html' && !html) html = decodePart(part, cte);
    }
  } else {
    const headerEnd = raw.search(/\r?\n\r?\n/);
    const cte = (getHeader(raw, 'Content-Transfer-Encoding') || '').toLowerCase();
    const ct = (getHeader(raw, 'Content-Type') || '').toLowerCase();
    const part = headerEnd === -1 ? raw : raw.slice(headerEnd).replace(/^[\r\n]+/, '');
    if (ct.includes('text/html')) html = decodePart(part, cte);
    else plain = decodePart(part, cte);
  }

  return plain || (html ? stripHtml(html) : '');
}

function extractMemo(bodyText) {
  if (!bodyText) return '';
  let t = bodyText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const markers = [
    /\n-{2,}\s*Forwarded message\s*-{2,}/i,
    /\nBegin forwarded message:/i,
    /\nFrom:\s.+\nSent:/i,
    /\nFrom:\s.+\nDate:/i,
    /\nOn .{0,120}wrote:/i,
    /\n_{5,}/,
    /\n>\s?/,
  ];
  let cut = -1;
  for (const re of markers) {
    const m = t.match(re);
    if (m && (cut === -1 || m.index < cut)) cut = m.index;
  }
  let memo = cut === -1 ? t : t.slice(0, cut);
  memo = memo.split('\n').map(l => l.trim()).filter(Boolean).join(' ').trim();
  memo = memo.replace(/^(fwd:|fw:|re:)\s*/i, '').trim();
  return memo.slice(0, 300);
}

function senderAllowed(sender, env) {
  const list = (env.ALLOWED_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return true;
  return list.some(d => sender.endsWith('@' + d) || sender.endsWith('.' + d));
}

async function process(message, env, toAddr) {
  const raw = await readEmailRaw(message);
  const sender = extractSenderEmail(getHeader(raw, 'From'));
  const subject = getHeader(raw, 'Subject');

  if (!senderAllowed(sender, env)) return;

  const att = extractBestAttachment(raw);
  if (!att) return;

  if (att.base64.length > 14 * 1024 * 1024) return;

  let memo = '';
  try { memo = extractMemo(extractBodyText(raw)); } catch (_) { memo = ''; }

  const intent = detectIntent(toAddr, subject, memo);

  const base = env.RECEIPTS_URL || 'https://receipts.shanepass.workers.dev';
  await fetch(base.replace(/\/$/, '') + '/api/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-intake-secret': env.INTAKE_SECRET || 'rcpt_[REDACTED_INTAKE_SECRET]' },
    body: JSON.stringify({
      from_addr: sender,
      to_addr: toAddr || '',
      intent,
      subject,
      memo,
      filename: att.filename,
      content_type: att.content_type,
      image_base64: att.base64,
    }),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'receipts-email-intake',
        version: 'v1.2',
        receipts_url: env.RECEIPTS_URL || 'https://receipts.shanepass.workers.dev',
        secret_set: !!env.INTAKE_SECRET,
        allowed_domains: env.ALLOWED_DOMAINS || '(all senders)',
        intent_routing: true,
      });
    }
    return json({ error: 'not found' }, 404);
  },
  async email(message, env, ctx) {
    ctx.waitUntil(process(message, env, message.to));
  },
};
