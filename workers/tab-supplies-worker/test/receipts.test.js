// Receipt feedback-loop tests against a real in-memory SQLite engine:
// schema init + seed, fail-closed ingest auth, confirmed vs likely behavior,
// deduplication, alias learning, and the confirmed-actual → preferred-estimate
// learning loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensurePricingSchema, loadPricingForItems, resolveItemEstimate,
  apiReceiptIngest, apiReceiptMatch,
} from '../worker.js';
import { makeEnv, fakeRequest, readJson } from './helpers.js';

const SECRET = 'test-secret';
const AUTH = { Authorization: `Bearer ${SECRET}` };
const line = (o) => o;

test('ensurePricingSchema creates tables and seeds idempotently', async () => {
  const { db, env } = makeEnv();
  await ensurePricingSchema(env);
  await ensurePricingSchema(env); // second run must not double-seed
  assert.equal(db.prepare('SELECT COUNT(*) n FROM item_prices').get().n, 12);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM price_tiers').get().n, 4);
  // Seeded Webstaurant plate carries the Dart SKU + a bulk tier.
  const plate = db.prepare(`SELECT * FROM item_prices WHERE item_id='main_large_plates'`).get();
  assert.equal(plate.sku, '30110PWQR');
  assert.equal(plate.price_cents, 6099);
});

test('ingest fails closed: no secret → 503, wrong/missing token → 401', async () => {
  const { env } = makeEnv();
  const payload = { receipt_id: 'R1', vendor: 'Webstaurant', lines: [line({ line_id: 1, description: 'X', quantity: 1, net_cents: 100 })] };

  // No secret configured at all.
  let r = await readJson(await apiReceiptIngest(fakeRequest(payload, AUTH), { DB: env.DB }));
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'ingest_not_configured');

  // Secret configured, but caller sends nothing.
  const envTok = { DB: env.DB, RECEIPT_INGEST_TOKEN: SECRET };
  r = await readJson(await apiReceiptIngest(fakeRequest(payload), envTok));
  assert.equal(r.status, 401);

  // Secret configured, wrong token.
  r = await readJson(await apiReceiptIngest(fakeRequest(payload, { Authorization: 'Bearer nope' }), envTok));
  assert.equal(r.status, 401);
});

test('ingest with correct token classifies confirmed / likely / needs_review', async () => {
  const { db, env } = makeEnv();
  const envTok = { DB: env.DB, RECEIPT_INGEST_TOKEN: SECRET };
  const r = await readJson(await apiReceiptIngest(fakeRequest({
    receipt_id: 'R10', vendor: 'Webstaurant', purchase_date: '2026-07-10',
    lines: [
      line({ line_id: 1, description: 'DART 10.25 FOAM PLATE', sku: '30110PWQR', quantity: 5, net_cents: 24000 }),
      line({ line_id: 2, description: 'WHOLE MILK GALLON', quantity: 3, net_cents: 1107 }),
      line({ line_id: 3, description: 'ZZZ MYSTERY ITEM', quantity: 1, net_cents: 999 }),
    ],
  }, AUTH), envTok));
  assert.equal(r.status, 200);
  assert.equal(r.body.inserted, 3);
  assert.equal(r.body.confirmed, 1, 'SKU line is confirmed');
  assert.equal(r.body.likely, 1, 'milk description is likely');
  assert.equal(r.body.needs_review, 1, 'mystery line needs review');

  const mystery = db.prepare(`SELECT * FROM purchase_history WHERE receipt_line_id='3'`).get();
  assert.equal(mystery.item_id, null, 'unmatched line has no canonical item');
});

