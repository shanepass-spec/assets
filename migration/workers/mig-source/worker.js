/**
 * mig-source — TEMPORARY TabReady migration reader.
 *
 * Account:  personal 26c8013cfb2cf72dde19e55e6cf390b1
 * Bindings: SRC     D1 -> tabready        (dcadb25c-d503-45a7-9e29-254c2d5f50e5)
 *           SRC_R2  R2 -> tabready-photos
 * Secret:   MIG_SECRET  (entered directly in the dashboard, same value as mig-sink)
 *
 * This worker is READ ONLY BY CONSTRUCTION. It holds no write path: there is no
 * INSERT, UPDATE, DELETE or DDL anywhere in it, and no endpoint that executes
 * caller-supplied SQL. Every statement is built here from a table name that has
 * been checked against this database's own sqlite_master. That is the safety
 * boundary — not a denylist, and not trust in the caller.
 *
 * Delete this worker once the copy is verified.
 */

const SKEW_MS = 300000;      // 5 minutes
const MAX_PAGE = 500;

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

// ------------------------------------------------------------------- auth
//
// The shared secret is never transmitted. The caller signs method, path+query
// and a timestamp; this worker recomputes the signature. A captured request
// cannot be replayed outside the skew window, and a leaked log line cannot
// yield the secret.

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function requireSig(request, env) {
  // Fail CLOSED when the credential source is unavailable. A migration reader
  // that answers without a secret is an open door onto the whole database.
  if (!env.MIG_SECRET) return json({ error: 'credential_source_unavailable' }, 503);
  if (!env.SRC) return json({ error: 'binding_unavailable' }, 503);

  const ts = request.headers.get('x-mig-ts') || '';
  const sig = request.headers.get('x-mig-sig') || '';
  if (!ts || !sig) return json({ error: 'unauthorized' }, 401);

  const skew = Math.abs(Date.now() - Number(ts));
  if (!isFinite(skew) || skew > SKEW_MS) return json({ error: 'stale_timestamp' }, 401);

  const url = new URL(request.url);
  const expect = await hmacHex(env.MIG_SECRET, request.method + '\n' + url.pathname + url.search + '\n' + ts);
  if (!timingSafeEqual(expect, sig)) return json({ error: 'unauthorized' }, 401);
  return null;
}

// ------------------------------------------------------------- sql helpers

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

async function tableNames(env) {
  const { results } = await env.SRC.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
  ).all();
  return (results || []).map(r => r.name);
}

// A table name only ever reaches SQL after matching this database's own
// catalogue. An unknown name is rejected, never interpolated.
async function checkedTable(env, name) {
  const names = await tableNames(env);
  if (!names.includes(name)) throw new Error('unknown_table');
  return name;
}

async function columnsOf(env, table) {
  const { results } = await env.SRC.prepare(
    'SELECT name FROM pragma_table_info(?) ORDER BY cid').bind(table).all();
  return (results || []).map(r => r.name);
}

// Same fingerprint the shell kit uses, so both agree: row count, total quoted
// length, and three positional character sums. Catches missing, extra,
// truncated and value-shifted rows. Not a cryptographic digest.
function fingerprintSql(table, cols) {
  const rt = cols.map(c => 'quote(' + q(c) + ')').join(" || char(31) || ");
  return 'SELECT COUNT(*) AS n,' +
    ' COALESCE(SUM(LENGTH(rt)),0) AS len,' +
    ' COALESCE(SUM(UNICODE(rt)),0) AS h1,' +
    ' COALESCE(SUM(UNICODE(SUBSTR(rt,(LENGTH(rt)+1)/2,1))),0) AS h2,' +
    ' COALESCE(SUM(UNICODE(SUBSTR(rt,LENGTH(rt),1))),0) AS h3' +
    ' FROM (SELECT ' + rt + ' AS rt FROM ' + q(table) + ')';
}

