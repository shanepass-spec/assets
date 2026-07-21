const VERSION = '1.0.0';
const COOKIE_NAME = 'tabready_session';
const TRANSFER_TOKEN_TTL_SECONDS = 60;

function h(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(data)));
  return Array.from(new Uint8Array(sig)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function constantTimeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(String(value));
  let raw = '';
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function verifyLegacySession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
  if (!match || !env.LEGACY_SESSION_SECRET) return null;
  const parts = match[1].split('.');
  if (parts.length !== 2) return null;
  const expected = await hmac(env.LEGACY_SESSION_SECRET, parts[0]);
  if (!constantTimeEqual(expected, parts[1])) return null;
  try {
    const payload = JSON.parse(atob(parts[0]));
    if (!payload.user_id || Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) { return null; }
}

async function mintTransferToken(request, env, session, destinationPath) {
  if (!env.SESSION_TRANSFER_SECRET) throw new Error('SESSION_TRANSFER_SECRET is not configured');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    purpose: 'session_transfer',
    user_id: session.user_id,
    epoch: Number(session.epoch || 0),
    source_host: new URL(request.url).host,
    aud: canonicalBase(env),
    dest_path: destinationPath,
    iat: now,
    exp: now + TRANSFER_TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID()
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return encoded + '.' + await hmac(env.SESSION_TRANSFER_SECRET, encoded);
}

function canonicalBase(env) {
  const raw = String(env.CANONICAL_BASE_URL || 'https://tabready.thetabsrq.net').trim();
  const base = raw.replace(/\/+$/g, '');
  const parsed = new URL(base);
  if (parsed.protocol !== 'https:') throw new Error('CANONICAL_BASE_URL must be https');
  return parsed.origin;
}

function redirect(location, status) {
  return new Response(null, {
    status: status || 302,
    headers: {
      'Location': location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const base = canonicalBase(env);
    const destinationPath = url.pathname + url.search;
    const destination = base + destinationPath;

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'tabready-legacy-bridge', version: VERSION, destination: base }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // Preserve authentication forms that may already be open on an old phone.
      // 307 keeps the POST body off the URL and lets the church host finish login.
      const authPosts = ['/auth/request', '/auth/verify', '/auth/code/request', '/auth/code/verify', '/auth/recovery/request'];
      if (request.method === 'POST' && authPosts.includes(url.pathname)) return redirect(destination, 307);
      return new Response(JSON.stringify({
        ok: false,
        error: 'legacy_host_read_only',
        message: 'TabReady moved to its permanent church address. Reopen the app and try again.',
        location: destination
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    if (request.method === 'HEAD') return redirect(destination, 302);

    const session = await verifyLegacySession(request, env);
    if (!session) return redirect(destination, 302);

    const transferToken = await mintTransferToken(request, env, session, destinationPath);
    const action = base + '/auth/transfer/consume';
    const html = '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">'
      + '<title>Moving TabReady</title></head>'
      + '<body style="font-family:-apple-system,sans-serif;background:#f7f6f2;color:#402020;padding:32px;text-align:center">'
      + '<main style="max-width:420px;margin:60px auto;background:#fff;border-radius:16px;padding:28px">'
      + '<h1 style="font-size:22px">TabReady is moving</h1>'
      + '<p>Your access is being transferred securely to the permanent church address.</p>'
      + '<form id="x" method="POST" action="' + h(action) + '">'
      + '<input type="hidden" name="transfer_token" value="' + h(transferToken) + '">'
      + '<button type="submit" style="padding:14px 20px;border:0;border-radius:10px;background:#6d3d31;color:#fff;font-weight:700">Continue</button>'
      + '</form><script>document.getElementById("x").submit();<' + '/script></main></body></html>';
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action " + base + "; base-uri 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
};
