const VERSION = '2.8.5';
const PRIMARY_CARD = '6557';
const SESSION_DAYS = 60;
const ALWAYS_ON_CODES = ['8135'];
const SEED_ADMIN = { name: 'Shane', pin: '7569', is_admin: 1 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    await ensureSeed(env);

    if (path === '/health') return json({ ok: true, version: VERSION });
    if (path.startsWith('/api/')) return handleApi(request, env, path, url);
    if (path === '/manifest.json') return new Response(JSON.stringify(MANIFEST), { headers: { 'Content-Type': 'application/json' } });
    if (path === '/sw.js') return new Response(SERVICE_WORKER, { headers: { 'Content-Type': 'application/javascript' } });
    return new Response(APP_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },

  async scheduled(event, env) {
    const { results } = await env.DB.prepare(`
      SELECT id FROM monthly_packets
      WHERE purge_at IS NOT NULL AND purge_at <= datetime('now') AND purged_at IS NULL
    `).all();
    for (const packet of results) {
      const { results: recs } = await env.DB.prepare(`
        SELECT r.id, r.image_r2_key, r.image_thumb_key
        FROM receipts r JOIN monthly_packets p ON r.statement_id = p.statement_id
        WHERE p.id = ? AND r.image_purged = 0
      `).bind(packet.id).all();
      for (const r of recs) {
        if (r.image_r2_key) await env.BUCKET.delete(r.image_r2_key).catch(() => {});
        if (r.image_thumb_key) await env.BUCKET.delete(r.image_thumb_key).catch(() => {});
        await env.DB.prepare("UPDATE receipts SET image_purged=1,updated_at=datetime('now') WHERE id=?").bind(r.id).run();
      }
      await env.DB.prepare("UPDATE monthly_packets SET purged_at=datetime('now') WHERE id=?").bind(packet.id).run();
    }
  },
};

// ============================================================
// CODE GROUPING
// ============================================================

function groupFor(code, sortOrder) {
  const so = Number(sortOrder);
  if (so < 1000) return { grp: '0', label: 'Most Used' };
  if (code === 'TBD') return { grp: 'ZZ', label: 'Other' };
  const blocks = [
    [8000,8099,'Personnel'],[8100,8149,'Administrative'],[8150,8169,'Computer / IT'],
    [8170,8189,'Hospitality'],[8190,8299,'Insurance & Taxes'],[8300,8999,'Facility & Maintenance'],
    [9000,9099,'Church Ministry'],[9100,9149,'Pastoral'],[9150,9199,'Advertising'],
    [9200,9299,'Ladies Ministry'],[9300,9399,'Praise & Worship / Media'],[9400,9499,'Discipleship'],
    [9500,9599,'Youth'],[9600,9699,"Children's Ministry"],[9700,9899,'Outreach / Events'],
    [9900,9999,'Extraordinary'],
  ];
  for (const [lo,hi,label] of blocks) if (so>=lo&&so<=hi) return { grp: String(lo), label };
  return { grp: 'ZZ', label: 'Other' };
}

const HEADER_CODES = new Set(['8000','8100','8150','8170','8190','8300','9000','9100','9150','9200','9300','9400','9500','9600','9700','9900']);
function isHeaderCode(code, sortOrder) {
  const so = Number(sortOrder);
  return so >= 1000 && /^\d+$/.test(code) && so === Number(code) && HEADER_CODES.has(code);
}

// ============================================================
// AUTH
// ============================================================

async function hashPin(pin, saltBytes) {
  const enc = new TextEncoder();
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey('raw', enc.encode(pin), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, km, 256);
  return { saltHex: bytesToHex(new Uint8Array(salt)), hashHex: bytesToHex(new Uint8Array(bits)) };
}

async function verifyPin(pin, saltHex, hashHex) {
  if (!saltHex || !hashHex) return false;
  const { hashHex: computed } = await hashPin(pin, hexToBytes(saltHex));
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

async function ensureSeed(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  if (row && row.n > 0) return;
  const id = crypto.randomUUID();
  const { saltHex, hashHex } = await hashPin(SEED_ADMIN.pin);
  await env.DB.prepare(`INSERT INTO users (id,name,email,pin_hash,pin_salt,is_admin,active) VALUES (?,?,NULL,?,?,?,1)`)
    .bind(id, SEED_ADMIN.name, hashHex, saltHex, SEED_ADMIN.is_admin).run();
}

function makeSessionToken() { return bytesToHex(crypto.getRandomValues(new Uint8Array(24))); }

function parseCookies(request) {
  const out = {};
  (request.headers.get('Cookie') || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0,i).trim()] = p.slice(i+1).trim();
  });
  return out;
}

async function getSessionUser(request, env) {
  const token = parseCookies(request)['rs_session'];
  if (!token) return null;
  const row = await env.DB.prepare(`
    SELECT u.id,u.name,u.email,u.is_admin,u.active FROM sessions s
    JOIN users u ON s.user_id=u.id
    WHERE s.token=? AND (s.expires_at IS NULL OR s.expires_at>datetime('now'))
  `).bind(token).first();
  if (!row || row.active !== 1) return null;
  return row;
}

function sessionCookie(token) {
  return `rs_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS*24*60*60}`;
}
function clearCookie() { return 'rs_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'; }

// ============================================================
// API ROUTER
// ============================================================

