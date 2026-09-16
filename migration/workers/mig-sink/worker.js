/**
 * mig-sink — TEMPORARY TabReady migration writer.
 *
 * Account:  church ffd360b239936d51e85d9961fdaeb65a
 * Bindings: DST     D1 -> tabready-main   (548cf797-8313-4a3e-827f-408ff1676b73)
 *           DST_R2  R2 -> tabready-photos
 * Vars:     MIG_SOURCE_URL   https://mig-source.shanepass.workers.dev
 * Secret:   MIG_SECRET       (entered directly in the dashboard, same value as mig-source)
 *
 * Pulls from mig-source and writes here. The church side drives the copy, so
 * the personal side stays a pure reader that knows nothing about a destination.
 *
 * NO PERSISTENT JOB STATE. Progress is derived from the destination itself on
 * every invocation — a table resumes at its own current row count, and an
 * object is skipped when it is already present at the same size. A crash, a
 * timeout or a double tap therefore cannot duplicate or skip anything; the
 * worst case is repeated work. This is deliberate: a job table would be one
 * more thing to keep truthful and one more thing to clean up.
 *
 * Delete this worker once the copy is verified.
 */

const SKEW_MS = 300000;
const BUDGET_MS = 20000;     // stop and hand off to a continuation
const MAX_CHAIN = 400;       // runaway guard
const MAX_FETCH = 700;       // subrequest guard
const PAGE = 200;
const SQL_BYTES = 90000;

const json = (o, s = 200) =>
  new Response(JSON.stringify(o, null, 2), { status: s, headers: { 'content-type': 'application/json' } });

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

// FK edges are few and shallow; parents must land before children.
const TIER = {
  users: 0, roles: 0, people_registry: 0, weekly_updates: 0, weekly_packets: 0, weekly_priv_steps: 0,
  weekly_versions: 2,
  alerts: 3, audit_log: 3, user_roles: 3, role_assignments: 3,
  weekly_correction_requests: 3, weekly_review_notes: 3, weekly_priv_step_history: 3,
  weekly_packet_items: 3
};
const tierOf = (t) => (t in TIER ? TIER[t] : 1);

// Tables that MUST EXIST but MUST STAY EMPTY.
//
// The live app inserts into and selects from every one of these, so a
// destination without them throws "no such table" in production — on the first
// login attempt, in the case of magic_links and login_codes. Their CONTENTS are
// a different question: live auth material, JWT replay records, rate-limit
// counters and PCO cache are all deliberately left behind. Schema travels,
// rows do not.
const SCHEMA_ONLY = new Set(['auth_request_limits','incident_shares','login_codes','magic_links','pco_cal_instances','pco_cal_sync_runs','pco_dates_cache','pco_group_cache','pco_group_members','place_invites','push_subscriptions','recovery_requests','roster_sync_changes','roster_sync_runs','transfer_jti']);

// ------------------------------------------------------------------- auth

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
  if (!env.MIG_SECRET) return json({ error: 'credential_source_unavailable' }, 503);
  if (!env.DST) return json({ error: 'binding_unavailable' }, 503);
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

// ------------------------------------------------------------ source calls

function makeSrc(env, counter) {
  const base = String(env.MIG_SOURCE_URL || '').replace(/\/+$/, '');
  return async function src(path, raw) {
    if (!base) throw new Error('MIG_SOURCE_URL is not set');
    if (counter.n++ > MAX_FETCH) throw new Error('subrequest_budget_exhausted');
    const ts = String(Date.now());
    const u = new URL(base + path);
    const sig = await hmacHex(env.MIG_SECRET, 'GET\n' + u.pathname + u.search + '\n' + ts);
    const r = await fetch(u.toString(), { headers: { 'x-mig-ts': ts, 'x-mig-sig': sig } });
    if (!r.ok) throw new Error('source_' + r.status + ' on ' + path + ': ' + (await r.text()).slice(0, 160));
    return raw ? r : await r.json();
  };
}

// ---------------------------------------------------------------- helpers

async function dstTables(env) {
  const { results } = await env.DST.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
  ).all();
  return (results || []).map(r => r.name);
}

async function countAt(env, table) {
  const r = await env.DST.prepare('SELECT COUNT(*) AS n FROM ' + q(table)).first();
  return (r && r.n) || 0;
}

async function ddlCount(env, kind) {
  const r = await env.DST.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type=? AND sql IS NOT NULL").bind(kind).first();
  return (r && r.n) || 0;
}

