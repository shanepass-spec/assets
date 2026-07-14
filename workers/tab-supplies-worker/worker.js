// ============================================================
// TAB-SUPPLIES Worker v2.1
// ============================================================
// Tabernacle Church supply check — digital companion to the
// paper packet. Shared resource visibility between Café and
// Kitchen teams, plus Shopping Cost Intelligence.
//
// ROUTES
//   /?code=XXX        → auto-login from URL (one-tap for volunteers)
//   /cafe             → Café team (Pages 1–2 + Shared Page 3)
//   /kitchen          → Kitchen team (Shared Page 3 + Page 4: WNM)
//   /shane            → Shopping Review (cost estimate + Need More by vendor)
//   /receipts         → TabReady receipt-match review queue (Shane)
//   /adult-ministry   → Care & Connection / Adult Ministry lane
//   /log              → Audit log (Care & Connection only)
//
// AUTH
// Role code in cookie (30 days). Auto-login via ?code=XXX URL.
//
// NEW IN v2.1.1 — SHOPPING TOTAL + SHIPPING
//   - /shane now reads products-first: the financial summary moved
//     BELOW the vendor list and reads as the final calculation.
//   - Shipping is part of the real estimate: shipping-capable vendors
//     (Webstaurant, Amazon) get an editable shipping row, and the
//     bottom summary shows Items subtotal → shipping → order total.
//     Unknown shipping is never counted as $0 — the total reads
//     "pending" and falls back to the known item subtotal.
//   - Sales-tax controls removed (church is tax-exempt; tax stays $0).
//   - New table shipping_estimates (one row per store).
//
// NEW IN v2.1 — SHOPPING COST INTELLIGENCE (additive, reversible)
//   - Estimated trip subtotal beneath the item count, with
//     unknown-price count, expandable store subtotals, and
//     shipping/tax kept separate (tax-exempt by default).
//   - Per-item estimate line with quantity-aware tier pricing;
//     exact prices vs round estimates are visually distinct.
//   - "Adjust estimate" calculator (use-for-trip or save) and a
//     price-detail panel (source, store prices, history, lock).
//   - TabReady feedback loop: POST /api/receipt-ingest (fail-closed,
//     requires the RECEIPT_INGEST_TOKEN secret) matches receipt
//     lines to canonical items (confirmed / likely / needs-review),
//     stores item-level purchase history without ever rewriting
//     finalized receipts, and learns vendor aliases. ONLY confirmed
//     matches (exact SKU, learned alias, or manual confirmation)
//     move an estimate; likely + needs-review stay in the review
//     queue until Shane confirms them.
//   - New tables only (item_prices, price_tiers, purchase_history,
//     receipt_aliases, pricing_meta); items/flags/audit_log
//     untouched. See the SHOPPING COST INTELLIGENCE section below.
//
// EARLIER IN v1.5
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
        return json({ ok: true, service: 'tab-supplies', version: '2.1.1' });
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
      if (path === '/receipts' && method === 'GET') {
        if (!role) return Response.redirect(new URL('/login', request.url).toString(), 302);
        if (role !== 'shane') return forbiddenPage();
        return await receiptsReviewPage(env);
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

      // ── Cost intelligence APIs ──
      // Save / lock / unlock an item's estimate (Shane only).
      if (path === '/api/price/save' && method === 'POST') {
        if (role !== 'shane') return json({ error: 'forbidden' }, 403);
        return await apiPriceSave(request, env);
      }
      // Save / clear a per-vendor shipping estimate (Shane only).
      if (path === '/api/shipping/save' && method === 'POST') {
        if (role !== 'shane') return json({ error: 'forbidden' }, 403);
        return await apiShippingSave(request, env);
      }
      // Ingest finalized receipt lines from TabReady (token-guarded; no cookie needed).
      if (path === '/api/receipt-ingest' && method === 'POST') {
        return await apiReceiptIngest(request, env);
      }
      // Confirm / reject a receipt match, optionally learning a vendor alias (Shane only).
      if (path === '/api/receipt-match' && method === 'POST') {
        if (role !== 'shane') return json({ error: 'forbidden' }, 403);
        return await apiReceiptMatch(request, env);
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
    `SELECT f.id as flag_id, f.quantity, f.bought_by, i.name as item_name, i.unit, i.vendor
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

  // Optional: record the actual paid price as a confirmed purchase so the next
  // estimate improves. Keyed to this flag so re-marking won't duplicate; a later
  // TabReady receipt for the same buy will supersede it (source stays 'manual').
  const actualCents = parseInt(body.actual_cents, 10);
  if (Number.isFinite(actualCents) && actualCents > 0 && finalBought > 0) {
    try {
      await ensurePricingSchema(env);
      const manualRef = 'manual:' + flag.flag_id;
      const unitCents = Math.round(actualCents / finalBought);
      await env.DB.prepare(`DELETE FROM purchase_history WHERE receipt_id = ?`).bind(manualRef).run();
      await env.DB.prepare(
        `INSERT INTO purchase_history
          (id, item_id, receipt_id, receipt_line_id, original_desc, normalized_desc, vendor,
           purchase_date, quantity, unit_of_measure, gross_cents, net_cents, unit_price_cents,
           match_confidence, match_method, confirmed, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), ?, ?, ?, ?, ?, 'confirmed', 'manual', 1, 'manual')`
      ).bind(crypto.randomUUID(), itemId, manualRef, flag.flag_id, flag.item_name,
        normDesc(flag.item_name), flag.vendor, finalBought, flag.unit, actualCents, actualCents, unitCents).run();
      await logAction(env, 'price_actual_recorded', role, 'item', itemId, {
        item_name: flag.item_name, bought_quantity: finalBought, actual_cents: actualCents, unit_price_cents: unitCents
      });
    } catch (err) { console.error('actual price record failed:', err); }
  }

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
  /* ── Cost intelligence ── */
  .trip-card {
    background: var(--bg-primary); border: 1px solid var(--border-tertiary);
    border-radius: 12px; padding: 14px 16px; margin-bottom: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  .trip-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .trip-label { font-size: 12px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }
  .trip-total { font-size: 30px; font-weight: 800; color: var(--brown); line-height: 1.1; margin-top: 2px; }
  .trip-sub { font-size: 12px; color: var(--text-secondary); margin-top: 3px; }
  .trip-unknown { font-size: 12px; color: #92400e; margin-top: 4px; font-weight: 600; }
  .trip-shipping { font-size: 12px; color: var(--text-secondary); margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-tertiary); }
  .adjust-btn {
    background: var(--bg-secondary); color: var(--cross); border: 1px solid var(--border-tertiary);
    padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.4px; cursor: pointer; font-family: inherit; flex-shrink: 0;
  }
  .store-toggle {
    background: none; border: none; color: var(--cross); font-weight: 700; font-size: 13px;
    cursor: pointer; font-family: inherit; padding: 8px 0 0; margin-top: 4px;
  }
  .store-subtotals { margin-top: 6px; border-top: 1px solid var(--border-tertiary); padding-top: 6px; }
  .store-line { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-secondary); padding: 4px 0; }
  .store-line .store-amt { font-weight: 700; color: var(--text-primary); }
  .est-line {
    font-size: 13px; margin-top: 4px; cursor: pointer; display: inline-block;
    padding: 2px 6px; border-radius: 5px; line-height: 1.35;
  }
  .est-line .est-line-total { font-weight: 700; }
  .est-line.src-actual { background: #d1fae5; color: #065f46; }
  .est-line.src-confirmed { background: #e0e7ff; color: #3730a3; }
  .est-line.src-web { background: #fef3c7; color: #92400e; }
  .est-line.src-est { background: var(--bg-secondary); color: var(--text-secondary); }
  .est-line.src-none { background: #fee2e2; color: #991b1b; font-style: italic; }
  .est-line.src-unknown { background: var(--bg-secondary); color: var(--text-tertiary); }
  .detail-toggle { text-decoration: underline; cursor: pointer; }
  .price-detail {
    margin-top: 8px; background: var(--bg-secondary); border-radius: 8px;
    padding: 8px 10px; font-size: 12px; color: var(--text-secondary);
  }
  .pd-row { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
  .pd-row span:last-child { font-weight: 600; color: var(--text-primary); text-align: right; }
  .pd-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-tertiary); font-weight: 700; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border-tertiary); }
  .pd-actions { display: flex; gap: 8px; margin-top: 10px; }
  .pd-btn {
    flex: 1; background: white; border: 1px solid var(--border-tertiary); color: var(--cross);
    padding: 8px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit;
  }
  .modal input[type=number] {
    width: 100%; padding: 12px; font-size: 15px;
    border: 1px solid var(--border-tertiary); border-radius: 8px; font-family: inherit; box-sizing: border-box;
  }
  .adjust-line { font-size: 13px; color: var(--text-secondary); margin: 6px 0; display: flex; justify-content: space-between; }
  .adjust-line strong { color: var(--brown); }
  /* Shipping row inside a vendor section */
  .ship-row {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 12px 16px; background: var(--bg-secondary);
    border-top: 1px dashed var(--border-tertiary);
  }
  .ship-main { min-width: 0; }
  .ship-label { font-size: 13px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.4px; }
  .ship-val { font-size: 15px; font-weight: 700; color: var(--brown); margin-top: 2px; }
  .ship-val.ship-none { color: var(--text-tertiary); font-weight: 600; font-style: italic; }
  .ship-btn {
    background: white; border: 1px solid var(--cross); color: var(--cross);
    padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.4px; cursor: pointer; font-family: inherit; flex-shrink: 0;
  }
  /* Bottom order summary — reads as the final calculation */
  .order-summary {
    background: var(--bg-primary); border: 1px solid var(--cross);
    border-radius: 12px; padding: 16px; margin-top: 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  .order-summary-title {
    font-size: 12px; color: var(--text-tertiary); text-transform: uppercase;
    letter-spacing: 0.8px; font-weight: 700; margin-bottom: 10px;
  }
  .sum-line { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 6px 0; font-size: 15px; color: var(--text-secondary); }
  .sum-line .sum-amt { font-weight: 700; color: var(--text-primary); }
  .sum-amt.sum-none { color: var(--text-tertiary); font-weight: 600; font-style: italic; }
  .sum-total-row {
    display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
    margin-top: 8px; padding-top: 10px; border-top: 2px solid var(--cross);
    font-size: 16px; font-weight: 700; color: var(--brown);
  }
  .sum-total { font-size: 24px; font-weight: 800; }
  .sum-pending { font-size: 13px; color: #92400e; margin-top: 8px; line-height: 1.4; }
  .sum-pending strong { color: var(--brown); }
  .sum-unknown { font-size: 12px; color: #92400e; margin-top: 6px; }
  .order-tax-note { font-size: 11px; color: var(--text-tertiary); margin-top: 8px; letter-spacing: 0.3px; }
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
      <a href="/receipts" class="${currentPath === '/receipts' ? 'active' : ''}">Receipts</a>
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
const SHOP_VENDOR_ORDER = [
  { key: 'Amazon', color: '#5a3220', textColor: COLORS.cream, tag: 'Online' },
  { key: 'Webstaurant', color: COLORS.brown, textColor: COLORS.cream, tag: 'Order online' },
  { key: 'Publix', color: '#1d9e75', textColor: '#fff', tag: 'Fresh / Weekly' },
  { key: "Sam's Club", color: COLORS.equip, textColor: '#fff', tag: 'Bulk · kitchen' },
  { key: "BJ's", color: COLORS.send, textColor: '#0c447c', tag: 'Bulk' },
  { key: 'Flexible', color: '#8b6e47', textColor: '#fff', tag: 'Sam\'s / BJ\'s / Amazon' },
  { key: 'Restaurant Depot', color: '#854f0b', textColor: '#fff', tag: 'Foodservice' },
  { key: 'Confirm', color: '#efbb27', textColor: '#4a3804', tag: 'Vendor TBD' },
];

async function shanePage(env) {
  await ensurePricingSchema(env);
  // Acknowledge all open flags as part of loading this page (background)
  await env.DB.prepare(
    `UPDATE flags SET acknowledged_at = datetime('now') WHERE resolved_at IS NULL AND acknowledged_at IS NULL`
  ).run();

  const res = await env.DB.prepare(`
    SELECT f.id as flag_id, f.item_id, f.note, f.quantity, f.flagged_by, f.flagged_at, f.bought_by, f.bought_quantity,
           i.name, i.vendor, i.unit, i.notes as item_notes, i.amazon_url, i.brand, i.lane, i.category
    FROM flags f JOIN items i ON i.id = f.item_id
    WHERE f.resolved_at IS NULL
    ORDER BY i.vendor, i.category, i.name
  `).all();
  const flags = res.results || [];

  // Load pricing + resolve an estimate and line total for every flagged item.
  const pricing = await loadPricingForItems(env, flags.map(f => f.item_id));
  let tripCents = 0, tripExact = true, tripHasAny = false, unknownCount = 0;
  const storeAgg = {}; // store -> { cents, exact, hasAny }
  for (const f of flags) {
    f._est = resolveItemEstimate({ id: f.item_id, vendor: f.vendor, unit: f.unit }, pricing);
    f._line = computeLine(f._est, f.quantity, f.vendor, pricing.tiers.get(f.item_id));
    if (f.bought_by) continue; // bought items no longer contribute to the active subtotal
    const store = f.vendor || 'Other';
    storeAgg[store] = storeAgg[store] || { cents: 0, exact: true, hasAny: false };
    if (!f._line.hasEstimate) { unknownCount++; continue; }
    tripCents += f._line.lineCents; tripHasAny = true;
    if (!f._line.isExact) tripExact = false;
    storeAgg[store].cents += f._line.lineCents; storeAgg[store].hasAny = true;
    if (!f._line.isExact) storeAgg[store].exact = false;
  }

  // Group rows by vendor (unchanged behavior).
  const byVendor = {};
  for (const f of flags) {
    const v = f.vendor || 'Unknown';
    if (!byVendor[v]) byVendor[v] = [];
    byVendor[v].push(f);
  }
  const VENDOR_ORDER = SHOP_VENDOR_ORDER;

  const totalCount = flags.length;
  const activeCount = flags.filter(f => !f.bought_by).length;

  // Editable per-vendor shipping + order-total roll-up (shipping folded in).
  const shipMap = await loadShippingEstimates(env);
  const activeShippingVendors = SHIPPING_VENDORS.filter(v => (byVendor[v] || []).some(f => !f.bought_by));
  const summary = computeOrderSummary(tripCents, tripExact, activeShippingVendors, shipMap);

  // ── Top: overview only (item count, vendors, instructions, receipts link) ──
  const banner = totalCount === 0
    ? `<div style="background:#d1fae5;color:#065f46;padding:18px;border-radius:10px;margin-bottom:14px;font-size:15px;text-align:center">
         <strong>All clear.</strong> No items flagged from any team right now.
       </div>`
    : `<div style="background:#faf3e6;border:1px solid ${COLORS.equip};border-radius:10px;padding:14px;margin-bottom:12px;font-size:14px;color:#5a3220">
         <strong id="active-count-line">${activeCount} item${activeCount === 1 ? '' : 's'}</strong> to buy across ${Object.keys(byVendor).length} vendor${Object.keys(byVendor).length === 1 ? '' : 's'}.
         Tap a price to adjust it, or the green checkbox as you buy. The estimated total is at the bottom.
       </div>`;

  // Vendor sections; shipping-capable vendors get an editable shipping row.
  const renderVendor = (key, color, textColor, tag, items) => {
    const rows = items.map(f => shopRow(f, pricing)).join('');
    const ship = (SHIPPING_VENDORS.includes(key) && items.some(f => !f.bought_by))
      ? shippingRow(key, shipMap[key]) : '';
    return `
      <div class="vendor-card">
        <div class="vendor-header" style="background:${color};color:${textColor}">
          <span class="vendor-name">${escapeHtml(key)}</span>
          <span class="vendor-meta">${escapeHtml(tag ? tag + ' · ' : '')}${items.length}</span>
        </div>
        <div>${rows}${ship}</div>
      </div>`;
  };

  const vendorBlocks = VENDOR_ORDER.map(v => {
    const items = byVendor[v.key] || [];
    if (items.length === 0) return '';
    return renderVendor(v.key, v.color, v.textColor, v.tag, items);
  }).join('');

  const knownVendors = new Set(VENDOR_ORDER.map(v => v.key));
  const otherBlock = Object.keys(byVendor).filter(v => !knownVendors.has(v))
    .map(v => renderVendor(v || 'Unknown', COLORS.textTertiary, 'white', '', byVendor[v])).join('');

  // ── Bottom: the complete cost calculation (the conclusion of the list) ──
  const summaryCard = totalCount === 0 ? '' : renderOrderSummary(summary, storeAgg, unknownCount, shipMap, activeShippingVendors);

  const body = `
    <div class="page">
      <div class="page-header">
        <div class="page-tag">Shane · Shopping Review</div>
        <p class="page-sub">Products first · complete total at the bottom. <a href="/receipts" style="color:${COLORS.cross};font-weight:700;text-decoration:none">Receipt matches →</a></p>
      </div>
      ${banner}
      ${vendorBlocks}
      ${otherBlock}
      ${summaryCard}
      <p style="text-align:center;color:${COLORS.textTertiary};font-size:13px;margin-top:20px">
        Tap a price line to adjust an estimate. Tap the green checkbox when bought — you can record the actual price.
      </p>
    </div>
    ${boughtModalHtml()}
    ${adjustModalHtml()}
    ${shippingModalHtml()}
    <script>${pricingClientLib()}</script>
    ${shopScript()}
  `;
  return pageShell('Shopping Review', 'shane', body, '/shane');
}

// Editable shipping row inside a shipping-capable vendor section.
function shippingRow(store, cents) {
  const has = cents != null;
  return `
    <div class="ship-row" data-ship-store="${escapeHtml(store)}" data-ship-cents="${has ? cents : ''}">
      <div class="ship-main">
        <div class="ship-label">${escapeHtml(store)} shipping</div>
        <div class="ship-val${has ? '' : ' ship-none'}">${has ? fmtMoney(cents, true) : 'Not entered'}</div>
      </div>
      <button type="button" class="ship-btn" data-ship-edit="${escapeHtml(store)}">${has ? 'Edit' : 'Add estimate'}</button>
    </div>`;
}

// Bottom financial summary: items subtotal → shipping → complete order total.
function renderOrderSummary(summary, storeAgg, unknownCount, shipMap, activeShippingVendors) {
  const lines = [];
  lines.push(`<div class="sum-line"><span>Items subtotal</span><span class="sum-amt" id="sum-items">${summary.itemsCents ? fmtMoney(summary.itemsCents, summary.exact) : '—'}</span></div>`);

  if (activeShippingVendors.includes('Webstaurant')) {
    const c = shipMap['Webstaurant'];
    lines.push(`<div class="sum-line"><span>Webstaurant shipping</span><span class="sum-amt${c == null ? ' sum-none' : ''}" id="sum-ws-ship">${c == null ? 'Not entered' : fmtMoney(c, true)}</span></div>`);
  }
  let otherKnown = 0, otherHas = false;
  for (const v of activeShippingVendors) { if (v !== 'Webstaurant' && shipMap[v] != null) { otherKnown += shipMap[v]; otherHas = true; } }
  lines.push(`<div class="sum-line" id="sum-other-wrap" style="${otherHas ? '' : 'display:none'}"><span>Other known shipping</span><span class="sum-amt" id="sum-other-ship">${otherHas ? fmtMoney(otherKnown, true) : ''}</span></div>`);

  const totalDisplay = summary.pending ? 'Pending' : ((summary.itemsCents || summary.knownShipping) ? fmtMoney(summary.total, summary.exact) : '—');
  const totalRow = `<div class="sum-total-row"><span>Estimated order total</span><span class="sum-total" id="sum-total">${totalDisplay}</span></div>`;
  const pendingNote = `<div class="sum-pending" id="sum-pending" style="${summary.pending ? '' : 'display:none'}">
      Known item subtotal <strong id="sum-known">${fmtMoney(summary.total, summary.exact)}</strong> · <span id="sum-pending-msg">final estimate pending ${escapeHtml(summary.missing.join(' & '))} shipping</span>
    </div>`;
  const unknownNote = `<div class="sum-unknown" id="sum-unknown" style="${unknownCount ? '' : 'display:none'}">Plus <span id="unknown-count">${unknownCount}</span> item${unknownCount === 1 ? '' : 's'} without an estimate — not in the total yet.</div>`;

  return `
    <div class="order-summary" id="order-summary">
      <div class="order-summary-title">Estimated order</div>
      ${lines.join('')}
      ${totalRow}
      ${pendingNote}
      ${unknownNote}
      <div class="order-tax-note">Tax-exempt — no sales tax added.</div>
      <button type="button" class="store-toggle" id="store-toggle">▸ Per-store subtotals</button>
      <div id="store-subtotals" class="store-subtotals" style="display:none">${renderStoreSubtotals(storeAgg)}</div>
    </div>`;
}

function renderStoreSubtotals(storeAgg) {
  const order = SHOP_VENDOR_ORDER.map(v => v.key);
  const keys = Object.keys(storeAgg).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  if (!keys.length) return `<div class="store-line" style="color:${COLORS.textTertiary}">No estimated items yet.</div>`;
  return keys.map(k => {
    const a = storeAgg[k];
    const val = a.hasAny ? fmtMoney(a.cents, a.exact) : '—';
    return `<div class="store-line"><span>${escapeHtml(k)}</span><span class="store-amt">${val}</span></div>`;
  }).join('');
}

// One shopping row: name + estimate line (tap to adjust) + qty badge.
function shopRow(f, pricing) {
  const est = f._est, line = f._line;
  const amazonLink = f.amazon_url
    ? `<a href="${escapeHtml(f.amazon_url)}" target="_blank" rel="noopener" style="font-size:11px;color:${COLORS.cross};text-decoration:none;letter-spacing:0.4px;text-transform:uppercase;font-weight:700;display:inline-block;margin-top:4px">Amazon ↗</a>`
    : '';
  const brandLine = f.brand
    ? `<div style="font-size:12px;color:${COLORS.textTertiary};margin-top:2px">${escapeHtml(f.brand)}${f.item_notes ? ' · ' + escapeHtml(f.item_notes) : ''}</div>`
    : (f.item_notes ? `<div style="font-size:12px;color:${COLORS.textTertiary};margin-top:2px">${escapeHtml(f.item_notes)}</div>` : '');
  const noteLine = f.note
    ? `<div style="font-size:12px;color:${COLORS.textSecondary};margin-top:4px;font-style:italic">📝 ${escapeHtml(f.note)}</div>`
    : '';

  // Compact estimate line — the heart of the cost display.
  const unitLabel = (est.unitOfMeasure || f.unit || 'unit');
  const bits = [];
  if (line.hasEstimate) {
    bits.push(`Est. <span class="est-line-total">${fmtMoney(line.lineCents, line.isExact)}</span>`);
    bits.push(`${f.quantity} ${escapeHtml(unitLabel)}${f.quantity == 1 ? '' : 's'}`);
    if (line.tierApplied) bits.push('Bulk pricing');
    if (est.sourceLabel) bits.push(escapeHtml(est.sourceLabel));
  }
  const sourceClass = { actual: 'src-actual', confirmed: 'src-confirmed', web: 'src-web', estimated: 'src-est' }[est.sourceType] || 'src-unknown';
  const estLine = line.hasEstimate
    ? `<div class="est-line ${sourceClass}" data-open-adjust="1">${bits.join(' · ')}</div>`
    : `<div class="est-line src-none" data-open-adjust="1">No estimate yet · tap to add</div>`;

  // Tier data for instant client recompute.
  const tiers = (pricing.tiers.get(f.item_id) || [])
    .filter(t => !t.store || normStore(t.store) === normStore(f.vendor))
    .map(t => [t.min_qty, t.price_cents]);
  const detail = shopRowDetail(f, pricing);

  return `
    <div class="shop-row" data-item-id="${escapeHtml(f.item_id)}"
         data-item-name="${escapeHtml(f.name)}"
         data-unit="${escapeHtml(unitLabel)}"
         data-flagged-qty="${f.quantity}"
         data-store="${escapeHtml(f.vendor || 'Other')}"
         data-bought="${f.bought_by ? '1' : '0'}"
         data-included="1"
         data-has-est="${line.hasEstimate ? '1' : '0'}"
         data-exact="${line.isExact ? '1' : '0'}"
         data-base-cents="${est.packageCents == null ? '' : est.packageCents}"
         data-line-cents="${line.lineCents == null ? '' : line.lineCents}"
         data-tiers='${escapeHtml(JSON.stringify(tiers))}'>
      <input type="checkbox" data-mark-bought="${escapeHtml(f.item_id)}"
             style="width:24px;height:24px;accent-color:#065f46;margin-top:4px;cursor:pointer;flex-shrink:0"${f.bought_by ? ' checked disabled' : ''}>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1">
            <div style="font-size:15px;color:${COLORS.textPrimary};font-weight:500">${escapeHtml(f.name)}${f.bought_by ? ` <span style="font-size:11px;color:#065f46;font-weight:700">✓ ${escapeHtml(f.bought_by)}</span>` : ''}</div>
            ${brandLine}
            ${estLine}
            ${noteLine}
            <div style="font-size:11px;color:${COLORS.textTertiary};margin-top:4px;text-transform:uppercase;letter-spacing:0.4px">
              From ${escapeHtml(f.flagged_by)} · ${escapeHtml(timeAgo(f.flagged_at))} · <span class="detail-toggle" data-toggle-detail="1">price details</span>
            </div>
            ${amazonLink}
            ${detail}
          </div>
          <div class="qty-badge" style="background:#ca8342">${formatUnit(f.quantity, f.unit)}</div>
        </div>
      </div>
    </div>
  `;
}

// Expandable price detail: source, package, store prices, purchase history.
function shopRowDetail(f, pricing) {
  const est = f._est;
  const prices = pricing.prices.get(f.item_id) || [];
  const purchases = pricing.purchases.get(f.item_id) || [];
  const rows = [];
  rows.push(`<div class="pd-row"><span>Preferred estimate</span><span>${est.hasEstimate ? fmtMoney(est.packageCents, est.isExact) + ' / ' + escapeHtml(est.unitOfMeasure || 'unit') : '—'}</span></div>`);
  rows.push(`<div class="pd-row"><span>Source</span><span>${escapeHtml(est.sourceLabel || 'None')}${est.locked ? ' 🔒' : ''}</span></div>`);
  if (est.packageDesc) rows.push(`<div class="pd-row"><span>Package</span><span>${escapeHtml(est.packageDesc)}</span></div>`);
  const storePrices = prices.filter(p => p.store);
  if (storePrices.length) {
    rows.push(`<div class="pd-head">Store prices</div>`);
    for (const p of storePrices) rows.push(`<div class="pd-row"><span>${escapeHtml(p.store)}</span><span>${fmtMoney(p.price_cents, p.is_exact)}${p.sku ? ' · ' + escapeHtml(p.sku) : ''}</span></div>`);
  }
  if (purchases.length) {
    rows.push(`<div class="pd-head">Recent purchases</div>`);
    for (const p of purchases.slice(0, 5)) {
      rows.push(`<div class="pd-row"><span>${escapeHtml((p.purchase_date || '').slice(0, 10))} · ${escapeHtml(p.vendor || '')}</span><span>${fmtMoney(p.unit_price_cents, true)}</span></div>`);
    }
  } else {
    rows.push(`<div class="pd-row" style="color:${COLORS.textTertiary}"><span>No actual purchases recorded yet</span><span></span></div>`);
  }
  const locked = prices.find(p => p.manual_locked);
  rows.push(`<div class="pd-actions">
    <button type="button" class="pd-btn" data-adjust-here="1">Edit estimate</button>
    <button type="button" class="pd-btn" data-lock-toggle="${locked ? 'unlock' : 'lock'}">${locked ? 'Remove lock' : 'Lock price'}</button>
  </div>`);
  return `<div class="price-detail" style="display:none">${rows.join('')}</div>`;
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
        <p class="modal-sub">This updates the burn-rate and pricing data over time.</p>
        <div class="qty-stepper">
          <button type="button" class="qty-btn" id="bought-minus">−</button>
          <div>
            <div class="qty-display" id="bought-display">0</div>
            <div class="qty-unit" id="bought-unit"></div>
          </div>
          <button type="button" class="qty-btn" id="bought-plus">+</button>
        </div>
        <label class="modal-field-label">Actual total paid (optional)</label>
        <input type="number" id="bought-price" inputmode="decimal" step="0.01" min="0" placeholder="e.g. 252.45">
        <p style="font-size:12px;color:var(--text-tertiary);margin:6px 0 0">Recording the real price makes next time's estimate more accurate. Leave blank if you don't have it — a TabReady receipt can fill it in later.</p>
        <div class="modal-actions">
          <button type="button" class="btn-primary" id="bought-save">Mark Bought</button>
          <button type="button" class="btn-secondary" id="bought-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function adjustModalHtml() {
  return `
    <div id="adjust-modal" class="modal-backdrop" role="dialog" aria-hidden="true">
      <div class="modal">
        <h3 id="adjust-title" class="modal-title">Adjust estimate</h3>
        <p class="modal-sub" id="adjust-store"></p>
        <label class="modal-field-label">Quantity</label>
        <input type="number" id="adjust-qty" inputmode="numeric" step="1" min="0">
        <label class="modal-field-label">Estimated price per <span id="adjust-uom">unit</span> ($)</label>
        <input type="number" id="adjust-unit" inputmode="decimal" step="0.01" min="0">
        <label class="modal-field-label" style="margin-top:10px"><input type="checkbox" id="adjust-exact" style="width:auto;margin-right:6px">This is an exact / verified price (show cents)</label>
        <label class="modal-field-label"><input type="checkbox" id="adjust-include" checked style="width:auto;margin-right:6px">Include in this trip's subtotal</label>
        <label class="modal-field-label">Note (optional)</label>
        <input type="text" id="adjust-note" placeholder="e.g. price checked on BJ's site">
        <div class="adjust-line">Line total <strong id="adjust-linetotal">—</strong></div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="adjust-trip">Use for this trip only</button>
          <button type="button" class="btn-primary" id="adjust-save">Save as new estimate</button>
        </div>
        <div class="modal-actions" style="margin-top:8px">
          <button type="button" class="btn-secondary" id="adjust-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function shippingModalHtml() {
  return `
    <div id="ship-modal" class="modal-backdrop" role="dialog" aria-hidden="true">
      <div class="modal">
        <h3 id="ship-title" class="modal-title">Shipping estimate</h3>
        <p class="modal-sub" id="ship-sub">Shipping is part of the real cost — enter it so the order total is complete.</p>
        <label class="modal-field-label">Shipping cost ($)</label>
        <input type="number" id="ship-input" inputmode="decimal" step="0.01" min="0" placeholder="e.g. 89.00">
        <div class="modal-actions">
          <button type="button" class="btn-primary" id="ship-save">Save shipping</button>
          <button type="button" class="btn-danger" id="ship-clear">Clear</button>
        </div>
        <div class="modal-actions" style="margin-top:8px">
          <button type="button" class="btn-secondary" id="ship-cancel">Cancel</button>
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
        function toast(msg, isError) {
          const b = document.getElementById('save-banner');
          b.textContent = msg;
          b.classList.toggle('error', !!isError);
          b.classList.add('show');
          setTimeout(() => b.classList.remove('show'), 2000);
        }
        function pluralize(qty, unit) {
          if (!unit) return String(qty);
          if (unit === 'each') return unit;
          if (qty === 1) return unit;
          if (unit === 'box') return 'boxes';
          return unit + 's';
        }

        // ── Live recompute of the bottom order summary (items + shipping) ──
        function recompute() {
          let items = 0, exact = true, unknown = 0, active = 0;
          const stores = {};
          document.querySelectorAll('.shop-row').forEach(row => {
            if (row.getAttribute('data-bought') === '1') return;
            active++;
            const included = row.getAttribute('data-included') !== '0';
            const hasEst = row.getAttribute('data-has-est') === '1';
            if (!hasEst) { if (included) unknown++; return; }
            if (!included) return;
            const lc = parseInt(row.getAttribute('data-line-cents'), 10);
            if (!Number.isFinite(lc)) { unknown++; return; }
            const isExact = row.getAttribute('data-exact') === '1';
            const store = row.getAttribute('data-store') || 'Other';
            items += lc; if (!isExact) exact = false;
            stores[store] = stores[store] || { cents: 0, exact: true };
            stores[store].cents += lc; if (!isExact) stores[store].exact = false;
          });

          // Shipping from the per-vendor ship rows (present only for active shipping vendors).
          let knownShip = 0, wsCents = null, otherKnown = 0, otherHas = false;
          const missing = [];
          document.querySelectorAll('[data-ship-store]').forEach(el => {
            const store = el.getAttribute('data-ship-store');
            const raw = el.getAttribute('data-ship-cents');
            const c = (raw === '' || raw == null) ? null : parseInt(raw, 10);
            if (c == null) missing.push(store); else knownShip += c;
            if (store === 'Webstaurant') wsCents = c;
            else if (c != null) { otherKnown += c; otherHas = true; }
          });
          const pending = missing.length > 0;
          const total = items + knownShip;

          const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
          set('active-count-line', active + ' item' + (active === 1 ? '' : 's'));
          set('sum-items', items ? window.TSCost.fmt(items, exact) : '—');
          const wsEl = document.getElementById('sum-ws-ship');
          if (wsEl) { wsEl.textContent = wsCents == null ? 'Not entered' : window.TSCost.fmt(wsCents, true); wsEl.classList.toggle('sum-none', wsCents == null); }
          const ow = document.getElementById('sum-other-wrap');
          if (ow) { ow.style.display = otherHas ? '' : 'none'; set('sum-other-ship', otherHas ? window.TSCost.fmt(otherKnown, true) : ''); }
          set('sum-total', pending ? 'Pending' : ((items || knownShip) ? window.TSCost.fmt(total, exact) : '—'));
          const pd = document.getElementById('sum-pending');
          if (pd) {
            pd.style.display = pending ? '' : 'none';
            if (pending) { set('sum-known', window.TSCost.fmt(total, exact)); set('sum-pending-msg', 'final estimate pending ' + missing.join(' & ') + ' shipping'); }
          }
          const uw = document.getElementById('sum-unknown');
          if (uw) { uw.style.display = unknown ? '' : 'none'; set('unknown-count', String(unknown)); }

          // Per-store subtotals
          const order = ['Amazon','Webstaurant','Publix',"Sam's Club","BJ's",'Flexible','Restaurant Depot','Confirm'];
          const keys = Object.keys(stores).sort((a,b) => (order.indexOf(a)+1||99) - (order.indexOf(b)+1||99));
          const ss = document.getElementById('store-subtotals');
          if (ss) ss.innerHTML = keys.length ? keys.map(k =>
            '<div class="store-line"><span>' + k + '</span><span class="store-amt">' + window.TSCost.fmt(stores[k].cents, stores[k].exact) + '</span></div>'
          ).join('') : '<div class="store-line">No estimated items yet.</div>';
        }
        const storeBtn = document.getElementById('store-toggle');
        if (storeBtn) storeBtn.addEventListener('click', () => {
          const ss = document.getElementById('store-subtotals');
          const open = ss.style.display !== 'none';
          ss.style.display = open ? 'none' : 'block';
          storeBtn.textContent = (open ? '▸' : '▾') + ' Per-store subtotals';
        });

        // ── Shipping estimate editor ──
        const shipModal = document.getElementById('ship-modal');
        const shipInput = document.getElementById('ship-input');
        const shipTitle = document.getElementById('ship-title');
        let shipStore = null;
        function shipRowFor(store) {
          const sel = (window.CSS && CSS.escape) ? CSS.escape(store) : store.replace(/"/g, '\\\\"');
          return document.querySelector('[data-ship-store="' + sel + '"]');
        }
        function openShip(store) {
          shipStore = store;
          if (shipTitle) shipTitle.textContent = store + ' shipping';
          const row = shipRowFor(store);
          const raw = row ? row.getAttribute('data-ship-cents') : '';
          shipInput.value = (raw === '' || raw == null) ? '' : (parseInt(raw, 10) / 100).toFixed(2);
          shipModal.classList.add('show');
          setTimeout(() => shipInput.focus(), 80);
        }
        async function saveShip(cents) {
          try {
            const r = await fetch('/api/shipping/save', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ store: shipStore, cents: cents })
            });
            if (!r.ok) { toast('Could not save shipping.', true); return; }
            const row = shipRowFor(shipStore);
            if (row) {
              row.setAttribute('data-ship-cents', cents == null ? '' : cents);
              const val = row.querySelector('.ship-val');
              const btn = row.querySelector('.ship-btn');
              if (val) { val.textContent = cents == null ? 'Not entered' : window.TSCost.fmt(cents, true); val.classList.toggle('ship-none', cents == null); }
              if (btn) btn.textContent = cents == null ? 'Add estimate' : 'Edit';
            }
            shipModal.classList.remove('show');
            toast(cents == null ? '✓ Shipping cleared' : '✓ Shipping saved');
            recompute();
          } catch (e) { toast('Network issue.', true); }
        }
        document.querySelectorAll('[data-ship-edit]').forEach(btn => {
          btn.addEventListener('click', () => openShip(btn.getAttribute('data-ship-edit')));
        });
        if (shipModal) {
          document.getElementById('ship-save').addEventListener('click', () => {
            const dollars = parseFloat(shipInput.value);
            if (!Number.isFinite(dollars) || dollars < 0) { toast('Enter a shipping amount.', true); return; }
            saveShip(Math.round(dollars * 100));
          });
          document.getElementById('ship-clear').addEventListener('click', () => saveShip(null));
          document.getElementById('ship-cancel').addEventListener('click', () => shipModal.classList.remove('show'));
          shipModal.addEventListener('click', (e) => { if (e.target === shipModal) shipModal.classList.remove('show'); });
        }

        // ── Price detail expand / collapse ──
        document.querySelectorAll('[data-toggle-detail]').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const pd = el.closest('.shop-row').querySelector('.price-detail');
            if (pd) pd.style.display = pd.style.display === 'none' ? 'block' : 'none';
          });
        });

        // ── Lock / unlock manual price ──
        document.querySelectorAll('[data-lock-toggle]').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const row = btn.closest('.shop-row');
            const mode = btn.getAttribute('data-lock-toggle');
            btn.disabled = true;
            try {
              const r = await fetch('/api/price/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: row.getAttribute('data-item-id'), lock: mode === 'lock' ? 1 : 0 })
              });
              if (r.ok) { toast(mode === 'lock' ? '✓ Price locked' : '✓ Lock removed'); setTimeout(() => location.reload(), 500); }
              else toast('Could not update.', true);
            } catch (err) { toast('Network issue.', true); }
            finally { btn.disabled = false; }
          });
        });

        // ── Adjust estimate calculator ──
        const aModal = document.getElementById('adjust-modal');
        const aQty = document.getElementById('adjust-qty');
        const aUnit = document.getElementById('adjust-unit');
        const aExact = document.getElementById('adjust-exact');
        const aInclude = document.getElementById('adjust-include');
        const aNote = document.getElementById('adjust-note');
        const aUom = document.getElementById('adjust-uom');
        const aStore = document.getElementById('adjust-store');
        const aTitle = document.getElementById('adjust-title');
        const aTotal = document.getElementById('adjust-linetotal');
        let aRow = null, aTiers = [];

        function aLineCents() {
          const q = parseInt(aQty.value, 10) || 0;
          const dollars = parseFloat(aUnit.value);
          if (!Number.isFinite(dollars)) return null;
          const base = Math.round(dollars * 100);
          return window.TSCost.lineCents(base, aTiers, q);
        }
        function aRefresh() {
          const lc = aLineCents();
          aTotal.textContent = lc == null ? '—' : window.TSCost.fmt(lc, aExact.checked);
        }
        [aQty, aUnit, aExact].forEach(el => el.addEventListener('input', aRefresh));

        function openAdjust(row) {
          aRow = row;
          try { aTiers = JSON.parse(row.getAttribute('data-tiers') || '[]'); } catch (e) { aTiers = []; }
          aTitle.textContent = row.getAttribute('data-item-name');
          aStore.textContent = 'Store: ' + (row.getAttribute('data-store') || '—');
          aUom.textContent = row.getAttribute('data-unit') || 'unit';
          aQty.value = row.getAttribute('data-flagged-qty') || '0';
          const base = parseInt(row.getAttribute('data-base-cents'), 10);
          aUnit.value = Number.isFinite(base) ? (base / 100).toFixed(2) : '';
          aExact.checked = row.getAttribute('data-exact') === '1';
          aInclude.checked = row.getAttribute('data-included') !== '0';
          aNote.value = '';
          aRefresh();
          aModal.classList.add('show');
        }
        document.querySelectorAll('[data-open-adjust], [data-adjust-here]').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            openAdjust(el.closest('.shop-row'));
          });
        });
        const adjustHint = document.getElementById('open-adjust-hint');
        if (adjustHint) adjustHint.addEventListener('click', () => {
          const first = document.querySelector('.shop-row[data-bought="0"]');
          if (first) openAdjust(first); else toast('Nothing to adjust.');
        });

        // Apply to the row (client-side) and recompute — used by both actions.
        function applyToRow() {
          const lc = aLineCents();
          const base = Math.round((parseFloat(aUnit.value) || 0) * 100);
          aRow.setAttribute('data-base-cents', base);
          aRow.setAttribute('data-line-cents', lc == null ? '' : lc);
          aRow.setAttribute('data-has-est', lc == null ? '0' : '1');
          aRow.setAttribute('data-exact', aExact.checked ? '1' : '0');
          aRow.setAttribute('data-included', aInclude.checked ? '1' : '0');
          // Update the visible estimate line.
          const est = aRow.querySelector('.est-line');
          if (est && lc != null) {
            est.className = 'est-line ' + (aExact.checked ? 'src-confirmed' : 'src-est');
            est.innerHTML = 'Est. <span class="est-line-total">' + window.TSCost.fmt(lc, aExact.checked) + '</span> · ' +
              aQty.value + ' ' + pluralize(parseInt(aQty.value,10)||0, aRow.getAttribute('data-unit')) +
              (aInclude.checked ? '' : ' · excluded');
          }
          recompute();
        }
        document.getElementById('adjust-trip').addEventListener('click', () => {
          applyToRow(); aModal.classList.remove('show'); toast('✓ Applied to this trip');
        });
        document.getElementById('adjust-save').addEventListener('click', async () => {
          const dollars = parseFloat(aUnit.value);
          if (!Number.isFinite(dollars)) { toast('Enter a price.', true); return; }
          const btn = document.getElementById('adjust-save');
          btn.disabled = true; btn.textContent = 'Saving…';
          try {
            const r = await fetch('/api/price/save', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                item_id: aRow.getAttribute('data-item-id'),
                store: aRow.getAttribute('data-store'),
                price_cents: Math.round(dollars * 100),
                is_exact: aExact.checked ? 1 : 0,
                unit_of_measure: aRow.getAttribute('data-unit'),
                note: aNote.value.trim() || null
              })
            });
            if (r.ok) { applyToRow(); toast('✓ Estimate saved'); aModal.classList.remove('show'); setTimeout(() => location.reload(), 700); }
            else toast('Could not save.', true);
          } catch (e) { toast('Network issue.', true); }
          finally { btn.disabled = false; btn.textContent = 'Save as new estimate'; }
        });
        document.getElementById('adjust-cancel').addEventListener('click', () => aModal.classList.remove('show'));
        aModal.addEventListener('click', (e) => { if (e.target === aModal) aModal.classList.remove('show'); });

        // ── Mark bought (with optional actual price) ──
        const bModal = document.getElementById('bought-modal');
        const bTitle = document.getElementById('bought-modal-title');
        const bDisplay = document.getElementById('bought-display');
        const bUnit = document.getElementById('bought-unit');
        const bPrice = document.getElementById('bought-price');
        const bPlus = document.getElementById('bought-plus');
        const bMinus = document.getElementById('bought-minus');
        const bSave = document.getElementById('bought-save');
        const bCancel = document.getElementById('bought-cancel');
        let b = { itemId: null, qty: 0, unit: '', checkbox: null };

        function bUpdate() {
          bDisplay.textContent = b.qty;
          bUnit.textContent = b.qty === 0 ? (b.unit ? pluralize(2, b.unit) : '') : pluralize(b.qty, b.unit);
          bMinus.disabled = b.qty <= 0;
        }
        function bOpen(row, checkbox) {
          b.itemId = row.getAttribute('data-item-id');
          b.unit = row.getAttribute('data-unit') || '';
          b.qty = parseInt(row.getAttribute('data-flagged-qty'), 10) || 1;
          b.checkbox = checkbox;
          bTitle.textContent = 'How many ' + (b.unit ? pluralize(b.qty, b.unit) : '') + ' of ' + row.getAttribute('data-item-name') + '?';
          bPrice.value = '';
          bUpdate();
          bModal.classList.add('show');
        }
        function bClose() { bModal.classList.remove('show'); if (b.checkbox) b.checkbox.checked = false; }
        bPlus.addEventListener('click', () => { b.qty++; bUpdate(); });
        bMinus.addEventListener('click', () => { if (b.qty > 0) { b.qty--; bUpdate(); } });

        bSave.addEventListener('click', async () => {
          bSave.disabled = true; bSave.textContent = 'Saving…';
          const dollars = parseFloat(bPrice.value);
          const payload = { item_id: b.itemId, bought_quantity: b.qty };
          if (Number.isFinite(dollars) && dollars > 0) payload.actual_cents = Math.round(dollars * 100);
          try {
            const res = await fetch('/api/resolve', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            if (res.ok) {
              toast('✓ Marked bought (' + b.qty + ')' + (payload.actual_cents ? ' · price saved' : ''));
              bModal.classList.remove('show');
              setTimeout(() => window.location.reload(), 600);
            } else { if (b.checkbox) b.checkbox.checked = false; toast('Could not save.', true); }
          } catch (e) { if (b.checkbox) b.checkbox.checked = false; toast('Could not save. Check connection.', true); }
          finally { bSave.disabled = false; bSave.textContent = 'Mark Bought'; }
        });
        bCancel.addEventListener('click', bClose);
        bModal.addEventListener('click', (e) => { if (e.target === bModal) bClose(); });
        document.querySelectorAll('[data-mark-bought]').forEach(cb => {
          cb.addEventListener('change', (e) => {
            if (!e.target.checked || e.target.disabled) return;
            bOpen(e.target.closest('.shop-row'), e.target);
          });
        });

        recompute();
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
    flag_bought:   { label: 'Bought',      color: '#065f46', bg: '#d1fae5' },
    item_added:    { label: 'Item added',  color: '#1e3a8a', bg: '#dbeafe' },
    price_saved:   { label: 'Price set',   color: '#3730a3', bg: '#e0e7ff' },
    price_lock:    { label: 'Price lock',  color: '#3730a3', bg: '#e0e7ff' },
    price_actual_recorded: { label: 'Actual price', color: '#065f46', bg: '#d1fae5' },
    shipping_saved: { label: 'Shipping set', color: '#3730a3', bg: '#e0e7ff' },
    shipping_cleared: { label: 'Shipping cleared', color: '#5f5e5a', bg: '#f5f2ea' },
    receipt_ingested: { label: 'Receipt in', color: '#854f0b', bg: '#fde68a' },
    receipt_match_confirmed: { label: 'Match ✓', color: '#065f46', bg: '#d1fae5' },
    receipt_match_ignored: { label: 'Match ignored', color: '#5f5e5a', bg: '#f5f2ea' },
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

// ════════════════════════════════════════════════════════════
// SHOPPING COST INTELLIGENCE  (additive — v2.1)
// ────────────────────────────────────────────────────────────
// Adds a realistic estimated cost to the Shopping Review and the
// data foundation for a Plan → buy → receipt → learn → improve
// loop. Everything here is additive and reversible: it creates its
// own tables (never alters items/flags/audit_log) and links to —
// but never rewrites — finalized receipt history.
//
// Concepts kept deliberately separate (see handoff §24):
//   • canonical item      → the existing `items` row
//   • price observation   → `item_prices` (a store's current price)
//   • quantity tier       → `price_tiers`
//   • purchase record     → `purchase_history` (what was actually paid)
//   • learned alias       → `receipt_aliases`
// The "forecast estimate" shown for planning is COMPUTED from those
// at render time, so a current price never overwrites historical truth.
// ════════════════════════════════════════════════════════════

// How recent a store actual must be to be preferred over an average (days).
const ACTUAL_FRESH_DAYS = 120;
// Weighted-average window: newest purchases weigh most.
const AVG_WINDOW = 3;
const AVG_WEIGHTS = [3, 2, 1];
// A purchase this far from the running average is flagged as a potential outlier.
const OUTLIER_RATIO = 0.5; // ±50%

async function ensurePricingSchema(env) {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS item_prices (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      store TEXT,                    -- vendor/store; NULL/'' = general estimate
      package_desc TEXT,             -- e.g. "500/case"
      unit_of_measure TEXT,          -- case, gallon, lb, each, box…
      package_qty REAL,              -- count inside the package (e.g. 500)
      price_cents INTEGER,           -- price for ONE package
      is_exact INTEGER DEFAULT 0,    -- 1 = exact cents, 0 = round estimate
      source_type TEXT,              -- actual|confirmed|web|estimated|unknown
      source_url TEXT,
      date_verified TEXT,
      sku TEXT,
      brand TEXT,
      manual_locked INTEGER DEFAULT 0,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS price_tiers (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      store TEXT,
      min_qty INTEGER NOT NULL DEFAULT 1,   -- applies when requested qty >= min_qty
      price_cents INTEGER NOT NULL,         -- per-package price at this tier
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS purchase_history (
      id TEXT PRIMARY KEY,
      item_id TEXT,                  -- canonical item (NULL until matched)
      receipt_id TEXT,               -- external TabReady receipt reference
      receipt_line_id TEXT,          -- external line reference
      original_desc TEXT,            -- raw receipt text (kept verbatim)
      normalized_desc TEXT,
      vendor TEXT,
      purchase_date TEXT,
      quantity REAL,                 -- packages purchased
      package_qty REAL,              -- count per package
      unit_of_measure TEXT,
      gross_cents INTEGER,
      discount_cents INTEGER DEFAULT 0,
      net_cents INTEGER,             -- net paid (used for cash forecasting)
      unit_price_cents INTEGER,      -- effective per-package price (net/qty)
      norm_price_cents INTEGER,      -- normalized per-unit price
      match_confidence TEXT,         -- confirmed|likely|needs_review
      match_method TEXT,             -- sku|alias|description|manual
      confirmed INTEGER DEFAULT 0,   -- manually confirmed
      is_outlier INTEGER DEFAULT 0,
      source TEXT DEFAULT 'receipt', -- receipt|manual
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS receipt_aliases (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      vendor TEXT,
      alias_text TEXT NOT NULL,      -- normalized receipt text
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    // Editable per-vendor shipping estimate (Webstaurant is the deciding one).
    // Smallest additive store: one row per store, cleared by deleting the row.
    `CREATE TABLE IF NOT EXISTS shipping_estimates (
      store TEXT PRIMARY KEY,
      cents INTEGER,
      note TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS pricing_meta (key TEXT PRIMARY KEY, val TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_prices_item ON item_prices(item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tiers_item ON price_tiers(item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_purch_item ON purchase_history(item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_purch_receipt ON purchase_history(receipt_id, receipt_line_id)`,
    `CREATE INDEX IF NOT EXISTS idx_alias_vendor ON receipt_aliases(vendor, alias_text)`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
  await seedPricing(env);
}

// Idempotent seed of verified case pricing + editable round estimates.
// Seed values come straight from the handoff (§20–21); Shane can edit any of
// them. Guarded by a meta flag so it runs once and never clobbers edits.
async function seedPricing(env) {
  const done = await env.DB.prepare(`SELECT val FROM pricing_meta WHERE key = 'seeded_v1'`).first();
  if (done) return;

  // [item_id, store, package_desc, uom, package_qty, cents, is_exact, source, sku, brand, tiers]
  const SEED = [
    ['main_large_plates', 'Webstaurant', '10¼" white foam plate, 500/case', 'case', 500, 6099, 1, 'confirmed', '30110PWQR', 'Dart', [[2, 5049]]],
    ['main_clear_cups', 'Webstaurant', '12 oz translucent cold cup, 1000/case', 'case', 1000, 4199, 1, 'confirmed', '500TW12', 'Choice', [[2, 3749]]],
    ['main_black_lids', 'Webstaurant', 'Black hot-cup travel lid, 1000/case', 'case', 1000, 3049, 1, 'confirmed', '500L1020B', 'Choice', [[2, 2749]]],
    ['main_sleeves', 'Webstaurant', 'Coffee cup sleeve, 1200/case', 'case', 1200, 4149, 1, 'confirmed', '500COLLAR', 'Choice', [[2, 3949]]],
    // Editable round estimates — no verified price yet.
    ['cafe_whole_milk', null, null, 'gallon', 1, 400, 0, 'estimated', null, null, []],
    ['cafe_apples', null, null, 'bag', 1, 600, 0, 'estimated', null, null, []],
    ['cafe_bananas', null, null, 'bag', 1, 200, 0, 'estimated', null, null, []],
    ['cafe_oranges', null, null, 'bag', 1, 800, 0, 'estimated', null, null, []],
    ['main_togo_boxes', null, null, 'case', 1, 1850, 0, 'estimated', null, null, []],
    ['main_mm_napkins', null, null, 'case', 1, 1300, 0, 'estimated', null, null, []],
    ['main_toothpicks', null, null, 'box', 1, 400, 0, 'estimated', null, null, []],
    ['am_microphones_for_susan_and_patch_cables_sau8', null, null, 'each', 1, 5000, 0, 'estimated', null, null, []],
  ];

  for (const [itemId, store, desc, uom, pkgQty, cents, exact, source, sku, brand, tiers] of SEED) {
    // Only seed if this item has no price rows yet (never overwrite Shane's edits).
    const exists = await env.DB.prepare(`SELECT 1 FROM item_prices WHERE item_id = ? LIMIT 1`).bind(itemId).first();
    if (!exists) {
      await env.DB.prepare(
        `INSERT INTO item_prices (id, item_id, store, package_desc, unit_of_measure, package_qty, price_cents, is_exact, source_type, sku, brand, date_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'))`
      ).bind(crypto.randomUUID(), itemId, store, desc, uom, pkgQty, cents, exact, source, sku, brand).run();
    }
    const hasTiers = await env.DB.prepare(`SELECT 1 FROM price_tiers WHERE item_id = ? LIMIT 1`).bind(itemId).first();
    if (!hasTiers) {
      for (const [minQty, tierCents] of tiers) {
        await env.DB.prepare(
          `INSERT INTO price_tiers (id, item_id, store, min_qty, price_cents) VALUES (?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), itemId, store, minQty, tierCents).run();
      }
    }
  }
  await env.DB.prepare(`INSERT OR REPLACE INTO pricing_meta (key, val) VALUES ('seeded_v1', datetime('now'))`).run();
}

// ── Money formatting ────────────────────────────────────────
// Exact prices show cents; estimates show whole dollars with ≈ (no false precision).
function fmtMoney(cents, exact) {
  if (cents == null) return '—';
  if (exact) return '$' + (cents / 100).toFixed(2);
  return '≈ $' + Math.round(cents / 100).toLocaleString('en-US');
}
function normStore(s) { return (s || '').trim().toLowerCase(); }
function normDesc(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Bulk-load pricing for a set of items (few queries, not N+1) ──
async function loadPricingForItems(env, itemIds) {
  const empty = { prices: new Map(), tiers: new Map(), purchases: new Map() };
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) return empty;
  const ph = ids.map(() => '?').join(',');

  const priceRes = await env.DB.prepare(
    `SELECT * FROM item_prices WHERE item_id IN (${ph})`
  ).bind(...ids).all();
  const tierRes = await env.DB.prepare(
    `SELECT * FROM price_tiers WHERE item_id IN (${ph}) ORDER BY min_qty DESC`
  ).bind(...ids).all();
  // Only CONFIRMED actuals (exact SKU, learned alias, or manually confirmed)
  // drive the preferred estimate. 'likely' matches stay in the /receipts review
  // queue and never move a price until Shane confirms them — this prevents an
  // ambiguous receipt abbreviation from poisoning future forecasts.
  const purchRes = await env.DB.prepare(
    `SELECT * FROM purchase_history
     WHERE item_id IN (${ph}) AND item_id IS NOT NULL
       AND is_outlier = 0 AND match_confidence = 'confirmed'
     ORDER BY purchase_date DESC, created_at DESC`
  ).bind(...ids).all();

  const prices = new Map(), tiers = new Map(), purchases = new Map();
  for (const r of (priceRes.results || [])) { if (!prices.has(r.item_id)) prices.set(r.item_id, []); prices.get(r.item_id).push(r); }
  for (const r of (tierRes.results || [])) { if (!tiers.has(r.item_id)) tiers.set(r.item_id, []); tiers.get(r.item_id).push(r); }
  for (const r of (purchRes.results || [])) { if (!purchases.has(r.item_id)) purchases.set(r.item_id, []); purchases.get(r.item_id).push(r); }
  return { prices, tiers, purchases };
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const t = new Date(String(dateStr).replace(' ', 'T') + (String(dateStr).length <= 10 ? 'T00:00:00Z' : 'Z')).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}
function weightedAvg(purchases) {
  const rows = purchases.slice(0, AVG_WINDOW).filter(p => p.unit_price_cents != null);
  if (!rows.length) return null;
  let ws = 0, acc = 0;
  rows.forEach((p, i) => { const w = AVG_WEIGHTS[i] || 1; ws += w; acc += w * p.unit_price_cents; });
  return Math.round(acc / ws);
}

// ── Resolve the preferred per-package estimate for one item ──
// Follows the price-source priority in the handoff (§4 / §16). Actuals from the
// selected store win; generic web pricing never silently replaces an actual.
function resolveItemEstimate(item, pricing) {
  const store = item.vendor;
  const prices = pricing.prices.get(item.id) || [];
  const purchases = pricing.purchases.get(item.id) || []; // newest first, already filtered
  const meta = pricing.prices.get(item.id)?.find(p => p.package_desc || p.unit_of_measure) || prices[0] || {};
  const base = {
    packageDesc: meta.package_desc || null,
    unitOfMeasure: meta.unit_of_measure || item.unit || null,
    packageQty: meta.package_qty != null ? meta.package_qty : null,
  };
  const out = (cents, exact, type, label) => ({
    ...base, hasEstimate: cents != null, packageCents: cents, isExact: !!exact,
    sourceType: type, sourceLabel: label,
  });

  // 1. Manual lock — never auto-replaced.
  const locked = prices.find(p => p.manual_locked && p.price_cents != null);
  if (locked) return { ...out(locked.price_cents, locked.is_exact, 'confirmed', 'Locked price'), locked: true, packageDesc: locked.package_desc || base.packageDesc, unitOfMeasure: locked.unit_of_measure || base.unitOfMeasure };

  const sameStore = (v) => store && normStore(v) === normStore(store);
  const storeP = purchases.filter(p => sameStore(p.vendor));
  const dateShort = (d) => (d ? String(d).slice(0, 10) : '');

  // 2. Most recent comparable actual from the selected store (if current).
  if (storeP.length && daysSince(storeP[0].purchase_date) <= ACTUAL_FRESH_DAYS) {
    return out(storeP[0].unit_price_cents, true, 'actual', `Last purchased at ${store} ${dateShort(storeP[0].purchase_date)}`.trim());
  }
  // 3. Weighted average of recent store actuals.
  if (storeP.length) {
    const a = weightedAvg(storeP);
    if (a != null) return out(a, true, 'actual', `${store} avg of last ${Math.min(storeP.length, AVG_WINDOW)}`);
  }
  // 4. Most recent actual across all stores.
  if (purchases.length && daysSince(purchases[0].purchase_date) <= ACTUAL_FRESH_DAYS) {
    return out(purchases[0].unit_price_cents, true, 'actual', `Recent actual ${dateShort(purchases[0].purchase_date)}`.trim());
  }
  // 5. Weighted average across all stores.
  if (purchases.length) {
    const a = weightedAvg(purchases);
    if (a != null) return out(a, true, 'actual', `Based on ${Math.min(purchases.length, AVG_WINDOW)} recent purchase${purchases.length === 1 ? '' : 's'}`);
  }

  // Non-actual sources: prefer store-specific, then general.
  const pick = (type) => prices.find(p => p.source_type === type && sameStore(p.store) && p.price_cents != null)
    || prices.find(p => p.source_type === type && (!p.store) && p.price_cents != null)
    || prices.find(p => p.source_type === type && p.price_cents != null);
  // 6. Manually confirmed price.
  const conf = pick('confirmed');
  if (conf) return { ...out(conf.price_cents, conf.is_exact, 'confirmed', 'Confirmed price'), packageDesc: conf.package_desc || base.packageDesc, unitOfMeasure: conf.unit_of_measure || base.unitOfMeasure };
  // 7. Web-verified.
  const web = pick('web');
  if (web) return { ...out(web.price_cents, web.is_exact, 'web', 'Web-verified'), packageDesc: web.package_desc || base.packageDesc };
  // 8. Round estimate.
  const est = pick('estimated');
  if (est) return { ...out(est.price_cents, est.is_exact, 'estimated', 'Round estimate'), packageDesc: est.package_desc || base.packageDesc };
  // 9. Any priced row at all, else nothing.
  const any = prices.find(p => p.price_cents != null);
  if (any) return out(any.price_cents, any.is_exact, any.source_type || 'unknown', 'Estimate');
  return out(null, false, 'unknown', null);
}

// Apply quantity tiers: highest min_qty that the requested quantity qualifies for.
function tierPriceFor(itemId, store, qty, tiers) {
  const rows = (tiers || []).filter(t => !t.store || normStore(t.store) === normStore(store));
  for (const t of rows) { if (qty >= t.min_qty) return t.price_cents; } // rows are min_qty DESC
  return null;
}

// Compute a single shopping line: requested qty × applicable package/tier price.
function computeLine(est, qty, store, tiers) {
  if (!est.hasEstimate || est.packageCents == null) {
    return { hasEstimate: false, lineCents: null, isExact: false, tierApplied: false, unitCents: null };
  }
  const q = Number(qty) || 0;
  const tier = tierPriceFor(null, store, q, tiers);
  const unitCents = tier != null ? tier : est.packageCents;
  const tierApplied = tier != null && tier !== est.packageCents;
  return { hasEstimate: true, lineCents: Math.round(unitCents * q), isExact: est.isExact, tierApplied, unitCents };
}

// Vendors where shipping is a real cost that must be entered, not assumed $0.
const SHIPPING_VENDORS = ['Webstaurant', 'Amazon'];

async function loadShippingEstimates(env) {
  const res = await env.DB.prepare(`SELECT store, cents FROM shipping_estimates`).all();
  const map = {};
  for (const r of (res.results || [])) if (r.cents != null) map[r.store] = r.cents;
  return map;
}

// Roll the item subtotal + entered shipping into the order estimate. Unknown
// shipping for a vendor you're ordering from is NEVER counted as $0 — it makes
// the order total "pending" and the honest label falls back to the item
// subtotal ("Known item subtotal ≈ $X · final estimate pending shipping").
function computeOrderSummary(itemsCents, itemsExact, activeShippingVendors, shipMap) {
  let knownShipping = 0;
  const missing = [];
  for (const v of activeShippingVendors) {
    if (shipMap[v] != null) knownShipping += shipMap[v];
    else missing.push(v);
  }
  const pending = missing.length > 0;
  return {
    itemsCents, knownShipping, missing, pending,
    total: itemsCents + knownShipping,   // "known so far" when pending, else final
    exact: itemsExact,
  };
}

// Client-side mirror of tierPriceFor/computeLine so totals recalc instantly
// (include/exclude toggles and the Adjust calculator) with no round-trip.
function pricingClientLib() {
  return `
    window.TSCost = {
      lineCents: function(baseCents, tiers, qty) {
        if (baseCents == null) return null;
        var unit = baseCents;
        for (var i = 0; i < (tiers||[]).length; i++) { if (qty >= tiers[i][0]) { unit = tiers[i][1]; break; } }
        return Math.round(unit * qty);
      },
      fmt: function(cents, exact) {
        if (cents == null) return '—';
        if (exact) return '$' + (cents/100).toFixed(2);
        return '≈ $' + Math.round(cents/100).toLocaleString('en-US');
      }
    };
  `;
}

// ── API: save / lock an item's estimate (Shane) ──
async function apiPriceSave(request, env) {
  await ensurePricingSchema(env);
  const body = await request.json().catch(() => ({}));
  const itemId = (body.item_id || '').toString().trim();
  if (!itemId) return json({ error: 'item_id_required' }, 400);
  const item = await env.DB.prepare('SELECT id, name, vendor, unit FROM items WHERE id = ? LIMIT 1').bind(itemId).first();
  if (!item) return json({ error: 'unknown_item' }, 404);

  // Lock / unlock path (no price change).
  if (body.lock === 1 || body.lock === 0) {
    if (body.lock === 1) {
      // Lock the item's currently-preferred manual/confirmed/estimate row (prefer a store-specific one).
      const target = await env.DB.prepare(
        `SELECT id FROM item_prices WHERE item_id = ? ORDER BY (store IS NOT NULL) DESC, updated_at DESC LIMIT 1`
      ).bind(itemId).first();
      if (!target) return json({ error: 'no_price_to_lock' }, 400);
      await env.DB.prepare(`UPDATE item_prices SET manual_locked = 0 WHERE item_id = ?`).bind(itemId).run();
      await env.DB.prepare(`UPDATE item_prices SET manual_locked = 1, updated_at = datetime('now') WHERE id = ?`).bind(target.id).run();
    } else {
      await env.DB.prepare(`UPDATE item_prices SET manual_locked = 0 WHERE item_id = ?`).bind(itemId).run();
    }
    await logAction(env, 'price_lock', 'shane', 'item', itemId, { item_name: item.name, locked: body.lock });
    return json({ ok: true, locked: body.lock });
  }

  const priceCents = parseInt(body.price_cents, 10);
  if (!Number.isFinite(priceCents) || priceCents < 0) return json({ error: 'price_required' }, 400);
  const store = (body.store && body.store !== 'Other') ? body.store.toString().trim() : (item.vendor || null);
  const isExact = body.is_exact ? 1 : 0;
  const uom = (body.unit_of_measure || item.unit || null);
  const note = (body.note || '').toString().trim() || null;

  // Upsert a manually-confirmed price for this item+store (keeps history separate).
  const existing = await env.DB.prepare(
    `SELECT id FROM item_prices WHERE item_id = ? AND IFNULL(store,'') = IFNULL(?,'') AND source_type IN ('confirmed','estimated') ORDER BY updated_at DESC LIMIT 1`
  ).bind(itemId, store).first();
  const sourceType = isExact ? 'confirmed' : 'estimated';
  if (existing) {
    await env.DB.prepare(
      `UPDATE item_prices SET price_cents = ?, is_exact = ?, source_type = ?, unit_of_measure = COALESCE(unit_of_measure, ?), note = ?, date_verified = date('now'), updated_at = datetime('now') WHERE id = ?`
    ).bind(priceCents, isExact, sourceType, uom, note, existing.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO item_prices (id, item_id, store, unit_of_measure, price_cents, is_exact, source_type, note, date_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, date('now'))`
    ).bind(crypto.randomUUID(), itemId, store, uom, priceCents, isExact, sourceType, note).run();
  }
  await logAction(env, 'price_saved', 'shane', 'item', itemId, {
    item_name: item.name, store, price_cents: priceCents, is_exact: isExact, source: sourceType
  });
  return json({ ok: true });
}

// ── API: save / clear a per-vendor shipping estimate (Shane) ──
async function apiShippingSave(request, env) {
  await ensurePricingSchema(env);
  const body = await request.json().catch(() => ({}));
  const store = (body.store || '').toString().trim();
  if (!store) return json({ error: 'store_required' }, 400);
  const note = (body.note || '').toString().trim() || null;

  // Blank / null cents clears the estimate (back to "Not entered").
  const cents = (body.cents === null || body.cents === '' || body.cents === undefined)
    ? null : parseInt(body.cents, 10);
  if (cents !== null && (!Number.isFinite(cents) || cents < 0)) return json({ error: 'bad_cents' }, 400);

  if (cents === null) {
    await env.DB.prepare(`DELETE FROM shipping_estimates WHERE store = ?`).bind(store).run();
    await logAction(env, 'shipping_cleared', 'shane', 'store', store, { store });
    return json({ ok: true, cleared: true });
  }
  await env.DB.prepare(
    `INSERT INTO shipping_estimates (store, cents, note, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(store) DO UPDATE SET cents = excluded.cents, note = excluded.note, updated_at = datetime('now')`
  ).bind(store, cents, note).run();
  await logAction(env, 'shipping_saved', 'shane', 'store', store, { store, cents });
  return json({ ok: true, cents });
}

// ── Receipt matching: try to map a raw receipt line to a canonical item ──
async function matchReceiptLine(env, vendor, line, itemsCache) {
  const normalized = normDesc(line.description || line.desc || '');
  const sku = (line.sku || line.product_code || '').toString().trim();

  // 1. Exact SKU / product code → confirmed.
  if (sku) {
    const hit = await env.DB.prepare(`SELECT item_id FROM item_prices WHERE sku = ? LIMIT 1`).bind(sku).first();
    if (hit) return { itemId: hit.item_id, confidence: 'confirmed', method: 'sku' };
  }
  // 2. Learned vendor alias → confirmed.
  if (normalized) {
    const alias = await env.DB.prepare(
      `SELECT item_id FROM receipt_aliases WHERE alias_text = ? AND (vendor IS NULL OR LOWER(vendor) = LOWER(?)) ORDER BY (vendor IS NOT NULL) DESC LIMIT 1`
    ).bind(normalized, vendor || '').first();
    if (alias) return { itemId: alias.item_id, confidence: 'confirmed', method: 'alias' };
  }
  // 3. Description similarity → likely / needs_review.
  const recTokens = new Set(normalized.split(' ').filter(t => t.length > 2));
  if (recTokens.size) {
    let best = null, second = null;
    for (const it of itemsCache) {
      const itTokens = it._tokens;
      if (!itTokens.size) continue;
      let overlap = 0;
      for (const t of recTokens) if (itTokens.has(t)) overlap++;
      const score = overlap / Math.max(recTokens.size, itTokens.size);
      const vendorBonus = vendor && normStore(it.vendor) === normStore(vendor) ? 0.15 : 0;
      const total = score + vendorBonus;
      if (!best || total > best.total) { second = best; best = { itemId: it.id, total }; }
      else if (!second || total > second.total) { second = { itemId: it.id, total }; }
    }
    if (best && best.total >= 0.55 && (!second || best.total - second.total >= 0.15)) {
      return { itemId: best.itemId, confidence: 'likely', method: 'description' };
    }
    if (best && best.total >= 0.4) {
      return { itemId: best.itemId, confidence: 'needs_review', method: 'description' };
    }
  }
  return { itemId: null, confidence: 'needs_review', method: 'none' };
}

// ── API: ingest finalized receipt lines from TabReady ──
// Token-guarded (env.RECEIPT_INGEST_TOKEN). Body:
//   { receipt_id, vendor, purchase_date, lines: [{ line_id, description, sku, quantity,
//     package_qty, unit_of_measure, gross_cents, discount_cents, net_cents }] }
async function apiReceiptIngest(request, env) {
  // Fail closed. This is a write path into price history, so it stays fully
  // disabled until a secret is configured AND the caller presents it:
  //   • no secret configured      → 503 ingest_not_configured
  //   • missing / wrong token      → 401 unauthorized
  //   • correct bearer/ingest tok  → continue
  if (!env.RECEIPT_INGEST_TOKEN) return json({ error: 'ingest_not_configured' }, 503);
  {
    const auth = request.headers.get('authorization') || '';
    const tok = (request.headers.get('x-ingest-token') || auth.replace(/^Bearer\s+/i, '')).trim();
    if (!tok || tok !== env.RECEIPT_INGEST_TOKEN) return json({ error: 'unauthorized' }, 401);
  }
  await ensurePricingSchema(env);
  const body = await request.json().catch(() => ({}));
  const receiptId = (body.receipt_id || '').toString().trim();
  const vendor = (body.vendor || body.vendor_name || '').toString().trim() || null;
  const purchaseDate = (body.purchase_date || body.receipt_date || '').toString().trim() || null;
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!receiptId) return json({ error: 'receipt_id_required' }, 400);
  if (!lines.length) return json({ error: 'no_lines' }, 400);

  // Preload items for description matching (tokenized once).
  const itemsRes = await env.DB.prepare(`SELECT i.id, i.name, i.vendor, i.brand FROM items i`).all();
  const itemsCache = (itemsRes.results || []).map(it => ({
    ...it, _tokens: new Set(normDesc(`${it.name} ${it.brand || ''}`).split(' ').filter(t => t.length > 2))
  }));

  const summary = { received: lines.length, inserted: 0, updated: 0, confirmed: 0, likely: 0, needs_review: 0, outliers: 0 };
  for (const line of lines) {
    const lineId = (line.line_id != null ? String(line.line_id) : String(summary.inserted + summary.updated));
    const qty = Number(line.quantity) || 1;
    const gross = parseInt(line.gross_cents, 10);
    const discount = parseInt(line.discount_cents, 10) || 0;
    let net = parseInt(line.net_cents, 10);
    if (!Number.isFinite(net)) net = (Number.isFinite(gross) ? gross - discount : NaN);
    const grossFinal = Number.isFinite(gross) ? gross : net;
    const packageQty = line.package_qty != null ? Number(line.package_qty) : null;
    const uom = (line.unit_of_measure || line.uom || null);
    const unitPrice = Number.isFinite(net) && qty > 0 ? Math.round(net / qty) : null;
    const normPrice = (Number.isFinite(net) && packageQty && qty > 0) ? Math.round(net / (qty * packageQty)) : null;

    const match = await matchReceiptLine(env, vendor, line, itemsCache);

    // Outlier check against the item's recent actuals (only when we have a match).
    let isOutlier = 0;
    if (match.itemId && unitPrice != null) {
      const prior = await env.DB.prepare(
        `SELECT AVG(unit_price_cents) avg FROM purchase_history WHERE item_id = ? AND is_outlier = 0 AND unit_price_cents IS NOT NULL`
      ).bind(match.itemId).first();
      const avg = prior && prior.avg;
      if (avg && Math.abs(unitPrice - avg) / avg > OUTLIER_RATIO) { isOutlier = 1; summary.outliers++; }
    }

    const existing = await env.DB.prepare(
      `SELECT id FROM purchase_history WHERE receipt_id = ? AND IFNULL(receipt_line_id,'') = ? LIMIT 1`
    ).bind(receiptId, lineId).first();

    const cols = [match.itemId, receiptId, lineId, (line.description || line.desc || ''), normDesc(line.description || line.desc || ''),
      vendor, purchaseDate, qty, packageQty, uom, grossFinal, discount, net, unitPrice, normPrice,
      match.confidence, match.method, isOutlier];
    if (existing) {
      await env.DB.prepare(
        `UPDATE purchase_history SET item_id=?, original_desc=?, normalized_desc=?, vendor=?, purchase_date=?,
          quantity=?, package_qty=?, unit_of_measure=?, gross_cents=?, discount_cents=?, net_cents=?,
          unit_price_cents=?, norm_price_cents=?, match_confidence=?, match_method=?, is_outlier=? WHERE id=?`
      ).bind(match.itemId, (line.description || line.desc || ''), normDesc(line.description || line.desc || ''), vendor, purchaseDate,
        qty, packageQty, uom, grossFinal, discount, net, unitPrice, normPrice, match.confidence, match.method, isOutlier, existing.id).run();
      summary.updated++;
    } else {
      await env.DB.prepare(
        `INSERT INTO purchase_history
          (id, item_id, receipt_id, receipt_line_id, original_desc, normalized_desc, vendor, purchase_date,
           quantity, package_qty, unit_of_measure, gross_cents, discount_cents, net_cents, unit_price_cents,
           norm_price_cents, match_confidence, match_method, is_outlier, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'receipt')`
      ).bind(crypto.randomUUID(), ...cols).run();
      summary.inserted++;
    }
    summary[match.confidence] = (summary[match.confidence] || 0) + 1;
  }

  await logAction(env, 'receipt_ingested', 'tabready', 'receipt', receiptId, {
    vendor, purchase_date: purchaseDate, ...summary
  });
  return json({ ok: true, ...summary });
}

// ── API: confirm / ignore a receipt match, optionally learning an alias ──
async function apiReceiptMatch(request, env) {
  await ensurePricingSchema(env);
  const body = await request.json().catch(() => ({}));
  const purchaseId = (body.purchase_id || '').toString().trim();
  const action = (body.action || 'confirm').toString();
  if (!purchaseId) return json({ error: 'purchase_id_required' }, 400);
  const rec = await env.DB.prepare(`SELECT * FROM purchase_history WHERE id = ? LIMIT 1`).bind(purchaseId).first();
  if (!rec) return json({ error: 'unknown_purchase' }, 404);

  if (action === 'ignore') {
    await env.DB.prepare(`UPDATE purchase_history SET match_confidence = 'ignored' WHERE id = ?`).bind(purchaseId).run();
    await logAction(env, 'receipt_match_ignored', 'shane', 'purchase', purchaseId, { desc: rec.original_desc });
    return json({ ok: true, action: 'ignored' });
  }
  if (action === 'outlier') {
    await env.DB.prepare(`UPDATE purchase_history SET is_outlier = 1 WHERE id = ?`).bind(purchaseId).run();
    return json({ ok: true, action: 'outlier' });
  }

  const itemId = (body.item_id || rec.item_id || '').toString().trim();
  if (!itemId) return json({ error: 'item_id_required' }, 400);
  await env.DB.prepare(
    `UPDATE purchase_history SET item_id = ?, match_confidence = 'confirmed', match_method = 'manual', confirmed = 1 WHERE id = ?`
  ).bind(itemId, purchaseId).run();

  // Learn a vendor-specific alias so future identical lines auto-match.
  if (body.learn_alias && rec.normalized_desc) {
    const dupe = await env.DB.prepare(
      `SELECT id FROM receipt_aliases WHERE item_id = ? AND alias_text = ? AND IFNULL(vendor,'') = IFNULL(?,'') LIMIT 1`
    ).bind(itemId, rec.normalized_desc, rec.vendor).first();
    if (!dupe) {
      await env.DB.prepare(
        `INSERT INTO receipt_aliases (id, item_id, vendor, alias_text) VALUES (?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), itemId, rec.vendor, rec.normalized_desc).run();
    }
  }
  await logAction(env, 'receipt_match_confirmed', 'shane', 'purchase', purchaseId, {
    item_id: itemId, desc: rec.original_desc, learned_alias: !!body.learn_alias
  });
  return json({ ok: true, action: 'confirmed', item_id: itemId });
}

// ── Receipt review queue page (Shane) ──
async function receiptsReviewPage(env) {
  await ensurePricingSchema(env);
  const res = await env.DB.prepare(
    `SELECT * FROM purchase_history
     WHERE source = 'receipt' AND match_confidence IN ('likely','needs_review')
     ORDER BY created_at DESC LIMIT 100`
  ).all();
  const rows = res.results || [];
  const itemsRes = await env.DB.prepare(`SELECT id, name, vendor FROM items ORDER BY name`).all();
  const items = itemsRes.results || [];

  const stats = await env.DB.prepare(
    `SELECT match_confidence c, COUNT(*) n FROM purchase_history WHERE source='receipt' GROUP BY match_confidence`
  ).all();
  const counts = {}; for (const s of (stats.results || [])) counts[s.c] = s.n;

  const options = items.map(i => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name)}${i.vendor ? ' — ' + escapeHtml(i.vendor) : ''}</option>`).join('');
  const nameById = {}; for (const i of items) nameById[i.id] = i.name;

  const banner = rows.length === 0
    ? `<div style="background:#d1fae5;color:#065f46;padding:16px;border-radius:10px;margin-bottom:14px;text-align:center">
         <strong>Nothing to review.</strong> Confirmed receipt matches are feeding your estimates.
         ${counts.confirmed ? `<div style="font-size:12px;margin-top:4px">${counts.confirmed} confirmed · ${counts.ignored || 0} ignored</div>` : ''}
       </div>`
    : `<div style="background:#faf3e6;border:1px solid ${COLORS.equip};border-radius:10px;padding:12px;margin-bottom:14px;font-size:14px;color:#5a3220">
         <strong>${rows.length} receipt line${rows.length === 1 ? '' : 's'} to review.</strong>
         Likely matches are suggestions only — they do not affect any estimate until you confirm them. Needs-review lines never change an estimate either.
       </div>`;

  const cardHtml = rows.map(r => {
    const badgeColor = r.match_confidence === 'likely' ? { bg: '#e0e7ff', fg: '#3730a3' } : { bg: '#fee2e2', fg: '#991b1b' };
    const guess = r.item_id ? nameById[r.item_id] : null;
    const price = r.unit_price_cents != null ? fmtMoney(r.unit_price_cents, true) : '—';
    return `
      <div class="review-card" data-purchase-id="${escapeHtml(r.id)}">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-family:monospace;font-size:13px;color:${COLORS.textPrimary};word-break:break-word">${escapeHtml(r.original_desc || '(no description)')}</div>
            <div style="font-size:11px;color:${COLORS.textTertiary};margin-top:3px;text-transform:uppercase;letter-spacing:0.4px">
              ${escapeHtml(r.vendor || 'Unknown')} · ${escapeHtml((r.purchase_date || '').slice(0,10))} · qty ${escapeHtml(String(r.quantity ?? ''))} · ${price}/unit${r.is_outlier ? ' · ⚠ outlier' : ''}
            </div>
          </div>
          <span style="background:${badgeColor.bg};color:${badgeColor.fg};padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;text-transform:uppercase;white-space:nowrap">${escapeHtml(r.match_confidence.replace('_',' '))}</span>
        </div>
        <label class="modal-field-label" style="margin-top:10px">Canonical item${guess ? ` · suggested: <strong>${escapeHtml(guess)}</strong>` : ''}</label>
        <select class="review-item">
          <option value="">— choose item —</option>
          ${options}
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:${COLORS.textSecondary};margin-top:8px">
          <input type="checkbox" class="review-alias" checked style="width:auto"> Remember this receipt text for ${escapeHtml(r.vendor || 'this vendor')}
        </label>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button type="button" class="btn-primary review-confirm" style="flex:2">Confirm match</button>
          <button type="button" class="btn-secondary review-ignore" style="flex:1">Ignore</button>
        </div>
      </div>`;
  }).join('');

  const body = `
    <div class="page">
      <div class="page-header">
        <div class="page-tag">Shane · TabReady Receipt Matches</div>
        <h2 class="page-title">RECEIPT REVIEW</h2>
        <p class="page-sub">Confirm which shopping item each receipt line belongs to. Confirmed actuals improve future estimates.</p>
      </div>
      ${banner}
      ${cardHtml}
    </div>
    <script>${receiptReviewScript()}</script>
  `;
  // Preselect suggested items after render.
  const preselect = `<script>(function(){
    var rows = ${JSON.stringify(rows.map(r => ({ id: r.id, item: r.item_id || '' })))};
    rows.forEach(function(r){
      var card = document.querySelector('.review-card[data-purchase-id="'+r.id+'"]');
      if (card && r.item) { var sel = card.querySelector('.review-item'); if (sel) sel.value = r.item; }
    });
  })();</script>`;
  return pageShell('Receipt Review', 'shane', body + preselect, '/receipts');
}

function receiptReviewScript() {
  return `
    (function(){
      function toast(msg, isError) {
        var b = document.getElementById('save-banner');
        b.textContent = msg; b.classList.toggle('error', !!isError);
        b.classList.add('show'); setTimeout(function(){ b.classList.remove('show'); }, 2000);
      }
      document.querySelectorAll('.review-card').forEach(function(card){
        var id = card.getAttribute('data-purchase-id');
        var sel = card.querySelector('.review-item');
        var alias = card.querySelector('.review-alias');
        var confirmBtn = card.querySelector('.review-confirm');
        var ignoreBtn = card.querySelector('.review-ignore');
        confirmBtn.addEventListener('click', async function(){
          if (!sel.value) { toast('Pick an item first.', true); return; }
          confirmBtn.disabled = true; confirmBtn.textContent = 'Saving…';
          try {
            var r = await fetch('/api/receipt-match', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ purchase_id: id, item_id: sel.value, action:'confirm', learn_alias: alias.checked ? 1 : 0 })
            });
            if (r.ok) { toast('✓ Match confirmed'); card.style.opacity = '0.4'; card.style.pointerEvents = 'none'; }
            else toast('Could not save.', true);
          } catch(e){ toast('Network issue.', true); }
          finally { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm match'; }
        });
        ignoreBtn.addEventListener('click', async function(){
          ignoreBtn.disabled = true;
          try {
            var r = await fetch('/api/receipt-match', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ purchase_id: id, action:'ignore' })
            });
            if (r.ok) { toast('Ignored'); card.style.opacity = '0.4'; card.style.pointerEvents = 'none'; }
            else toast('Could not save.', true);
          } catch(e){ toast('Network issue.', true); }
          finally { ignoreBtn.disabled = false; }
        });
      });
    })();
  `;
}
// ────────────────────────────────────────────────────────────
// Named exports for tests. The Workers runtime only uses the
// `export default` above; these extra named exports are inert at
// deploy time and let the committed test suite import the pure
// pricing + receipt functions directly (see ./test).
// ────────────────────────────────────────────────────────────
export {
  ensurePricingSchema, seedPricing, loadPricingForItems,
  resolveItemEstimate, computeLine, tierPriceFor, weightedAvg,
  fmtMoney, normDesc, normStore, pricingClientLib,
  matchReceiptLine, apiReceiptIngest, apiReceiptMatch, apiPriceSave, apiResolve,
  computeOrderSummary, loadShippingEstimates, apiShippingSave, SHIPPING_VENDORS,
};