async function handleApi(request, env, path, url) {
  if (path === '/api/auth/users' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id,name FROM users WHERE active=1 ORDER BY name').all();
    return json({ users: results });
  }
  if (path === '/api/auth/login' && request.method === 'POST') return handleLogin(request, env);
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = parseCookies(request)['rs_session'];
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie() } });
  }
  if (path === '/api/auth/me' && request.method === 'GET') {
    const user = await getSessionUser(request, env);
    if (!user) return json({ authenticated: false });
    return json({ authenticated: true, user: { id: user.id, name: user.name, is_admin: user.is_admin } });
  }

  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'not authenticated' }, 401);

  if (path.startsWith('/api/admin/')) {
    if (user.is_admin !== 1) return json({ error: 'admin only' }, 403);
    return handleAdmin(request, env, path);
  }

  // Budget codes
  if (path === '/api/budget-codes' && request.method === 'GET') {
    const sel = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_codes WHERE user_id=?').bind(user.id).first();
    if (sel && sel.n > 0) {
      const { results } = await env.DB.prepare(`
        SELECT bc.code,bc.name,bc.standing_rule,bc.sort_order
        FROM user_codes uc JOIN budget_codes bc ON uc.code=bc.code
        WHERE uc.user_id=? AND bc.active=1 ORDER BY bc.sort_order
      `).bind(user.id).all();
      return json({ codes: results });
    }
    const { results } = await env.DB.prepare('SELECT code,name,standing_rule,sort_order FROM budget_codes WHERE active=1 ORDER BY sort_order').all();
    return json({ codes: results });
  }

  if (path === '/api/my-codes' && request.method === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT bc.code,bc.name,bc.sort_order,
        (SELECT COUNT(*) FROM user_codes uc WHERE uc.user_id=? AND uc.code=bc.code) AS selected
      FROM budget_codes bc WHERE bc.active=1 ORDER BY bc.sort_order
    `).bind(user.id).all();
    const codes = (results||[]).filter(c=>c.code!=='TBD').map(c => {
      const g = groupFor(c.code, c.sort_order);
      return { ...c, grp: g.grp, grp_label: g.label, is_header: isHeaderCode(c.code,c.sort_order)?1:0, always_on: ALWAYS_ON_CODES.indexOf(c.code)!==-1?1:0 };
    });
    return json({ codes });
  }

  if (path === '/api/my-used-codes' && request.method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT DISTINCT budget_code AS code FROM receipts WHERE user_id=? AND budget_code IS NOT NULL AND budget_code!='TBD'`).bind(user.id).all();
    return json({ codes: (results||[]).map(r=>r.code) });
  }

  if (path === '/api/my-codes' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
    const codes = Array.isArray(body.codes) ? body.codes : [];
    await env.DB.prepare('DELETE FROM user_codes WHERE user_id=?').bind(user.id).run();
    for (const c of codes) await env.DB.prepare('INSERT OR IGNORE INTO user_codes (user_id,code) VALUES (?,?)').bind(user.id,String(c)).run();
    for (const c of ALWAYS_ON_CODES) await env.DB.prepare('INSERT OR IGNORE INTO user_codes (user_id,code) VALUES (?,?)').bind(user.id,String(c)).run();
    return json({ ok: true, count: codes.length });
  }

  if (path === '/api/my-codes/remove' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
    const code = String(body.code||'').trim();
    if (!code) return json({ error: 'code required' }, 400);
    if (ALWAYS_ON_CODES.indexOf(code) !== -1) return json({ error: 'This code is required for all staff and cannot be removed.' }, 400);
    await env.DB.prepare('DELETE FROM user_codes WHERE user_id=? AND code=?').bind(user.id,code).run();
    return json({ ok: true });
  }

  if (path === '/api/parse-codes' && request.method === 'POST') return handleParseCodes(request, env);

  if (path === '/api/my-review' && request.method === 'GET') {
    let month = (url.searchParams.get('month')||'').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) month = new Date().toISOString().slice(0,7);
    const { results: recs } = await env.DB.prepare(`
      SELECT id,receipt_date,vendor_name,amount,purpose,budget_code,captured_at,status
      FROM receipts WHERE user_id=?1 AND strftime('%Y-%m',captured_at)=?2
      ORDER BY captured_at DESC
    `).bind(user.id, month).all();
    const receipts = recs||[];
    let total=0; const byCodeMap={};
    for (const r of receipts) {
      const amt = Number(r.amount)||0; total += amt;
      const key = r.budget_code||'TBD';
      if (!byCodeMap[key]) byCodeMap[key]={code:key,total:0,count:0};
      byCodeMap[key].total+=amt; byCodeMap[key].count+=1;
    }
    const codes = Object.keys(byCodeMap);
    let nameMap={};
    if (codes.length) {
      const { results: names } = await env.DB.prepare(`SELECT code,name FROM budget_codes WHERE code IN (${codes.map(()=>'?').join(',')})`).bind(...codes).all();
      (names||[]).forEach(n=>{nameMap[n.code]=n.name;});
    }
    const byCode = Object.values(byCodeMap).map(b=>({...b,name:nameMap[b.code]||(b.code==='TBD'?'Pending Review':b.code)})).sort((a,b)=>b.total-a.total);
    const { results: months } = await env.DB.prepare(`SELECT DISTINCT strftime('%Y-%m',captured_at) AS m FROM receipts WHERE user_id=? AND captured_at IS NOT NULL ORDER BY m DESC`).bind(user.id).all();
    const monthList = (months||[]).map(x=>x.m).filter(Boolean);
    const cur = new Date().toISOString().slice(0,7);
    if (!monthList.includes(cur)) monthList.unshift(cur);
    return json({ month, total, count: receipts.length, by_code: byCode, receipts, months: monthList });
  }

  if (path === '/api/export' && request.method === 'GET') {
    let month = (url.searchParams.get('month')||'').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) month = new Date().toISOString().slice(0,7);

    // Try to get statement lines for this month first (the source of truth)
    const { results: stmtRows } = await env.DB.prepare(`
      SELECT sl.id, sl.post_date, sl.transaction_date, sl.vendor_clean, sl.vendor_raw,
             sl.amount, sl.ref_number, sl.match_status, sl.receipt_id,
             r.purpose, r.notes, r.budget_code, r.receipt_date
      FROM statements s
      JOIN statement_lines sl ON sl.statement_id=s.id
      LEFT JOIN receipts r ON sl.receipt_id=r.id
      WHERE s.user_id=? AND s.statement_month=?
      ORDER BY sl.line_order
    `).bind(user.id, month).all();

    // Fallback to captured receipts if no statement uploaded
    // Include receipts captured this month plus any carry_forward receipts
    // from prior months that were not matched to an earlier statement.
    const { results: capRecs } = await env.DB.prepare(`
      SELECT id,receipt_date,vendor_name,amount,purpose,notes,budget_code,status,card_last_four,captured_at
      FROM receipts
      WHERE user_id=?1
        AND (strftime('%Y-%m',captured_at)=?2 OR status='carry_forward')
      ORDER BY captured_at ASC
    `).bind(user.id, month).all();

    const usingStatement = stmtRows && stmtRows.length > 0;
    const rows = [];
    const carryRows = [];
    let statementTotal = 0;

    const codeSet = new Set();
    if (usingStatement) {
      for (const sl of stmtRows) {
        const code = sl.budget_code || 'TBD';
        codeSet.add(code);
        const shaped = {
          post_date: sl.post_date||'',
          date: sl.transaction_date||sl.post_date||'',
          vendor: sl.vendor_clean||sl.vendor_raw||'',
          amount: Number(sl.amount)||0,
          explanation: sl.purpose||'',
          code,
          code_name: '',
          notes: sl.notes||'',
          status: sl.match_status||'unmatched',
          has_receipt: !!sl.receipt_id,
          receipt_id: sl.receipt_id||null,
          missing: !sl.receipt_id,
        };
        rows.push(shaped);
        statementTotal += shaped.amount;
      }
    } else {
      for (const r of (capRecs||[])) {
        const code = r.budget_code||'TBD';
        codeSet.add(code);
        const shaped = {
          post_date: r.receipt_date||'', date: r.receipt_date||'',
          vendor: r.vendor_name||'', amount: Number(r.amount)||0,
          explanation: r.purpose||'', code, code_name: '',
          notes: r.notes||'', status: r.status||'captured',
          has_receipt: true, receipt_id: r.id||null, missing: false,
        };
        if (r.status==='carry_forward') carryRows.push(shaped);
        else { rows.push(shaped); statementTotal+=shaped.amount; }
      }
    }

    // In statement path: pull carry_forward receipts not already matched
    // to any statement line. These go to the Carry Forward Excel tab and
    // are excluded from the statement total.
    if (usingStatement) {
      const { results: cfRecs } = await env.DB.prepare(`
        SELECT id,receipt_date,vendor_name,amount,purpose,notes,budget_code
        FROM receipts
        WHERE user_id=? AND status='carry_forward'
        ORDER BY captured_at ASC
      `).bind(user.id).all();
      for (const r of (cfRecs||[])) {
        const code = r.budget_code||'TBD';
        codeSet.add(code);
        carryRows.push({
          post_date: r.receipt_date||'', date: r.receipt_date||'',
          vendor: r.vendor_name||'', amount: Number(r.amount)||0,
          explanation: r.purpose||'', code, code_name: '',
          notes: r.notes||'', status: 'carry_forward',
          has_receipt: true, receipt_id: r.id||null, missing: false,
        });
      }
    }

    const codeArr = Array.from(codeSet);
    let nameMap = {};
    if (codeArr.length) {
      const { results: names } = await env.DB.prepare(`SELECT code,name FROM budget_codes WHERE code IN (${codeArr.map(()=>'?').join(',')})`).bind(...codeArr).all();
      (names||[]).forEach(n=>{nameMap[n.code]=n.name;});
    }
    rows.forEach(r=>{ r.code_name=nameMap[r.code]||(r.code==='TBD'?'Pending Review':''); r.code_label=r.code_name?(r.code+' — '+r.code_name):r.code; });
    carryRows.forEach(r=>{ r.code_name=nameMap[r.code]||''; r.code_label=r.code_name?(r.code+' — '+r.code_name):r.code; });

    const { results: myCodes } = await env.DB.prepare(`
      SELECT bc.code,bc.name FROM user_codes uc JOIN budget_codes bc ON uc.code=bc.code
      WHERE uc.user_id=? AND bc.active=1 ORDER BY bc.sort_order
    `).bind(user.id).all();

    return json({ month, name: user.name, card: PRIMARY_CARD, statement_rows: rows, carry_rows: carryRows, statement_total: statementTotal, budget_codes: myCodes||[], using_statement: usingStatement });
  }

  // PACKET DATA: read-only feed for the client-side Receipt PDF Packet (v2.8.3)
  // Does not touch /api/export or reconciliation. Returns ledger-ordered rows
  // plus captured receipts not on the statement, plus cover-page counts.
  if (path === '/api/packet-data' && request.method === 'GET') {
    let month = (url.searchParams.get('month')||'').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) month = new Date().toISOString().slice(0,7);

    const stmt = await env.DB.prepare('SELECT id FROM statements WHERE user_id=? AND statement_month=? ORDER BY created_at DESC LIMIT 1').bind(user.id, month).first();

    const pktRows = [];
    const extras = [];
    const codeSet = new Set();

    if (stmt) {
      const { results: lines } = await env.DB.prepare(`
        SELECT sl.line_order, sl.post_date, sl.transaction_date, sl.vendor_clean, sl.vendor_raw,
               sl.amount, sl.match_status, sl.receipt_id,
               r.purpose, r.notes, r.budget_code, r.receipt_date, r.image_r2_key, r.image_purged
        FROM statement_lines sl
        LEFT JOIN receipts r ON sl.receipt_id=r.id
        WHERE sl.statement_id=? ORDER BY sl.line_order
      `).bind(stmt.id).all();
      for (const l of (lines||[])) {
        const code = l.budget_code || 'TBD';
        codeSet.add(code);
        pktRows.push({
          post_date: l.post_date||'',
          date: l.transaction_date||l.post_date||'',
          vendor: l.vendor_clean||l.vendor_raw||'',
          amount: Number(l.amount)||0,
          code, code_label: '',
          notes: l.notes||'',
          status: l.match_status||'unmatched',
          has_receipt: !!l.receipt_id,
          has_image: !!(l.image_r2_key) && l.image_purged!==1,
          receipt_id: l.receipt_id||null,
          on_statement: true,
        });
      }
      // Include any unmatched receipt for this user regardless of capture month.
      // This is what surfaces May receipts in the June PDF packet.
      const { results: unmatched } = await env.DB.prepare(`
        SELECT id, receipt_date, vendor_name, amount, purpose, notes, budget_code, image_r2_key, image_purged
        FROM receipts
        WHERE user_id=?1
          AND status IN ('captured','carry_forward')
          AND id NOT IN (SELECT receipt_id FROM statement_lines WHERE statement_id=?2 AND receipt_id IS NOT NULL)
        ORDER BY captured_at ASC
      `).bind(user.id, stmt.id).all();
      for (const r of (unmatched||[])) {
        const code = r.budget_code || 'TBD';
        codeSet.add(code);
        extras.push({
          post_date: r.receipt_date||'', date: r.receipt_date||'',
          vendor: r.vendor_name||'', amount: Number(r.amount)||0,
          code, code_label: '', notes: r.notes||'',
          status: 'not_on_statement',
          has_receipt: true,
          has_image: !!(r.image_r2_key) && r.image_purged!==1,
          receipt_id: r.id||null,
          on_statement: false,
        });
      }
    } else {
      const { results: caps } = await env.DB.prepare(`
        SELECT id, receipt_date, vendor_name, amount, purpose, notes, budget_code, image_r2_key, image_purged, status
        FROM receipts
        WHERE user_id=?1
          AND (strftime('%Y-%m',captured_at)=?2 OR status='carry_forward')
        ORDER BY captured_at ASC
      `).bind(user.id, month).all();
      for (const r of (caps||[])) {
        const code = r.budget_code || 'TBD';
        codeSet.add(code);
        pktRows.push({
          post_date: r.receipt_date||'', date: r.receipt_date||'',
          vendor: r.vendor_name||'', amount: Number(r.amount)||0,
          code, code_label: '', notes: r.notes||'',
          status: r.status||'captured',
          has_receipt: true,
          has_image: !!(r.image_r2_key) && r.image_purged!==1,
          receipt_id: r.id||null,
          on_statement: false,
        });
      }
    }

    const codeArr = Array.from(codeSet);
    let nameMap = {};
    if (codeArr.length) {
      const { results: names } = await env.DB.prepare(`SELECT code,name FROM budget_codes WHERE code IN (${codeArr.map(()=>'?').join(',')})`).bind(...codeArr).all();
      (names||[]).forEach(n=>{nameMap[n.code]=n.name;});
    }
    const label = c => { const nm = nameMap[c]||(c==='TBD'?'Pending Review':''); return nm?(c+' — '+nm):c; };
    pktRows.forEach(r=>{ r.code_label=label(r.code); });
    extras.forEach(r=>{ r.code_label=label(r.code); });

    const counts = {
      lines: pktRows.length,
      with_image: pktRows.filter(r=>r.has_image).length,
      missing: pktRows.filter(r=>!r.has_receipt).length,
      extras: extras.length,
    };

    return json({ month, name: user.name, card: PRIMARY_CARD, using_statement: !!stmt, rows: pktRows, extras, counts });
  }

  // SERVE receipt image from R2 (authenticated, own receipts only; admins any)
  if (path.startsWith('/api/receipt-image/') && request.method === 'GET') {
    const id = path.split('/')[3];
    if (!id) return new Response('id required', { status: 400 });
    const rec = user.is_admin === 1
      ? await env.DB.prepare('SELECT id,image_r2_key,image_purged FROM receipts WHERE id=?').bind(id).first()
      : await env.DB.prepare('SELECT id,image_r2_key,image_purged FROM receipts WHERE id=? AND user_id=?').bind(id, user.id).first();
    if (!rec) return new Response('Receipt not found', { status: 404 });
    if (rec.image_purged === 1) return new Response('This receipt image has been purged.', { status: 410 });
    if (!rec.image_r2_key) return new Response('No image on file for this receipt.', { status: 404 });
    const obj = await env.BUCKET.get(rec.image_r2_key);
    if (!obj) return new Response('Image file not found.', { status: 404 });
    const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg';
    return new Response(obj.body, { headers: { 'Content-Type': ct, 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=60' } });
  }

  if (path === '/api/receipts' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM receipts WHERE user_id=? ORDER BY captured_at DESC LIMIT 50').bind(user.id).all();
    return json({ receipts: results });
  }

  // EDIT receipt
  if (path.startsWith('/api/receipts/') && request.method === 'PATCH') {
    const id = path.split('/')[3];
    if (!id) return json({ error: 'id required' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM receipts WHERE id=? AND user_id=?').bind(id, user.id).first();
    if (!existing) return json({ error: 'not found' }, 404);
    let body; try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
    const r = body.receipt || {};
    await env.DB.prepare(`
      UPDATE receipts SET receipt_date=?,vendor_name=?,amount=?,purpose=?,purpose_short=?,notes=?,budget_code=?,updated_at=datetime('now')
      WHERE id=? AND user_id=?
    `).bind(r.receipt_date||null, r.vendor_name||null, r.amount??null, r.explanation||null, (r.explanation||'').slice(0,60), r.note||null, r.budget_code||'TBD', id, user.id).run();
    return json({ ok: true });
  }

  // DELETE receipt
  if (path.startsWith('/api/receipts/') && request.method === 'DELETE') {
    const id = path.split('/')[3];
    if (!id) return json({ error: 'id required' }, 400);
    const existing = await env.DB.prepare('SELECT id,image_r2_key,statement_id FROM receipts WHERE id=? AND user_id=?').bind(id, user.id).first();
    if (!existing) return json({ error: 'not found' }, 404);
    if (existing.image_r2_key) await env.BUCKET.delete(existing.image_r2_key).catch(()=>{});
    // unlink from any statement line
    await env.DB.prepare("UPDATE statement_lines SET receipt_id=NULL,match_status='unmatched' WHERE receipt_id=?").bind(id).run();
    await env.DB.prepare('DELETE FROM receipts WHERE id=? AND user_id=?').bind(id, user.id).run();
    return json({ ok: true });
  }

  if (path === '/api/statements' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM statements WHERE user_id=? ORDER BY period_end DESC').bind(user.id).all();
    return json({ statements: results });
  }

  if (path === '/api/summary' && request.method === 'GET') {
    const counts = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM receipts WHERE status='captured' AND user_id=?1) as captured,
        (SELECT COUNT(*) FROM receipts WHERE status='matched' AND user_id=?1) as matched,
        (SELECT COUNT(*) FROM receipts WHERE status='carry_forward' AND user_id=?1) as carry_forward,
        (SELECT COUNT(*) FROM statements WHERE status='open' AND user_id=?1) as open_statements
    `).bind(user.id).first();
    return json({ summary: counts });
  }

  if (path === '/api/parse' && request.method === 'POST') return handleParse(request, env);
  if (path === '/api/receipts' && request.method === 'POST') return handleSaveReceipt(request, env, user);

  // STATEMENT UPLOAD: parse PDF text → store statement + lines
  if (path === '/api/statements/upload' && request.method === 'POST') return handleStatementUpload(request, env, user);

  // RECONCILIATION: get statement lines with match status for a month
  if (path === '/api/reconcile' && request.method === 'GET') {
    let month = (url.searchParams.get('month')||'').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) month = new Date().toISOString().slice(0,7);
    const stmt = await env.DB.prepare('SELECT * FROM statements WHERE user_id=? AND statement_month=? ORDER BY created_at DESC LIMIT 1').bind(user.id,month).first();
    if (!stmt) return json({ statement: null, lines: [], month });
    const { results: lines } = await env.DB.prepare(`
      SELECT sl.*,r.vendor_name as r_vendor,r.amount as r_amount,r.budget_code,r.purpose,r.receipt_date,r.image_r2_key
      FROM statement_lines sl LEFT JOIN receipts r ON sl.receipt_id=r.id
      WHERE sl.statement_id=? ORDER BY sl.line_order
    `).bind(stmt.id).all();
    // Counts
    const matched = (lines||[]).filter(l=>l.match_status==='matched').length;
    const missing = (lines||[]).filter(l=>l.match_status==='unmatched').length;
    return json({ statement: stmt, lines: lines||[], month, matched, missing });
  }

  // MANUAL MATCH: link a receipt to a statement line
  if (path === '/api/reconcile/match' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
    const { line_id, receipt_id } = body;
    if (!line_id || !receipt_id) return json({ error: 'line_id and receipt_id required' }, 400);
    await env.DB.prepare("UPDATE statement_lines SET receipt_id=?,match_status='matched' WHERE id=?").bind(receipt_id,line_id).run();
    await env.DB.prepare("UPDATE receipts SET status='matched',updated_at=datetime('now') WHERE id=? AND user_id=?").bind(receipt_id,user.id).run();
    return json({ ok: true });
  }

  // UNMATCH a line
  if (path === '/api/reconcile/unmatch' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
    const { line_id } = body;
    if (!line_id) return json({ error: 'line_id required' }, 400);
    const line = await env.DB.prepare('SELECT receipt_id FROM statement_lines WHERE id=?').bind(line_id).first();
    if (line && line.receipt_id) {
      await env.DB.prepare("UPDATE receipts SET status='captured',updated_at=datetime('now') WHERE id=?").bind(line.receipt_id).run();
    }
    await env.DB.prepare("UPDATE statement_lines SET receipt_id=NULL,match_status='unmatched' WHERE id=?").bind(line_id).run();
    return json({ ok: true });
  }

  return json({ error: 'not found' }, 404);
}

// ============================================================
// STATEMENT UPLOAD + AI PARSE
// ============================================================

async function handleStatementUpload(request, env, user) {
  let body; try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const imageBase64 = body.image_base64 || null;
  const mediaType = body.media_type || 'application/pdf';
  const pastedText = (body.text || '').trim();
  const statementMonth = (body.statement_month || '').trim(); // YYYY-MM

  if (!imageBase64 && !pastedText) return json({ error: 'no file or text provided' }, 400);
  if (!/^\d{4}-\d{2}$/.test(statementMonth)) return json({ error: 'statement_month required (YYYY-MM)' }, 400);

  // Check if statement for this month already exists
  const existing = await env.DB.prepare('SELECT id FROM statements WHERE user_id=? AND statement_month=?').bind(user.id,statementMonth).first();

  const systemPrompt = `You parse SouthState Visa credit card statements for a church. Extract every transaction line.

Return ONLY a JSON object, no preamble, no markdown, no backticks:
{
  "period_start": "YYYY-MM-DD",
  "period_end": "YYYY-MM-DD",
  "card_last_four": "6557",
  "purchase_total": 2095.08,
  "transactions": [
    {
      "line_order": 1,
      "post_date": "YYYY-MM-DD",
      "transaction_date": "YYYY-MM-DD",
      "ref_number": "5555",
      "vendor_raw": "TST*LOUIS PAPPAS FRESH University Pk FL",
      "vendor_clean": "Louis Pappas Fresh",
      "amount": 41.36,
      "is_credit": false
    }
  ]
}

Rules:
- Include ALL purchase/debit lines. Skip credits/payments unless is_credit=true.
- vendor_clean: remove ALL-CAPS, state abbreviations, extra codes, location suffixes. Human-readable name only.
- post_date and transaction_date as YYYY-MM-DD.
- ref_number: the 4-digit Ref# column if present, else null.
- line_order: sequential integer starting at 1.
- Do not skip any transaction. The total of all non-credit amounts must equal purchase_total.`;

  const userContent = [];
  if (imageBase64) {
    if (mediaType === 'application/pdf') {
      userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } });
    } else {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } });
    }
    userContent.push({ type: 'text', text: 'Parse all transactions from this statement. Return the JSON object only.' });
  } else {
    userContent.push({ type: 'text', text: `Parse all transactions from this statement text:\n\n${pastedText}\n\nReturn the JSON object only.` });
  }

  let parsed;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content: userContent }] }),
    });
    if (!resp.ok) { const t = await resp.text(); return json({ error: 'AI call failed', detail: t.slice(0,300) }, 502); }
    const data = await resp.json();
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').replace(/```json|```/g,'').trim();
    parsed = JSON.parse(text);
  } catch(err) {
    return json({ error: 'could not parse statement', detail: String(err).slice(0,300) }, 502);
  }

  if (!parsed.transactions || !parsed.transactions.length) return json({ error: 'no transactions found in statement' }, 422);

  // Delete existing statement + lines if re-uploading
  if (existing) {
    await env.DB.prepare('DELETE FROM statement_lines WHERE statement_id=?').bind(existing.id).run();
    await env.DB.prepare('DELETE FROM statements WHERE id=?').bind(existing.id).run();
  }

  const stmtId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO statements (id,user_id,statement_month,period_start,period_end,card_identifier,purchase_total,status)
    VALUES (?,?,?,?,?,?,?,'open')
  `).bind(stmtId, user.id, statementMonth, parsed.period_start||null, parsed.period_end||null, parsed.card_last_four||PRIMARY_CARD, parsed.purchase_total||0).run();

  for (const t of parsed.transactions) {
    await env.DB.prepare(`
      INSERT INTO statement_lines (id,statement_id,line_order,post_date,transaction_date,ref_number,vendor_raw,vendor_clean,amount,is_credit,match_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      crypto.randomUUID(), stmtId, t.line_order||0,
      t.post_date||null, t.transaction_date||null, t.ref_number||null,
      t.vendor_raw||'', t.vendor_clean||t.vendor_raw||'',
      t.amount||0, t.is_credit?1:0, 'unmatched'
    ).run();
  }

  // Auto-match: link existing captured receipts to statement lines
  const matched = await autoMatch(env, stmtId, user.id, statementMonth);
  await carryForwardUnpostedReceiptsToNextCycle(env, user.id, statementMonth);

  return json({ ok: true, statement_id: stmtId, line_count: parsed.transactions.length, auto_matched: matched, purchase_total: parsed.purchase_total });
}

// Auto-match receipts to statement lines by amount + approximate date
async function autoMatch(env, stmtId, userId, month) {
  const { results: lines } = await env.DB.prepare(
    'SELECT id,transaction_date,vendor_clean,amount FROM statement_lines WHERE statement_id=? AND is_credit=0'
  ).bind(stmtId).all();

  // month param kept for signature compat but no longer used as a filter —
  // any unreconciled receipt (captured or carry_forward) is eligible to match
  // any statement, including receipts from prior months that posted late.
  const { results: receipts } = await env.DB.prepare(`
    SELECT id,receipt_date,vendor_name,amount FROM receipts
    WHERE user_id=? AND status IN ('captured','carry_forward')
  `).bind(userId).all();

  let matched = 0;
  const usedReceipts = new Set();

  for (const line of (lines||[])) {
    for (const rec of (receipts||[])) {
      if (usedReceipts.has(rec.id)) continue;
      const amtMatch = Math.abs((Number(line.amount)||0) - (Number(rec.amount)||0)) < 0.02;
      if (!amtMatch) continue;
      // Vendor similarity: share at least one significant word
      const lineWords = (line.vendor_clean||'').toLowerCase().split(/\s+/).filter(w=>w.length>3);
      const recWords = (rec.vendor_name||'').toLowerCase().split(/\s+/).filter(w=>w.length>3);
      const vendorMatch = lineWords.length===0 || recWords.length===0 || lineWords.some(w=>recWords.some(r=>r.includes(w)||w.includes(r)));
      if (!vendorMatch) continue;
      await env.DB.prepare("UPDATE statement_lines SET receipt_id=?,match_status='matched' WHERE id=?").bind(rec.id,line.id).run();
      await env.DB.prepare("UPDATE receipts SET status='matched',updated_at=datetime('now') WHERE id=?").bind(rec.id).run();
      usedReceipts.add(rec.id);
      matched++;
      break;
    }
  }
  return matched;
}

// Marks any captured receipt from a prior month as carry_forward so it
// surfaces in the Carry Forward Excel tab and PDF packet extras for the
// current statement cycle. Runs after autoMatch so already-matched receipts
// are excluded (they have status='matched' by this point).
async function carryForwardUnpostedReceiptsToNextCycle(env, userId, statementMonth) {
  await env.DB.prepare(`
    UPDATE receipts
    SET status='carry_forward', updated_at=datetime('now')
    WHERE user_id=?
      AND status='captured'
      AND strftime('%Y-%m', captured_at) < ?
  `).bind(userId, statementMonth).run();
}

// ============================================================
// LOGIN
// ============================================================

async function handleLogin(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const { user_id, pin } = body;
  if (!user_id || !pin) return json({ error: 'name and PIN required' }, 400);
  const u = await env.DB.prepare('SELECT id,name,pin_hash,pin_salt,is_admin,active FROM users WHERE id=?').bind(user_id).first();
  if (!u || u.active !== 1) return json({ error: 'login failed' }, 401);
  if (!await verifyPin(pin.trim(), u.pin_salt, u.pin_hash)) return json({ error: 'wrong PIN' }, 401);
  const token = makeSessionToken();
  const expires = new Date(Date.now()+SESSION_DAYS*864e5).toISOString().replace('T',' ').slice(0,19);
  await env.DB.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').bind(token,u.id,expires).run();
  return new Response(JSON.stringify({ ok: true, user: { id: u.id, name: u.name, is_admin: u.is_admin } }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(token) },
  });
}

// ============================================================
// ADMIN
// ============================================================

async function handleAdmin(request, env, path) {
  if (path === '/api/admin/users' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id,name,email,is_admin,active,created_at FROM users ORDER BY name').all();
    return json({ users: results });
  }
  if (path === '/api/admin/users' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
    const name = (body.name||'').trim(), email = (body.email||'').trim()||null, pin = (body.pin||'').trim(), isAdmin = body.is_admin?1:0;
    if (!name||!pin) return json({ error: 'name and PIN required' }, 400);
    if (!/^\d{4,6}$/.test(pin)) return json({ error: 'PIN must be 4-6 digits' }, 400);
    const id = crypto.randomUUID();
    const { saltHex, hashHex } = await hashPin(pin);
    await env.DB.prepare('INSERT INTO users (id,name,email,pin_hash,pin_salt,is_admin,active) VALUES (?,?,?,?,?,?,1)').bind(id,name,email,hashHex,saltHex,isAdmin).run();
    return json({ ok: true, id });
  }
  if (path === '/api/admin/users/update' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
    const { id } = body;
    if (!id) return json({ error: 'id required' }, 400);
    if (body.new_pin) {
      const pin = String(body.new_pin).trim();
      if (!/^\d{4,6}$/.test(pin)) return json({ error: 'PIN must be 4-6 digits' }, 400);
      const { saltHex, hashHex } = await hashPin(pin);
      await env.DB.prepare("UPDATE users SET pin_hash=?,pin_salt=?,updated_at=datetime('now') WHERE id=?").bind(hashHex,saltHex,id).run();
      await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
    }
    if (typeof body.is_admin==='boolean') await env.DB.prepare("UPDATE users SET is_admin=?,updated_at=datetime('now') WHERE id=?").bind(body.is_admin?1:0,id).run();
    if (typeof body.active==='boolean') {
      await env.DB.prepare("UPDATE users SET active=?,updated_at=datetime('now') WHERE id=?").bind(body.active?1:0,id).run();
      if (!body.active) await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
    }
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}

// ============================================================
// PARSE (receipt photo → structured fields)
// ============================================================

async function handleParse(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid request body' }, 400); }
  const { image_base64, media_type, note } = body;
  if (!image_base64) return json({ error: 'no image provided' }, 400);

  const { results: codes } = await env.DB.prepare('SELECT code,name,standing_rule FROM budget_codes WHERE active=1 ORDER BY sort_order').all();
  const { results: rules } = await env.DB.prepare('SELECT pattern,suggested_code,note FROM coding_rules').all();
  const codeList = codes.map(c=>`${c.code} — ${c.name}: ${c.standing_rule||''}`).join('\n');
  const ruleList = rules.map(r=>`"${r.pattern}" -> ${r.suggested_code} (${r.note||''})`) .join('\n');

  let parsed;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 1024,
        system: buildSystemPrompt(codeList, ruleList),
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: media_type||'image/jpeg', data: image_base64 } },
          { type: 'text', text: note ? `Shane's note: "${note}"\n\nRead the receipt and return the JSON object.` : 'Read the receipt and return the JSON object.' },
        ]}],
      }),
    });
    if (!resp.ok) { const t=await resp.text(); return json({ error: 'vision call failed', detail: t.slice(0,300) }, 502); }
    const data = await resp.json();
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').replace(/```json|```/g,'').trim();
    parsed = JSON.parse(text);
  } catch(err) { return json({ error: 'could not parse receipt', detail: String(err).slice(0,300) }, 502); }

  let cardWarning = null;
  if (parsed.card_last_four && parsed.card_last_four !== PRIMARY_CARD) {
    cardWarning = `This looks like card ending ${parsed.card_last_four}, not the church card (${PRIMARY_CARD}).`;
    parsed.needs_confirm = true;
  }
  return json({ parsed, card_warning: cardWarning });
}