// ------------------------------------------------------------------ router

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === '/health') {
      return json({
        ok: true, service: 'mig-source', role: 'reader', writes: 'none',
        bindings: { SRC: !!env.SRC, SRC_R2: !!env.SRC_R2 },
        secret_present: !!env.MIG_SECRET
      });
    }

    const denied = await requireSig(request, env);
    if (denied) return denied;

    try {
      if (p === '/d1/tables') {
        return json({ tables: await tableNames(env) });
      }

      if (p === '/d1/columns') {
        const t = await checkedTable(env, url.searchParams.get('t') || '');
        return json({ table: t, columns: await columnsOf(env, t) });
      }

      if (p === '/d1/fingerprint') {
        const t = await checkedTable(env, url.searchParams.get('t') || '');
        const cols = await columnsOf(env, t);
        const row = await env.SRC.prepare(fingerprintSql(t, cols)).first();
        return json({ table: t, fingerprint: row });
      }

      // Rows come back as ready-made INSERT statements rendered by SQLite's own
      // quote(), so NULLs, blobs and embedded quotes round-trip exactly and the
      // sink never has to re-encode anything.
      if (p === '/d1/rows') {
        const t = await checkedTable(env, url.searchParams.get('t') || '');
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1), MAX_PAGE);
        const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
        const cols = await columnsOf(env, t);
        const collist = cols.map(q).join(',');
        const vals = cols.map(c => 'quote(' + q(c) + ')').join(" || ',' || ");

        let order = 'rowid';
        try { await env.SRC.prepare('SELECT rowid FROM ' + q(t) + ' LIMIT 1').first(); }
        catch (e) { order = '1'; }   // WITHOUT ROWID table: order by the rendered text

        const sql = "SELECT 'INSERT INTO " + q(t).replace(/"/g, '""') + ' (' + collist.replace(/"/g, '""') +
          ") VALUES (' || " + vals + " || ');' AS s FROM " + q(t) +
          ' ORDER BY ' + order + ' LIMIT ? OFFSET ?';
        const { results } = await env.SRC.prepare(sql).bind(limit, offset).all();
        const rows = (results || []).map(r => r.s);
        return json({ table: t, offset: offset, count: rows.length, statements: rows });
      }

      // Key names only. app_settings VALUES are never selected, never sent,
      // never compared. Shipping whole rows across would have put values on the
      // wire purely to count them.
      if (p === '/d1/setting-keys') {
        const { results } = await env.SRC.prepare('SELECT key FROM app_settings ORDER BY key').all();
        return json({ keys: (results || []).map(r => r.key) });
      }

      if (p === '/d1/ddl') {
        const kind = url.searchParams.get('type') || '';
        if (['index', 'view', 'trigger'].indexOf(kind) === -1) return json({ error: 'bad_type' }, 400);
        const { results } = await env.SRC.prepare(
          "SELECT type, tbl_name, sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL"
        ).bind(kind).all();
        return json({ type: kind, objects: results || [] });
      }

      // ------------------------------------------------------------- r2

      if (p === '/r2/list') {
        if (!env.SRC_R2) return json({ error: 'binding_unavailable' }, 503);
        const cursor = url.searchParams.get('cursor') || undefined;
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1), 1000);
        const listed = await env.SRC_R2.list({ cursor: cursor, limit: limit });
        return json({
          truncated: listed.truncated,
          cursor: listed.truncated ? listed.cursor : null,
          objects: listed.objects.map(o => ({ key: o.key, size: o.size, etag: o.etag, uploaded: o.uploaded }))
        });
      }

      if (p === '/r2/object') {
        if (!env.SRC_R2) return json({ error: 'binding_unavailable' }, 503);
        const key = url.searchParams.get('key') || '';
        if (!key) return json({ error: 'key_required' }, 400);
        const obj = await env.SRC_R2.get(key);
        if (!obj) return json({ error: 'not_found' }, 404);
        const h = new Headers();
        obj.writeHttpMetadata(h);
        h.set('x-mig-etag', obj.etag);
        h.set('x-mig-size', String(obj.size));
        return new Response(obj.body, { headers: h });   // streamed, never buffered
      }

      if (p === '/r2/fingerprint') {
        if (!env.SRC_R2) return json({ error: 'binding_unavailable' }, 503);
        let cursor, n = 0, bytes = 0, multipart = 0;
        do {
          const listed = await env.SRC_R2.list({ cursor: cursor, limit: 1000 });
          for (const o of listed.objects) {
            n++; bytes += o.size;
            if (String(o.etag).indexOf('-') !== -1) multipart++;
          }
          cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);
        return json({ objects: n, bytes: bytes, multipart_etags: multipart });
      }

      return json({ error: 'not_found' }, 404);
    } catch (e) {
      const msg = String(e && e.message || e);
      return json({ error: msg === 'unknown_table' ? 'unknown_table' : 'source_error', detail: msg.slice(0, 200) }, 400);
    }
  }
};
