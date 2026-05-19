// compass-api-v14.js
// ── Capture Promote Cleanup ──
// Changes from v13:
//   - PATCH 1: PUT /capture/:id now supports processed_at, promoted_to_type,
//     promoted_to_id fields (in addition to content). Content no longer required;
//     any of the four fields may be updated. Used by Jennie promote flow to mark
//     captures as processed instead of hard-deleting them.
//   - PATCH 2: GET /capture now defaults to showing only unprocessed (active)
//     captures. Supports ?status=processed and ?status=all for other views.
//
// All v13 features preserved.
//
// v13 baseline (Air Traffic Control upgrade):
//   - DRIFT FIX: signals INSERT now matches schema (added person_name, detail columns to DB)
//   - DRIFT FIX: notes INSERT now matches schema (added title, tags columns to DB)
//   - DRIFT FIX: agent_sessions table recreated to match worker code
//   - DRIFT FIX: audit_events INSERT now works (added detail column to DB)
//   - DRIFT FIX: people INSERT now matches schema (added email, phone, updated_at)
//   - Identity stamping on every write — actor + actor_session columns
//   - actor resolved from header X-Actor (jennie | scout | claude | garvis | system)
//     Defaults to 'jennie' if not provided
//   - Audit logging — every write logs to audit_events automatically
//   - POST /scout/capture — Scout's write endpoint (alias for /capture, stamps actor=scout)
//   - GET /audit — view recent audit events

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Actor, X-Actor-Session',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

const VALID_DOMAINS = ['Lead', 'People', 'Systems', 'Risk', 'Financial'];
const VALID_VISIBILITY = ['private', 'leadership', 'congregation'];
const VALID_ACTORS = ['jennie', 'scout', 'claude', 'garvis', 'system', 'pco', 'outlook'];

// ── ACTOR RESOLUTION ──────────────────────────────────────────────────────────
function resolveActor(request, defaultActor = 'jennie') {
  const headerActor = request.headers.get('X-Actor');
  if (headerActor && VALID_ACTORS.includes(headerActor)) return headerActor;
  return defaultActor;
}

function resolveActorSession(request) {
  return request.headers.get('X-Actor-Session') || null;
}

// ── AUTH HELPER ────────────────────────────────────────────────────────────────
function requireAuth(request, env) {
  const expected = env.COMPASS_TOKEN;
  if (!expected) return null;
  const auth = request.headers.get('Authorization') || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (provided !== expected) return err('Unauthorized', 401);
  return null;
}