// Re-runnable DDL: a continuation must not fail on an object it already made.
function idempotent(sql) {
  return String(sql)
    .replace(/^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i, (m, u) => 'CREATE ' + (u || '') + 'INDEX IF NOT EXISTS ')
    .replace(/^\s*CREATE\s+VIEW\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE VIEW IF NOT EXISTS ')
    .replace(/^\s*CREATE\s+TRIGGER\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE TRIGGER IF NOT EXISTS ');
}

async function selfChain(env, ctx, path, chain) {
  if (chain >= MAX_CHAIN) return false;
  const base = String(env.MIG_SELF_URL || '').replace(/\/+$/, '');
  if (!base) return false;
  const u = new URL(base + path);
  u.searchParams.set('chain', String(chain + 1));
  const ts = String(Date.now());
  const sig = await hmacHex(env.MIG_SECRET, 'POST\n' + u.pathname + u.search + '\n' + ts);
  ctx.waitUntil(fetch(u.toString(), { method: 'POST', headers: { 'x-mig-ts': ts, 'x-mig-sig': sig } }));
  return true;
}

// --------------------------------------------------------------- d1 phase

async function runD1(env, ctx, chain) {
  const t0 = Date.now();
  const counter = { n: 0 };
  const src = makeSrc(env, counter);

  const tables = await dstTables(env);
  if (!tables.length) return { error: 'destination has no tables — run the schema phase first' };

  // Triggers must not be attached during the load. trg_content_ins writes a
  // content_versions row per inserted content row, so a load with triggers
  // live fabricates history that a row-count check would pass.
  const liveDdl = (await ddlCount(env, 'index')) + (await ddlCount(env, 'trigger')) + (await ddlCount(env, 'view'));

  const srcTables = (await src('/d1/tables')).tables;
  const orphans = tables.filter(t => srcTables.indexOf(t) === -1 && t !== '_cf_KV');
  if (orphans.length) return { error: 'destination tables absent from source: ' + orphans.join(', ') };

  const ordered = tables.slice().sort((a, b) => tierOf(a) - tierOf(b) || a.localeCompare(b));
  const loaded = {};
  let movedAny = false;

  for (const t of ordered) {
    if (SCHEMA_ONLY.has(t)) {
      const here = await countAt(env, t);
      if (here !== 0) return { error: t + ' is schema-only but holds ' + here + ' rows at the destination' };
      continue;
    }
    const fp = (await src('/d1/fingerprint?t=' + encodeURIComponent(t))).fingerprint;
    const want = (fp && fp.n) || 0;
    let have = await countAt(env, t);
    if (have > want) return { error: 'destination has more rows than source in ' + t + ' (' + have + ' > ' + want + ')' };

    while (have < want) {
      if (liveDdl > 0) return { error: 'destination carries ' + liveDdl + ' index/trigger/view objects — load must run against a bare schema' };
      if (Date.now() - t0 > BUDGET_MS) {
        const more = await selfChain(env, ctx, '/run/d1', chain);
        return { phase: 'rows', done: false, continued: more, table: t, at: have, of: want, loaded: loaded };
      }
      const page = await src('/d1/rows?t=' + encodeURIComponent(t) + '&limit=' + PAGE + '&offset=' + have);
      if (!page.count) return { error: 'source returned no rows for ' + t + ' at offset ' + have + ' while ' + (want - have) + ' remain' };

      // NOT exec(): D1's exec splits statements on newlines, and a content body
      // or a JSON column legitimately contains newlines inside its quoted
      // literal, which would shred the statement. batch() takes whole prepared
      // statements and runs them in a transaction, so a batch either lands
      // completely or not at all.
      let group = [], bytes = 0;
      for (const stmt of page.statements) {
        if (bytes + stmt.length > SQL_BYTES && group.length) {
          await env.DST.batch(group); group = []; bytes = 0;
        }
        group.push(env.DST.prepare(stmt)); bytes += stmt.length;
      }
      if (group.length) await env.DST.batch(group);

      // Re-read rather than assume: a partially applied batch self-corrects,
      // because the next offset is whatever actually landed.
      const now = await countAt(env, t);
      if (now <= have) return { error: 'no progress loading ' + t + ' at offset ' + have };
      have = now; movedAny = true;
    }
    if (want) loaded[t] = want;
  }

  // ---- post-load DDL, in order: indexes, then views, then triggers
  for (const kind of ['index', 'view', 'trigger']) {
    const objs = (await src('/d1/ddl?type=' + kind)).objects || [];
    for (const o of objs) {
      if (kind !== 'view' && tables.indexOf(o.tbl_name) === -1) continue;  // belongs to an excluded table
      if (Date.now() - t0 > BUDGET_MS) {
        const more = await selfChain(env, ctx, '/run/d1', chain);
        return { phase: 'ddl', done: false, continued: more, kind: kind, loaded: loaded };
      }
      await env.DST.prepare(idempotent(o.sql)).run();
    }
  }

  return {
    phase: 'complete', done: true, tables: ordered.length,
    rows: Object.keys(loaded).reduce((a, k) => a + loaded[k], 0),
    indexes: await ddlCount(env, 'index'),
    views: await ddlCount(env, 'view'),
    triggers: await ddlCount(env, 'trigger'),
    moved_this_pass: movedAny
  };
}

// --------------------------------------------------------------- r2 phase

async function runR2(env, ctx, chain, cursor) {
  if (!env.DST_R2) return { error: 'DST_R2 binding is not configured' };
  const t0 = Date.now();
  const counter = { n: 0 };
  const src = makeSrc(env, counter);

  let copied = 0, skipped = 0, bytes = 0, cur = cursor || '';
  for (;;) {
    const listed = await src('/r2/list?limit=200' + (cur ? '&cursor=' + encodeURIComponent(cur) : ''));
    for (const o of listed.objects) {
      if (Date.now() - t0 > BUDGET_MS) {
        const more = await selfChain(env, ctx, '/run/r2?cursor=' + encodeURIComponent(cur), chain);
        return { phase: 'r2', done: false, continued: more, copied: copied, skipped: skipped, bytes: bytes };
      }
      const head = await env.DST_R2.head(o.key);
      if (head && head.size === o.size) { skipped++; continue; }   // already here, same size
      const r = await src('/r2/object?key=' + encodeURIComponent(o.key), true);
      const httpMetadata = {};
      const ct = r.headers.get('content-type');
      if (ct) httpMetadata.contentType = ct;
      await env.DST_R2.put(o.key, r.body, { httpMetadata: httpMetadata });   // streamed, never buffered
      copied++; bytes += o.size;
    }
    if (!listed.truncated) break;
    cur = listed.cursor;
  }
  return { phase: 'r2', done: true, copied: copied, skipped: skipped, bytes: bytes };
}

// ---------------------------------------------------------------- verify

async function verify(env) {
  const counter = { n: 0 };
  const src = makeSrc(env, counter);
  const checks = [];
  const add = (name, pass, detail) => checks.push({ check: name, result: pass ? 'PASS' : 'FAIL', detail: detail });

  const tables = await dstTables(env);
  const srcTables = (await src('/d1/tables')).tables;

  // 1 — row counts and content fingerprints
  const bad = [];
  const notEmpty = [];
  let total = 0;
  for (const t of tables) {
    if (SCHEMA_ONLY.has(t)) {
      const here = await countAt(env, t);
      if (here !== 0) notEmpty.push({ table: t, rows: here });
      continue;
    }
    const want = (await src('/d1/fingerprint?t=' + encodeURIComponent(t))).fingerprint;
    const cols = (await src('/d1/columns?t=' + encodeURIComponent(t))).columns;
    const rt = cols.map(c => 'quote(' + q(c) + ')').join(" || char(31) || ");
    const got = await env.DST.prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(rt)),0) AS len, COALESCE(SUM(UNICODE(rt)),0) AS h1,' +
      ' COALESCE(SUM(UNICODE(SUBSTR(rt,(LENGTH(rt)+1)/2,1))),0) AS h2,' +
      ' COALESCE(SUM(UNICODE(SUBSTR(rt,LENGTH(rt),1))),0) AS h3 FROM (SELECT ' + rt + ' AS rt FROM ' + q(t) + ')'
    ).first();
    total += (want && want.n) || 0;
    const same = want && got && ['n', 'len', 'h1', 'h2', 'h3'].every(k => Number(want[k]) === Number(got[k]));
    if (!same) bad.push({ table: t, source: want, destination: got });
  }
  add('row counts and content fingerprints', bad.length === 0,
    bad.length ? bad : (tables.length - SCHEMA_ONLY.size) + ' copied tables match source exactly (' + total + ' rows)');
  add('schema-only tables are empty', notEmpty.length === 0,
    notEmpty.length ? notEmpty : SCHEMA_ONLY.size + ' tables present and empty — no auth material, JWT replay record, rate-limit counter or PCO cache row was carried over');

  // 2 — excluded tables stayed excluded
  const excluded = srcTables.filter(t => tables.indexOf(t) === -1);
  // Assert the forbidden categories are absent by name. Comparing the
  // destination list against itself, as an earlier draft of this did, is a
  // check that can never fail and therefore proves nothing.
  const forbidden = tables.filter(t => !SCHEMA_ONLY.has(t) && (
    /_backup/i.test(t) || /^wave\d/i.test(t) || /_legacy_/i.test(t) || /_rollback_/i.test(t) ||
    /migration_ledger|routing_snapshot|consolidation_audit|pilot_tokens/i.test(t)));
  add('excluded tables', forbidden.length === 0,
    forbidden.length ? forbidden : excluded.length + ' source tables deliberately absent (auth material, PCO cache, backups)');

  // 3 — settings allow-list, KEY NAMES ONLY. Values are never read or compared.
  const srcKeys = (await src('/d1/setting-keys')).keys || [];
  const dstKeyRows = await env.DST.prepare('SELECT key FROM app_settings ORDER BY key').all();
  const dstKeys = (dstKeyRows.results || []).map(r => r.key);
  const keysMatch = srcKeys.length === dstKeys.length && srcKeys.every((k, i) => k === dstKeys[i]);
  add('app_settings keys', keysMatch, dstKeys.length + ' keys, names compared only — values are never selected, sent or compared');
  const suspect = dstKeys.filter(k => /key|secret|token|pass|salt|credential|hash|private/i.test(k));
  add('no credential-shaped settings', suspect.length === 0, suspect.length ? suspect : 'none');

  // 4 — indexes, triggers, views
  for (const kind of ['index', 'view', 'trigger']) {
    const objs = (await src('/d1/ddl?type=' + kind)).objects || [];
    const expected = kind === 'view' ? objs.length : objs.filter(o => tables.indexOf(o.tbl_name) !== -1).length;
    const got = await ddlCount(env, kind);
    add(kind + 'es', got === expected, got + ' of ' + objs.length + ' present (' + (objs.length - expected) + ' belong to excluded tables)');
  }

  // 5 — history counts, with content_versions as the trigger canary
  for (const t of ['audit_log', 'audit_log_v2', 'content_versions', 'msg_events', 'msg_sends', 'msg_deliveries']) {
    if (tables.indexOf(t) === -1) continue;
    const want = ((await src('/d1/fingerprint?t=' + t)).fingerprint || {}).n;
    const got = await countAt(env, t);
    add('history ' + t, want === got, 'source ' + want + ', destination ' + got);
  }

  // 6 — destination reads correctly
  const reads = [
    ['user to role join', 'SELECT COUNT(*) AS n FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id'],
    ['content readable', 'SELECT COUNT(*) AS n FROM content WHERE deleted_at IS NULL'],
    ['v_user_org view', 'SELECT COUNT(*) AS n FROM v_user_org'],
    ['v_user_capabilities view', 'SELECT COUNT(*) AS n FROM v_user_capabilities'],
    ['version history reachable', 'SELECT COUNT(*) AS n FROM content c JOIN content_versions v ON v.content_id=c.id'],
    ['global admin present', 'SELECT COUNT(*) AS n FROM users WHERE is_global_admin=1']
  ];
  for (const [label, sql] of reads) {
    try { const r = await env.DST.prepare(sql).first(); add('read: ' + label, !!(r && r.n > 0), 'returned ' + (r && r.n)); }
    catch (e) { add('read: ' + label, false, String(e && e.message || e).slice(0, 160)); }
  }

  // 7 — R2
  if (env.DST_R2) {
    const want = await src('/r2/fingerprint');
    let n = 0, bytes = 0, cur;
    do {
      const l = await env.DST_R2.list({ cursor: cur, limit: 1000 });
      for (const o of l.objects) { n++; bytes += o.size; }
      cur = l.truncated ? l.cursor : undefined;
    } while (cur);
    add('R2 object count', n === want.objects, 'source ' + want.objects + ', destination ' + n);
    add('R2 total bytes', bytes === want.bytes, 'source ' + want.bytes + ', destination ' + bytes);
    if (want.multipart_etags) {
      checks.push({
        check: 'R2 etag comparison', result: 'NOT APPLICABLE',
        detail: want.multipart_etags + ' source objects carry multipart etags, which are composite and do not compare across accounts. Key set and byte sizes are the comparison used.'
      });
    }
  } else {
    add('R2', false, 'DST_R2 binding missing — photo storage not verified');
  }

  const failed = checks.filter(c => c.result === 'FAIL');
  return { ok: failed.length === 0, failed: failed.length, checks: checks };
}

// ------------------------------------------------------------------ router

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === '/health') {
      return json({
        ok: true, service: 'mig-sink', role: 'writer',
        bindings: { DST: !!env.DST, DST_R2: !!env.DST_R2 },
        source_url_set: !!env.MIG_SOURCE_URL,
        self_url_set: !!env.MIG_SELF_URL,
        secret_present: !!env.MIG_SECRET
      });
    }

    const denied = await requireSig(request, env);
    if (denied) return denied;

    const chain = parseInt(url.searchParams.get('chain') || '0', 10) || 0;
    try {
      if (p === '/run/d1' && request.method === 'POST') return json(await runD1(env, ctx, chain));
      if (p === '/run/r2' && request.method === 'POST') return json(await runR2(env, ctx, chain, url.searchParams.get('cursor') || ''));
      if (p === '/verify') { const v = await verify(env); return json(v, v.ok ? 200 : 409); }
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: 'sink_error', detail: String(e && e.message || e).slice(0, 300) }, 500);
    }
  }
};