test('confirmed drives estimate; likely does NOT move any price', async () => {
  const { env } = makeEnv();
  const envTok = { DB: env.DB, RECEIPT_INGEST_TOKEN: SECRET };
  await apiReceiptIngest(fakeRequest({
    receipt_id: 'R20', vendor: 'Webstaurant', purchase_date: '2026-07-10',
    lines: [
      line({ line_id: 1, description: 'DART FOAM PLATE', sku: '30110PWQR', quantity: 5, net_cents: 24000 }),
      line({ line_id: 2, description: 'WHOLE MILK GALLON', quantity: 3, net_cents: 1107 }),
    ],
  }, AUTH), envTok);

  const pricing = await loadPricingForItems(env, ['main_large_plates', 'cafe_whole_milk']);

  // Confirmed SKU actual (24000/5 = 4800) becomes the preferred plate estimate.
  const plate = resolveItemEstimate({ id: 'main_large_plates', vendor: 'Webstaurant', unit: 'case' }, pricing);
  assert.equal(plate.sourceType, 'actual');
  assert.equal(plate.packageCents, 4800);

  // Milk matched only "likely" → estimate must stay on the seeded round value.
  const milk = resolveItemEstimate({ id: 'cafe_whole_milk', vendor: 'Flexible', unit: 'gallon' }, pricing);
  assert.equal(milk.sourceType, 'estimated', 'likely match must not feed the estimate');
  assert.equal(milk.packageCents, 400);
});

test('re-ingesting the same receipt line updates, never duplicates', async () => {
  const { db, env } = makeEnv();
  const envTok = { DB: env.DB, RECEIPT_INGEST_TOKEN: SECRET };
  const payload = {
    receipt_id: 'R30', vendor: 'Webstaurant', purchase_date: '2026-07-10',
    lines: [line({ line_id: 1, description: 'DART FOAM PLATE', sku: '30110PWQR', quantity: 5, net_cents: 24000 })],
  };
  await apiReceiptIngest(fakeRequest(payload, AUTH), envTok);
  const second = await readJson(await apiReceiptIngest(fakeRequest(payload, AUTH), envTok));
  assert.equal(second.body.updated, 1);
  assert.equal(second.body.inserted, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM purchase_history WHERE receipt_id='R30'`).get().n, 1);
});

test('confirming a likely match learns an alias and then feeds the estimate', async () => {
  const { db, env } = makeEnv();
  const envTok = { DB: env.DB, RECEIPT_INGEST_TOKEN: SECRET };
  await apiReceiptIngest(fakeRequest({
    receipt_id: 'R40', vendor: 'Flexible', purchase_date: '2026-07-10',
    lines: [line({ line_id: 1, description: 'WHOLE MILK GALLON', quantity: 3, net_cents: 1107 })],
  }, AUTH), envTok);

  const likely = db.prepare(`SELECT * FROM purchase_history WHERE receipt_id='R40'`).get();
  assert.equal(likely.match_confidence, 'likely');

  // Before confirmation, the estimate is still the seeded round value.
  let pricing = await loadPricingForItems(env, ['cafe_whole_milk']);
  assert.equal(resolveItemEstimate({ id: 'cafe_whole_milk', vendor: 'Flexible', unit: 'gallon' }, pricing).sourceType, 'estimated');

  // Confirm the match + learn the vendor alias.
  const res = await readJson(await apiReceiptMatch(fakeRequest({
    purchase_id: likely.id, item_id: 'cafe_whole_milk', action: 'confirm', learn_alias: 1,
  }), env));
  assert.equal(res.body.action, 'confirmed');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM receipt_aliases`).get().n, 1, 'alias learned');

  // Now the confirmed actual (1107/3 = 369) drives the estimate.
  pricing = await loadPricingForItems(env, ['cafe_whole_milk']);
  const milk = resolveItemEstimate({ id: 'cafe_whole_milk', vendor: 'Flexible', unit: 'gallon' }, pricing);
  assert.equal(milk.sourceType, 'actual');
  assert.equal(milk.packageCents, 369);

  // A future identical vendor line now auto-matches as confirmed via the alias.
  await apiReceiptIngest(fakeRequest({
    receipt_id: 'R41', vendor: 'Flexible', purchase_date: '2026-07-12',
    lines: [line({ line_id: 1, description: 'WHOLE MILK GALLON', quantity: 3, net_cents: 1110 })],
  }, AUTH), envTok);
  const auto = db.prepare(`SELECT * FROM purchase_history WHERE receipt_id='R41'`).get();
  assert.equal(auto.match_confidence, 'confirmed');
  assert.equal(auto.match_method, 'alias');
});