function buildSystemPrompt(codeList, ruleList) {
  return `You read church credit-card receipts for Shane, a pastor and ministry integrator. Extract clean fields and suggest a budget code.

Return ONLY a JSON object, no preamble, no markdown:
{
  "receipt_date": "DD-Mon-YY",
  "vendor_name": "Clean human name",
  "amount": 0.00,
  "card_last_four": "1234",
  "explanation": "one readable line",
  "budget_code": "8135",
  "code_reason": "short plain reason",
  "needs_confirm": false,
  "confirm_question": null
}

CODING RULES:
- Staff meals (Julie, Wil, TJ, Josh, Ron, Dwain) → 9435
- Member/leader meals (Todd Cutlip, Jay Slife, Johan, etc.) → 9434
- All software/AI (Anthropic, OpenAI, Audible) → 8135
- YouTube → 8129
- Safety gear → 8350. Equipment/supplies → 8329. Repairs → 8320. First aid → 8347
- Café food/supplies → 8175. Churchwide food/kitchen → 8172
- 22145 pass-through only if note clearly says so
- If unclear, needs_confirm=true

AVAILABLE CODES:
${codeList}

HINTS:
${ruleList}`;
}

// ============================================================
// PARSE CODES
// ============================================================

async function handleParseCodes(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid request body' }, 400); }
  const { image_base64, media_type, text: pastedText } = body;
  if (!image_base64 && !pastedText) return json({ error: 'no image or text provided' }, 400);
  const { results: allCodes } = await env.DB.prepare('SELECT code FROM budget_codes WHERE active=1').all();
  const validSet = new Set((allCodes||[]).map(c=>String(c.code)));

  const systemPrompt = `Extract budget/account code numbers from a church report.
Return ONLY a JSON array of code number strings. Example: ["8129","8175","9435"]
Rules: only account/budget numbers, no dollar amounts, no invented codes. Return [] if none found.`;

  const userContent = [];
  if (image_base64) {
    const mt = (media_type==='application/pdf') ? 'application/pdf' : media_type;
    userContent.push(mt==='application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image_base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mt, data: image_base64 } });
    userContent.push({ type: 'text', text: 'Extract budget code numbers. Return the JSON array only.' });
  } else {
    userContent.push({ type: 'text', text: `Extract budget code numbers from:\n\n${pastedText}\n\nReturn the JSON array only.` });
  }

  let found = [];
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, messages: [{ role: 'user', content: userContent }] }),
    });
    if (!resp.ok) { const t=await resp.text(); return json({ error: 'read failed', detail: t.slice(0,300) }, 502); }
    const data = await resp.json();
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').replace(/```json|```/g,'').trim();
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) found = arr.map(x=>String(x).trim());
  } catch(err) { return json({ error: 'could not read codes', detail: String(err).slice(0,300) }, 502); }

  const matched = [], seen = new Set();
  for (const c of found) if (validSet.has(c)&&!seen.has(c)) { seen.add(c); matched.push(c); }
  return json({ codes: matched, unknown: found.filter(c=>!validSet.has(c)), raw_count: found.length });
}

// ============================================================
// SAVE RECEIPT
// ============================================================

async function handleSaveReceipt(request, env, user) {
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid request body' }, 400); }
  const id = crypto.randomUUID();
  let imageKey = null;
  if (body.image_base64) {
    try {
      const bytes = base64ToBytes(body.image_base64);
      imageKey = `receipts/${id}.jpg`;
      await env.BUCKET.put(imageKey, bytes, { httpMetadata: { contentType: body.media_type||'image/jpeg' } });
    } catch(err) { return json({ error: 'could not store image', detail: String(err).slice(0,200) }, 502); }
  }
  const r = body.receipt||{};
  try {
    await env.DB.prepare(`
      INSERT INTO receipts (id,user_id,receipt_date,vendor_name,amount,purpose,purpose_short,notes,budget_code,image_r2_key,card_last_four,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'captured')
    `).bind(id, user.id, r.receipt_date||null, r.vendor_name||null, r.amount??null, r.explanation||null, (r.explanation||'').slice(0,60), r.note||null, r.budget_code||'TBD', imageKey, r.card_last_four||null).run();
  } catch(err) { return json({ error: 'could not save receipt', detail: String(err).slice(0,200) }, 502); }
  return json({ ok: true, id });
}

// ============================================================
// HELPERS
// ============================================================

function base64ToBytes(b64) {
  const binary = atob(b64), bytes = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return bytes;
}
function bytesToHex(bytes) { let s=''; for (let i=0;i<bytes.length;i++) s+=bytes[i].toString(16).padStart(2,'0'); return s; }
function hexToBytes(hex) { const out=new Uint8Array(hex.length/2); for (let i=0;i<out.length;i++) out[i]=parseInt(hex.substr(i*2,2),16); return out; }
function json(data, status=200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }

// ============================================================
// PWA
// ============================================================

