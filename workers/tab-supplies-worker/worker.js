// ============================================================
// TAB-SUPPLIES Worker v1.5
// ============================================================
// Tabernacle Church supply check — digital companion to the
// paper packet. Now with shared resource visibility between
// Café and Kitchen teams.
//
// ROUTES
//   /?code=XXX        → auto-login from URL (one-tap for volunteers)
//   /cafe             → Café team (Pages 1–2 + Shared Page 3)
//   /kitchen          → Kitchen team (Shared Page 3 + Page 4: WNM)
//   /shane            → Shopping Review (Need More flags by vendor)
//   /adult-ministry   → Care & Connection / Adult Ministry lane
//   /log              → Audit log (Care & Connection only)
//
// AUTH
// Role code in cookie (30 days). Auto-login via ?code=XXX URL.
//
// NEW IN v1.5
//   - Café and Kitchen both see Page 3 (shared paper goods,
//     sweeteners, creamers, bagged hot teas, cleaning supplies)
//   - Either team can flag shared items; audit log captures who
//   - SHARED badge on items both teams can see
//   - Phone keyboard fix: no auto-capitalize / no spellcheck on
//     the login input (login is already case-insensitive)
//
// CARRIED FROM v1.4
//   - Quantity per flag, unit labels, auto-login URLs
//   - Acknowledgment system, "Confirm bought quantity"
//   - Adult Ministry lane with "Add new item"
//   - Data-driven rendering from D1
// ============================================================

const COOKIE_NAME = 'tab_supplies_role';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

const COLORS = {
  brown: '#402020',
  cross: '#6d3d31',
  cream: '#f5e9d4',
  reach: '#aac27f',
  equip: '#ca8342',
  send: '#8dc6e8',
  bgPrimary: '#ffffff',
  bgSecondary: '#faf8f3',
  bgTertiary: '#f5f2ea',
  textPrimary: '#2c2c2a',
  textSecondary: '#5f5e5a',
  textTertiary: '#888780',
  borderTertiary: '#e0ddd2',
};

// Friendly display names for each role (used when crediting actions like "Bought by Maria")
const ROLE_NAMES = {
  cafe: 'Maria',
  kitchen: 'Cheryl',
  shane: 'Shane',
};

// Category → icon name (for hospitality items)
const CATEGORY_ICON = {
  'Coffee, Tea & Hot Chocolate': 'coffee',
  'Syrups': 'syrup',
  'Pump Sauces': 'pump',
  'Honey & Jelly': 'honeyJar',
  'Café Cleaning': 'spray',
  'Milks & Dairy': 'milk',
  'Fresh Fruit': 'apple',
  'Hot Drink Service': 'hotCup',
  'Cold Drink Cups': 'coldCup',
  'Coffee & Tea': 'coffeeTea',
  'Creamers & Sweeteners': 'creamer',
  'Lemonade Mix': 'lemonade',
  'Plates & Bowls': 'plates',
  'Cutlery': 'cutlery',
  'Seasonings': 'seasonings',
  'Napkins & Towels': 'napkins',
  'Packaging & Wraps': 'packaging',
  'Nitrile Gloves': 'gloves',
  'Cleaning Supplies': 'cleaning',
  'Cold Sides': 'coldSides',
  'Salad Fresh': 'saladFresh',
  'Salad Dressings': 'dressing',
  'Cold Drinks': 'gallonJug',
  'Bread': 'bread',
  'Butter Pads': 'butter',
  // Adult Ministry categories use simpler defaults
  'Name Badges': 'packet',
  'Hardware': 'packaging',
  'Office': 'packet',
  'Organization': 'packaging',
  'Worship Service': 'hotCup',
};

// Category → header color
const CATEGORY_COLOR = {
  'Coffee, Tea & Hot Chocolate': { bg: '#402020', fg: '#f5e9d4' },
  'Syrups': { bg: '#ca8342', fg: '#fff' },
  'Pump Sauces': { bg: '#6d3d31', fg: '#f5e9d4' },
  'Honey & Jelly': { bg: '#aac27f', fg: '#1f3008' },
  'Café Cleaning': { bg: '#1d9e75', fg: '#fff' },
  'Milks & Dairy': { bg: '#8dc6e8', fg: '#0c447c' },
  'Fresh Fruit': { bg: '#639922', fg: '#fff' },
  'Hot Drink Service': { bg: '#402020', fg: '#f5e9d4' },
  'Cold Drink Cups': { bg: '#185fa5', fg: '#fff' },
  'Coffee & Tea': { bg: '#5a3220', fg: '#f5e9d4' },
  'Creamers & Sweeteners': { bg: '#ca8342', fg: '#fff' },
  'Lemonade Mix': { bg: '#efbb27', fg: '#4a3804' },
  'Plates & Bowls': { bg: '#5f5e5a', fg: '#fff' },
  'Cutlery': { bg: '#888780', fg: '#fff' },
  'Seasonings': { bg: '#b4b2a9', fg: '#2c2c2a' },
  'Napkins & Towels': { bg: '#6d3d31', fg: '#f5e9d4' },
  'Packaging & Wraps': { bg: '#854f0b', fg: '#fff' },
  'Nitrile Gloves': { bg: '#8dc6e8', fg: '#0c447c' },
  'Cleaning Supplies': { bg: '#1d9e75', fg: '#fff' },
  'Cold Sides': { bg: '#639922', fg: '#fff' },
  'Salad Fresh': { bg: '#1d9e75', fg: '#fff' },
  'Salad Dressings': { bg: '#854f0b', fg: '#fff' },
  'Cold Drinks': { bg: '#185fa5', fg: '#fff' },
  'Bread': { bg: '#ca8342', fg: '#fff' },
  'Butter Pads': { bg: '#ef9f27', fg: '#412402' },
  'Name Badges': { bg: '#6d3d31', fg: '#f5e9d4' },
  'Hardware': { bg: '#5f5e5a', fg: '#fff' },
  'Office': { bg: '#854f0b', fg: '#fff' },
  'Organization': { bg: '#888780', fg: '#fff' },
  'Worship Service': { bg: '#402020', fg: '#f5e9d4' },
};

// ────────────────────────────────────────────────
// MAIN HANDLER
// ────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === '/health') {
        return json({ ok: true, service: 'tab-supplies', version: '2.0' });
      }

      // Auto-login from URL param (?code=XXX)
      const urlCode = url.searchParams.get('code');
      if (urlCode && method === 'GET') {
        return await autoLoginFromUrl(request, env, urlCode);
      }

      // Login routes
      if (path === '/login' && method === 'GET') return loginPage(null);
      if (path === '/login' && method === 'POST') return await handleLogin(request, env);
      if (path === '/logout' && method === 'POST') return handleLogout();

      const role = getRoleFromCookie(request);

      // Root → redirect by role
      if (path === '/') {
        if (!role) return Response.redirect(new URL('/login', request.url).toString(), 302);
        const home = role === 'shane' ? '/shane' : '/' + role;
        return Response.redirect(new URL(home, request.url).toString(), 302);
      }

      // Role pages
      if (path === '/cafe' && method === 'GET') {
        if (!role) return Response.redirect(new URL('/login', request.url).toString(), 302);
        if (role !== 'cafe' && role !== 'shane') return forbiddenPage();
        return await cafePage(env, role);
      }
      if (path === '/kitchen' && method === 'GET') {
        if (!role) return Response.redirect(new URL('/login', request.url).toString(), 302);
        if (role !== 'kitchen' && role !== 'shane') return forbiddenPage();
        return await kitchenPage(env, role);
      }
      if (path === '/shane' && method === 'GET') {
        if (!role) return Response.redirect(new URL('/login', request.url).toString(), 302);
        if (role !== 'shane') return forbiddenPage();
        return await shanePage(env);
      }
      if (path === '/adult-ministry' && method === 'GET') {
        if (!role) return Response.redirect(new URL('/login', request.url).toString(), 302);
        if (role !== 'shane') return forbiddenPage();
        return await adultMinistryPage(env);
      }
      if (path === '/log' && method === 'GET') {
        if (!role) return Response.redirect(new URL('/login', request.url).toString(), 302);
        if (role !== 'shane') return forbiddenPage();
        return await logPage(env);
      }
      if (path === '/list' && method === 'GET') {
        if (!role) return Response.redirect(new URL('/login', request.url).toString(), 302);
        return await shoppingListPage(env, role);
      }

      // API: flag with quantity
      if (path === '/api/flag' && method === 'POST') {
        if (!role) return json({ error: 'not_authenticated' }, 401);
        return await apiFlag(request, env, role);
      }
      // API: clear (volunteer un-flags)
      if (path === '/api/clear' && method === 'POST') {
        if (!role) return json({ error: 'not_authenticated' }, 401);
        return await apiClear(request, env, role);
      }
      // API: mark bought (any logged-in role)
      if (path === '/api/resolve' && method === 'POST') {
        if (!role) return json({ error: 'forbidden' }, 403);
        return await apiResolve(request, env, role);
      }
      // API: acknowledge (fired automatically when Shane loads Shopping)
      if (path === '/api/acknowledge-all' && method === 'POST') {
        if (role !== 'shane') return json({ error: 'forbidden' }, 403);
        return await apiAcknowledgeAll(env);
      }
      // API: add new item (Care & Connection only — Adult Ministry lane)
      if (path === '/api/add-item' && method === 'POST') {
        if (role !== 'shane') return json({ error: 'forbidden' }, 403);
        return await apiAddItem(request, env);
      }

      return notFoundPage();
    } catch (err) {
      console.error('Unhandled error:', err);
      return new Response('Server error: ' + err.message, { status: 500 });
    }
  }
};

// ────────────────────────────────────────────────
// AUTH
// ────────────────────────────────────────────────
function getRoleFromCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const role = match[1];
  if (['cafe', 'kitchen', 'shane'].includes(role)) return role;
  return null;
}

async function autoLoginFromUrl(request, env, code) {
  const role = resolveRoleFromCode(env, code);
  if (!role) return loginPage('That link\'s code didn\'t match. Ask your team lead for a fresh link.');
  // Strip the code from the URL — set cookie + redirect to clean URL
  const url = new URL(request.url);
  url.searchParams.delete('code');
  const dest = url.pathname === '/' || url.pathname === '' ? `/${role === 'shane' ? 'shane' : role}` : url.pathname;
  return new Response(null, {
    status: 302,
    headers: {
      'Location': dest,
      'Set-Cookie': `${COOKIE_NAME}=${role}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`
    }
  });
}