// ── AUDIT HELPER ──────────────────────────────────────────────────────────────
async function logAudit(env, action, table_name, record_id, actor, actor_session, detail) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_events (action, table_name, record_id, detail, actor, actor_session, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(action, table_name, record_id || null, detail || null, actor || null, actor_session || null).run();
  } catch(e) {
    console.error('Audit log failed:', e.message);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Health check — always open
    if (path === '/health' && method === 'GET') {
      return json({
        ok: true,
        service: 'compass-api',
        version: 'v14',
        auth_mode: env.COMPASS_TOKEN ? 'enforced' : 'open',
        features: ['identity_stamping', 'audit_logging', 'scout_write', 'capture_promote_cleanup'],
      });
    }

    // All other routes require auth
    const authError = requireAuth(request, env);
    if (authError) return authError;

    // Resolve identity once per request
    const isScoutPath = path.startsWith('/scout/');
    const actor = isScoutPath ? 'scout' : resolveActor(request);
    const actorSession = resolveActorSession(request);

    try {
      // ── CAPTURE QUEUE ──────────────────────────────────────────────
      if (path === '/capture' && method === 'POST') {
        const body = await request.json();
        const { content, source = 'manual', type = 'note' } = body;
        if (!content) return err('content required');
        const result = await env.DB.prepare(
          `INSERT INTO capture_queue (content, source, type, actor, actor_session, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        ).bind(content, source, type, actor, actorSession).run();
        await logAudit(env, 'create', 'capture_queue', result.meta?.last_row_id, actor, actorSession, content.substring(0, 100));
        return json({ ok: true, id: result.meta?.last_row_id });
      }

      // PATCH 2: default to active captures; support ?status=processed and ?status=all
      if (path === '/capture' && method === 'GET') {
        const status = url.searchParams.get('status') || 'active';
        const query =
          status === 'processed'
            ? `SELECT * FROM capture_queue WHERE processed_at IS NOT NULL ORDER BY processed_at DESC LIMIT 50`
            : status === 'all'
              ? `SELECT * FROM capture_queue ORDER BY created_at DESC LIMIT 50`
              : `SELECT * FROM capture_queue WHERE processed_at IS NULL ORDER BY created_at DESC LIMIT 50`;
        const rows = await env.DB.prepare(query).all();
        return json(rows.results);
      }

      if (path.startsWith('/capture/') && method === 'DELETE') {
        const id = path.split('/')[2];
        await env.DB.prepare(`DELETE FROM capture_queue WHERE id = ?`).bind(id).run();
        await logAudit(env, 'delete', 'capture_queue', id, actor, actorSession, null);
        return json({ ok: true });
      }

      // PATCH 1: support partial updates for content, processed_at, promoted_to_type, promoted_to_id
      if (path.startsWith('/capture/') && method === 'PUT') {
        const id = path.split('/')[2];
        const body = await request.json();
        const { content, processed_at, promoted_to_type, promoted_to_id } = body;
        const sets = [];
        const vals = [];
        if (content !== undefined) { sets.push('content = ?'); vals.push(content); }
        if (processed_at !== undefined) { sets.push('processed_at = ?'); vals.push(processed_at); }
        if (promoted_to_type !== undefined) { sets.push('promoted_to_type = ?'); vals.push(promoted_to_type); }
        if (promoted_to_id !== undefined) { sets.push('promoted_to_id = ?'); vals.push(promoted_to_id); }
        if (!sets.length) return err('no fields to update');
        vals.push(id);
        await env.DB.prepare(
          `UPDATE capture_queue SET ${sets.join(', ')} WHERE id = ?`
        ).bind(...vals).run();
        const auditDetail = content
          ? content.substring(0, 100)
          : (promoted_to_type ? `promoted to ${promoted_to_type} #${promoted_to_id || '?'}` : 'updated');
        await logAudit(env, 'update', 'capture_queue', id, actor, actorSession, auditDetail);
        return json({ ok: true });
      }

      // ── SCOUT WRITE ENDPOINT ───────────────────────────────────────
      if (path === '/scout/capture' && method === 'POST') {
        const body = await request.json();
        const { content, source = 'scout', type = 'note' } = body;
        if (!content) return err('content required');
        const result = await env.DB.prepare(
          `INSERT INTO capture_queue (content, source, type, actor, actor_session, created_at)
           VALUES (?, ?, ?, 'scout', ?, datetime('now'))`
        ).bind(content, source, type, actorSession).run();
        await logAudit(env, 'create', 'capture_queue', result.meta?.last_row_id, 'scout', actorSession, content.substring(0, 100));
        return json({ ok: true, id: result.meta?.last_row_id, captured: 'scout' });
      }

      if (path === '/scout/attention' && method === 'POST') {
        const body = await request.json();
        const { title, detail, due_date, operational_domain, visibility } = body;
        if (!title) return err('title required');
        if (operational_domain && !VALID_DOMAINS.includes(operational_domain)) {
          return err('operational_domain must be one of: ' + VALID_DOMAINS.join(', '));
        }
        if (visibility && !VALID_VISIBILITY.includes(visibility)) {
          return err('visibility must be one of: ' + VALID_VISIBILITY.join(', '));
        }
        const result = await env.DB.prepare(
          `INSERT INTO attention_items
            (title, detail, due_date, operational_domain, visibility, source, actor, actor_session, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'scout', 'scout', ?, datetime('now'), datetime('now'))`
        ).bind(title, detail || null, due_date || null, operational_domain || null, visibility || null, actorSession).run();
        await logAudit(env, 'create', 'attention_items', result.meta?.last_row_id, 'scout', actorSession, title);
        return json({ ok: true, id: result.meta?.last_row_id });
      }

      if (path === '/scout/task' && method === 'POST') {
        const body = await request.json();
        const { task, title, due_date, priority = 'medium', project, notes } = body;
        const taskName = task || title;
        if (!taskName) return err('task required');
        const result = await env.DB.prepare(
          `INSERT INTO tasks (user_id, task, due_date, priority, project, notes, status, actor, actor_session, created_at)
           VALUES ('shane', ?, ?, ?, ?, ?, 'open', 'scout', ?, datetime('now'))`
        ).bind(taskName, due_date || null, priority, project || null, notes || null, actorSession).run();
        await logAudit(env, 'create', 'tasks', result.meta?.last_row_id, 'scout', actorSession, taskName);
        return json({ ok: true, id: result.meta?.last_row_id });
      }

      // ── NOTES ──────────────────────────────────────────────────────
      if (path === '/notes' && method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT * FROM notes ORDER BY created_at DESC LIMIT 100`
        ).all();
        return json(rows.results);
      }

      if (path === '/notes' && method === 'POST') {
        const body = await request.json();
        const { title, content, tags } = body;
        if (!content) return err('content required');
        const result = await env.DB.prepare(
          `INSERT INTO notes (title, content, tags, actor, actor_session, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        ).bind(title || '', content, tags || '', actor, actorSession).run();
        await logAudit(env, 'create', 'notes', result.meta?.last_row_id, actor, actorSession, (title || content).substring(0, 100));
        return json({ ok: true, id: result.meta?.last_row_id });
      }

      // ── TASKS ──────────────────────────────────────────────────────
      if (path === '/tasks' && method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT * FROM tasks WHERE status != 'done' ORDER BY due_date ASC, priority DESC`
        ).all();
        return json(rows.results);
      }

      if (path === '/tasks' && method === 'POST') {
        const body = await request.json();
        const { task, title, due_date, priority = 'medium', project, notes } = body;
        const taskName = task || title;
        if (!taskName) return err('task required');
        const result = await env.DB.prepare(
          `INSERT INTO tasks (user_id, task, due_date, priority, project, notes, status, actor, actor_session, created_at)
           VALUES ('shane', ?, ?, ?, ?, ?, 'open', ?, ?, datetime('now'))`
        ).bind(taskName, due_date || null, priority, project || null, notes || null, actor, actorSession).run();
        await logAudit(env, 'create', 'tasks', result.meta?.last_row_id, actor, actorSession, taskName);
        return json({ ok: true, id: result.meta?.last_row_id });
      }

      if (path.startsWith('/tasks/') && method === 'PUT') {
        const id = path.split('/')[2];
        const body = await request.json();
        const { status, task, title, due_date, priority, project, notes } = body;
        const taskName = task || title || null;
        await env.DB.prepare(
          `UPDATE tasks SET status=COALESCE(?,status), task=COALESCE(?,task),
           due_date=COALESCE(?,due_date), priority=COALESCE(?,priority),
           project=COALESCE(?,project), notes=COALESCE(?,notes) WHERE id=?`
        ).bind(status||null, taskName, due_date||null, priority||null, project||null, notes||null, id).run();
        await logAudit(env, 'update', 'tasks', id, actor, actorSession, taskName || status);
        return json({ ok: true });
      }

      if (path.startsWith('/tasks/') && method === 'DELETE') {
        const id = path.split('/')[2];
        await env.DB.prepare(`UPDATE tasks SET status='done' WHERE id=?`).bind(id).run();
        await logAudit(env, 'complete', 'tasks', id, actor, actorSession, null);
        return json({ ok: true });
      }

      // ── SIGNALS ────────────────────────────────────────────────────
      if (path === '/signals' && method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT * FROM signals WHERE resolved_at IS NULL ORDER BY created_at DESC`
        ).all();
        return json(rows.results);
      }

      if (path === '/signals' && method === 'POST') {
        const body = await request.json();
        const { type, person_name, detail, source = 'manual' } = body;
        if (!type) return err('type required');
        const result = await env.DB.prepare(
          `INSERT INTO signals (type, person_name, detail, source, actor, actor_session, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(type, person_name || null, detail || null, source, actor, actorSession).run();
        await logAudit(env, 'create', 'signals', result.meta?.last_row_id, actor, actorSession, `${type}: ${person_name || ''}`);
        return json({ ok: true, id: result.meta?.last_row_id });
      }

      if (path.startsWith('/signals/') && method === 'PUT') {
        const id = path.split('/')[2];
        await env.DB.prepare(
          `UPDATE signals SET resolved_at=datetime('now') WHERE id=?`
        ).bind(id).run();
        await logAudit(env, 'resolve', 'signals', id, actor, actorSession, null);
        return json({ ok: true });
      }

      // ── ATTENTION ITEMS ────────────────────────────────────────────
      if (path === '/attention' && method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT * FROM attention_items WHERE resolved_at IS NULL ORDER BY due_date ASC`
        ).all();
        return json(rows.results);
      }

      if (path === '/attention' && method === 'POST') {
        const body = await request.json();
        const {
          title, detail, due_date, color_override,
          context_key, operational_domain, visibility,
          payload, action_state, source
        } = body;
        if (!title) return err('title required');

        if (operational_domain && !VALID_DOMAINS.includes(operational_domain)) {
          return err('operational_domain must be one of: ' + VALID_DOMAINS.join(', '));
        }
        if (visibility && !VALID_VISIBILITY.includes(visibility)) {
          return err('visibility must be one of: ' + VALID_VISIBILITY.join(', '));
        }

        const payloadStr = payload && typeof payload === 'object'
          ? JSON.stringify(payload) : (payload || null);
        const actionStateStr = action_state && typeof action_state === 'object'
          ? JSON.stringify(action_state) : (action_state || null);

        const result = await env.DB.prepare(
          `INSERT INTO attention_items
            (title, detail, due_date, color_override,
             context_key, operational_domain, visibility,
             payload, action_state, source, actor, actor_session,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        ).bind(
          title, detail || null, due_date || null, color_override || null,
          context_key || null, operational_domain || null, visibility || null,
          payloadStr, actionStateStr, source || null, actor, actorSession
        ).run();
        await logAudit(env, 'create', 'attention_items', result.meta?.last_row_id, actor, actorSession, title);
        return json({ ok: true, id: result.meta?.last_row_id });
      }

      if (path.startsWith('/attention/') && method === 'PUT') {
        const id = path.split('/')[2];
        const body = await request.json();
        const {
          title, detail, due_date, color_override,
          context_key, operational_domain, visibility,
          payload, action_state, source
        } = body;

        if (operational_domain && !VALID_DOMAINS.includes(operational_domain)) {
          return err('operational_domain must be one of: ' + VALID_DOMAINS.join(', '));
        }
        if (visibility && !VALID_VISIBILITY.includes(visibility)) {
          return err('visibility must be one of: ' + VALID_VISIBILITY.join(', '));
        }

        const payloadStr = payload && typeof payload === 'object' ? JSON.stringify(payload) : payload;
        const actionStateStr = action_state && typeof action_state === 'object' ? JSON.stringify(action_state) : action_state;

        await env.DB.prepare(
          `UPDATE attention_items SET
            title=COALESCE(?,title), detail=COALESCE(?,detail),
            due_date=COALESCE(?,due_date), color_override=COALESCE(?,color_override),
            context_key=COALESCE(?,context_key), operational_domain=COALESCE(?,operational_domain),
            visibility=COALESCE(?,visibility), payload=COALESCE(?,payload),
            action_state=COALESCE(?,action_state), source=COALESCE(?,source),
            updated_at=datetime('now')
          WHERE id=?`
        ).bind(
          title||null, detail||null, due_date||null, color_override||null,
          context_key||null, operational_domain||null, visibility||null,
          payloadStr||null, actionStateStr||null, source||null, id
        ).run();
        await logAudit(env, 'update', 'attention_items', id, actor, actorSession, title);
        return json({ ok: true });
      }

      if (path.startsWith('/attention/') && method === 'DELETE') {
        const id = path.split('/')[2];
        await env.DB.prepare(
          `UPDATE attention_items SET resolved_at=datetime('now') WHERE id=?`
        ).bind(id).run();
        await logAudit(env, 'resolve', 'attention_items', id, actor, actorSession, null);
        return json({ ok: true });
      }

      // ── DOCUMENTS ──────────────────────────────────────────────────
      if (path === '/documents' && method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT * FROM documents ORDER BY updated_at DESC LIMIT 100`
        ).all();
        return json(rows.results);
      }

      if (path === '/documents' && method === 'POST') {
        const body = await request.json();
        const { title, content, type, tags } = body;
        const result = await env.DB.prepare(
          `INSERT INTO documents (user_id, title, content, type, tags, actor, actor_session, created_at, updated_at)
           VALUES ('shane', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        ).bind(title || '', content || '', type || 'general', tags || '', actor, actorSession).run();
        await logAudit(env, 'create', 'documents', result.meta?.last_row_id, actor, actorSession, title);
        return json({ ok: true, id: result.meta?.last_row_id });
      }

      // ── PEOPLE ─────────────────────────────────────────────────────
      if (path === '/people' && method === 'GET') {
        const q = url.searchParams.get('q');
        let rows;
        if (q) {
          rows = await env.DB.prepare(
            `SELECT * FROM people WHERE name LIKE ? OR email LIKE ? LIMIT 50`
          ).bind(`%${q}%`, `%${q}%`).all();
        } else {
          rows = await env.DB.prepare(`SELECT * FROM people ORDER BY name LIMIT 100`).all();
        }
        return json(rows.results);
      }

      if (path === '/people' && method === 'POST') {
        const body = await request.json();
        const { name, email, phone, pco_id, notes } = body;
        if (!name) return err('name required');
        const id = body.id || (name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now());
        await env.DB.prepare(
          `INSERT OR REPLACE INTO people (id, name, email, phone, pco_id, notes, updated_at, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        ).bind(id, name, email || null, phone || null, pco_id || null, notes || null).run();
        await logAudit(env, 'upsert', 'people', null, actor, actorSession, name);
        return json({ ok: true, id });
      }

      // ── GROUPS ─────────────────────────────────────────────────────
      if (path === '/groups' && method === 'GET') {
        const rows = await env.DB.prepare(`SELECT * FROM groups ORDER BY name`).all();
        return json(rows.results);
      }

      // ── REGISTRATIONS ──────────────────────────────────────────────
      if (path === '/registrations' && method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT * FROM registrations ORDER BY synced_at DESC LIMIT 100`
        ).all();
        return json(rows.results);
      }

      // ── AGENT SESSIONS ─────────────────────────────────────────────
      if (path === '/sessions' && method === 'POST') {
        const body = await request.json();
        const { session_id, role, content } = body;
        if (!session_id || !content) return err('session_id and content required');
        await env.DB.prepare(
          `INSERT INTO agent_sessions (session_id, role, content, actor, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`
        ).bind(session_id, role || 'user', content, actor).run();
        return json({ ok: true });
      }

      if (path.startsWith('/sessions/') && method === 'GET') {
        const session_id = path.split('/')[2];
        const rows = await env.DB.prepare(
          `SELECT * FROM agent_sessions WHERE session_id=? ORDER BY created_at ASC`
        ).bind(session_id).all();
        return json(rows.results);
      }

      // ── AUDIT ──────────────────────────────────────────────────────
      if (path === '/audit' && method === 'GET') {
        const limit = url.searchParams.get('limit') || '50';
        const filterActor = url.searchParams.get('actor');
        const filterTable = url.searchParams.get('table');
        let sql = `SELECT * FROM audit_events`;
        const where = [];
        const binds = [];
        if (filterActor) { where.push('actor = ?'); binds.push(filterActor); }
        if (filterTable) { where.push('table_name = ?'); binds.push(filterTable); }
        if (where.length) sql += ' WHERE ' + where.join(' AND ');
        sql += ' ORDER BY created_at DESC LIMIT ?';
        binds.push(parseInt(limit, 10));
        const stmt = env.DB.prepare(sql);
        const rows = await (binds.length ? stmt.bind(...binds).all() : stmt.all());
        return json(rows.results);
      }

      if (path === '/audit' && method === 'POST') {
        const body = await request.json();
        const { action, table_name, record_id, detail } = body;
        if (!action) return err('action required');
        await env.DB.prepare(
          `INSERT INTO audit_events (action, table_name, record_id, detail, actor, actor_session, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(action, table_name || null, record_id || null, detail || null, actor, actorSession).run();
        return json({ ok: true });
      }

      // ── RADAR ──────────────────────────────────────────────────────
      if (path === '/radar' && method === 'GET') {
        const queries = [
          env.DB.prepare(`SELECT * FROM signals WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 10`).all(),
          env.DB.prepare(`SELECT * FROM tasks WHERE status != 'done' ORDER BY due_date ASC LIMIT 10`).all(),
          env.DB.prepare(`SELECT * FROM capture_queue ORDER BY created_at DESC LIMIT 5`).all(),
          env.DB.prepare(`SELECT * FROM notes ORDER BY created_at DESC LIMIT 5`).all(),
          env.DB.prepare(`SELECT * FROM attention_items WHERE resolved_at IS NULL ORDER BY due_date ASC LIMIT 10`).all(),
          env.DB.prepare(`SELECT * FROM garvis_items WHERE resolved_at IS NULL ORDER BY due_date ASC LIMIT 10`).all(),
          env.DB.prepare(`SELECT * FROM documents ORDER BY updated_at DESC LIMIT 20`).all(),
        ];
        const settled = await Promise.allSettled(queries);
        const safe = (i) => settled[i].status === 'fulfilled' ? settled[i].value.results : [];
        return json({
          signals: safe(0),
          tasks: safe(1),
          recent_captures: safe(2),
          recent_notes: safe(3),
          attention: safe(4),
          garvis: safe(5),
          documents: safe(6),
          partial: settled.some(s => s.status === 'rejected'),
        });
      }

      // ── OAUTH TOKENS ───────────────────────────────────────────────
      if (path === '/tokens/outlook' && method === 'GET') {
        const row = await env.DB.prepare(
          `SELECT * FROM oauth_tokens WHERE user_id='shane' AND provider='outlook' LIMIT 1`
        ).first();
        return json(row || null);
      }

      if (path === '/tokens/outlook' && method === 'POST') {
        const body = await request.json();
        const { access_token, refresh_token, expires_at } = body;
        await env.DB.prepare(
          `INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, updated_at)
           VALUES ('shane', 'outlook', ?, ?, ?, datetime('now'))
           ON CONFLICT DO UPDATE SET access_token=excluded.access_token, refresh_token=excluded.refresh_token, expires_at=excluded.expires_at, updated_at=datetime('now')`
        ).bind(access_token, refresh_token || null, expires_at || null).run();
        return json({ ok: true });
      }

      // ── GARVIS ITEMS ────────────────────────────────────────────────
      if (path === '/garvis/items' && method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT * FROM garvis_items WHERE resolved_at IS NULL ORDER BY due_date ASC`
        ).all();
        return json(rows.results);
      }

      if (path === '/garvis/import' && method === 'POST') {
        const body = await request.json();
        const items = Array.isArray(body) ? body : [body];
        let imported = 0, skipped = 0;
        for (const item of items) {
          if (!item.title) continue;
          try {
            await env.DB.prepare(
              `INSERT OR IGNORE INTO garvis_items (tela_id, title, detail, due_date, priority, status, imported_at)
               VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
            ).bind(
              item.tela_id || null, item.title, item.detail || null,
              item.due_date || null, item.priority || 'medium', item.status || 'active'
            ).run();
            imported++;
          } catch(e) { skipped++; }
        }
        await logAudit(env, 'import', 'garvis_items', null, actor, actorSession, `imported ${imported}, skipped ${skipped}`);
        return json({ ok: true, imported, skipped });
      }

      if (path.startsWith('/garvis/items/') && method === 'PUT') {
        const id = path.split('/')[3];
        const body = await request.json();
        const { title, detail, due_date } = body;
        await env.DB.prepare(
          `UPDATE garvis_items SET title=COALESCE(?,title), detail=COALESCE(?,detail), due_date=COALESCE(?,due_date) WHERE id=?`
        ).bind(title||null, detail||null, due_date||null, id).run();
        await logAudit(env, 'update', 'garvis_items', id, actor, actorSession, title);
        return json({ ok: true });
      }

      if (path.startsWith('/garvis/items/') && method === 'DELETE') {
        const id = path.split('/')[3];
        await env.DB.prepare(
          `UPDATE garvis_items SET resolved_at=datetime('now') WHERE id=?`
        ).bind(id).run();
        await logAudit(env, 'resolve', 'garvis_items', id, actor, actorSession, null);
        return json({ ok: true });
      }

      if (path === '/garvis/status' && method === 'GET') {
        const count = await env.DB.prepare(
          `SELECT COUNT(*) as total FROM garvis_items WHERE resolved_at IS NULL`
        ).first();
        return json({ ok: true, source: 'garvis', active_items: count.total, mode: 'manual_import' });
      }

      // ── PCO PROXY ──────────────────────────────────────────────────
      if (path.startsWith('/pco/')) {
        const pcoPath = path.replace('/pco', '');
        const pcoUrl = `https://api.planningcenteronline.com${pcoPath}${url.search}`;
        const creds = btoa(`${env.PCO_APP_ID}:${env.PCO_SECRET}`);
        const pcoRes = await fetch(pcoUrl, {
          headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/json' },
        });
        const data = await pcoRes.json();
        return json(data, pcoRes.status);
      }

      return err('Not found', 404);
    } catch (e) {
      console.error(e);
      return err(e.message, 500);
    }
  },
};
