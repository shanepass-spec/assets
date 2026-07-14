// Test helpers: a tiny in-memory D1 shim over node:sqlite so the worker's
// prepare(...).bind(...).run()/first()/all() calls run against a real SQLite
// engine — no Cloudflare account or wrangler needed.
import { DatabaseSync } from 'node:sqlite';

// Minimal slice of the production `tab-supplies` schema that the cost-
// intelligence code joins against. The pricing tables are created by the
// worker's own ensurePricingSchema() at runtime, exactly as in production.
const BASE_SCHEMA = `
  CREATE TABLE items (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, page INTEGER,
    vendor TEXT, notes TEXT, unit TEXT, lane TEXT DEFAULT 'hospitality',
    amazon_url TEXT, brand TEXT, cafe_visible INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 50, recurring INTEGER DEFAULT 0
  );
  CREATE TABLE flags (
    id TEXT PRIMARY KEY, item_id TEXT NOT NULL, flagged_by TEXT NOT NULL,
    flagged_at TEXT DEFAULT (datetime('now')), note TEXT, resolved_at TEXT,
    quantity INTEGER DEFAULT 1, acknowledged_at TEXT, bought_quantity INTEGER,
    bought_by TEXT, bought_at TEXT
  );
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY, action TEXT, actor_role TEXT, target_kind TEXT,
    target_id TEXT, metadata TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
`;

// A handful of real canonical item IDs the seed references.
const SEED_ITEMS = [
  ['main_large_plates', '10¼" large plates', 'Webstaurant', 'case', 'Plates', 3],
  ['main_clear_cups', '12 oz clear cups', 'Webstaurant', 'case', 'Cups', 3],
  ['cafe_whole_milk', 'Whole milk', 'Flexible', 'gallon', 'Dairy', 2],
  ['main_toothpicks', 'Toothpicks', "Sam's Club", 'box', 'Paper', 3],
];

export function makeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(BASE_SCHEMA);
  const ins = db.prepare(`INSERT INTO items (id,name,vendor,unit,category,page,lane) VALUES (?,?,?,?,?,?,'hospitality')`);
  for (const row of SEED_ITEMS) ins.run(...row);

  const env = {
    DB: {
      prepare(sql) {
        return {
          _b: [],
          bind(...a) { this._b = a; return this; },
          async run() { const r = db.prepare(sql).run(...this._b); return { meta: { changes: r.changes } }; },
          async first() { return db.prepare(sql).get(...this._b) ?? null; },
          async all() { return { results: db.prepare(sql).all(...this._b) }; },
        };
      },
    },
  };
  return { db, env };
}

export function addFlag(db, id, itemId, qty, by = 'cafe') {
  db.prepare(`INSERT INTO flags (id,item_id,flagged_by,quantity) VALUES (?,?,?,?)`).run(id, itemId, by, qty);
}

// Build a fake Request for the ingest/match handlers.
export function fakeRequest(body, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null }, json: async () => body };
}

export async function readJson(res) {
  return { status: res.status, body: JSON.parse(await res.text()) };
}
