// harness.mjs — pure parsing/decision functions extracted VERBATIM from the
// deployed receipts-email-intake v1.2 bundle (personal account, script id
// f26c03bdf9164d3d84081402b27219e4, retrieved 2026-07-24). Only change: these
// are exported so the offline test suite can exercise them without the Workers
// email() runtime. Logic is byte-identical to the deployed functions.
//
// The v1.0 (church) worker shares getHeader/extractSenderEmail/senderAllowed
// verbatim and adds body-capture; the body-capture finding is exercised with a
// small faithful copy of its extractBody() below (extractBody_v10).

export function getHeader(raw, name) {
  const blank = raw.search(/\r?\n\r?\n/);
  const block = blank === -1 ? raw : raw.slice(0, blank);
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ');
  const m = unfolded.match(new RegExp('^' + name + ':\\s*(.+)$', 'im'));
  return m ? m[1].trim() : '';
}

export function extractSenderEmail(fromHeader) {
  if (!fromHeader) return '';
  const angle = fromHeader.match(/<([^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  const bare = fromHeader.match(/[\w.+-]+@[\w.-]+/);
  return bare ? bare[0].trim().toLowerCase() : '';
}

export function detectIntent(toAddr, subject, memo) {
  const local = String(toAddr || '').toLowerCase().split('@')[0];
  if (local.includes('check') || local.includes('reimburse') || local.includes('payment')) return 'check';
  const hay = ((subject || '') + ' ' + (memo || '')).toLowerCase();
  if (/\bcheck request\b|\bcheck req\b|\bcut a check\b|\breimburse|\bcheck for\b|\bplease pay\b|\bpay to\b/.test(hay)) return 'check';
  return 'receipt';
}

export function extractBestAttachment(raw) {
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

export function senderAllowed(sender, env) {
  const list = (env.ALLOWED_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return true;
  return list.some(d => sender.endsWith('@' + d) || sender.endsWith('.' + d));
}

// ---- v1.0 (church) body-capture, faithful copy for the XSS-passthrough test ----
function getChunks(raw) {
  const boundaries = new Set();
  const bRe = /boundary\s*=\s*("([^"]+)"|([^\s;]+))/gi;
  let bm;
  while ((bm = bRe.exec(raw)) !== null) boundaries.add(bm[2] || bm[3]);
  if (boundaries.size === 0) return null;
  const delims = Array.from(boundaries).map(b => '--' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return raw.split(new RegExp('(?:' + delims.join('|') + ')', 'g'));
}
function decodePart(headers, body) {
  const cteM = headers.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
  const cte = (cteM ? cteM[1] : '').trim().toLowerCase();
  let s = body.replace(/^[\r\n]+/, '');
  if (cte === 'base64') { try { return atob(s.replace(/[^A-Za-z0-9+/=]/g, '')); } catch (_) { return s; } }
  if (cte === 'quoted-printable') return s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return s;
}
export function extractBody_v10(raw) {
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

// Test helper: build a base64 payload of a given decoded length.
export function b64OfLength(nChars) {
  // 'A' repeated nChars is valid base64 (decodes to bytes). >800 to pass the gate.
  return 'A'.repeat(nChars);
}