function resolveRoleFromCode(env, code) {
  if (!code) return null;
  const normalized = code.trim();
  // Case-insensitive match — codes are easier to type on phones this way
  const lc = normalized.toLowerCase();
  if (env.CAFE_CODE && lc === env.CAFE_CODE.toLowerCase()) return 'cafe';
  if (env.KITCHEN_CODE && lc === env.KITCHEN_CODE.toLowerCase()) return 'kitchen';
  if (env.SHANE_CODE && lc === env.SHANE_CODE.toLowerCase()) return 'shane';
  return null;
}

async function handleLogin(request, env) {
  const form = await request.formData();
  const code = (form.get('code') || '').toString().trim();
  if (!code) return loginPage('Please enter a code.');
  const role = resolveRoleFromCode(env, code);
  if (!role) return loginPage("That code didn't match. Try again or ask your team lead.");
  const dest = '/' + (role === 'shane' ? 'shane' : role);
  return new Response(null, {
    status: 302,
    headers: {
      'Location': dest,
      'Set-Cookie': `${COOKIE_NAME}=${role}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`
    }
  });
}

function handleLogout() {
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/login',
      'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    }
  });
}

// ────────────────────────────────────────────────
// API: flag with quantity (creates or updates)
// ────────────────────────────────────────────────
async function apiFlag(request, env, role) {
  const body = await request.json().catch(() => ({}));
  const itemId = (body.item_id || '').toString().trim();
  const note = (body.note || '').toString().trim() || null;
  const quantity = parseInt(body.quantity, 10) || 0;
  if (!itemId) return json({ error: 'item_id_required' }, 400);
  if (quantity < 1) return json({ error: 'quantity_must_be_positive' }, 400);

  const item = await env.DB.prepare('SELECT id, name, unit FROM items WHERE id = ? LIMIT 1').bind(itemId).first();
  if (!item) return json({ error: 'unknown_item' }, 404);

  const existing = await env.DB.prepare(
    `SELECT id, note, quantity FROM flags WHERE item_id = ? AND resolved_at IS NULL LIMIT 1`
  ).bind(itemId).first();

  if (existing) {
    await env.DB.prepare(
      `UPDATE flags SET note = ?, quantity = ?, flagged_by = ?, flagged_at = datetime('now'), acknowledged_at = NULL WHERE id = ?`
    ).bind(note, quantity, role, existing.id).run();
    await logAction(env, 'flag_updated', role, 'flag', existing.id, {
      item_id: itemId, item_name: item.name, unit: item.unit,
      quantity, previous_quantity: existing.quantity, note, previous_note: existing.note
    });
    return json({ ok: true, action: 'updated', flag_id: existing.id });
  } else {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO flags (id, item_id, flagged_by, note, quantity) VALUES (?, ?, ?, ?, ?)`
    ).bind(id, itemId, role, note, quantity).run();
    await logAction(env, 'flag_created', role, 'flag', id, {
      item_id: itemId, item_name: item.name, unit: item.unit, quantity, note
    });
    return json({ ok: true, action: 'created', flag_id: id });
  }
}

async function apiClear(request, env, role) {
  const body = await request.json().catch(() => ({}));
  const itemId = (body.item_id || '').toString().trim();
  if (!itemId) return json({ error: 'item_id_required' }, 400);

  const flag = await env.DB.prepare(
    `SELECT f.id as flag_id, f.flagged_by, f.note, f.quantity, i.name as item_name, i.unit
     FROM flags f JOIN items i ON i.id = f.item_id
     WHERE f.item_id = ? AND f.resolved_at IS NULL LIMIT 1`
  ).bind(itemId).first();

  if (!flag) return json({ ok: true, action: 'no_open_flag' });

  // Permission: cafe clears cafe-posted; kitchen ditto; shane clears all
  if (role !== 'shane' && flag.flagged_by !== role) {
    return json({ error: 'not_your_flag' }, 403);
  }

  await env.DB.prepare(`UPDATE flags SET resolved_at = datetime('now') WHERE id = ?`).bind(flag.flag_id).run();
  await logAction(env, 'flag_cleared', role, 'flag', flag.flag_id, {
    item_id: itemId, item_name: flag.item_name, unit: flag.unit,
    quantity: flag.quantity, original_flagger: flag.flagged_by, note_at_clear: flag.note
  });
  return json({ ok: true });
}

async function apiResolve(request, env, role) {
  const body = await request.json().catch(() => ({}));
  const itemId = (body.item_id || '').toString().trim();
  const boughtQty = parseInt(body.bought_quantity, 10);
  if (!itemId) return json({ error: 'item_id_required' }, 400);

  const flag = await env.DB.prepare(
    `SELECT f.id as flag_id, f.quantity, f.bought_by, i.name as item_name, i.unit
     FROM flags f JOIN items i ON i.id = f.item_id
     WHERE f.item_id = ? AND f.resolved_at IS NULL LIMIT 1`
  ).bind(itemId).first();

  if (!flag) return json({ error: 'no_open_flag' }, 404);

  const finalBought = (Number.isFinite(boughtQty) && boughtQty >= 0) ? boughtQty : flag.quantity;
  const buyerName = ROLE_NAMES[role] || role;

  // Mark bought but keep the flag open (visible) so the team can see who got it.
  // Shane can "clear" later from Shopping Review to remove from list.
  await env.DB.prepare(
    `UPDATE flags SET bought_quantity = ?, bought_by = ?, bought_at = datetime('now') WHERE id = ?`
  ).bind(finalBought, buyerName, flag.flag_id).run();

  await logAction(env, 'flag_bought', role, 'flag', flag.flag_id, {
    item_id: itemId, item_name: flag.item_name, unit: flag.unit,
    flagged_quantity: flag.quantity, bought_quantity: finalBought, bought_by: buyerName
  });
  return json({ ok: true, bought_quantity: finalBought, bought_by: buyerName });
}

async function apiAcknowledgeAll(env) {
  const res = await env.DB.prepare(
    `UPDATE flags SET acknowledged_at = datetime('now') WHERE resolved_at IS NULL AND acknowledged_at IS NULL`
  ).run();
  return json({ ok: true, acknowledged: res.meta?.changes || 0 });
}

async function apiAddItem(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').toString().trim();
  const vendor = (body.vendor || 'Confirm').toString().trim();
  const unit = (body.unit || 'each').toString().trim();
  const category = (body.category || 'Office').toString().trim();
  const notes = (body.notes || '').toString().trim() || null;
  if (!name) return json({ error: 'name_required' }, 400);

  // Generate a safe ID from the name
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  const id = 'am_' + slug + '_' + Math.random().toString(36).slice(2, 6);

  await env.DB.prepare(
    `INSERT INTO items (id, name, category, page, vendor, notes, unit, lane) VALUES (?, ?, ?, 5, ?, ?, ?, 'adult_ministry')`
  ).bind(id, name, category, vendor, notes, unit).run();

  await logAction(env, 'item_added', 'shane', 'item', id, { name, vendor, unit, category });
  return json({ ok: true, id });
}

// ────────────────────────────────────────────────
// AUDIT LOGGING
// ────────────────────────────────────────────────
async function logAction(env, action, actorRole, targetKind, targetId, metadata) {
  try {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO audit_log (id, action, actor_role, target_kind, target_id, metadata) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, action, actorRole, targetKind || null, targetId || null, JSON.stringify(metadata || {})).run();
  } catch (err) {
    console.error('Audit log write failed:', err);
  }
}

// ────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function formatUnit(qty, unit) {
  if (!unit) return String(qty);
  // Simple pluralization for common cases
  let plural = unit;
  if (qty !== 1) {
    if (unit === 'box') plural = 'boxes';
    else if (unit === 'each') plural = '';
    else plural = unit + 's';
  } else if (unit === 'each') {
    plural = '';
  }
  return plural ? `${qty} ${plural}` : `${qty}`;
}
function timeAgo(isoStr) {
  if (!isoStr) return '';
  const then = new Date(isoStr.replace(' ', 'T') + 'Z').getTime();
  if (!Number.isFinite(then)) return isoStr;
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return isoStr.split(' ')[0];
}

// ────────────────────────────────────────────────
// SHARED CSS
// ────────────────────────────────────────────────
function sharedStyles() {
  return `
  :root {
    --brown: ${COLORS.brown};
    --cross: ${COLORS.cross};
    --cream: ${COLORS.cream};
    --bg-primary: ${COLORS.bgPrimary};
    --bg-secondary: ${COLORS.bgSecondary};
    --bg-tertiary: ${COLORS.bgTertiary};
    --text-primary: ${COLORS.textPrimary};
    --text-secondary: ${COLORS.textSecondary};
    --text-tertiary: ${COLORS.textTertiary};
    --border-tertiary: ${COLORS.borderTertiary};
    --border-radius-md: 8px;
    --border-radius-lg: 12px;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    margin: 0;
    padding: 0;
    font-size: 16px;
    line-height: 1.5;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .page { max-width: 680px; margin: 0 auto; padding: 16px; }
  .page-header { text-align: center; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 2px solid var(--cross); }
  .page-tag { font-size: 11px; color: var(--text-tertiary); letter-spacing: 1.5px; margin-bottom: 6px; text-transform: uppercase; }
  .page-title { font-size: 22px; font-weight: 500; color: var(--brown); margin: 0 0 4px; letter-spacing: 0.5px; }
  .page-sub { font-size: 14px; color: var(--text-secondary); margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  @media (max-width: 540px) { .grid { grid-template-columns: 1fr; } }
  .span-2 { grid-column: 1 / -1; }
  .card { background: var(--bg-primary); border: 0.5px solid var(--border-tertiary); border-radius: var(--border-radius-lg); overflow: hidden; }
  .card-header { padding: 8px 12px; font-size: 14px; font-weight: 500; letter-spacing: 0.3px; }
  .card-body { padding: 8px 10px; }
  .icon-panel {
    display: flex; justify-content: center; align-items: center;
    margin-bottom: 6px; padding: 8px;
    background: var(--bg-secondary); border-radius: var(--border-radius-md);
    height: 40px; gap: 8px;
  }
  .item-row {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 8px; cursor: pointer; border-radius: 6px;
    transition: background 0.1s;
    -webkit-tap-highlight-color: transparent;
    border: 1px solid transparent;
    margin-bottom: 2px;
  }
  .item-row:active { background: var(--bg-secondary); }
  .item-row.flagged {
    background: #fef3c7;
    border-left: 4px solid #ca8342;
  }
  .item-row.flagged .item-name { color: #5a3220; font-weight: 600; }
  .item-row.acknowledged { background: #d1fae5; border-left-color: #065f46; }
  .item-row.acknowledged .item-name { color: #065f46; }
  .item-main { flex: 1; min-width: 0; }
  .item-name { font-size: 15px; color: var(--text-primary); line-height: 1.3; }
  .item-meta {
    font-size: 11px; color: var(--text-tertiary);
    margin-top: 2px; letter-spacing: 0.3px;
    text-transform: uppercase;
  }
  .item-note {
    font-size: 12px; color: #5a3220;
    margin-top: 4px; font-style: italic; line-height: 1.3;
  }
  .qty-badge {
    background: #ca8342; color: white;
    font-weight: 700; font-size: 14px;
    padding: 6px 12px; border-radius: 999px;
    min-width: 44px; text-align: center;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .qty-badge.empty { background: transparent; color: var(--text-tertiary); border: 1px dashed var(--border-tertiary); }
  .ack-badge {
    display: inline-block;
    background: #d1fae5; color: #065f46;
    font-size: 10px; font-weight: 700;
    padding: 2px 6px; border-radius: 4px;
    margin-left: 6px; letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .shared-pill {
    display: inline-block;
    background: #efd9b3; color: #5a3220;
    font-size: 9px; font-weight: 800;
    padding: 2px 5px; border-radius: 3px;
    margin-right: 5px; letter-spacing: 0.6px;
    text-transform: uppercase;
    vertical-align: middle;
  }
  .shared-pill-light {
    display: inline-block;
    background: rgba(255,255,255,0.25); color: inherit;
    font-size: 9px; font-weight: 800;
    padding: 2px 5px; border-radius: 3px;
    margin-left: 6px; letter-spacing: 0.6px;
    text-transform: uppercase;
    vertical-align: middle;
  }
  .topbar {
    background: var(--brown); color: var(--cream);
    padding: 14px 16px; display: flex;
    justify-content: space-between; align-items: center;
    font-size: 14px; letter-spacing: 0.4px;
  }
  .topbar-title { font-weight: 700; text-transform: uppercase; }
  .topbar-actions { display: flex; gap: 10px; align-items: center; }
  .topbar-actions button {
    background: rgba(255,255,255,0.15); color: var(--cream);
    border: none; padding: 6px 12px; border-radius: 6px;
    font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.5px; cursor: pointer; font-family: inherit;
  }
  .admin-nav {
    background: var(--cross); padding: 8px 12px;
    display: flex; gap: 4px; overflow-x: auto;
    white-space: nowrap; -webkit-overflow-scrolling: touch;
  }
  .admin-nav a {
    color: var(--cream); text-decoration: none;
    padding: 6px 12px; border-radius: 6px;
    font-size: 12px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.5px;
    background: rgba(255,255,255,0.08); flex-shrink: 0;
  }
  .admin-nav a.active { background: var(--cream); color: var(--brown); }
  .greeting {
    background: var(--bg-secondary);
    border-left: 4px solid var(--reach);
    padding: 12px 16px; border-radius: 6px;
    margin-bottom: 16px; font-size: 14px;
    color: var(--text-primary); line-height: 1.5;
  }
  .toggle-hint {
    font-size: 12px; color: var(--text-tertiary);
    text-align: center; padding: 8px 12px;
    background: var(--bg-secondary); border-radius: 6px;
    margin-bottom: 12px;
  }
  .save-banner {
    position: fixed; bottom: 20px; left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: #065f46; color: white;
    padding: 12px 22px; border-radius: 24px;
    font-size: 14px; font-weight: 600;
    opacity: 0; pointer-events: none;
    transition: opacity 0.3s, transform 0.3s;
    z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    max-width: 90vw; text-align: center;
  }
  .save-banner.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .save-banner.error { background: #991b1b; }
  /* MODAL */
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55);
    z-index: 100; display: none;
    align-items: flex-start; justify-content: center;
    padding: 40px 16px 16px;
  }
  .modal-backdrop.show { display: flex; }
  .modal {
    background: white; border-radius: 14px;
    padding: 22px; max-width: 440px; width: 100%;
    box-shadow: 0 10px 40px rgba(0,0,0,0.3);
  }
  .modal-title {
    font-size: 17px; font-weight: 700; color: var(--brown);
    margin: 0 0 4px; line-height: 1.3;
  }
  .modal-sub {
    font-size: 13px; color: var(--text-secondary);
    margin: 0 0 16px;
  }
  .qty-stepper {
    display: flex; align-items: center; justify-content: center;
    gap: 16px; margin: 20px 0;
  }
  .qty-btn {
    width: 56px; height: 56px;
    border: 2px solid var(--cross); background: white;
    color: var(--cross); font-size: 28px; font-weight: 700;
    border-radius: 50%; cursor: pointer; font-family: inherit;
    -webkit-tap-highlight-color: transparent;
    display: flex; align-items: center; justify-content: center;
  }
  .qty-btn:active { background: var(--bg-secondary); }
  .qty-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .qty-display {
    font-size: 32px; font-weight: 700; color: var(--brown);
    min-width: 80px; text-align: center; line-height: 1;
  }
  .qty-unit {
    text-align: center; font-size: 13px; color: var(--text-secondary);
    text-transform: uppercase; letter-spacing: 1px; margin-top: -8px;
    margin-bottom: 8px;
  }
  .modal-field-label {
    display: block; font-size: 11px;
    color: var(--text-tertiary); letter-spacing: 0.5px;
    margin: 12px 0 6px; text-transform: uppercase; font-weight: 700;
  }
  .modal textarea, .modal input[type=text], .modal select {
    width: 100%; padding: 12px; font-size: 15px;
    border: 1px solid var(--border-tertiary); border-radius: 8px;
    font-family: inherit; box-sizing: border-box;
  }
  .modal textarea { resize: vertical; min-height: 70px; }
  .modal-actions {
    display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap;
  }
  .btn-primary, .btn-secondary, .btn-danger {
    flex: 1; min-width: 100px; padding: 14px 16px;
    border: none; border-radius: 8px;
    font-size: 14px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.5px; cursor: pointer; font-family: inherit;
  }
  .btn-primary { background: var(--cross); color: white; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { background: var(--bg-secondary); color: var(--text-secondary); }
  .btn-danger { background: #fee2e2; color: #991b1b; }
  /* Vendor card on Shopping */
  .vendor-card { background: var(--bg-primary); border: 0.5px solid var(--border-tertiary); border-radius: 12px; overflow: hidden; margin-bottom: 14px; }
  .vendor-header { padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
  .vendor-name { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; }
  .vendor-meta { font-size: 11px; opacity: 0.9; letter-spacing: 0.4px; }
  .shop-row {
    display: flex; align-items: flex-start; gap: 12px;
    padding: 12px 16px; border-bottom: 1px solid var(--border-tertiary);
  }
  .shop-row:last-child { border-bottom: none; }
  .shop-row .qty-badge { background: var(--brown); }
  .shop-row.flagged-only .qty-badge { background: #ca8342; }
  .add-item-btn {
    display: block; width: 100%; padding: 14px;
    background: var(--bg-secondary); border: 2px dashed var(--cross);
    color: var(--cross); border-radius: 10px;
    font-size: 14px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.5px;
    cursor: pointer; font-family: inherit;
    margin: 16px 0;
  }
  .add-item-btn:active { background: var(--bg-tertiary); }
  `;
}

// ────────────────────────────────────────────────
// PAGE SHELL
// ────────────────────────────────────────────────
function pageShell(title, role, bodyHtml, currentPath = '') {
  const ROLE_LABELS = {
    cafe: 'Café Team — Maria',
    kitchen: 'Kitchen Team — Cheryl',
    shane: 'Shane',
  };
  const roleLabel = role ? (ROLE_LABELS[role] || role) : null;
  const topbar = roleLabel ? `
    <div class="topbar">
      <div class="topbar-title">Tab Supplies · ${escapeHtml(roleLabel)}</div>
      <div class="topbar-actions">
        <form method="POST" action="/logout" style="display:inline">
          <button type="submit">Exit</button>
        </form>
      </div>
    </div>
  ` : '';
  const adminNav = (role === 'shane') ? `
    <div class="admin-nav">
      <a href="/shane" class="${currentPath === '/shane' ? 'active' : ''}">Shopping</a>
      <a href="/cafe" class="${currentPath === '/cafe' ? 'active' : ''}">Café</a>
      <a href="/kitchen" class="${currentPath === '/kitchen' ? 'active' : ''}">Kitchen</a>
      <a href="/adult-ministry" class="${currentPath === '/adult-ministry' ? 'active' : ''}">Adult Ministry</a>
      <a href="/log" class="${currentPath === '/log' ? 'active' : ''}">Log</a>
    </div>
  ` : '';
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)} — Tab Supplies</title>
<meta name="theme-color" content="${COLORS.brown}">
<style>${sharedStyles()}</style>
</head>
<body>
${topbar}
${adminNav}
${bodyHtml}
<div id="save-banner" class="save-banner">Saved ✓</div>
</body>
</html>`, { headers: { 'Content-Type': 'text/html' } });
}

// ────────────────────────────────────────────────
// LOGIN
// ────────────────────────────────────────────────
function loginPage(errorMsg) {
  const err = errorMsg ? `<div style="background:#fee2e2;color:#991b1b;padding:12px;border-radius:8px;margin-bottom:14px;font-size:14px">${escapeHtml(errorMsg)}</div>` : '';
  const body = `
    <div class="page" style="padding-top:40px">
      <div class="page-header">
        <div class="page-tag">Tabernacle Church</div>
        <h2 class="page-title">SUPPLY CHECK</h2>
        <p class="page-sub">Enter the code your team leader gave you.</p>
      </div>
      ${err}
      <div class="card">
        <div class="card-body">
          <form method="POST" action="/login">
            <label style="display:block;font-size:12px;color:${COLORS.textTertiary};letter-spacing:0.5px;margin-bottom:6px;text-transform:uppercase;font-weight:700">Team code</label>
            <input type="text" name="code" autofocus autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
              style="width:100%;padding:14px;font-size:18px;border:1px solid ${COLORS.borderTertiary};border-radius:8px;font-family:inherit;letter-spacing:2px;text-align:center">
            <button type="submit"
              style="width:100%;margin-top:14px;padding:14px;background:${COLORS.cross};color:white;border:none;border-radius:8px;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;cursor:pointer;font-family:inherit">
              Enter
            </button>
          </form>
        </div>
      </div>
      <p style="text-align:center;color:${COLORS.textTertiary};font-size:13px;margin-top:20px">
        Don't have a code? Ask your team lead or Shane.
      </p>
    </div>
  `;
  return pageShell('Sign In', null, body);
}

function forbiddenPage() {
  const body = `
    <div class="page" style="padding-top:40px;text-align:center">
      <h2 style="color:${COLORS.brown}">Not allowed</h2>
      <p style="color:${COLORS.textSecondary}">Your code doesn't match this page. Try signing in with a different code.</p>
      <form method="POST" action="/logout" style="margin-top:20px">
        <button type="submit" style="padding:12px 24px;background:${COLORS.cross};color:white;border:none;border-radius:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;cursor:pointer;font-family:inherit">Sign Out</button>
      </form>
    </div>
  `;
  return pageShell('Not Allowed', null, body);
}

function notFoundPage() {
  return new Response('Not found', { status: 404 });
}

// ────────────────────────────────────────────────
// DATA: load items + flags for a given lane + page set
// ────────────────────────────────────────────────
async function loadItemsForPages(env, lane, pages, cafeOnly) {
  const placeholders = pages.map(() => '?').join(',');
  const filter = cafeOnly ? ' AND cafe_visible = 1' : '';
  const res = await env.DB.prepare(
    `SELECT id, name, category, page, vendor, notes, unit, lane, amazon_url, brand, cafe_visible, sort_order
     FROM items WHERE lane = ? AND page IN (${placeholders})${filter}
     ORDER BY sort_order, page, category, name`
  ).bind(lane, ...pages).all();
  return res.results || [];
}
async function loadActiveFlagsMap(env) {
  const res = await env.DB.prepare(
    `SELECT item_id, quantity, note, flagged_by, flagged_at, acknowledged_at
     FROM flags WHERE resolved_at IS NULL`
  ).all();
  const map = new Map();
  for (const r of (res.results || [])) map.set(r.item_id, r);
  return map;
}

// ────────────────────────────────────────────────
// SHARED: render a list of items as cards by category
// ────────────────────────────────────────────────
function renderItemCardsByCategory(items, flags, opts) {
  const sharedPage = opts && opts.sharedPage;
  // Group by category, preserving order
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.category)) groups.set(it.category, []);
    groups.get(it.category).push(it);
  }
  let html = '<div class="grid">';
  for (const [category, catItems] of groups) {
    const iconKey = CATEGORY_ICON[category] || 'coffee';
    const color = CATEGORY_COLOR[category] || { bg: COLORS.brown, fg: COLORS.cream };
    const icon = ICONS[iconKey] || '';
    // Cards span 2 when they have many items, for visual balance
    const span = catItems.length >= 7 ? ' span-2' : '';
    // A category is "shared" if every item in it is on the shared page AND visible to café.
    // This means both Maria and Cheryl see this category as cross-team.
    const allShared = sharedPage && catItems.every(i => i.page === sharedPage && i.cafe_visible === 1);
    const headerBadge = allShared ? ' <span class="shared-pill-light">SHARED</span>' : '';
    const rows = catItems.map(it => itemRow(it, flags.get(it.id), { sharedPage, allShared })).join('');
    html += `
      <div class="card${span}">
        <div class="card-header" style="background:${color.bg};color:${color.fg}">${escapeHtml(category.toUpperCase())}${headerBadge}</div>
        <div class="card-body">
          <div class="icon-panel">${icon}</div>
          ${rows}
        </div>
      </div>
    `;
  }
  html += '</div>';
  return html;
}

function itemRow(item, flag, opts) {
  const sharedPage = opts && opts.sharedPage;
  const allShared = opts && opts.allShared;
  // Show inline SHARED badge only when item is shared but its category card isn't all-shared.
  const isShared = sharedPage && item.page === sharedPage && item.cafe_visible === 1 && !allShared;
  const flagged = !!flag;
  const ack = flagged && flag.acknowledged_at;
  const qty = flagged ? flag.quantity : 0;
  const unitDisplay = qty > 0 ? formatUnit(qty, item.unit) : (item.unit || 'item');
  const qtyBadge = flagged
    ? `<div class="qty-badge">${formatUnit(qty, item.unit)}</div>`
    : `<div class="qty-badge empty">+</div>`;
  const noteHtml = flagged && flag.note
    ? `<div class="item-note">📝 ${escapeHtml(flag.note)}</div>` : '';
  const ackBadge = ack
    ? `<span class="ack-badge">✓ Seen</span>` : '';
  const sharedInline = isShared ? `<span class="shared-pill">SHARED</span> ` : '';
  const flaggedTime = flagged
    ? `<div class="item-meta">Flagged ${timeAgo(flag.flagged_at)} by ${escapeHtml(flag.flagged_by)}${ackBadge}</div>` : '';
  const classes = ['item-row'];
  if (flagged) classes.push('flagged');
  if (ack) classes.push('acknowledged');
  return `
    <div class="${classes.join(' ')}"
         data-item-id="${escapeHtml(item.id)}"
         data-item-name="${escapeHtml(item.name)}"
         data-unit="${escapeHtml(item.unit || '')}"
         data-flagged="${flagged ? '1' : '0'}"
         data-current-qty="${qty}"
         data-current-note="${escapeHtml(flag?.note || '')}">
      <div class="item-main">
        <div class="item-name">${sharedInline}${escapeHtml(item.name)}</div>
        ${flaggedTime}
        ${noteHtml}
      </div>
      ${qtyBadge}
    </div>
  `;
}

// ────────────────────────────────────────────────
// CAFÉ PAGE
// ────────────────────────────────────────────────
async function cafePage(env, viewerRole) {
  const items = await loadItemsForPages(env, 'hospitality', [1, 2, 3], true);
  const flags = await loadActiveFlagsMap(env);
  const flaggedCount = items.filter(i => flags.has(i.id)).length;
  const greeting = `
    <div class="greeting">
      <strong>Hi Maria.</strong> Tap any item that's running low and tell us how many we need. We'll get it on the shopping run. Items marked <span class="shared-pill">SHARED</span> are also visible to the Kitchen team.
      ${flaggedCount > 0 ? `<br><span style="font-size:12px;color:${COLORS.textSecondary}">${flaggedCount} item${flaggedCount === 1 ? '' : 's'} currently on the list.</span>` : ''}
      <div style="margin-top:10px"><a href="/list" style="display:inline-block;background:${COLORS.brown};color:${COLORS.cream};padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase">View Shopping List</a></div>
    </div>
  `;
  const body = `
    <div class="page">
      <div class="page-header">
        <div class="page-tag">Café Team</div>
        <h2 class="page-title">CAFÉ SUPPLY CHECK</h2>
      </div>
      ${greeting}
      ${renderItemCardsByCategory(items, flags, { sharedPage: 3 })}
    </div>
    ${quantityModalHtml()}
    ${itemScript()}
  `;
  return pageShell('Café Supply Check', viewerRole, body, '/cafe');
}

// ────────────────────────────────────────────────
// KITCHEN PAGE
// ────────────────────────────────────────────────
async function kitchenPage(env, viewerRole) {
  const items = await loadItemsForPages(env, 'hospitality', [3, 4]);
  const flags = await loadActiveFlagsMap(env);
  const flaggedCount = items.filter(i => flags.has(i.id)).length;
  const greeting = `
    <div class="greeting">
      <strong>Hi Cheryl.</strong> Tap any item that's running low and tell us how many we need. We'll get it on the shopping run. Items marked <span class="shared-pill">SHARED</span> are also visible to the Café team.
      ${flaggedCount > 0 ? `<br><span style="font-size:12px;color:${COLORS.textSecondary}">${flaggedCount} item${flaggedCount === 1 ? '' : 's'} currently on the list.</span>` : ''}
      <div style="margin-top:10px"><a href="/list" style="display:inline-block;background:${COLORS.brown};color:${COLORS.cream};padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase">View Shopping List</a></div>
    </div>
  `;
  const body = `
    <div class="page">
      <div class="page-header">
        <div class="page-tag">Kitchen Team</div>
        <h2 class="page-title">KITCHEN SUPPLY CHECK</h2>
      </div>
      ${greeting}
      ${renderItemCardsByCategory(items, flags, { sharedPage: 3 })}
    </div>
    ${quantityModalHtml()}
    ${itemScript()}
  `;
  return pageShell('Kitchen Supply Check', viewerRole, body, '/kitchen');
}

// ────────────────────────────────────────────────
// ADULT MINISTRY PAGE
// ────────────────────────────────────────────────
async function adultMinistryPage(env) {
  const items = await loadItemsForPages(env, 'adult_ministry', [5]);
  const flags = await loadActiveFlagsMap(env);
  const body = `
    <div class="page">
      <div class="page-header">
        <div class="page-tag">Shane · Adult Ministry Lane</div>
        <h2 class="page-title">ADULT MINISTRY SUPPLIES</h2>
        <p class="page-sub">Your budget. Volunteers don't see this page.</p>
      </div>
      ${renderItemCardsByCategory(items, flags)}
      <button type="button" class="add-item-btn" id="add-item-btn">+ Add New Item</button>
    </div>
    ${quantityModalHtml()}
    ${addItemModalHtml()}
    ${itemScript()}
    ${addItemScript()}
  `;
  return pageShell('Adult Ministry Supplies', 'shane', body, '/adult-ministry');
}

// ────────────────────────────────────────────────
// SHOPPING REVIEW PAGE (Care & Connection)
// Vendor-grouped Need More list + "confirm bought" flow.
// Fires acknowledgment for all open flags on load.
// ────────────────────────────────────────────────
async function shanePage(env) {
  // Acknowledge all open flags as part of loading this page (background)
  await env.DB.prepare(
    `UPDATE flags SET acknowledged_at = datetime('now') WHERE resolved_at IS NULL AND acknowledged_at IS NULL`
  ).run();

  const res = await env.DB.prepare(`
    SELECT f.id as flag_id, f.item_id, f.note, f.quantity, f.flagged_by, f.flagged_at,
           i.name, i.vendor, i.unit, i.notes as item_notes, i.amazon_url, i.brand, i.lane, i.category
    FROM flags f JOIN items i ON i.id = f.item_id
    WHERE f.resolved_at IS NULL
    ORDER BY i.vendor, i.category, i.name
  `).all();
  const flags = res.results || [];

  // Group by vendor
  const byVendor = {};
  for (const f of flags) {
    const v = f.vendor || 'Unknown';
    if (!byVendor[v]) byVendor[v] = [];
    byVendor[v].push(f);
  }

  const VENDOR_ORDER = [
    { key: 'Amazon', color: '#5a3220', textColor: COLORS.cream, tag: 'Online' },
    { key: 'Webstaurant', color: COLORS.brown, textColor: COLORS.cream, tag: 'Order online' },
    { key: 'Publix', color: '#1d9e75', textColor: '#fff', tag: 'Fresh / Weekly' },
    { key: "Sam's Club", color: COLORS.equip, textColor: '#fff', tag: 'Bulk · kitchen' },
    { key: "BJ's", color: COLORS.send, textColor: '#0c447c', tag: 'Bulk' },
    { key: 'Flexible', color: '#8b6e47', textColor: '#fff', tag: 'Sam\'s / BJ\'s / Amazon' },
    { key: 'Restaurant Depot', color: '#854f0b', textColor: '#fff', tag: 'Foodservice' },
    { key: 'Confirm', color: '#efbb27', textColor: '#4a3804', tag: 'Vendor TBD' },
  ];

  const totalCount = flags.length;
  const banner = totalCount === 0
    ? `<div style="background:#d1fae5;color:#065f46;padding:18px;border-radius:10px;margin-bottom:14px;font-size:15px;text-align:center">
         <strong>All clear.</strong> No items flagged from any team right now.
       </div>`
    : `<div style="background:#faf3e6;border:1px solid ${COLORS.equip};border-radius:10px;padding:14px;margin-bottom:14px;font-size:14px;color:#5a3220">
         <strong>${totalCount} item${totalCount === 1 ? '' : 's'} flagged across ${Object.keys(byVendor).length} vendor${Object.keys(byVendor).length === 1 ? '' : 's'}.</strong>
         Group your run, or tap a green checkbox as you buy each item.
       </div>`;

  const vendorBlocks = VENDOR_ORDER.map(v => {
    const items = byVendor[v.key] || [];
    if (items.length === 0) return '';
    const rows = items.map(f => shopRow(f)).join('');
    return `
      <div class="vendor-card">
        <div class="vendor-header" style="background:${v.color};color:${v.textColor}">
          <span class="vendor-name">${escapeHtml(v.key)}</span>
          <span class="vendor-meta">${escapeHtml(v.tag)} · ${items.length}</span>
        </div>
        <div>${rows}</div>
      </div>
    `;
  }).join('');

  // Any vendor not in our list
  const knownVendors = new Set(VENDOR_ORDER.map(v => v.key));
  const otherVendors = Object.keys(byVendor).filter(v => !knownVendors.has(v));
  const otherBlock = otherVendors.map(v => {
    const items = byVendor[v];
    const rows = items.map(f => shopRow(f)).join('');
    return `
      <div class="vendor-card">
        <div class="vendor-header" style="background:${COLORS.textTertiary};color:white">
          <span class="vendor-name">${escapeHtml(v || 'Unknown')}</span>
          <span class="vendor-meta">${items.length}</span>
        </div>
        <div>${rows}</div>
      </div>
    `;
  }).join('');

  const body = `
    <div class="page">
      <div class="page-header">
        <div class="page-tag">Shane · Shopping Review</div>
        <p class="page-sub">Need More flags grouped by vendor.</p>
      </div>
      ${banner}
      ${vendorBlocks}
      ${otherBlock}
      <p style="text-align:center;color:${COLORS.textTertiary};font-size:13px;margin-top:24px">
        Tap the green checkbox when you've bought an item. You'll confirm how many.
      </p>
    </div>
    ${boughtModalHtml()}
    ${shopScript()}
  `;
  return pageShell('Shopping Review', 'shane', body, '/shane');
}

function shopRow(f) {
  const amazonLink = f.amazon_url
    ? `<a href="${escapeHtml(f.amazon_url)}" target="_blank" rel="noopener" style="font-size:11px;color:${COLORS.cross};text-decoration:none;letter-spacing:0.4px;text-transform:uppercase;font-weight:700;display:inline-block;margin-top:4px">Amazon ↗</a>`
    : '';
  const brandLine = f.brand
    ? `<div style="font-size:12px;color:${COLORS.textTertiary};margin-top:2px">${escapeHtml(f.brand)}${f.item_notes ? ' · ' + escapeHtml(f.item_notes) : ''}</div>`
    : (f.item_notes ? `<div style="font-size:12px;color:${COLORS.textTertiary};margin-top:2px">${escapeHtml(f.item_notes)}</div>` : '');
  const noteLine = f.note
    ? `<div style="font-size:12px;color:${COLORS.textSecondary};margin-top:4px;font-style:italic">📝 ${escapeHtml(f.note)}</div>`
    : '';
  return `
    <div class="shop-row" data-item-id="${escapeHtml(f.item_id)}"
         data-item-name="${escapeHtml(f.name)}"
         data-unit="${escapeHtml(f.unit || '')}"
         data-flagged-qty="${f.quantity}">
      <input type="checkbox" data-mark-bought="${escapeHtml(f.item_id)}"
             style="width:24px;height:24px;accent-color:#065f46;margin-top:4px;cursor:pointer;flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1">
            <div style="font-size:15px;color:${COLORS.textPrimary};font-weight:500">${escapeHtml(f.name)}</div>
            ${brandLine}
            ${noteLine}
            <div style="font-size:11px;color:${COLORS.textTertiary};margin-top:4px;text-transform:uppercase;letter-spacing:0.4px">
              From ${escapeHtml(f.flagged_by)} · ${escapeHtml(timeAgo(f.flagged_at))}
            </div>
            ${amazonLink}
          </div>
          <div class="qty-badge" style="background:#ca8342">${formatUnit(f.quantity, f.unit)}</div>
        </div>
      </div>
    </div>
  `;
}

// ────────────────────────────────────────────────
// MODALS
// ────────────────────────────────────────────────
function quantityModalHtml() {
  return `
    <div id="qty-modal" class="modal-backdrop" role="dialog" aria-hidden="true">
      <div class="modal">
        <h3 id="qty-modal-title" class="modal-title">Need More</h3>
        <p class="modal-sub" id="qty-modal-sub">Tell us how many we need.</p>
        <div class="qty-stepper">
          <button type="button" class="qty-btn" id="qty-minus">−</button>
          <div>
            <div class="qty-display" id="qty-display">0</div>
            <div class="qty-unit" id="qty-unit"></div>
          </div>
          <button type="button" class="qty-btn" id="qty-plus">+</button>
        </div>
        <label class="modal-field-label">Note (optional)</label>
        <textarea id="qty-note" placeholder="e.g. Ran out during 9am service. Need before Wednesday."></textarea>
        <div class="modal-actions">
          <button type="button" class="btn-primary" id="qty-save">Send to Shopping List</button>
          <button type="button" class="btn-danger" id="qty-clear" style="display:none">We Don't Need This</button>
          <button type="button" class="btn-secondary" id="qty-cancel">Never Mind</button>
        </div>
      </div>
    </div>
  `;
}

function boughtModalHtml() {
  return `
    <div id="bought-modal" class="modal-backdrop" role="dialog" aria-hidden="true">
      <div class="modal">
        <h3 id="bought-modal-title" class="modal-title">How many did you buy?</h3>
        <p class="modal-sub">This updates the burn-rate data over time.</p>
        <div class="qty-stepper">
          <button type="button" class="qty-btn" id="bought-minus">−</button>
          <div>
            <div class="qty-display" id="bought-display">0</div>
            <div class="qty-unit" id="bought-unit"></div>
          </div>
          <button type="button" class="qty-btn" id="bought-plus">+</button>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-primary" id="bought-save">Mark Bought</button>
          <button type="button" class="btn-secondary" id="bought-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function addItemModalHtml() {
  return `
    <div id="add-modal" class="modal-backdrop" role="dialog" aria-hidden="true">
      <div class="modal">
        <h3 class="modal-title">Add New Item</h3>
        <p class="modal-sub">Adds an item to the Adult Ministry lane.</p>
        <label class="modal-field-label">Item name</label>
        <input type="text" id="add-name" placeholder="e.g. Communion Wafers">
        <label class="modal-field-label">Category</label>
        <select id="add-category">
          <option value="Worship Service">Worship Service</option>
          <option value="Name Badges">Name Badges</option>
          <option value="Hardware">Hardware / AV</option>
          <option value="Office">Office Basics</option>
          <option value="Organization">Storage / Organization</option>
        </select>
        <label class="modal-field-label">Unit</label>
        <select id="add-unit">
          <option value="each">each</option>
          <option value="pack">pack</option>
          <option value="box">box</option>
          <option value="case">case</option>
          <option value="bottle">bottle</option>
          <option value="bag">bag</option>
        </select>
        <label class="modal-field-label">Vendor (optional)</label>
        <select id="add-vendor">
          <option value="Confirm">Confirm later</option>
          <option value="Amazon">Amazon</option>
          <option value="Sam's Club">Sam's Club</option>
          <option value="BJ's">BJ's</option>
          <option value="Publix">Publix</option>
          <option value="Restaurant Depot">Restaurant Depot</option>
        </select>
        <label class="modal-field-label">Notes (optional)</label>
        <textarea id="add-notes" placeholder="Brand, pack size, ASIN, etc."></textarea>
        <div class="modal-actions">
          <button type="button" class="btn-primary" id="add-save">Add Item</button>
          <button type="button" class="btn-secondary" id="add-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

// ────────────────────────────────────────────────
// CLIENT SCRIPTS
// ────────────────────────────────────────────────
function itemScript() {
  return `
    <script>
      (function() {
        const modal = document.getElementById('qty-modal');
        const title = document.getElementById('qty-modal-title');
        const sub = document.getElementById('qty-modal-sub');
        const display = document.getElementById('qty-display');
        const unitDisplay = document.getElementById('qty-unit');
        const noteInput = document.getElementById('qty-note');
        const btnPlus = document.getElementById('qty-plus');
        const btnMinus = document.getElementById('qty-minus');
        const btnSave = document.getElementById('qty-save');
        const btnClear = document.getElementById('qty-clear');
        const btnCancel = document.getElementById('qty-cancel');

        let state = { itemId: null, qty: 0, unit: '', wasFlagged: false };

        function pluralize(qty, unit) {
          if (!unit) return String(qty);
          if (unit === 'each') return qty === 1 ? unit : unit;
          if (qty === 1) return unit;
          if (unit === 'box') return 'boxes';
          return unit + 's';
        }

        function updateDisplay() {
          display.textContent = state.qty;
          unitDisplay.textContent = state.qty === 0
            ? (state.unit ? pluralize(2, state.unit) : '')
            : pluralize(state.qty, state.unit);
          btnMinus.disabled = state.qty <= 0;
          btnSave.disabled = state.qty < 1;
        }

        function open(row) {
          state.itemId = row.getAttribute('data-item-id');
          state.unit = row.getAttribute('data-unit') || '';
          state.wasFlagged = row.getAttribute('data-flagged') === '1';
          state.qty = parseInt(row.getAttribute('data-current-qty'), 10) || 0;
          const itemName = row.getAttribute('data-item-name');
          const currentNote = row.getAttribute('data-current-note') || '';
          title.textContent = itemName;
          sub.textContent = state.wasFlagged ? 'Update the quantity or note.' : 'Tell us how many we need.';
          noteInput.value = currentNote;
          btnClear.style.display = state.wasFlagged ? 'inline-block' : 'none';
          updateDisplay();
          modal.classList.add('show');
          setTimeout(() => display.parentElement.focus?.(), 100);
        }
        function close() { modal.classList.remove('show'); }

        function toast(msg, isError) {
          const b = document.getElementById('save-banner');
          b.textContent = msg;
          b.classList.toggle('error', !!isError);
          b.classList.add('show');
          setTimeout(() => b.classList.remove('show'), 2200);
        }

        btnPlus.addEventListener('click', () => { state.qty++; updateDisplay(); });
        btnMinus.addEventListener('click', () => { if (state.qty > 0) { state.qty--; updateDisplay(); } });

        btnSave.addEventListener('click', async () => {
          if (state.qty < 1) return;
          btnSave.disabled = true; btnSave.textContent = 'Sending…';
          try {
            const res = await fetch('/api/flag', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ item_id: state.itemId, quantity: state.qty, note: noteInput.value.trim() })
            });
            if (res.ok) {
              toast('✓ Submitted — ' + state.qty + ' ' + pluralize(state.qty, state.unit));
              close();
              setTimeout(() => window.location.reload(), 600);
            } else {
              const err = await res.json().catch(() => ({}));
              toast('Could not send. Try again.', true);
            }
          } catch (e) {
            toast('Could not send. Check connection.', true);
          } finally {
            btnSave.disabled = false; btnSave.textContent = 'Send to Shopping List';
          }
        });

        btnClear.addEventListener('click', async () => {
          btnClear.disabled = true; btnClear.textContent = 'Clearing…';
          try {
            const res = await fetch('/api/clear', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ item_id: state.itemId })
            });
            if (res.ok) {
              toast('✓ Cleared');
              close();
              setTimeout(() => window.location.reload(), 500);
            } else {
              const err = await res.json().catch(() => ({}));
              if (err.error === 'not_your_flag') {
                toast('Only the team that flagged it can clear it.', true);
              } else {
                toast('Could not clear. Try again.', true);
              }
            }
          } catch (e) {
            toast('Could not clear. Check connection.', true);
          } finally {
            btnClear.disabled = false; btnClear.textContent = "We Don't Need This";
          }
        });

        btnCancel.addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

        document.querySelectorAll('.item-row').forEach(row => {
          row.addEventListener('click', () => open(row));
        });
      })();
    </script>
  `;
}

function shopScript() {
  return `
    <script>
      (function() {
        const modal = document.getElementById('bought-modal');
        const title = document.getElementById('bought-modal-title');
        const display = document.getElementById('bought-display');
        const unitDisplay = document.getElementById('bought-unit');
        const btnPlus = document.getElementById('bought-plus');
        const btnMinus = document.getElementById('bought-minus');
        const btnSave = document.getElementById('bought-save');
        const btnCancel = document.getElementById('bought-cancel');

        let state = { itemId: null, qty: 0, unit: '', flaggedQty: 0, checkbox: null };

        function pluralize(qty, unit) {
          if (!unit) return String(qty);
          if (unit === 'each') return unit;
          if (qty === 1) return unit;
          if (unit === 'box') return 'boxes';
          return unit + 's';
        }

        function updateDisplay() {
          display.textContent = state.qty;
          unitDisplay.textContent = state.qty === 0
            ? (state.unit ? pluralize(2, state.unit) : '')
            : pluralize(state.qty, state.unit);
          btnMinus.disabled = state.qty <= 0;
        }

        function toast(msg, isError) {
          const b = document.getElementById('save-banner');
          b.textContent = msg;
          b.classList.toggle('error', !!isError);
          b.classList.add('show');
          setTimeout(() => b.classList.remove('show'), 1800);
        }

        function open(row, checkbox) {
          state.itemId = row.getAttribute('data-item-id');
          state.unit = row.getAttribute('data-unit') || '';
          state.flaggedQty = parseInt(row.getAttribute('data-flagged-qty'), 10) || 1;
          state.qty = state.flaggedQty;
          state.checkbox = checkbox;
          title.textContent = 'How many ' + (state.unit ? pluralize(state.qty, state.unit) : '') + ' of ' + row.getAttribute('data-item-name') + '?';
          updateDisplay();
          modal.classList.add('show');
        }
        function close() { modal.classList.remove('show'); if (state.checkbox) state.checkbox.checked = false; }

        btnPlus.addEventListener('click', () => { state.qty++; updateDisplay(); });
        btnMinus.addEventListener('click', () => { if (state.qty > 0) { state.qty--; updateDisplay(); } });

        btnSave.addEventListener('click', async () => {
          btnSave.disabled = true; btnSave.textContent = 'Saving…';
          try {
            const res = await fetch('/api/resolve', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ item_id: state.itemId, bought_quantity: state.qty })
            });
            if (res.ok) {
              toast('✓ Marked bought (' + state.qty + ')');
              modal.classList.remove('show');
              setTimeout(() => window.location.reload(), 600);
            } else {
              if (state.checkbox) state.checkbox.checked = false;
              toast('Could not save.', true);
            }
          } catch (e) {
            if (state.checkbox) state.checkbox.checked = false;
            toast('Could not save. Check connection.', true);
          } finally {
            btnSave.disabled = false; btnSave.textContent = 'Mark Bought';
          }
        });

        btnCancel.addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

        document.querySelectorAll('[data-mark-bought]').forEach(cb => {
          cb.addEventListener('change', (e) => {
            if (!e.target.checked) return;
            const row = e.target.closest('.shop-row');
            open(row, e.target);
          });
        });
      })();
    </script>
  `;
}

function addItemScript() {
  return `
    <script>
      (function() {
        const btn = document.getElementById('add-item-btn');
        const modal = document.getElementById('add-modal');
        const nameInput = document.getElementById('add-name');
        const categorySelect = document.getElementById('add-category');
        const unitSelect = document.getElementById('add-unit');
        const vendorSelect = document.getElementById('add-vendor');
        const notesInput = document.getElementById('add-notes');
        const btnSave = document.getElementById('add-save');
        const btnCancel = document.getElementById('add-cancel');

        function toast(msg, isError) {
          const b = document.getElementById('save-banner');
          b.textContent = msg;
          b.classList.toggle('error', !!isError);
          b.classList.add('show');
          setTimeout(() => b.classList.remove('show'), 1800);
        }

        btn.addEventListener('click', () => {
          nameInput.value = '';
          notesInput.value = '';
          categorySelect.selectedIndex = 0;
          unitSelect.selectedIndex = 0;
          vendorSelect.selectedIndex = 0;
          modal.classList.add('show');
          setTimeout(() => nameInput.focus(), 100);
        });

        btnSave.addEventListener('click', async () => {
          const name = nameInput.value.trim();
          if (!name) { toast('Name required', true); return; }
          btnSave.disabled = true; btnSave.textContent = 'Adding…';
          try {
            const res = await fetch('/api/add-item', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name, category: categorySelect.value, unit: unitSelect.value,
                vendor: vendorSelect.value, notes: notesInput.value.trim()
              })
            });
            if (res.ok) {
              toast('✓ Added ' + name);
              modal.classList.remove('show');
              setTimeout(() => window.location.reload(), 600);
            } else {
              toast('Could not add. Try again.', true);
            }
          } catch (e) {
            toast('Could not add. Check connection.', true);
          } finally {
            btnSave.disabled = false; btnSave.textContent = 'Add Item';
          }
        });

        btnCancel.addEventListener('click', () => modal.classList.remove('show'));
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });
      })();
    </script>
  `;
}

// ────────────────────────────────────────────────
// SHOPPING LIST PAGE (available to all roles)
// Shows flagged items, who flagged them, and tracks
// "bought by [name]" so teams can share shopping.
// Items stay visible after being bought until Shane
// clears them from Shopping Review.
// ────────────────────────────────────────────────
async function shoppingListPage(env, viewerRole) {
  const res = await env.DB.prepare(`
    SELECT f.id as flag_id, f.item_id, f.note, f.quantity, f.flagged_by, f.flagged_at,
           f.bought_by, f.bought_at, f.bought_quantity,
           i.name, i.vendor, i.unit, i.notes as item_notes, i.amazon_url, i.brand, i.lane, i.category, i.page
    FROM flags f JOIN items i ON i.id = f.item_id
    WHERE f.resolved_at IS NULL
    ORDER BY i.vendor, i.category, i.name
  `).all();
  const allFlags = res.results || [];

  // Filter by role: cafe sees its items + shared (page 3); kitchen sees its + shared; shane sees all.
  let flags = allFlags;
  if (viewerRole === 'cafe') {
    flags = allFlags.filter(f => f.lane === 'hospitality' && (f.page === 1 || f.page === 2 || f.page === 3));
  } else if (viewerRole === 'kitchen') {
    flags = allFlags.filter(f => f.lane === 'hospitality' && (f.page === 3 || f.page === 4));
  }

  const byVendor = {};
  for (const f of flags) {
    const v = f.vendor || 'Unknown';
    if (!byVendor[v]) byVendor[v] = [];
    byVendor[v].push(f);
  }

  const totalCount = flags.length;
  const boughtCount = flags.filter(f => f.bought_by).length;
  const remainingCount = totalCount - boughtCount;
  const teamLabel = viewerRole === 'cafe' ? 'Café Team' : (viewerRole === 'kitchen' ? 'Kitchen Team' : 'All Teams');

  const banner = totalCount === 0
    ? `<div style="background:#d1fae5;color:#065f46;padding:14px;border-radius:10px;margin-bottom:12px;font-size:15px;text-align:center">
         <strong>Nothing on the list right now.</strong> Flag items from your supply page and they'll show up here.
       </div>`
    : `<div style="background:#faf3e6;border:1px solid ${COLORS.equip};border-radius:10px;padding:12px;margin-bottom:12px;font-size:14px;color:#5a3220">
         <strong>${remainingCount} still needed</strong>${boughtCount > 0 ? ` · <span style="color:#065f46">${boughtCount} bought ✓</span>` : ''}<br>
         <span style="font-size:12px;color:${COLORS.textSecondary}">Tap "Mark Bought" when you pick something up. Everyone on the team will see.</span>
       </div>`;

  const vendorOrder = Object.keys(byVendor).sort();
  const vendorBlocks = vendorOrder.map(v => {
    const items = byVendor[v];
    const rows = items.map(f => simpleListRow(f)).join('');
    return `
      <div class="vendor-card" style="margin-bottom:10px">
        <div class="vendor-header" style="background:${COLORS.brown};color:${COLORS.cream}">
          <span class="vendor-name">${escapeHtml(v)}</span>
          <span class="vendor-meta">${items.length} item${items.length === 1 ? '' : 's'}</span>
        </div>
        <div>${rows}</div>
      </div>
    `;
  }).join('');

  const body = `
    <div class="page">
      <div class="page-header">
        <div class="page-tag">${escapeHtml(teamLabel)} · Shopping List</div>
        <h2 class="page-title">SHOPPING LIST</h2>
        <p class="page-sub">Tap "Mark Bought" when you grab something. Updates for everyone.</p>
      </div>
      ${banner}
      ${vendorBlocks}
    </div>
    ${shoppingListScript()}
  `;
  return pageShell('Shopping List', viewerRole, body, '/list');
}

function simpleListRow(f) {
  const qtyStr = formatUnit(f.quantity, f.unit);
  const isBought = !!f.bought_by;
  const noteHtml = f.note
    ? `<div style="font-size:12px;color:${COLORS.textSecondary};margin-top:2px">📝 ${escapeHtml(f.note)}</div>` : '';
  const boughtHtml = isBought
    ? `<div style="font-size:12px;color:#065f46;margin-top:3px;font-weight:600">✓ Bought by ${escapeHtml(f.bought_by)} · ${timeAgo(f.bought_at)}</div>`
    : '';
  const rowBg = isBought ? '#d1fae5' : 'transparent';
  const nameStyle = isBought
    ? `font-weight:600;font-size:14px;color:#065f46;text-decoration:line-through`
    : `font-weight:600;font-size:14px;color:${COLORS.textPrimary}`;
  const actionButton = isBought
    ? `<div style="background:#065f46;color:white;padding:6px 10px;border-radius:6px;font-weight:700;font-size:12px;white-space:nowrap">✓ DONE</div>`
    : `<button class="btn-mark-bought" data-item-id="${escapeHtml(f.item_id)}" data-qty="${f.quantity}" style="background:${COLORS.cross};color:white;padding:8px 12px;border-radius:6px;font-weight:700;font-size:12px;white-space:nowrap;border:none;cursor:pointer;font-family:inherit;text-transform:uppercase;letter-spacing:0.5px">Mark Bought</button>`;
  return `
    <div style="display:flex;padding:10px 12px;border-bottom:1px solid ${COLORS.borderTertiary};align-items:center;gap:10px;background:${rowBg}">
      <div style="flex:1;min-width:0">
        <div style="${nameStyle}">${escapeHtml(f.name)}</div>
        <div style="font-size:11px;color:${COLORS.textTertiary};margin-top:2px">Need ${qtyStr} · Flagged by ${escapeHtml(f.flagged_by)} · ${timeAgo(f.flagged_at)}</div>
        ${noteHtml}
        ${boughtHtml}
      </div>
      ${actionButton}
    </div>
  `;
}

function shoppingListScript() {
  return `
    <script>
      document.querySelectorAll('.btn-mark-bought').forEach(btn => {
        btn.addEventListener('click', async () => {
          const itemId = btn.getAttribute('data-item-id');
          const qty = parseInt(btn.getAttribute('data-qty'), 10) || 1;
          if (!confirm('Mark this as bought? The team will see your name.')) return;
          btn.disabled = true;
          btn.textContent = 'Saving…';
          try {
            const r = await fetch('/api/resolve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ item_id: itemId, bought_quantity: qty })
            });
            if (r.ok) {
              location.reload();
            } else {
              btn.disabled = false;
              btn.textContent = 'Mark Bought';
              alert('Could not save. Try again.');
            }
          } catch (e) {
            btn.disabled = false;
            btn.textContent = 'Mark Bought';
            alert('Network issue. Try again.');
          }
        });
      });
    </script>
  `;
}

// ────────────────────────────────────────────────
// AUDIT LOG PAGE
// ────────────────────────────────────────────────
async function logPage(env) {
  const res = await env.DB.prepare(`
    SELECT id, action, actor_role, target_kind, target_id, metadata, created_at
    FROM audit_log ORDER BY created_at DESC LIMIT 200
  `).all();
  const rows = res.results || [];

  const ACTION_LABELS = {
    flag_created:  { label: 'Flagged',     color: '#92400e', bg: '#fef3c7' },
    flag_updated:  { label: 'Updated',     color: '#854f0b', bg: '#fde68a' },
    flag_cleared:  { label: 'Cleared',     color: '#5f5e5a', bg: '#f5f2ea' },
    flag_resolved: { label: 'Bought',      color: '#065f46', bg: '#d1fae5' },
    item_added:    { label: 'Item added',  color: '#1e3a8a', bg: '#dbeafe' },
  };

  const rowHtml = rows.length === 0
    ? `<div style="padding:24px;text-align:center;color:${COLORS.textTertiary}">No actions yet. Once volunteers start flagging items, you'll see every move here.</div>`
    : rows.map(r => {
        let meta = {};
        try { meta = JSON.parse(r.metadata || '{}'); } catch {}
        const itemName = meta.item_name || meta.name || meta.item_id || r.target_id || '—';
        const lbl = ACTION_LABELS[r.action] || { label: r.action, color: COLORS.textSecondary, bg: COLORS.bgSecondary };

        let detailBits = [];
        if (meta.quantity != null && meta.previous_quantity != null && meta.quantity !== meta.previous_quantity) {
          detailBits.push(`<div style="font-size:12px;color:${COLORS.textSecondary};margin-top:2px">Quantity: ${meta.previous_quantity} → ${meta.quantity} ${escapeHtml(meta.unit || '')}</div>`);
        } else if (meta.quantity != null) {
          detailBits.push(`<div style="font-size:12px;color:${COLORS.textSecondary};margin-top:2px">Qty: ${meta.quantity} ${escapeHtml(meta.unit || '')}</div>`);
        }
        if (meta.bought_quantity != null && meta.flagged_quantity != null) {
          detailBits.push(`<div style="font-size:12px;color:${COLORS.textSecondary};margin-top:2px">Bought ${meta.bought_quantity} of ${meta.flagged_quantity} flagged ${escapeHtml(meta.unit || '')}</div>`);
        }
        if (meta.note) {
          detailBits.push(`<div style="font-size:13px;color:${COLORS.textSecondary};margin-top:2px;font-style:italic">"${escapeHtml(meta.note)}"</div>`);
        }
        if (meta.previous_note && meta.previous_note !== meta.note) {
          detailBits.push(`<div style="font-size:11px;color:${COLORS.textTertiary};margin-top:2px">Was: "${escapeHtml(meta.previous_note)}"</div>`);
        }
        if (meta.original_flagger && meta.original_flagger !== r.actor_role) {
          detailBits.push(`<div style="font-size:11px;color:${COLORS.textTertiary};margin-top:2px;text-transform:uppercase;letter-spacing:0.4px">Originally flagged by ${escapeHtml(meta.original_flagger)}</div>`);
        }

        return `
          <div style="padding:14px 16px;border-bottom:1px solid ${COLORS.borderTertiary}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:4px">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="background:${lbl.bg};color:${lbl.color};padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">${escapeHtml(lbl.label)}</span>
                <span style="font-size:11px;color:${COLORS.textTertiary};text-transform:uppercase;letter-spacing:0.4px">by ${escapeHtml(r.actor_role)}</span>
              </div>
              <span style="font-size:11px;color:${COLORS.textTertiary};white-space:nowrap">${escapeHtml(timeAgo(r.created_at))}</span>
            </div>
            <div style="font-size:15px;color:${COLORS.textPrimary};font-weight:500">${escapeHtml(itemName)}</div>
            ${detailBits.join('')}
          </div>
        `;
      }).join('');

  const body = `
    <div class="page">
      <div class="page-header">
        <div class="page-tag">Shane · Audit Log</div>
        <h2 class="page-title">AUDIT LOG</h2>
        <p class="page-sub">Every action, latest first. Last 200 events.</p>
      </div>
      <div class="card" style="padding:0">
        ${rowHtml}
      </div>
    </div>
  `;
  return pageShell('Audit Log', 'shane', body, '/log');
}

// ────────────────────────────────────────────────
// ICONS (preserved byte-for-byte from prior thread)
// ────────────────────────────────────────────────
const ICONS = {
  coffee: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#402020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 14c0 1 .5 2.4 2 2.4M3 14h13a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H3z"/><path d="M16 6H3a2 2 0 0 0-2 2v6h17V8a2 2 0 0 0-2-2z" transform="translate(2 0)"/><path d="M7 4c0 1 1 1 1 2s-1 1-1 2M11 4c0 1 1 1 1 2s-1 1-1 2M15 4c0 1 1 1 1 2s-1 1-1 2"/></svg>`,
  syrup: `<svg width="32" height="48" viewBox="0 0 32 48" fill="none" stroke="#ca8342" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="13" y="2" width="6" height="6" rx="1"/><path d="M11 8h10v4l2 3v28a3 3 0 01-3 3H10a3 3 0 01-3-3V15l2-3V8z"/><rect x="11" y="22" width="10" height="10" rx="1" fill="#ca8342" fill-opacity="0.15"/></svg>`,
  pump: `<svg width="36" height="48" viewBox="0 0 36 48" fill="none" stroke="#6d3d31" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 4v8M22 4l6 2"/><path d="M18 12v3"/><rect x="12" y="15" width="14" height="3" rx="1"/><rect x="10" y="18" width="18" height="26" rx="2"/><line x1="14" y1="26" x2="24" y2="26"/></svg>`,
  honeyJar: `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="#7a9658" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="20" cy="22" rx="9" ry="11"/><line x1="14" y1="18" x2="26" y2="18"/><line x1="13" y1="24" x2="27" y2="24"/><line x1="14" y1="30" x2="26" y2="30"/><circle cx="20" cy="13" r="3"/><line x1="18" y1="11" x2="16" y2="8"/><line x1="22" y1="11" x2="24" y2="8"/><ellipse cx="11" cy="16" rx="4" ry="2.5" transform="rotate(-30 11 16)"/><ellipse cx="29" cy="16" rx="4" ry="2.5" transform="rotate(30 29 16)"/></svg><svg width="36" height="44" viewBox="0 0 36 44" fill="none" stroke="#7a9658" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="4" width="18" height="5" rx="1"/><path d="M8 9h20v28a3 3 0 01-3 3H11a3 3 0 01-3-3V9z"/><circle cx="14" cy="25" r="3" fill="#7a9658" fill-opacity="0.2"/><circle cx="22" cy="28" r="3" fill="#7a9658" fill-opacity="0.2"/><circle cx="17" cy="32" r="2.5" fill="#7a9658" fill-opacity="0.2"/></svg>`,
  spray: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0f6e56" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2h6v4l2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8l2-2V2z"/><line x1="9" y1="12" x2="13" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/><circle cx="20" cy="4" r="1"/><circle cx="22" cy="6" r="1"/><circle cx="19" cy="7" r="1"/></svg>`,
  milk: `<svg width="40" height="48" viewBox="0 0 24 24" fill="none" stroke="#185fa5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2h6v3l2 3v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8l2-3V2z"/><line x1="7" y1="11" x2="17" y2="11"/></svg>`,
  apple: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#3b6d11" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5a4 4 0 0 1 4 4v6a6 6 0 0 1-12 0V9a4 4 0 0 1 4-4 4 4 0 0 1 4 0z"/><path d="M12 5V3"/><path d="M12 3c1-1 2-1 3-1"/></svg>`,
  hotCup: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#402020" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h12l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 8z"/><path d="M6 4h10v4H6z"/></svg>`,
  coldCup: `<svg width="40" height="44" viewBox="0 0 40 44" fill="none" stroke="#185fa5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 8h20l-2 32a2 2 0 01-2 2H14a2 2 0 01-2-2L10 8z"/><line x1="11" y1="14" x2="29" y2="14"/></svg>`,
  coffeeTea: `<svg width="36" height="40" viewBox="0 0 24 24" fill="none" stroke="#5a3220" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 14c0 1 .5 2.4 2 2.4M3 14h13a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H3z"/><path d="M16 6H3a2 2 0 0 0-2 2v6h17V8a2 2 0 0 0-2-2z" transform="translate(2 0)"/><path d="M7 4c0 1 1 1 1 2s-1 1-1 2M11 4c0 1 1 1 1 2s-1 1-1 2"/></svg><svg width="32" height="36" viewBox="0 0 40 44" fill="none" stroke="#5a3220" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="12" y="14" width="16" height="20" rx="1"/><line x1="20" y1="14" x2="20" y2="6"/><rect x="16" y="2" width="8" height="6" rx="1"/><line x1="16" y1="22" x2="24" y2="22"/></svg>`,
  creamer: `<svg width="28" height="32" viewBox="0 0 28 32" fill="none" stroke="#ca8342" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8h12v3l2 4v14a2 2 0 01-2 2H8a2 2 0 01-2-2V15l2-4V8z"/><rect x="8" y="6" width="12" height="2" rx="1"/><line x1="9" y1="20" x2="19" y2="20"/></svg>`,
  bulkSugar: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#ca8342" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8c0-2 2-3 4-3h8c2 0 4 1 4 3v16a2 2 0 01-2 2H8a2 2 0 01-2-2V8z"/><line x1="6" y1="12" x2="22" y2="12"/></svg>`,
  packet: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#ca8342" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="20" height="14" rx="1"/><line x1="8" y1="13" x2="20" y2="13"/><line x1="8" y1="17" x2="20" y2="17"/><path d="M14 8v-2M11 6h6"/></svg>`,
  lemonade: `<svg width="36" height="48" viewBox="0 0 36 48" fill="none" stroke="#ba7517" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="8" width="24" height="34" rx="2"/><rect x="6" y="8" width="24" height="6" rx="2"/><rect x="9" y="18" width="18" height="18" rx="1" fill="#ba7517" fill-opacity="0.15"/></svg>`,
  plates: `<svg width="44" height="36" viewBox="0 0 44 36" fill="none" stroke="#5f5e5a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="22" cy="22" rx="18" ry="5"/><ellipse cx="22" cy="20" rx="14" ry="3"/></svg><svg width="44" height="36" viewBox="0 0 44 36" fill="none" stroke="#5f5e5a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h36c0 8-7 16-18 16S4 22 4 14z"/><ellipse cx="22" cy="14" rx="18" ry="3"/></svg>`,
  cutlery: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#5f5e5a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 3v18M19 12c0-3-2-5-2-9M21 12c0-3-2-5-2-9M19 12c0-3 2-5 2-9"/><path d="M5 3v3a4 4 0 0 0 4 4v11"/><path d="M9 3v7"/></svg>`,
  seasonings: `<svg width="32" height="44" viewBox="0 0 32 44" fill="none" stroke="#5f5e5a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="14" width="16" height="26" rx="2"/><rect x="10" y="10" width="12" height="4" rx="1"/><circle cx="13" cy="13" r="0.5" fill="#5f5e5a"/><circle cx="16" cy="12" r="0.5" fill="#5f5e5a"/><circle cx="19" cy="13" r="0.5" fill="#5f5e5a"/></svg><svg width="32" height="44" viewBox="0 0 32 44" fill="none" stroke="#2c2c2a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="14" width="16" height="26" rx="2"/><rect x="10" y="10" width="12" height="4" rx="1"/><circle cx="13" cy="13" r="0.5" fill="#2c2c2a"/><circle cx="16" cy="12" r="0.5" fill="#2c2c2a"/><circle cx="19" cy="13" r="0.5" fill="#2c2c2a"/></svg>`,
  napkins: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#6d3d31" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l9-5 9 5-9 5z"/><path d="M3 14l9 5 9-5"/><path d="M3 11l9 5 9-5"/></svg>`,
  packaging: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#854f0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
  gloves: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#185fa5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11V6a2 2 0 0 1 4 0v5"/><path d="M13 11V4a2 2 0 0 1 4 0v7"/><path d="M17 11V6a2 2 0 0 1 2-2v9c0 4-2 7-7 7H8a4 4 0 0 1-4-4v-6a2 2 0 0 1 4 0"/></svg>`,
  cleaning: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0f6e56" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h18l-2 13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L3 7z"/><path d="M8 7V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3"/></svg>`,
  coldSides: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#3b6d11" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 18h32v4c0 8-6 14-14 14h-4c-8 0-14-6-14-14v-4z"/><ellipse cx="22" cy="18" rx="16" ry="3"/><circle cx="16" cy="14" r="2" fill="#3b6d11" fill-opacity="0.2"/><circle cx="24" cy="13" r="2" fill="#3b6d11" fill-opacity="0.2"/><circle cx="30" cy="15" r="1.5" fill="#3b6d11" fill-opacity="0.2"/></svg>`,
  saladFresh: `<svg width="36" height="40" viewBox="0 0 36 40" fill="none" stroke="#0f6e56" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="18" cy="22" rx="10" ry="14"/><path d="M18 8c0 4 4 6 4 14M18 8c0-4 4-6 6-4"/></svg><svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="#0f6e56" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="22" r="11"/><path d="M18 11c0-3 2-5 4-5M18 11c0-2-1-3-2-4"/></svg>`,
  dressing: `<svg width="32" height="48" viewBox="0 0 32 48" fill="none" stroke="#854f0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="13" y="2" width="6" height="6" rx="1"/><path d="M11 8h10v4l2 3v28a3 3 0 01-3 3H10a3 3 0 01-3-3V15l2-3V8z"/><rect x="11" y="22" width="10" height="10" rx="1" fill="#854f0b" fill-opacity="0.15"/></svg>`,
  gallonJug: `<svg width="48" height="52" viewBox="0 0 48 52" fill="none" stroke="#185fa5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="20" y="2" width="10" height="5" rx="1"/><path d="M19 7h12v4l3 3"/><path d="M12 14h24a2 2 0 012 2v28a4 4 0 01-4 4H14a4 4 0 01-4-4V16a2 2 0 012-2z"/><path d="M36 20h4a3 3 0 013 3v6a3 3 0 01-3 3h-4"/><rect x="14" y="24" width="20" height="14" rx="1" fill="#185fa5" fill-opacity="0.15"/></svg>`,
  bread: `<svg width="48" height="36" viewBox="0 0 48 36" fill="none" stroke="#854f0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 18c0-8 8-12 20-12s20 4 20 12v8a4 4 0 01-4 4H8a4 4 0 01-4-4v-8z"/><line x1="12" y1="14" x2="14" y2="11"/><line x1="20" y1="12" x2="22" y2="9"/><line x1="28" y1="12" x2="30" y2="9"/><line x1="36" y1="14" x2="38" y2="11"/></svg>`,
  butter: `<svg width="40" height="32" viewBox="0 0 40 32" fill="none" stroke="#ca8342" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="10" width="28" height="14" rx="2"/><line x1="6" y1="14" x2="34" y2="14"/><line x1="14" y1="14" x2="14" y2="24"/><line x1="22" y1="14" x2="22" y2="24"/><line x1="30" y1="14" x2="30" y2="24"/></svg>`,
};