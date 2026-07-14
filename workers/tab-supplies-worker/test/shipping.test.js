// v2.1.1 shipping + order-total tests: unknown shipping is never $0, entered
// shipping folds into the order total, and the shipping estimate persists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOrderSummary, fmtMoney, ensurePricingSchema,
  loadShippingEstimates, apiShippingSave,
} from '../worker.js';
import { makeEnv, fakeRequest, readJson } from './helpers.js';

test('order summary is PENDING when a shipping vendor has no estimate', () => {
  // Items ≈ $909 (90900¢), ordering from Webstaurant, no shipping entered.
  const s = computeOrderSummary(90900, false, ['Webstaurant'], {});
  assert.equal(s.pending, true);
  assert.deepEqual(s.missing, ['Webstaurant']);
  assert.equal(s.knownShipping, 0, 'unknown shipping is never counted as $0 in a final total');
  assert.equal(s.total, 90900, 'total is the known item subtotal only, labeled pending');
  assert.equal(fmtMoney(s.total, s.exact), '≈ $909');
});

test('entered shipping folds into a complete order total', () => {
  const s = computeOrderSummary(90900, false, ['Webstaurant'], { Webstaurant: 8900 });
  assert.equal(s.pending, false);
  assert.equal(s.knownShipping, 8900);
  assert.equal(s.total, 99800); // 909 + 89
  assert.equal(fmtMoney(s.total, s.exact), '≈ $998');
});

test('no shipping vendors on the trip → total is complete, not pending', () => {
  const s = computeOrderSummary(5000, false, [], {});
  assert.equal(s.pending, false);
  assert.equal(s.total, 5000);
});

test('multiple shipping vendors: one missing keeps it pending', () => {
  const s = computeOrderSummary(10000, true, ['Webstaurant', 'Amazon'], { Amazon: 500 });
  assert.equal(s.pending, true);
  assert.deepEqual(s.missing, ['Webstaurant']);
  assert.equal(s.knownShipping, 500, 'known shipping still summed for display');
});

test('shipping estimate saves, updates, and clears (persistent)', async () => {
  const { db, env } = makeEnv();
  await ensurePricingSchema(env);

  let r = await readJson(await apiShippingSave(fakeRequest({ store: 'Webstaurant', cents: 8900 }), env));
  assert.equal(r.status, 200);
  assert.equal((await loadShippingEstimates(env)).Webstaurant, 8900);

  // Update (upsert, not duplicate)
  await apiShippingSave(fakeRequest({ store: 'Webstaurant', cents: 9500 }), env);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM shipping_estimates WHERE store='Webstaurant'`).get().n, 1);
  assert.equal((await loadShippingEstimates(env)).Webstaurant, 9500);

  // Clear (cents null) removes it → back to "Not entered"
  await apiShippingSave(fakeRequest({ store: 'Webstaurant', cents: null }), env);
  assert.equal((await loadShippingEstimates(env)).Webstaurant, undefined);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM shipping_estimates`).get().n, 0);
});

test('shipping save rejects a missing store or a negative amount', async () => {
  const { env } = makeEnv();
  await ensurePricingSchema(env);
  assert.equal((await readJson(await apiShippingSave(fakeRequest({ cents: 100 }), env))).status, 400);
  assert.equal((await readJson(await apiShippingSave(fakeRequest({ store: 'Webstaurant', cents: -5 }), env))).status, 400);
});
