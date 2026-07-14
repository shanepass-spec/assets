// Pure pricing-engine tests: tier math, price-source priority, exact vs round
// formatting, and client/server tier parity. No DB required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtMoney, resolveItemEstimate, computeLine, pricingClientLib } from '../worker.js';

// Build a pricing context (the shape loadPricingForItems returns).
function ctx(itemId, prices = [], tiers = [], purchases = []) {
  return {
    prices: new Map(prices.length ? [[itemId, prices]] : []),
    tiers: new Map(tiers.length ? [[itemId, tiers]] : []),
    purchases: new Map(purchases.length ? [[itemId, purchases]] : []),
  };
}
const today = new Date().toISOString().slice(0, 10);

test('exact prices show cents, estimates show whole dollars with ≈', () => {
  assert.equal(fmtMoney(25245, true), '$252.45');
  assert.equal(fmtMoney(400, false), '≈ $4');
  assert.equal(fmtMoney(77480, true), '$774.80');
  assert.equal(fmtMoney(null, true), '—');
});

test('quantity tiers: bulk price applies at/above min_qty, base below it', () => {
  const item = { id: 'main_large_plates', vendor: 'Webstaurant', unit: 'case' };
  const prices = [{ item_id: item.id, store: 'Webstaurant', price_cents: 6099, is_exact: 1, source_type: 'confirmed', unit_of_measure: 'case' }];
  const tiers = [{ item_id: item.id, store: 'Webstaurant', min_qty: 2, price_cents: 5049 }];
  const est = resolveItemEstimate(item, ctx(item.id, prices, tiers));

  assert.equal(computeLine(est, 1, 'Webstaurant', tiers).lineCents, 6099, '1 case = base');
  const five = computeLine(est, 5, 'Webstaurant', tiers);
  assert.equal(five.lineCents, 25245, '5 cases = bulk tier');
  assert.equal(five.tierApplied, true);
});

test('Webstaurant 5-case seed reproduces $774.80 exactly', () => {
  const seeds = [[6099, 5049], [4199, 3749], [3049, 2749], [4149, 3949]];
  const total = seeds.reduce((s, [, tier]) => s + 5 * tier, 0);
  assert.equal(total, 77480);
  assert.equal(fmtMoney(total, true), '$774.80');
});

test('price-source priority: store actual > confirmed web price', () => {
  const item = { id: 'main_clear_cups', vendor: 'Webstaurant', unit: 'case' };
  const prices = [{ item_id: item.id, store: 'Webstaurant', price_cents: 4199, is_exact: 1, source_type: 'confirmed' }];
  const purchases = [{ item_id: item.id, vendor: 'Webstaurant', purchase_date: today, unit_price_cents: 3899 }];
  const est = resolveItemEstimate(item, ctx(item.id, prices, [], purchases));
  assert.equal(est.sourceType, 'actual');
  assert.equal(est.packageCents, 3899);
});

test('price-source priority: round estimate when nothing better exists', () => {
  const item = { id: 'cafe_whole_milk', vendor: 'Flexible', unit: 'gallon' };
  const prices = [{ item_id: item.id, store: null, price_cents: 400, is_exact: 0, source_type: 'estimated', unit_of_measure: 'gallon' }];
  const est = resolveItemEstimate(item, ctx(item.id, prices));
  assert.equal(est.sourceType, 'estimated');
  assert.equal(est.isExact, false);
  assert.equal(fmtMoney(computeLine(est, 3, 'Flexible', []).lineCents, false), '≈ $12');
});

test('manual lock is never auto-replaced, even by a fresh actual', () => {
  const item = { id: 'main_clear_cups', vendor: 'Webstaurant', unit: 'case' };
  const prices = [
    { item_id: item.id, store: 'Webstaurant', price_cents: 4199, is_exact: 1, source_type: 'confirmed' },
    { item_id: item.id, store: 'Webstaurant', price_cents: 5000, is_exact: 1, source_type: 'confirmed', manual_locked: 1 },
  ];
  const purchases = [{ item_id: item.id, vendor: 'Webstaurant', purchase_date: today, unit_price_cents: 3899 }];
  const est = resolveItemEstimate(item, ctx(item.id, prices, [], purchases));
  assert.equal(est.packageCents, 5000);
  assert.equal(est.locked, true);
});

test('items with no price resolve to "no estimate"', () => {
  const item = { id: 'x', vendor: 'Publix', unit: 'each' };
  const est = resolveItemEstimate(item, ctx(item.id));
  assert.equal(est.hasEstimate, false);
  assert.equal(computeLine(est, 3, 'Publix', []).lineCents, null);
});

test('client tier mirror agrees with the server', () => {
  const g = {};
  new Function('window', pricingClientLib()).call(g, g);
  assert.equal(g.TSCost.lineCents(6099, [[2, 5049]], 5), 25245);
  assert.equal(g.TSCost.lineCents(6099, [[2, 5049]], 1), 6099);
  assert.equal(g.TSCost.fmt(77480, true), '$774.80');
  assert.equal(g.TSCost.fmt(1200, false), '≈ $12');
});