const MANIFEST = {
  name: 'Receipts', short_name: 'Receipts',
  description: 'Receipt capture and monthly reconciliation',
  start_url: '/', display: 'standalone',
  background_color: '#fdf8f3', theme_color: '#402020',
  icons: [{ src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" fill="%23402020"/><text x="96" y="120" font-size="100" text-anchor="middle" fill="%23fdf8f3" font-family="Georgia">R</text></svg>', sizes: '192x192', type: 'image/svg+xml' }],
};
const SERVICE_WORKER = `self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>self.clients.claim());self.addEventListener('fetch',e=>{});`;

// ============================================================
// APP HTML
// ============================================================

const APP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#402020">
<title>Receipts</title>
<link rel="manifest" href="/manifest.json">
<script src="https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
<style>
:root{--brown:#402020;--cross:#6d3d31;--reach:#aac27f;--equip:#ca8342;--send:#8dc6e8;--cream:#fdf8f3;--warm:#f4ebdf;--ink:#2a1a1a;--muted:#8a7a72;--danger:#b3422f;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;background:var(--cream);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5;}
header{background:var(--brown);color:var(--cream);padding:16px 20px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:10;}
header h1{margin:0;font-size:20px;font-weight:600;}
header .who{font-size:12px;opacity:0.8;text-align:right;}
header .who a{color:var(--send);text-decoration:none;display:block;margin-top:2px;}
main{padding:20px;max-width:760px;margin:0 auto;padding-bottom:100px;}
.card{background:white;border-radius:10px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(64,32,32,0.08);}
.card h2{margin:0 0 12px 0;font-size:16px;color:var(--brown);font-weight:600;}
.summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.summary-tile{background:var(--warm);border-radius:8px;padding:14px;text-align:center;}
.summary-tile .num{font-size:28px;font-weight:700;color:var(--brown);line-height:1;}
.summary-tile .lbl{font-size:12px;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;}
.btn{background:var(--brown);color:var(--cream);border:none;padding:14px 20px;border-radius:8px;font-size:16px;font-weight:600;width:100%;cursor:pointer;margin-top:8px;}
.btn:active{transform:scale(0.98);}
.btn:disabled{opacity:0.5;}
.btn-secondary{background:var(--warm);color:var(--brown);}
.btn-danger{background:var(--danger);color:white;}
.btn-sm{padding:8px 14px;font-size:13px;font-weight:600;width:auto;margin-top:0;}
.empty{text-align:center;padding:30px 20px;color:var(--muted);}
.empty .icon{font-size:48px;opacity:0.4;margin-bottom:10px;}
.capture-bar{position:fixed;bottom:0;left:0;right:0;padding:16px 20px calc(16px + env(safe-area-inset-bottom));background:linear-gradient(to top,var(--cream) 70%,transparent);z-index:20;}
.capture-bar .btn{max-width:720px;margin:0 auto;display:block;background:var(--equip);}
.rcpt{padding:12px 0;border-bottom:1px solid var(--warm);}
.rcpt:last-child{border-bottom:none;}
.rcpt .top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;}
.rcpt .vendor{font-weight:600;color:var(--brown);}
.rcpt .amt{font-weight:700;flex:none;}
.rcpt .meta{font-size:13px;color:var(--muted);margin-top:2px;}
.rcpt .code-pill{display:inline-block;font-family:'SF Mono',Menlo,monospace;font-size:12px;background:var(--warm);color:var(--brown);padding:2px 8px;border-radius:6px;margin-top:6px;}
.rcpt .rcpt-actions{display:flex;gap:8px;margin-top:8px;}
.rcpt .rcpt-actions button{padding:6px 12px;font-size:12px;font-weight:600;border:none;border-radius:6px;cursor:pointer;}
.rcpt .edit-btn{background:var(--warm);color:var(--brown);}
.rcpt .del-btn{background:#fbeee9;color:var(--danger);}
.modal-bg{position:fixed;inset:0;background:rgba(42,26,26,0.55);display:none;align-items:flex-end;z-index:30;}
.modal-bg.open{display:flex;}
.modal{background:var(--cream);width:100%;max-width:760px;margin:0 auto;border-radius:16px 16px 0 0;padding:20px;max-height:92vh;overflow-y:auto;}
.modal h2{margin:0 0 4px 0;color:var(--brown);font-size:18px;}
.modal .sub{color:var(--muted);font-size:13px;margin-bottom:16px;}
.field{margin-bottom:14px;}
.field label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px;}
.field input,.field textarea,.field select{width:100%;padding:12px;border:1px solid #e3d6c8;border-radius:8px;font-size:16px;background:white;color:var(--ink);font-family:inherit;}
.field textarea{resize:vertical;min-height:56px;}
.preview-img{width:100%;border-radius:10px;margin-bottom:16px;max-height:200px;object-fit:cover;}
.reason{background:var(--warm);border-left:3px solid var(--reach);padding:10px 12px;border-radius:6px;font-size:13px;color:var(--brown);margin-bottom:14px;}
.confirm-flag{background:#fbeee9;border-left:3px solid var(--danger);padding:10px 12px;border-radius:6px;font-size:13px;color:var(--danger);margin-bottom:14px;}
.spinner{text-align:center;padding:30px;color:var(--muted);}
.row-2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.hidden{display:none!important;}
/* Login */
.login-wrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;}
.login-card{background:white;border-radius:14px;padding:28px 24px;width:100%;max-width:380px;box-shadow:0 4px 18px rgba(64,32,32,0.12);}
.login-card .logo{width:56px;height:56px;border-radius:12px;background:var(--brown);color:var(--cream);display:flex;align-items:center;justify-content:center;font-size:28px;font-family:Georgia,serif;margin:0 auto 16px;}
.login-card h1{text-align:center;color:var(--brown);font-size:22px;margin:0 0 4px;}
.login-card .tag{text-align:center;color:var(--muted);font-size:13px;margin-bottom:22px;}
.pin-display{display:flex;gap:10px;justify-content:center;margin:18px 0 6px;}
.pin-dot{width:16px;height:16px;border-radius:50%;border:2px solid var(--cross);background:transparent;}
.pin-dot.filled{background:var(--cross);}
.keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px;}
.key{background:var(--warm);border:none;border-radius:12px;padding:18px 0;font-size:22px;font-weight:600;color:var(--brown);cursor:pointer;}
.key:active{background:#ecdfce;}
.key.wide{font-size:15px;font-weight:600;}
.login-error{color:var(--danger);text-align:center;font-size:14px;min-height:20px;margin-top:10px;}
.name-list{list-style:none;padding:0;margin:0;}
.name-list li{padding:16px;border:1px solid var(--warm);border-radius:10px;margin-bottom:10px;font-size:17px;font-weight:600;color:var(--brown);cursor:pointer;text-align:center;}
.name-list li:active{background:var(--warm);}
/* Reconcile view */
.recon-line{padding:12px 0;border-bottom:1px solid var(--warm);}
.recon-line:last-child{border-bottom:none;}
.recon-line .top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;}
.recon-line .vendor{font-weight:600;color:var(--brown);font-size:15px;}
.recon-line .amt{font-weight:700;flex:none;}
.recon-line .meta{font-size:13px;color:var(--muted);margin-top:2px;}
.status-pill{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;margin-top:6px;}
.status-pill.matched{background:#e8f5e2;color:#2a5a14;}
.status-pill.unmatched{background:#fbeee9;color:var(--danger);}
.status-pill.captured{background:#e8f0f5;color:#14405a;}
.recon-stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px;}
.recon-stat{background:var(--warm);border-radius:8px;padding:12px;text-align:center;}
.recon-stat .num{font-size:22px;font-weight:700;color:var(--brown);line-height:1;}
.recon-stat .lbl{font-size:11px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px;}
/* Admin */
.admin-user{padding:14px 0;border-bottom:1px solid var(--warm);}
.admin-user:last-child{border-bottom:none;}
.admin-user .nm{font-weight:600;color:var(--brown);}
.admin-user .badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:6px;background:var(--reach);color:#2a3a14;margin-left:6px;}
.admin-user .badge.off{background:#e0d3c7;color:var(--muted);}
.admin-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;}
.admin-actions button{width:auto;flex:1;min-width:90px;padding:9px;font-size:13px;margin:0;}
/* Code picker */
.grp-section{border:1px solid var(--warm);border-radius:10px;margin-bottom:10px;overflow:hidden;}
.grp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 14px;cursor:pointer;background:white;user-select:none;}
.grp-head:active{background:var(--warm);}
.grp-head .grp-title{font-weight:600;color:var(--brown);font-size:15px;}
.grp-head .grp-meta{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:8px;}
.grp-head .chev{transition:transform 0.15s ease;color:var(--muted);font-size:13px;}
.grp-section.open .grp-head .chev{transform:rotate(90deg);}
.grp-count{background:var(--reach);color:#2a3a14;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:600;}
.grp-count.zero{background:var(--warm);color:var(--muted);}
.grp-body{display:none;padding:4px 14px 10px;border-top:1px solid var(--warm);}
.grp-section.open .grp-body{display:block;}
.code-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--warm);cursor:pointer;}
.code-row:last-child{border-bottom:none;}
.code-row input{width:20px;height:20px;flex:none;}
.code-row .c{font-family:monospace;font-weight:600;color:var(--brown);min-width:54px;}
.code-row .n{font-size:14px;}
/* Review */
.review-controls{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.review-controls select{flex:1;padding:10px 12px;border:1px solid #e3d6c8;border-radius:8px;font-size:15px;background:white;color:var(--ink);font-family:inherit;}
.review-totals{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;}
.review-tile{background:var(--warm);border-radius:8px;padding:14px;text-align:center;}
.review-tile .num{font-size:24px;font-weight:700;color:var(--brown);line-height:1;}
.review-tile .lbl{font-size:11px;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;}
.bycode-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--warm);}
.bycode-row:last-child{border-bottom:none;}
.bycode-row .left{display:flex;align-items:center;gap:8px;min-width:0;}
.bycode-row .pill{font-family:monospace;font-size:12px;background:var(--warm);color:var(--brown);padding:2px 8px;border-radius:6px;flex:none;}
.bycode-row .nm{font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bycode-row .amt{font-weight:700;color:var(--brown);flex:none;}
.review-sub{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 6px;}
/* My codes nested */
.mycode-cat{border:1px solid var(--warm);border-radius:10px;margin-bottom:8px;overflow:hidden;}
.mycode-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;cursor:pointer;background:white;user-select:none;}
.mycode-head:active{background:var(--warm);}
.mycode-head .t{font-weight:600;color:var(--brown);font-size:14px;}
.mycode-head .meta{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:8px;}
.mycode-head .cnt{background:var(--reach);color:#2a3a14;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:600;}
.mycode-head .chev{transition:transform 0.15s ease;color:var(--muted);font-size:12px;}
.mycode-cat.open .mycode-head .chev{transform:rotate(90deg);}
.mycode-body{display:none;padding:2px 14px 8px;border-top:1px solid var(--warm);}
.mycode-cat.open .mycode-body{display:block;}
.mycode-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--warm);}
.mycode-item:last-child{border-bottom:none;}
.mycode-item .c{font-family:monospace;font-weight:600;color:var(--brown);min-width:54px;flex:none;}
.mycode-item .n{font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mycode-item .x{flex:none;width:28px;height:28px;border-radius:6px;border:none;background:var(--warm);color:var(--danger);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;margin:0;}
.code-actions{display:flex;gap:8px;margin-top:10px;}
.code-actions .btn{margin-top:0;}
.seg{display:flex;gap:8px;margin-bottom:14px;}
.seg button{flex:1;padding:10px;border:1px solid #e3d6c8;background:white;color:var(--muted);border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;}
.seg button.active{background:var(--brown);color:var(--cream);border-color:var(--brown);}
.export-btn{background:var(--reach);color:#2a3a14;margin-top:6px;}
.export-note{font-size:12px;color:var(--muted);margin-top:8px;}
.upload-stmt-btn{background:var(--send);color:var(--ink);margin-top:6px;}
.missing-badge{display:inline-block;background:#fbeee9;color:var(--danger);font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:8px;}
</style>
</head>
<body>

<!-- LOGIN VIEW -->
<div id="login-view" class="login-wrap hidden">
  <div class="login-card">
    <div class="logo">R</div>
    <h1>Receipts</h1>
    <div class="tag" id="login-tag">Choose your name to sign in</div>
    <div style="text-align:center;font-size:10px;color:var(--muted);margin-bottom:8px;">v2.8.5</div>
    <div id="name-step">
      <ul class="name-list" id="name-list"></ul>
    </div>
    <div id="pin-step" class="hidden">
      <div class="pin-display" id="pin-display">
        <div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div>
      </div>
      <div class="login-error" id="login-error"></div>
      <button class="btn" id="signin-btn" disabled>Sign In</button>
      <div class="keypad" id="keypad">
        <button type="button" class="key" data-digit="1">1</button><button type="button" class="key" data-digit="2">2</button><button type="button" class="key" data-digit="3">3</button>
        <button type="button" class="key" data-digit="4">4</button><button type="button" class="key" data-digit="5">5</button><button type="button" class="key" data-digit="6">6</button>
        <button type="button" class="key" data-digit="7">7</button><button type="button" class="key" data-digit="8">8</button><button type="button" class="key" data-digit="9">9</button>
        <button type="button" class="key wide" data-action="back">Back</button>
        <button type="button" class="key" data-digit="0">0</button>
        <button type="button" class="key wide" data-action="del">&#9003;</button>
      </div>
    </div>
  </div>
</div>

<!-- APP VIEW -->
<div id="app-view" class="hidden">
<header>
  <h1>Receipts</h1>
  <div class="who">
    <span id="who-name">&mdash;</span>
    <a href="#" id="logout-link">Sign out</a>
  </div>
</header>
<main>

  <div class="card" id="admin-entry" style="display:none;">
    <h2>Admin</h2>
    <button class="btn btn-secondary" id="open-admin">Manage Team Members</button>
  </div>

  <div class="card">
    <h2>Summary</h2>
    <div class="summary-grid" id="summary-grid">
      <div class="summary-tile"><div class="num">&mdash;</div><div class="lbl">Captured</div></div>
      <div class="summary-tile"><div class="num">&mdash;</div><div class="lbl">Matched</div></div>
      <div class="summary-tile"><div class="num">&mdash;</div><div class="lbl">Carry Forward</div></div>
      <div class="summary-tile"><div class="num">&mdash;</div><div class="lbl">Open Statements</div></div>
    </div>
  </div>

  <!-- RECONCILIATION CARD -->
  <div class="card">
    <h2>Statement Reconciliation <span id="missing-badge-head" class="missing-badge hidden"></span></h2>
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">Upload this month's statement, then match receipts to each line. Missing lines are flagged.</div>
    <div class="review-controls">
      <select id="recon-month"></select>
    </div>
    <div id="recon-no-stmt">
      <div class="empty" style="padding:16px 0;">
        <div>No statement uploaded for this month yet.</div>
      </div>
      <button class="btn upload-stmt-btn" id="open-upload-stmt">&#8679; Upload Statement</button>
    </div>
    <div id="recon-has-stmt" class="hidden">
      <div class="recon-stats">
        <div class="recon-stat"><div class="num" id="recon-total-amt">$0</div><div class="lbl">Statement Total</div></div>
        <div class="recon-stat"><div class="num" id="recon-matched-ct">0</div><div class="lbl">Matched</div></div>
        <div class="recon-stat"><div class="num" id="recon-missing-ct" style="color:var(--danger);">0</div><div class="lbl">Missing</div></div>
      </div>
      <div id="recon-lines"></div>
      <button class="btn upload-stmt-btn" style="margin-top:12px;" id="reupload-stmt">&#8679; Re-upload Statement</button>
    </div>
  </div>

  <div class="card">
    <h2>Recent Receipts</h2>
    <div id="receipts-area">
      <div class="empty">
        <div class="icon">&#129534;</div>
        <div>No receipts yet</div>
        <div style="font-size:12px;margin-top:6px;">Tap Capture to add your first</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>My Review</h2>
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">Your spending by month.</div>
    <div class="review-controls">
      <select id="review-month"></select>
    </div>
    <div class="review-totals">
      <div class="review-tile"><div class="num" id="review-total">$0</div><div class="lbl">Spent</div></div>
      <div class="review-tile"><div class="num" id="review-count">0</div><div class="lbl">Receipts</div></div>
    </div>
    <div id="review-bycode-wrap" class="hidden">
      <div class="review-sub">By budget code</div>
      <div id="review-bycode"></div>
    </div>
    <div id="review-list-wrap" class="hidden">
      <div class="review-sub">Receipts this month</div>
      <div id="review-list"></div>
    </div>
    <div id="review-empty" class="empty" style="padding:20px;"><div>No receipts in this month yet.</div></div>
    <button class="btn export-btn" id="export-btn">&#11015; Download Business Office Report</button>
    <div class="export-note">5-tab workbook for the month shown. If a statement is uploaded, uses statement order as source of truth.</div>
    <button class="btn" id="packet-btn" style="background:var(--equip);color:#fff;margin-top:10px;">&#128196; Download Receipt Packet (PDF)</button>
    <div class="export-note">One PDF for the month: a labeled page per receipt, missing receipts flagged, in statement order. No links to click.</div>
  </div>

  <div class="card">
    <h2>My Budget Codes</h2>
    <div style="font-size:13px;color:var(--muted);margin-bottom:8px;">Your codes, grouped by area.</div>
    <div id="mycodes-nested"><div style="color:var(--muted);font-size:13px;padding:8px 0;">Loading&hellip;</div></div>
    <div class="code-actions">
      <button class="btn btn-secondary" id="open-codes">Choose codes</button>
      <button class="btn btn-secondary" id="open-upload">Upload my codes</button>
    </div>
  </div>

</main>

<div class="capture-bar">
  <button class="btn" id="capture-btn">&#128247; Capture Receipt</button>
</div>

<input type="file" id="file-input" accept="image/*" class="hidden">

<!-- Capture modal -->
<div class="modal-bg" id="modal-bg">
  <div class="modal" id="modal">
    <h2 id="modal-title">Review Receipt</h2>
    <div class="sub" id="modal-sub">Check the details, then save.</div>
    <img id="preview-img" class="preview-img hidden" alt="receipt preview">
    <div id="note-step">
      <div class="field"><label>Quick note (optional)</label><textarea id="note-input" placeholder="e.g. lunch with Julie & TJ"></textarea></div>
      <button class="btn" id="parse-btn">Read Receipt</button>
      <button class="btn btn-secondary" id="cancel-btn-1">Cancel</button>
    </div>
    <div id="loading-step" class="hidden"><div class="spinner">Reading the receipt&hellip;</div></div>
    <div id="review-step" class="hidden">
      <div id="confirm-flag" class="confirm-flag hidden"></div>
      <div id="reason" class="reason hidden"></div>
      <div class="row-2">
        <div class="field"><label>Date</label><input type="text" id="f-date" placeholder="27-May-26"></div>
        <div class="field"><label>Amount</label><input type="text" id="f-amount" placeholder="0.00" inputmode="decimal"></div>
      </div>
      <div class="field"><label>Vendor</label><input type="text" id="f-vendor"></div>
      <div class="field"><label>Explanation (for Business Office)</label><input type="text" id="f-explanation"></div>
      <div class="field"><label>Budget Code</label><select id="f-code"></select></div>
      <button class="btn" id="save-btn">Save Receipt</button>
      <button class="btn btn-secondary" id="cancel-btn-2">Cancel</button>
    </div>
  </div>
</div>

<!-- Edit receipt modal -->
<div class="modal-bg" id="edit-bg">
  <div class="modal">
    <h2>Edit Receipt</h2>
    <div class="sub">Update any field, then save.</div>
    <div class="row-2">
      <div class="field"><label>Date</label><input type="text" id="ef-date"></div>
      <div class="field"><label>Amount</label><input type="text" id="ef-amount" inputmode="decimal"></div>
    </div>
    <div class="field"><label>Vendor</label><input type="text" id="ef-vendor"></div>
    <div class="field"><label>Explanation</label><input type="text" id="ef-explanation"></div>
    <div class="field"><label>Budget Code</label><select id="ef-code"></select></div>
    <div class="field"><label>Notes</label><textarea id="ef-notes"></textarea></div>
    <button class="btn" id="edit-save-btn">Save Changes</button>
    <button class="btn btn-secondary" id="edit-cancel-btn">Cancel</button>
  </div>
</div>

<!-- Statement upload modal -->
<div class="modal-bg" id="stmt-upload-bg">
  <div class="modal">
    <h2>Upload Statement</h2>
    <div class="sub">Upload the SouthState PDF or paste the transaction text. The app will parse all lines and auto-match your receipts.</div>
    <div class="field">
      <label>Statement Month</label>
      <input type="month" id="stmt-month-input">
    </div>
    <div class="seg">
      <button id="stmt-seg-file" class="active" type="button">PDF / Photo</button>
      <button id="stmt-seg-text" type="button">Paste text</button>
    </div>
    <div id="stmt-file-step">
      <button class="btn btn-secondary" id="pick-stmt-file">Choose PDF or photo</button>
      <div id="stmt-file-name" style="font-size:13px;color:var(--muted);margin-top:8px;text-align:center;"></div>
    </div>
    <div id="stmt-text-step" class="hidden">
      <div class="field"><textarea id="stmt-paste" style="min-height:140px;" placeholder="Paste transaction lines from your statement here&hellip;"></textarea></div>
    </div>
    <div id="stmt-loading" class="hidden"><div class="spinner">Parsing statement&hellip; this takes ~20 seconds for a full PDF.</div></div>
    <div id="stmt-result" class="hidden">
      <div class="reason" id="stmt-result-msg"></div>
    </div>
    <button class="btn" id="parse-stmt-btn">Parse Statement</button>
    <button class="btn btn-secondary" id="close-stmt-upload">Cancel</button>
  </div>
</div>

<!-- Admin modal -->
<div class="modal-bg" id="admin-bg">
  <div class="modal">
    <h2>Team Members</h2>
    <div class="sub">Add people, reset PINs, or toggle access.</div>
    <div id="admin-list"></div>
    <h2 style="margin-top:20px;">Add a Person</h2>
    <div class="field"><label>Name</label><input type="text" id="new-name" placeholder="First name"></div>
    <div class="field"><label>Email (optional)</label><input type="email" id="new-email"></div>
    <div class="row-2">
      <div class="field"><label>PIN (4-6 digits)</label><input type="text" id="new-pin" inputmode="numeric"></div>
      <div class="field"><label>Admin?</label><select id="new-admin"><option value="0">No</option><option value="1">Yes</option></select></div>
    </div>
    <button class="btn" id="add-user-btn">Add Person</button>
    <button class="btn btn-secondary" id="close-admin">Done</button>
  </div>
</div>

<!-- My Codes picker modal -->
<div class="modal-bg" id="codes-bg">
  <div class="modal">
    <h2>Choose My Budget Codes</h2>
    <div class="sub">Open a section and check your line items. Search to jump to any code.</div>
    <button class="btn btn-secondary" id="use-used-btn" style="margin-top:0;">Use what I've been using</button>
    <div class="field" style="margin-top:12px;"><input type="text" id="codes-search" placeholder="Search codes&hellip;"></div>
    <div id="codes-picker" style="max-height:50vh;overflow-y:auto;"></div>
    <button class="btn" id="save-codes-btn">Save My Codes</button>
    <button class="btn btn-secondary" id="close-codes">Cancel</button>
  </div>
</div>

<!-- Upload my codes modal -->
<div class="modal-bg" id="upload-bg">
  <div class="modal">
    <h2>Upload My Codes</h2>
    <div class="sub">Drop in a report, screenshot, or PDF. We'll find your codes.</div>
    <div class="seg">
      <button id="seg-file" class="active" type="button">Photo / PDF</button>
      <button id="seg-text" type="button">Paste text</button>
    </div>
    <div id="upload-file-step">
      <button class="btn btn-secondary" id="pick-codes-file">Choose a file</button>
      <div id="upload-file-name" style="font-size:13px;color:var(--muted);margin-top:8px;text-align:center;"></div>
    </div>
    <div id="upload-text-step" class="hidden">
      <div class="field"><textarea id="codes-paste" style="min-height:120px;" placeholder="Paste codes or report text here&hellip;"></textarea></div>
    </div>
    <div id="upload-loading" class="hidden"><div class="spinner">Reading your codes&hellip;</div></div>
    <div id="upload-result" class="hidden">
      <div class="reason" id="upload-summary"></div>
      <div id="upload-found" style="max-height:30vh;overflow-y:auto;margin-bottom:12px;"></div>
    </div>
    <button class="btn" id="read-codes-btn">Read Codes</button>
    <button class="btn" id="apply-codes-btn" style="display:none;">Add These to My Codes</button>
    <button class="btn btn-secondary" id="close-upload">Cancel</button>
  </div>
</div>

<input type="file" id="codes-file-input" accept="image/*,application/pdf" class="hidden">
<input type="file" id="stmt-file-input" accept="image/*,application/pdf" class="hidden">
</div>

<script>
  var codesCache=[], currentImageB64=null, currentMediaType='image/jpeg', me=null, pinUserId=null, pinBuffer='';
  var editingReceiptId=null, masterCodes=[], groupOrder=[];
  var stmtImageB64=null, stmtMediaType='application/pdf';
  var uploadImageB64=null, uploadMediaType='image/jpeg', uploadFoundCodes=[];
  var currentMonth=null, currentReconMonth=null;

  async function api(path,opts){const r=await fetch(path,opts);return r.json();}

  // ---------- AUTH ----------
  async function boot(){
    const data=await api('/api/auth/me');
    if(data.authenticated){me=data.user;showApp();}else{showLogin();}
  }
  function showLogin(){
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('app-view').classList.add('hidden');
    loadNames();
  }
  async function loadNames(){
    const data=await api('/api/auth/users');
    const list=document.getElementById('name-list');
    list.innerHTML='';
    (data.users||[]).forEach(u=>{
      const li=document.createElement('li');
      li.textContent=u.name;
      li.addEventListener('click',()=>pickName(u.id,u.name));
      list.appendChild(li);
    });
  }
  function pickName(id,name){
    pinUserId=id; pinBuffer='';
    document.getElementById('login-tag').textContent='Enter '+name+"'s PIN";
    document.getElementById('name-step').classList.add('hidden');
    document.getElementById('pin-step').classList.remove('hidden');
    renderPin();
  }
  function renderPin(){
    document.querySelectorAll('#pin-display .pin-dot').forEach((d,i)=>d.classList.toggle('filled',i<pinBuffer.length));
    const btn=document.getElementById('signin-btn');
    if(btn) btn.disabled=pinBuffer.length<4;
  }
  function handleKey(btn){
    const action=btn.getAttribute('data-action');
    if(action==='back'){
      document.getElementById('pin-step').classList.add('hidden');
      document.getElementById('name-step').classList.remove('hidden');
      document.getElementById('login-tag').textContent='Choose your name to sign in';
      document.getElementById('login-error').textContent=''; pinBuffer=''; renderPin(); return;
    }
    if(action==='del'){pinBuffer=pinBuffer.slice(0,-1);renderPin();return;}
    const digit=btn.getAttribute('data-digit');
    if(digit!==null){if(pinBuffer.length<6)pinBuffer+=digit;document.getElementById('login-error').textContent='';renderPin();}
  }
  document.querySelectorAll('#keypad .key').forEach(b=>b.addEventListener('click',()=>handleKey(b)));
  document.getElementById('signin-btn').addEventListener('click',submitPin);
  var submitting=false;
  async function submitPin(){
    if(submitting||pinBuffer.length<4) return;
    submitting=true;
    const btn=document.getElementById('signin-btn');
    btn.disabled=true; btn.textContent='Checking\u2026';
    document.getElementById('login-error').textContent='';
    let resp;
    try{resp=await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:pinUserId,pin:pinBuffer})});}
    catch(e){resp={error:'network'};}
    submitting=false; btn.textContent='Sign In';
    if(resp&&resp.ok){me=resp.user;document.getElementById('login-error').textContent='';showApp();}
    else{document.getElementById('login-error').textContent=(resp&&resp.error==='network')?'Connection problem. Try again.':'Wrong PIN. Try again.';pinBuffer='';renderPin();}
  }
  document.getElementById('logout-link').addEventListener('click',async e=>{e.preventDefault();await api('/api/auth/logout',{method:'POST'});me=null;location.reload();});

  function showApp(){
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');
    document.getElementById('who-name').textContent=me.name;
    if(me.is_admin===1) document.getElementById('admin-entry').style.display='';
    loadSummary(); loadCodes(); loadReceipts(); loadMyCodesNested(); loadReview();
    const cur=new Date().toISOString().slice(0,7);
    initReconMonthPicker(cur); loadReconcile(cur);
  }

  // ---------- SUMMARY ----------
  async function loadSummary(){
    const data=await api('/api/summary'); const s=data.summary||{};
    const tiles=document.querySelectorAll('#summary-grid .summary-tile .num');
    tiles[0].textContent=s.captured??0; tiles[1].textContent=s.matched??0;
    tiles[2].textContent=s.carry_forward??0; tiles[3].textContent=s.open_statements??0;
  }

  // ---------- CODES ----------
  async function loadCodes(){
    const data=await api('/api/budget-codes');
    codesCache=data.codes||[];
    const sel=document.getElementById('f-code'); sel.innerHTML='';
    const esel=document.getElementById('ef-code'); esel.innerHTML='';
    codesCache.forEach(c=>{
      const opt=document.createElement('option'); opt.value=c.code; opt.textContent=c.code+' \u2014 '+c.name;
      sel.appendChild(opt.cloneNode(true)); esel.appendChild(opt);
    });
  }

  // ---------- RECEIPTS ----------
  async function loadReceipts(){
    const data=await api('/api/receipts'); const area=document.getElementById('receipts-area'); const list=data.receipts||[];
    if(!list.length){area.innerHTML='<div class="empty"><div class="icon">&#129534;</div><div>No receipts yet</div><div style="font-size:12px;margin-top:6px;">Tap Capture to add your first</div></div>';return;}
    area.innerHTML='';
    list.forEach(r=>{
      const div=document.createElement('div'); div.className='rcpt';
      const amt=(r.amount!=null)?('$'+Number(r.amount).toFixed(2)):'&mdash;';
      div.innerHTML='<div class="top"><span class="vendor">'+(r.vendor_name||'Unknown')+'</span><span class="amt">'+amt+'</span></div>'+
        '<div class="meta">'+(r.receipt_date||'')+' &middot; '+(r.purpose||'')+'</div>'+
        '<span class="code-pill">'+(r.budget_code||'TBD')+'</span>'+
        '<div class="rcpt-actions"><button class="edit-btn" data-id="'+r.id+'">Edit</button><button class="del-btn" data-id="'+r.id+'">Delete</button></div>';
      div.querySelector('.edit-btn').addEventListener('click',()=>openEditReceipt(r));
      div.querySelector('.del-btn').addEventListener('click',()=>deleteReceipt(r.id));
      area.appendChild(div);
    });
  }

  // ---------- EDIT RECEIPT ----------
  function openEditReceipt(r){
    editingReceiptId=r.id;
    document.getElementById('ef-date').value=r.receipt_date||'';
    document.getElementById('ef-amount').value=r.amount!=null?r.amount:'';
    document.getElementById('ef-vendor').value=r.vendor_name||'';
    document.getElementById('ef-explanation').value=r.purpose||'';
    document.getElementById('ef-notes').value=r.notes||'';
    const sel=document.getElementById('ef-code');
    if(r.budget_code) sel.value=r.budget_code;
    document.getElementById('edit-bg').classList.add('open');
  }
  document.getElementById('edit-cancel-btn').addEventListener('click',()=>document.getElementById('edit-bg').classList.remove('open'));
  document.getElementById('edit-save-btn').addEventListener('click',async()=>{
    if(!editingReceiptId) return;
    const btn=document.getElementById('edit-save-btn'); btn.disabled=true; btn.textContent='Saving\u2026';
    const receipt={
      receipt_date:document.getElementById('ef-date').value.trim(),
      amount:parseFloat(document.getElementById('ef-amount').value)||null,
      vendor_name:document.getElementById('ef-vendor').value.trim(),
      explanation:document.getElementById('ef-explanation').value.trim(),
      budget_code:document.getElementById('ef-code').value,
      note:document.getElementById('ef-notes').value.trim(),
    };
    const r=await api('/api/receipts/'+editingReceiptId,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipt})});
    btn.disabled=false; btn.textContent='Save Changes';
    if(r.error){alert('Could not save: '+r.error);return;}
    document.getElementById('edit-bg').classList.remove('open');
    loadReceipts(); loadReview(); loadSummary();
  });

  async function deleteReceipt(id){
    if(!confirm('Delete this receipt? This cannot be undone.')) return;
    const r=await api('/api/receipts/'+id,{method:'DELETE'});
    if(r.error){alert('Could not delete: '+r.error);return;}
    loadReceipts(); loadReview(); loadSummary(); loadReconcile(currentReconMonth);
  }

  // ---------- RECONCILIATION ----------
  function initReconMonthPicker(defaultMonth){
    currentReconMonth=defaultMonth;
    const sel=document.getElementById('recon-month');
    // Build last 6 months
    const months=[]; const d=new Date();
    for(let i=0;i<6;i++){
      const m=new Date(d.getFullYear(),d.getMonth()-i,1).toISOString().slice(0,7);
      months.push(m);
    }
    sel.innerHTML='';
    months.forEach(m=>{const opt=document.createElement('option');opt.value=m;opt.textContent=monthLabel(m);sel.appendChild(opt);});
    sel.value=defaultMonth;
    sel.addEventListener('change',e=>{currentReconMonth=e.target.value;loadReconcile(e.target.value);});
  }

  async function loadReconcile(month){
    currentReconMonth=month;
    const data=await api('/api/reconcile?month='+encodeURIComponent(month));
    renderReconcile(data);
  }

  function renderReconcile(data){
    const noStmt=document.getElementById('recon-no-stmt');
    const hasStmt=document.getElementById('recon-has-stmt');
    const badge=document.getElementById('missing-badge-head');
    if(!data.statement){
      noStmt.classList.remove('hidden'); hasStmt.classList.add('hidden'); badge.classList.add('hidden'); return;
    }
    noStmt.classList.add('hidden'); hasStmt.classList.remove('hidden');
    const lines=data.lines||[];
    const matched=lines.filter(l=>l.match_status==='matched').length;
    const missing=lines.filter(l=>l.match_status==='unmatched').length;
    document.getElementById('recon-total-amt').textContent='$'+Number(data.statement.purchase_total||0).toFixed(2);
    document.getElementById('recon-matched-ct').textContent=matched;
    document.getElementById('recon-missing-ct').textContent=missing;
    if(missing>0){badge.textContent=missing+' missing';badge.classList.remove('hidden');}
    else badge.classList.add('hidden');

    const wrap=document.getElementById('recon-lines'); wrap.innerHTML='';
    lines.forEach(line=>{
      const div=document.createElement('div'); div.className='recon-line';
      const amt='$'+Number(line.amount||0).toFixed(2);
      const statusLabel=line.match_status==='matched'?'&#10003; Receipt attached':'&#9888; No receipt';
      const statusCls=line.match_status==='matched'?'matched':'unmatched';
      let receiptInfo='';
      if(line.match_status==='matched'&&line.r_vendor){
        receiptInfo='<div class="meta" style="color:var(--brown);">'+
          (line.purpose||line.r_vendor||'')+
          (line.budget_code?' &middot; <span style="font-family:monospace;">'+line.budget_code+'</span>':'')+
          '</div>';
      }
      div.innerHTML='<div class="top"><span class="vendor">'+(line.vendor_clean||line.vendor_raw||'')+'</span><span class="amt">'+amt+'</span></div>'+
        '<div class="meta">'+(line.transaction_date||line.post_date||'')+'</div>'+
        receiptInfo+
        '<span class="status-pill '+statusCls+'">'+statusLabel+'</span>';
      wrap.appendChild(div);
    });
  }

  document.getElementById('open-upload-stmt').addEventListener('click',openStmtUpload);
  document.getElementById('reupload-stmt').addEventListener('click',openStmtUpload);
  function openStmtUpload(){
    const m=currentReconMonth||new Date().toISOString().slice(0,7);
    document.getElementById('stmt-month-input').value=m;
    stmtImageB64=null;
    document.getElementById('stmt-file-name').textContent='';
    document.getElementById('stmt-paste').value='';
    document.getElementById('stmt-result').classList.add('hidden');
    document.getElementById('stmt-loading').classList.add('hidden');
    document.getElementById('parse-stmt-btn').style.display='';
    setStmtMode('file');
    document.getElementById('stmt-upload-bg').classList.add('open');
  }
  document.getElementById('close-stmt-upload').addEventListener('click',()=>document.getElementById('stmt-upload-bg').classList.remove('open'));
  document.getElementById('stmt-seg-file').addEventListener('click',()=>setStmtMode('file'));
  document.getElementById('stmt-seg-text').addEventListener('click',()=>setStmtMode('text'));
  function setStmtMode(mode){
    const isFile=mode==='file';
    document.getElementById('stmt-seg-file').classList.toggle('active',isFile);
    document.getElementById('stmt-seg-text').classList.toggle('active',!isFile);
    document.getElementById('stmt-file-step').classList.toggle('hidden',!isFile);
    document.getElementById('stmt-text-step').classList.toggle('hidden',isFile);
  }
  document.getElementById('pick-stmt-file').addEventListener('click',()=>document.getElementById('stmt-file-input').click());
  document.getElementById('stmt-file-input').addEventListener('change',async e=>{
    const file=e.target.files[0]; if(!file) return;
    stmtMediaType=file.type||'application/pdf';
    stmtImageB64=await fileToBase64(file);
    document.getElementById('stmt-file-name').textContent=file.name;
    e.target.value='';
  });
  document.getElementById('parse-stmt-btn').addEventListener('click',async()=>{
    const month=document.getElementById('stmt-month-input').value;
    if(!month){alert('Select the statement month first.');return;}
    const isText=document.getElementById('stmt-seg-text').classList.contains('active');
    const payload={statement_month:month};
    if(isText){
      const txt=document.getElementById('stmt-paste').value.trim();
      if(!txt){alert('Paste statement text first.');return;}
      payload.text=txt;
    } else {
      if(!stmtImageB64){alert('Choose a PDF or photo first.');return;}
      payload.image_base64=stmtImageB64; payload.media_type=stmtMediaType;
    }
    document.getElementById('stmt-loading').classList.remove('hidden');
    document.getElementById('stmt-result').classList.add('hidden');
    document.getElementById('parse-stmt-btn').style.display='none';
    let data;
    try{
      const resp=await fetch('/api/statements/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      data=await resp.json();
    }catch(e){data={error:'network'};}
    document.getElementById('stmt-loading').classList.add('hidden');
    if(data.error){
      alert('Could not parse statement: '+data.error+'. Try pasting the text instead.');
      document.getElementById('parse-stmt-btn').style.display='';
      return;
    }
    const msg=document.getElementById('stmt-result-msg');
    msg.textContent='Parsed '+data.line_count+' transactions ($'+Number(data.purchase_total||0).toFixed(2)+'). Auto-matched '+data.auto_matched+' receipts.';
    document.getElementById('stmt-result').classList.remove('hidden');
    setTimeout(()=>{
      document.getElementById('stmt-upload-bg').classList.remove('open');
      loadReconcile(month); loadSummary(); loadReceipts();
    },2200);
  });

  // ---------- MY REVIEW ----------
  function monthLabel(m){
    const parts=m.split('-'); if(parts.length!==2) return m;
    const names=['January','February','March','April','May','June','July','August','September','October','November','December'];
    return (names[parseInt(parts[1],10)-1]||parts[1])+' '+parts[0];
  }
  async function loadReview(month){
    const q=month?('?month='+encodeURIComponent(month)):'';
    const data=await api('/api/my-review'+q);
    renderReview(data);
  }
  function renderReview(d){
    currentMonth=d.month;
    const sel=document.getElementById('review-month');
    const months=d.months||[d.month];
    const existing=Array.from(sel.options).map(o=>o.value).join(',');
    if(existing!==months.join(',')){sel.innerHTML='';months.forEach(m=>{const opt=document.createElement('option');opt.value=m;opt.textContent=monthLabel(m);sel.appendChild(opt);});}
    sel.value=d.month;
    document.getElementById('review-total').textContent='$'+Number(d.total||0).toFixed(2);
    document.getElementById('review-count').textContent=d.count||0;
    const byWrap=document.getElementById('review-bycode-wrap');
    const byBox=document.getElementById('review-bycode');
    const listWrap=document.getElementById('review-list-wrap');
    const listBox=document.getElementById('review-list');
    const emptyBox=document.getElementById('review-empty');
    if(!d.count){byWrap.classList.add('hidden');listWrap.classList.add('hidden');emptyBox.classList.remove('hidden');return;}
    emptyBox.classList.add('hidden');
    byBox.innerHTML='';
    (d.by_code||[]).forEach(b=>{
      const row=document.createElement('div'); row.className='bycode-row';
      row.innerHTML='<span class="left"><span class="pill">'+b.code+'</span><span class="nm">'+(b.name||'')+'</span></span><span class="amt">$'+Number(b.total||0).toFixed(2)+'</span>';
      byBox.appendChild(row);
    });
    byWrap.classList.remove('hidden');
    listBox.innerHTML='';
    (d.receipts||[]).forEach(r=>{
      const div=document.createElement('div'); div.className='rcpt';
      const amt=(r.amount!=null)?('$'+Number(r.amount).toFixed(2)):'&mdash;';
      div.innerHTML='<div class="top"><span class="vendor">'+(r.vendor_name||'Unknown')+'</span><span class="amt">'+amt+'</span></div>'+
        '<div class="meta">'+(r.receipt_date||'')+' &middot; '+(r.purpose||'')+'</div>'+
        '<span class="code-pill">'+(r.budget_code||'TBD')+'</span>';
      listBox.appendChild(div);
    });
    listWrap.classList.remove('hidden');
  }
  document.getElementById('review-month').addEventListener('change',e=>loadReview(e.target.value));

  // ---------- BUSINESS OFFICE EXPORT (ExcelJS) ----------
  var TAB_BROWN='FF402020', TAB_CREAM='FFFDF8F3', TAB_SAGE='FFAAC27F', TAB_WARM='FFF4EBDF', TAB_INK='FF2A1A1A', TAB_DANGER='FFB3422F', TAB_LINK='FF14405A';

  function exStyleTitle(ws,row,ncols){
    ws.mergeCells(row.number,1,row.number,ncols);
    var c=row.getCell(1);
    c.font={bold:true,size:13,color:{argb:TAB_CREAM}};
    c.fill={type:'pattern',pattern:'solid',fgColor:{argb:TAB_BROWN}};
    c.alignment={vertical:'middle',horizontal:'left'};
    row.height=22;
  }
  function exStyleSub(ws,row,ncols){
    ws.mergeCells(row.number,1,row.number,ncols);
    var c=row.getCell(1);
    c.font={italic:true,size:10,color:{argb:TAB_INK}};
    c.fill={type:'pattern',pattern:'solid',fgColor:{argb:TAB_WARM}};
    c.alignment={vertical:'middle',horizontal:'left'};
  }
  function exStyleHeader(row){
    row.eachCell(function(c){
      c.font={bold:true,size:11,color:{argb:TAB_BROWN}};
      c.fill={type:'pattern',pattern:'solid',fgColor:{argb:TAB_SAGE}};
      c.alignment={vertical:'middle',horizontal:'left',wrapText:true};
      c.border={bottom:{style:'thin',color:{argb:TAB_BROWN}}};
    });
    row.height=20;
  }
  function exMoney(cell){ cell.numFmt='$#,##0.00'; cell.alignment={horizontal:'right',vertical:'top'}; }
  function exWrap(cell){ cell.alignment={wrapText:true,vertical:'top'}; }
  function exPage(ws){
    ws.pageSetup={orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,
      margins:{left:0.4,right:0.4,top:0.5,bottom:0.5,header:0.3,footer:0.3}};
  }
  function exReceipt(cell,origin,receiptId,hasReceipt){
    if(hasReceipt && receiptId){
      cell.value={text:'View receipt',hyperlink:origin+'/api/receipt-image/'+receiptId};
      cell.font={color:{argb:TAB_LINK},underline:true,size:11};
      cell.alignment={vertical:'top',horizontal:'left'};
    } else {
      cell.value='MISSING';
      cell.font={bold:true,color:{argb:TAB_DANGER},size:11};
      cell.alignment={vertical:'top',horizontal:'left'};
    }
  }

  document.getElementById('export-btn').addEventListener('click',async()=>{
    const btn=document.getElementById('export-btn');
    if(typeof ExcelJS==='undefined'){alert('Spreadsheet tool still loading. Wait and try again.');return;}
    const month=currentMonth||document.getElementById('review-month').value;
    btn.disabled=true; const orig=btn.innerHTML; btn.textContent='Building\u2026';
    let data;
    try{data=await api('/api/export?month='+encodeURIComponent(month));}catch(e){data={error:'network'};}
    if(!data||data.error){alert('Could not build export: '+((data&&data.error)||'unknown'));btn.disabled=false;btn.innerHTML=orig;return;}
    try{await buildWorkbook(data);}catch(e){alert('Workbook error: '+(e&&e.message?e.message:e));}
    btn.disabled=false; btn.innerHTML=orig;
  });

  // ---------- RECEIPT PDF PACKET (jsPDF, client-side) ----------
  function blobToDataURL(blob){return new Promise(function(res,rej){var fr=new FileReader();fr.onload=function(){res(fr.result);};fr.onerror=function(){rej(new Error('read failed'));};fr.readAsDataURL(blob);});}
  function loadImage(dataUrl){return new Promise(function(res,rej){var im=new Image();im.onload=function(){res(im);};im.onerror=function(){rej(new Error('image decode failed'));};im.src=dataUrl;});}

  document.getElementById('packet-btn').addEventListener('click',async function(){
    var btn=document.getElementById('packet-btn');
    if(!window.jspdf||!window.jspdf.jsPDF){alert('PDF tool still loading. Wait a moment and try again.');return;}
    var month=currentMonth||document.getElementById('review-month').value;
    btn.disabled=true; var orig=btn.innerHTML; btn.textContent='Building packet\u2026';
    var data;
    try{data=await api('/api/packet-data?month='+encodeURIComponent(month));}catch(e){data={error:'network'};}
    if(!data||data.error){alert('Could not build packet: '+((data&&data.error)||'unknown'));btn.disabled=false;btn.innerHTML=orig;return;}
    try{await buildPacket(data);}catch(e){alert('Packet error: '+(e&&e.message?e.message:e));}
    btn.disabled=false; btn.innerHTML=orig;
  });

  async function buildPacket(d){
    var jsPDFctor=window.jspdf.jsPDF;
    var doc=new jsPDFctor({unit:'pt',format:'letter'});
    var PW=612, PH=792, M=40;
    var BROWN=[64,32,32], SAGE=[170,194,127], WARM=[244,235,223], DANGER=[179,66,47], INK=[42,26,26], MUTED=[138,122,114];
    var monthName=monthLabel(d.month);
    var packetDate=new Date().toISOString().slice(0,10);

    // ----- Cover page -----
    doc.setFillColor(BROWN[0],BROWN[1],BROWN[2]); doc.rect(0,0,PW,110,'F');
    doc.setTextColor(253,248,243); doc.setFont('helvetica','bold'); doc.setFontSize(24);
    doc.text('Receipt Packet',M,58);
    doc.setFont('helvetica','normal'); doc.setFontSize(13);
    doc.text(monthName,M,86);
    var cy=150;
    doc.setTextColor(INK[0],INK[1],INK[2]); doc.setFontSize(12);
    function coverLine(lbl,val){doc.setFont('helvetica','bold');doc.text(lbl,M,cy);doc.setFont('helvetica','normal');doc.text(String(val),M+170,cy);cy+=26;}
    coverLine('Name:', d.name||'\u2014');
    coverLine('Card:', 'SouthState Visa ending '+(d.card||'\u2014'));
    coverLine('Source:', d.using_statement?'Statement ledger order':'Captured receipts (no statement)');
    coverLine('Statement lines:', d.counts.lines);
    coverLine('Receipts with image:', d.counts.with_image);
    coverLine('Missing receipts:', d.counts.missing);
    coverLine('Not on statement:', d.counts.extras);
    coverLine('Packet generated:', packetDate);
    doc.setDrawColor(SAGE[0],SAGE[1],SAGE[2]); doc.setLineWidth(2); doc.line(M,cy,PW-M,cy);
    doc.setTextColor(MUTED[0],MUTED[1],MUTED[2]); doc.setFontSize(10);
    doc.text('One page per receipt follows. Missing receipts are flagged in sequence.',M,cy+24);

    // ----- Label block helper -----
    function labelBlock(r,statusText,statusColor){
      doc.addPage();
      doc.setFillColor(WARM[0],WARM[1],WARM[2]); doc.rect(M,M,PW-2*M,92,'F');
      doc.setDrawColor(SAGE[0],SAGE[1],SAGE[2]); doc.setLineWidth(1.5); doc.line(M,M+92,PW-M,M+92);
      doc.setTextColor(BROWN[0],BROWN[1],BROWN[2]); doc.setFont('helvetica','bold'); doc.setFontSize(15);
      doc.text(String(r.vendor||'Unknown vendor').slice(0,60),M+12,M+26);
      doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(INK[0],INK[1],INK[2]);
      doc.text('Date: '+(r.date||'\u2014')+'     Amount: $'+(Number(r.amount)||0).toFixed(2),M+12,M+48);
      doc.text('Budget code: '+(r.code_label||r.code||'\u2014'),M+12,M+68);
      if(statusText){doc.setFont('helvetica','bold');doc.setTextColor(statusColor[0],statusColor[1],statusColor[2]);doc.text(statusText,M+12,M+86);}
    }

    // ----- One receipt page -----
    async function receiptPage(r,extraTag){
      var statusText=extraTag?'Not on statement':'';
      var statusColor=INK;
      if(!r.has_receipt){ labelBlock(r,'MISSING RECEIPT',DANGER); drawMissing(); return; }
      if(!r.has_image){ labelBlock(r,extraTag?'Not on statement':'',INK); drawFallback('Receipt on file, but no image stored. View in app.'); return; }
      // fetch image (authenticated, same-origin cookie)
      var blob;
      try{ var resp=await fetch('/api/receipt-image/'+r.receipt_id,{credentials:'same-origin'}); if(!resp.ok){throw new Error('status '+resp.status);} blob=await resp.blob(); }
      catch(e){ labelBlock(r,extraTag?'Not on statement':'',INK); drawFallback('Receipt image could not be loaded. View in app.'); return; }
      var type=(blob.type||'').toLowerCase();
      if(type.indexOf('jpeg')===-1 && type.indexOf('jpg')===-1 && type.indexOf('png')===-1){
        labelBlock(r,extraTag?'Not on statement':'',INK);
        drawFallback('Receipt on file \u2014 not image-previewable in PDF. View in app.');
        return;
      }
      var fmt=(type.indexOf('png')!==-1)?'PNG':'JPEG';
      var dataUrl=await blobToDataURL(blob);
      var img;
      try{ img=await loadImage(dataUrl); }
      catch(e){ labelBlock(r,extraTag?'Not on statement':'',INK); drawFallback('Receipt image could not be decoded. View in app.'); return; }
      labelBlock(r,statusText,statusColor);
      var top=M+92+18, maxW=PW-2*M, maxH=PH-top-M;
      var iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height;
      var scale=Math.min(maxW/iw, maxH/ih); if(scale>1) scale=1;
      var w=iw*scale, h=ih*scale, x=M+(maxW-w)/2, y=top;
      try{ doc.addImage(dataUrl,fmt,x,y,w,h); }
      catch(e){ drawFallback('Receipt image could not be embedded. View in app.'); }
    }
    function drawMissing(){
      var cyy=PH/2;
      doc.setFont('helvetica','bold'); doc.setFontSize(26); doc.setTextColor(DANGER[0],DANGER[1],DANGER[2]);
      doc.text('MISSING RECEIPT',PW/2,cyy,{align:'center'});
      doc.setFont('helvetica','normal'); doc.setFontSize(12); doc.setTextColor(MUTED[0],MUTED[1],MUTED[2]);
      doc.text('No receipt image is attached to this statement line.',PW/2,cyy+28,{align:'center'});
    }
    function drawFallback(msg){
      var cyy=PH/2;
      doc.setFont('helvetica','normal'); doc.setFontSize(13); doc.setTextColor(INK[0],INK[1],INK[2]);
      doc.text(doc.splitTextToSize(msg,PW-2*M-40),PW/2,cyy,{align:'center'});
    }

    // ----- Statement / captured rows in order -----
    var rows=d.rows||[];
    for(var i=0;i<rows.length;i++){ await receiptPage(rows[i],false); }

    // ----- Extras: captured not on statement -----
    var extras=d.extras||[];
    if(extras.length){
      doc.addPage();
      doc.setFillColor(BROWN[0],BROWN[1],BROWN[2]); doc.rect(0,PH/2-40,PW,80,'F');
      doc.setTextColor(253,248,243); doc.setFont('helvetica','bold'); doc.setFontSize(18);
      doc.text('Captured receipts not on statement',PW/2,PH/2+6,{align:'center'});
      for(var j=0;j<extras.length;j++){ await receiptPage(extras[j],true); }
    }

    // ----- Save -----
    var safeName=(d.name||'User').replace(/[^A-Za-z0-9]/g,'');
    var parts=d.month.split('-');
    var names=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var fname=(names[parseInt(parts[1],10)]||parts[1])+'_'+parts[0]+'_Receipt_Packet_'+safeName+'.pdf';
    doc.save(fname);
  }

  async function buildWorkbook(d){
    var monthName=monthLabel(d.month);
    var usingStmt=!!d.using_statement;
    var origin=location.origin;
    var wb=new ExcelJS.Workbook();
    wb.creator='Receipts'; wb.created=new Date();

    // ---- Tab 1: Monthly Export ----
    var ws1=wb.addWorksheet('Monthly Export');
    var hdr1=usingStmt?['Post Date','Trans Date','Vendor Name','Amount','Explanation','TAB Expense Code #','Receipt']
                      :['Date','Vendor Name','Amount','Explanation','TAB Expense Code #','Receipt'];
    var amt1=usingStmt?4:3, expl1=usingStmt?5:4, code1=usingStmt?6:5, rcpt1=usingStmt?7:6;
    ws1.columns=usingStmt
      ?[{width:11},{width:11},{width:24},{width:12},{width:30},{width:26},{width:14}]
      :[{width:12},{width:26},{width:12},{width:34},{width:28},{width:14}];
    exStyleTitle(ws1,ws1.addRow(['Visa Expense Cover Sheet']),hdr1.length);
    exStyleSub(ws1,ws1.addRow(['Statement Date: '+monthName+'  \u00b7  Name: '+(d.name||'')+'  \u00b7  Card: SouthState Visa ending '+(d.card||'')]),hdr1.length);
    ws1.addRow([]);
    exStyleHeader(ws1.addRow(hdr1));
    (d.statement_rows||[]).forEach(function(r){
      var arr=usingStmt
        ?[r.post_date,r.date,r.vendor,Number(r.amount)||0,r.explanation,r.code_label,'']
        :[r.date,r.vendor,Number(r.amount)||0,r.explanation,r.code_label,''];
      var row=ws1.addRow(arr);
      exMoney(row.getCell(amt1)); exWrap(row.getCell(expl1)); exWrap(row.getCell(code1));
      exReceipt(row.getCell(rcpt1),origin,r.receipt_id,r.has_receipt);
    });
    var t1=ws1.addRow([]);
    t1.getCell(1).value='Total Visa purchases'; t1.getCell(1).font={bold:true,color:{argb:TAB_BROWN}};
    t1.getCell(amt1).value=Number(d.statement_total)||0; exMoney(t1.getCell(amt1));
    t1.getCell(amt1).font={bold:true,color:{argb:TAB_BROWN}};
    ws1.views=[{state:'frozen',ySplit:4}]; exPage(ws1);

    // ---- Tab 2: Statement Ledger ----
    var ws2=wb.addWorksheet('Statement Ledger');
    var hdr2=['Post Date','Trans Date','Vendor Name','Amount','Explanation','TAB Expense Code #','Notes','Receipt'];
    ws2.columns=[{width:11},{width:11},{width:22},{width:12},{width:28},{width:24},{width:22},{width:14}];
    exStyleTitle(ws2,ws2.addRow(['Statement Ledger \u2014 '+monthName]),hdr2.length);
    exStyleSub(ws2,ws2.addRow(['Statement controls final reconciliation.']),hdr2.length);
    ws2.addRow([]);
    exStyleHeader(ws2.addRow(hdr2));
    (d.statement_rows||[]).forEach(function(r){
      var row=ws2.addRow([r.post_date||r.date,r.date,r.vendor,Number(r.amount)||0,r.explanation,r.code_label,r.notes,'']);
      exMoney(row.getCell(4)); exWrap(row.getCell(5)); exWrap(row.getCell(6)); exWrap(row.getCell(7));
      exReceipt(row.getCell(8),origin,r.receipt_id,r.has_receipt);
    });
    var t2=ws2.addRow([]);
    t2.getCell(3).value='Statement Ledger Total'; t2.getCell(3).font={bold:true,color:{argb:TAB_BROWN}};
    t2.getCell(4).value=Number(d.statement_total)||0; exMoney(t2.getCell(4));
    t2.getCell(4).font={bold:true,color:{argb:TAB_BROWN}};
    ws2.views=[{state:'frozen',ySplit:4}]; exPage(ws2);

    // ---- Tab 3: Credits & Offsets ----
    var ws3=wb.addWorksheet('Credits & Offsets');
    var hdr3=['Date','Description','Amount','Type','Notes'];
    ws3.columns=[{width:12},{width:40},{width:12},{width:16},{width:30}];
    exStyleTitle(ws3,ws3.addRow(['Credits & Offsets \u2014 '+monthName]),hdr3.length);
    exStyleSub(ws3,ws3.addRow(['Credits, reimbursements, offsets, corrections']),hdr3.length);
    ws3.addRow([]);
    exStyleHeader(ws3.addRow(hdr3));
    var noteRow3=ws3.addRow(['No credits or offsets recorded. Credit total: $0.00']);
    ws3.mergeCells(noteRow3.number,1,noteRow3.number,hdr3.length);
    noteRow3.getCell(1).font={italic:true,color:{argb:TAB_INK}};
    ws3.views=[{state:'frozen',ySplit:4}]; exPage(ws3);

    // ---- Tab 4: Carry Forward ----
    var ws4=wb.addWorksheet('Carry Forward');
    var hdr4=['Date','Vendor Name','Amount','Explanation','TAB Expense Code #','Notes','Receipt Status'];
    ws4.columns=[{width:12},{width:24},{width:12},{width:30},{width:26},{width:22},{width:14}];
    exStyleTitle(ws4,ws4.addRow(['Carry Forward']),hdr4.length);
    exStyleSub(ws4,ws4.addRow(['Captured but flagged carry-forward. Do NOT include in month total.']),hdr4.length);
    ws4.addRow([]);
    exStyleHeader(ws4.addRow(hdr4));
    var carryTotal=0;
    (d.carry_rows||[]).forEach(function(r){
      var row=ws4.addRow([r.date,r.vendor,Number(r.amount)||0,r.explanation,r.code_label,r.notes,'Carry Forward']);
      exMoney(row.getCell(3)); exWrap(row.getCell(4)); exWrap(row.getCell(6));
      carryTotal+=Number(r.amount)||0;
    });
    if(!(d.carry_rows||[]).length){
      var nr4=ws4.addRow(['No carry-forward items for this month.']);
      ws4.mergeCells(nr4.number,1,nr4.number,hdr4.length);
      nr4.getCell(1).font={italic:true,color:{argb:TAB_INK}};
    } else {
      var t4=ws4.addRow([]);
      t4.getCell(2).value='Carry-Forward Total'; t4.getCell(2).font={bold:true,color:{argb:TAB_BROWN}};
      t4.getCell(3).value=carryTotal; exMoney(t4.getCell(3)); t4.getCell(3).font={bold:true,color:{argb:TAB_BROWN}};
    }
    ws4.views=[{state:'frozen',ySplit:4}]; exPage(ws4);

    // ---- Tab 5: Budget Codes ----
    var ws5=wb.addWorksheet('Budget Codes');
    var hdr5=['Code','Name'];
    ws5.columns=[{width:12},{width:46}];
    exStyleTitle(ws5,ws5.addRow(['Budget Codes']),hdr5.length);
    exStyleSub(ws5,ws5.addRow(['Your selected codes.']),hdr5.length);
    ws5.addRow([]);
    exStyleHeader(ws5.addRow(hdr5));
    (d.budget_codes||[]).forEach(function(c){
      var row=ws5.addRow([c.code,c.name]);
      row.getCell(1).font={bold:true,color:{argb:TAB_BROWN}};
      exWrap(row.getCell(2));
    });
    ws5.views=[{state:'frozen',ySplit:4}]; exPage(ws5);

    // ---- Download ----
    var safeName=(d.name||'User').replace(/[^A-Za-z0-9]/g,'');
    var parts=d.month.split('-');
    var names=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var fname=(names[parseInt(parts[1],10)]||parts[1])+'_'+parts[0]+'_Monthly_Export_'+safeName+'.xlsx';
    var buf=await wb.xlsx.writeBuffer();
    var blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url; a.download=fname; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){URL.revokeObjectURL(url);},1500);
  }

  // ---------- CAPTURE ----------
  const fileInput=document.getElementById('file-input');
  const modalBg=document.getElementById('modal-bg');
  document.getElementById('capture-btn').addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',async e=>{
    const file=e.target.files[0]; if(!file) return;
    // v2.8.5: normalize orientation (bake EXIF rotation into pixels) before preview/parse/save
    const norm=await normalizeImageFile(file);
    currentImageB64=norm.base64; currentMediaType=norm.mediaType;
    const img=document.getElementById('preview-img'); img.src='data:'+currentMediaType+';base64,'+currentImageB64;
    img.classList.remove('hidden'); showStep('note'); modalBg.classList.add('open'); fileInput.value='';
  });
  function fileToBase64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=()=>rej(new Error('read failed'));r.readAsDataURL(file);});}

  // v2.8.5: bake EXIF orientation into the pixels so Android/portrait receipts are
  // upright everywhere (preview, stored R2 image, and the PDF packet). Re-encodes
  // as JPEG at full resolution. Falls back to the raw read if a browser can't decode,
  // so capture never breaks. Only touches receipt images, never statement PDFs.
  async function normalizeImageFile(file){
    try{
      if(!file || !file.type || file.type.indexOf('image/')!==0){
        return { base64: await fileToBase64(file), mediaType: (file&&file.type)||'image/jpeg' };
      }
      let bitmap;
      try{ bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}); }
      catch(e){
        try{ bitmap=await createImageBitmap(file); }
        catch(e2){ return { base64: await fileToBase64(file), mediaType: file.type||'image/jpeg' }; }
      }
      const w=bitmap.width, h=bitmap.height;
      if(!w || !h){ if(bitmap.close) bitmap.close(); return { base64: await fileToBase64(file), mediaType: file.type||'image/jpeg' }; }
      const canvas=document.createElement('canvas');
      canvas.width=w; canvas.height=h;
      const ctx=canvas.getContext('2d');
      ctx.drawImage(bitmap,0,0);
      if(bitmap.close) bitmap.close();
      const dataUrl=canvas.toDataURL('image/jpeg',0.92);
      const base64=dataUrl.split(',')[1];
      if(!base64){ return { base64: await fileToBase64(file), mediaType: file.type||'image/jpeg' }; }
      return { base64, mediaType:'image/jpeg' };
    }catch(e){
      return { base64: await fileToBase64(file), mediaType: (file&&file.type)||'image/jpeg' };
    }
  }
  function showStep(step){
    document.getElementById('note-step').classList.toggle('hidden',step!=='note');
    document.getElementById('loading-step').classList.toggle('hidden',step!=='loading');
    document.getElementById('review-step').classList.toggle('hidden',step!=='review');
  }
  function closeModal(){modalBg.classList.remove('open');currentImageB64=null;document.getElementById('note-input').value='';document.getElementById('preview-img').classList.add('hidden');}
  document.getElementById('cancel-btn-1').addEventListener('click',closeModal);
  document.getElementById('cancel-btn-2').addEventListener('click',closeModal);
  document.getElementById('parse-btn').addEventListener('click',async()=>{
    if(!currentImageB64) return; showStep('loading');
    const note=document.getElementById('note-input').value.trim();
    let data;
    try{const resp=await fetch('/api/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image_base64:currentImageB64,media_type:currentMediaType,note})});data=await resp.json();}
    catch(e){alert('Could not read the receipt. Check connection and try again.');showStep('note');return;}
    if(data.error){alert('Could not read receipt: '+data.error+'. Fill in by hand.');fillReview({},null);showStep('review');return;}
    fillReview(data.parsed||{},data.card_warning);showStep('review');
  });
  function fillReview(p,cardWarning){
    document.getElementById('f-date').value=p.receipt_date||'';
    document.getElementById('f-amount').value=(p.amount!=null)?p.amount:'';
    document.getElementById('f-vendor').value=p.vendor_name||'';
    document.getElementById('f-explanation').value=p.explanation||'';
    const sel=document.getElementById('f-code'); if(p.budget_code) sel.value=p.budget_code;
    const reason=document.getElementById('reason');
    if(p.code_reason){reason.textContent='Why this code: '+p.code_reason;reason.classList.remove('hidden');}else reason.classList.add('hidden');
    const flag=document.getElementById('confirm-flag'); const msgs=[];
    if(cardWarning) msgs.push(cardWarning);
    if(p.needs_confirm&&p.confirm_question) msgs.push(p.confirm_question);
    if(msgs.length){flag.innerHTML=msgs.join('<br>');flag.classList.remove('hidden');}else flag.classList.add('hidden');
  }
  document.getElementById('save-btn').addEventListener('click',async()=>{
    const btn=document.getElementById('save-btn'); btn.disabled=true; btn.textContent='Saving\u2026';
    const receipt={receipt_date:document.getElementById('f-date').value.trim(),amount:parseFloat(document.getElementById('f-amount').value)||null,vendor_name:document.getElementById('f-vendor').value.trim(),explanation:document.getElementById('f-explanation').value.trim(),budget_code:document.getElementById('f-code').value,note:document.getElementById('note-input').value.trim()};
    try{const resp=await fetch('/api/receipts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image_base64:currentImageB64,media_type:currentMediaType,receipt})});const data=await resp.json();if(data.error)throw new Error(data.error);}
    catch(e){alert('Could not save: '+e.message);btn.disabled=false;btn.textContent='Save Receipt';return;}
    btn.disabled=false; btn.textContent='Save Receipt'; closeModal();
    loadSummary(); loadReceipts(); loadReview();
  });

  // ---------- ADMIN ----------
  const adminBg=document.getElementById('admin-bg');
  document.getElementById('open-admin').addEventListener('click',()=>{adminBg.classList.add('open');loadAdminUsers();});
  document.getElementById('close-admin').addEventListener('click',()=>adminBg.classList.remove('open'));
  async function loadAdminUsers(){
    const data=await api('/api/admin/users'); const wrap=document.getElementById('admin-list'); wrap.innerHTML='';
    (data.users||[]).forEach(u=>{
      const div=document.createElement('div'); div.className='admin-user';
      div.innerHTML='<div class="nm">'+u.name+(u.is_admin?'<span class="badge">Admin</span>':'')+(u.active?'':'<span class="badge off">Off</span>')+'</div>'+
        '<div style="font-size:12px;color:var(--muted)">'+(u.email||'no email')+'</div>'+
        '<div class="admin-actions"><button class="btn-secondary" data-act="resetpin" data-id="'+u.id+'" data-name="'+u.name+'">Reset PIN</button>'+
        '<button class="btn-secondary" data-act="toggleadmin" data-id="'+u.id+'" data-val="'+(u.is_admin?0:1)+'">'+(u.is_admin?'Remove admin':'Make admin')+'</button>'+
        '<button class="btn-danger" data-act="toggleactive" data-id="'+u.id+'" data-val="'+(u.active?0:1)+'">'+(u.active?'Turn off':'Turn on')+'</button></div>';
      wrap.appendChild(div);
    });
    wrap.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>adminAction(b)));
  }
  async function adminAction(btn){
    const act=btn.getAttribute('data-act'),id=btn.getAttribute('data-id');
    if(act==='resetpin'){const name=btn.getAttribute('data-name');const pin=prompt('New PIN for '+name+' (4-6 digits):');if(!pin)return;const r=await api('/api/admin/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,new_pin:pin})});if(r.error)alert(r.error);else alert('PIN reset.');}
    else if(act==='toggleadmin'){const val=btn.getAttribute('data-val')==='1';await api('/api/admin/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,is_admin:val})});loadAdminUsers();}
    else if(act==='toggleactive'){const val=btn.getAttribute('data-val')==='1';await api('/api/admin/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,active:val})});loadAdminUsers();}
  }
  document.getElementById('add-user-btn').addEventListener('click',async()=>{
    const name=document.getElementById('new-name').value.trim(),email=document.getElementById('new-email').value.trim(),pin=document.getElementById('new-pin').value.trim(),is_admin=document.getElementById('new-admin').value==='1';
    if(!name||!pin){alert('Name and PIN are required.');return;}
    const r=await api('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,pin,is_admin})});
    if(r.error){alert(r.error);return;}
    document.getElementById('new-name').value=''; document.getElementById('new-email').value=''; document.getElementById('new-pin').value=''; document.getElementById('new-admin').value='0';
    loadAdminUsers();
  });

  // ---------- MY CODES PICKER ----------
  const codesBg=document.getElementById('codes-bg');
  document.getElementById('open-codes').addEventListener('click',async()=>{
    const data=await api('/api/my-codes'); const all=data.codes||[];
    masterCodes=all.filter(c=>c.is_header!==1); groupOrder=[];
    const seen={};
    masterCodes.forEach(c=>{if(!seen[c.grp]){seen[c.grp]=true;groupOrder.push({grp:c.grp,label:c.grp_label});}});
    document.getElementById('codes-search').value=''; renderPicker(''); codesBg.classList.add('open');
  });
  document.getElementById('close-codes').addEventListener('click',()=>codesBg.classList.remove('open'));
  document.getElementById('codes-search').addEventListener('input',e=>renderPicker(e.target.value.toLowerCase().trim()));
  document.getElementById('use-used-btn').addEventListener('click',async()=>{
    const btn=document.getElementById('use-used-btn'); btn.disabled=true; btn.textContent='Loading\u2026';
    const data=await api('/api/my-used-codes'); const used=new Set(data.codes||[]);
    btn.disabled=false; btn.textContent='Use what I\u2019ve been using';
    if(!used.size){alert('No saved receipts yet. Pick codes by hand.');return;}
    masterCodes.forEach(c=>{if(used.has(c.code))c.selected=1;});
    renderPicker(document.getElementById('codes-search').value.toLowerCase().trim());
  });
  function selectedCountForGroup(grp){return masterCodes.filter(c=>c.grp===grp&&c.selected).length;}
  function renderPicker(filter){
    const wrap=document.getElementById('codes-picker'); wrap.innerHTML='';
    groupOrder.forEach(g=>{
      const inGroup=masterCodes.filter(c=>c.grp===g.grp);
      const matching=filter?inGroup.filter(c=>(c.code+' '+c.name).toLowerCase().indexOf(filter)!==-1):inGroup;
      if(!matching.length) return;
      const selCount=selectedCountForGroup(g.grp);
      const shouldOpen=!!filter||g.grp==='0'||selCount>0;
      const section=document.createElement('div'); section.className='grp-section'+(shouldOpen?' open':'');
      const head=document.createElement('div'); head.className='grp-head';
      const countCls=selCount>0?'grp-count':'grp-count zero';
      head.innerHTML='<span class="grp-title">'+g.label+'</span><span class="grp-meta"><span class="'+countCls+'">'+selCount+' picked</span><span class="chev">&#9656;</span></span>';
      head.addEventListener('click',()=>section.classList.toggle('open'));
      section.appendChild(head);
      const body=document.createElement('div'); body.className='grp-body';
      matching.forEach(c=>{
        const row=document.createElement('label'); row.className='code-row';
        row.innerHTML='<input type="checkbox" data-code="'+c.code+'" '+(c.selected?'checked':'')+'>'+
          '<span class="c">'+c.code+'</span><span class="n">'+c.name+'</span>';
        const cb=row.querySelector('input');
        cb.addEventListener('change',()=>{
          const m=masterCodes.find(x=>x.code===c.code); if(m) m.selected=cb.checked?1:0;
          const badge=head.querySelector('.grp-count'); const n=selectedCountForGroup(g.grp);
          badge.textContent=n+' picked'; badge.className=n>0?'grp-count':'grp-count zero';
        });
        body.appendChild(row);
      });
      section.appendChild(body); wrap.appendChild(section);
    });
    if(!wrap.children.length) wrap.innerHTML='<div style="text-align:center;color:var(--muted);padding:24px;">No codes match.</div>';
  }
  document.getElementById('save-codes-btn').addEventListener('click',async()=>{
    const btn=document.getElementById('save-codes-btn'); btn.disabled=true; btn.textContent='Saving\u2026';
    const finalCodes=masterCodes.filter(c=>c.selected).map(c=>c.code);
    await api('/api/my-codes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codes:finalCodes})});
    btn.disabled=false; btn.textContent='Save My Codes'; codesBg.classList.remove('open'); loadCodes(); loadMyCodesNested();
  });

  // ---------- MY BUDGET CODES (nested dashboard) ----------
  async function loadMyCodesNested(){
    const data=await api('/api/my-codes'); const all=(data.codes||[]).filter(c=>c.is_header!==1&&c.selected);
    const wrap=document.getElementById('mycodes-nested'); wrap.innerHTML='';
    if(!all.length){wrap.innerHTML='<div style="color:var(--muted);font-size:13px;padding:8px 0;">No codes chosen yet. Tap "Choose codes" below.</div>';return;}
    const order=[]; const seen={};
    all.forEach(c=>{if(!seen[c.grp]){seen[c.grp]=true;order.push({grp:c.grp,label:c.grp_label});}});
    order.forEach(g=>{
      const items=all.filter(c=>c.grp===g.grp);
      const cat=document.createElement('div'); cat.className='mycode-cat';
      const head=document.createElement('div'); head.className='mycode-head';
      head.innerHTML='<span class="t">'+g.label+'</span><span class="meta"><span class="cnt">'+items.length+'</span><span class="chev">&#9656;</span></span>';
      head.addEventListener('click',()=>cat.classList.toggle('open')); cat.appendChild(head);
      const bodyEl=document.createElement('div'); bodyEl.className='mycode-body';
      items.forEach(c=>{
        const item=document.createElement('div'); item.className='mycode-item';
        const rightSide=(c.always_on===1)?'<span style="font-size:11px;color:var(--muted);padding:4px 8px;">Required</span>':'<button class="x" data-code="'+c.code+'">&times;</button>';
        item.innerHTML='<span class="c">'+c.code+'</span><span class="n">'+c.name+'</span>'+rightSide;
        const xBtn=item.querySelector('.x');
        if(xBtn) xBtn.addEventListener('click',async e=>{e.stopPropagation();const code=e.currentTarget.getAttribute('data-code');if(!confirm('Remove '+code+'?'))return;await api('/api/my-codes/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});loadMyCodesNested();loadCodes();});
        bodyEl.appendChild(item);
      });
      cat.appendChild(bodyEl); wrap.appendChild(cat);
    });
  }

  // ---------- UPLOAD MY CODES ----------
  const uploadBg=document.getElementById('upload-bg');
  const codesFileInput=document.getElementById('codes-file-input');
  function resetUpload(){uploadImageB64=null;uploadFoundCodes=[];document.getElementById('codes-paste').value='';document.getElementById('upload-file-name').textContent='';document.getElementById('upload-result').classList.add('hidden');document.getElementById('upload-loading').classList.add('hidden');document.getElementById('read-codes-btn').style.display='';document.getElementById('apply-codes-btn').style.display='none';setUploadMode('file');}
  function setUploadMode(mode){const isFile=mode==='file';document.getElementById('seg-file').classList.toggle('active',isFile);document.getElementById('seg-text').classList.toggle('active',!isFile);document.getElementById('upload-file-step').classList.toggle('hidden',!isFile);document.getElementById('upload-text-step').classList.toggle('hidden',isFile);}
  document.getElementById('open-upload').addEventListener('click',()=>{resetUpload();uploadBg.classList.add('open');});
  document.getElementById('close-upload').addEventListener('click',()=>uploadBg.classList.remove('open'));
  document.getElementById('seg-file').addEventListener('click',()=>setUploadMode('file'));
  document.getElementById('seg-text').addEventListener('click',()=>setUploadMode('text'));
  document.getElementById('pick-codes-file').addEventListener('click',()=>codesFileInput.click());
  codesFileInput.addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;uploadMediaType=file.type||'image/jpeg';uploadImageB64=await fileToBase64(file);document.getElementById('upload-file-name').textContent=file.name;codesFileInput.value='';});
  document.getElementById('read-codes-btn').addEventListener('click',async()=>{
    const isText=document.getElementById('seg-text').classList.contains('active');
    const payload={};
    if(isText){const txt=document.getElementById('codes-paste').value.trim();if(!txt){alert('Paste some text first.');return;}payload.text=txt;}
    else{if(!uploadImageB64){alert('Choose a file first.');return;}payload.image_base64=uploadImageB64;payload.media_type=uploadMediaType;}
    document.getElementById('upload-loading').classList.remove('hidden'); document.getElementById('upload-result').classList.add('hidden'); document.getElementById('read-codes-btn').style.display='none';
    let data;
    try{const resp=await fetch('/api/parse-codes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});data=await resp.json();}catch(e){data={error:'network'};}
    document.getElementById('upload-loading').classList.add('hidden');
    if(data.error){alert('Could not read codes: '+data.error);document.getElementById('read-codes-btn').style.display='';return;}
    uploadFoundCodes=data.codes||[];
    const found=document.getElementById('upload-found'); const summary=document.getElementById('upload-summary');
    if(!uploadFoundCodes.length){summary.textContent='No matching budget codes found.';found.innerHTML='';document.getElementById('upload-result').classList.remove('hidden');document.getElementById('read-codes-btn').style.display='';return;}
    summary.textContent='Found '+uploadFoundCodes.length+' code'+(uploadFoundCodes.length===1?'':'s')+'. Review, then add them.';
    found.innerHTML='';
    uploadFoundCodes.forEach(code=>{const c=(codesCache.find(x=>x.code===code)||{});const row=document.createElement('div');row.className='bycode-row';row.innerHTML='<span class="left"><span class="pill">'+code+'</span><span class="nm">'+(c.name||'')+'</span></span>';found.appendChild(row);});
    document.getElementById('upload-result').classList.remove('hidden'); document.getElementById('apply-codes-btn').style.display='';
  });
  document.getElementById('apply-codes-btn').addEventListener('click',async()=>{
    if(!uploadFoundCodes.length) return;
    const btn=document.getElementById('apply-codes-btn'); btn.disabled=true; btn.textContent='Adding\u2026';
    const cur=await api('/api/my-codes'); const already=new Set((cur.codes||[]).filter(c=>c.selected).map(c=>c.code));
    uploadFoundCodes.forEach(c=>already.add(c));
    await api('/api/my-codes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codes:Array.from(already)})});
    btn.disabled=false; btn.textContent='Add These to My Codes'; uploadBg.classList.remove('open'); loadMyCodesNested(); loadCodes();
  });

  // init
  boot();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
<\/script>
</body>
</html>`;