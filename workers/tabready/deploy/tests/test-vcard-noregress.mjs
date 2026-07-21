// Explicit /api/vcard + Medical Team no-regression checks for the rebased 2.9.290 candidate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from './worker.build.js';

const src = readFileSync(new URL('./worker.build.js', import.meta.url), 'utf8');
const results = [];
async function test(name, fn){ try { await fn(); results.push(['PASS',name]); } catch(e){ results.push(['FAIL',name,e.stack||String(e)]); } }

// Minimal stub env: enough for the router to reach the vcard auth gate.
const env = {
  SESSION_SECRET: 'x', CANONICAL_BASE_URL: 'https://tabready.thetabsrq.net',
  DB: { prepare(){ return { bind(){ return this; }, async first(){ return null; }, async all(){ return {results:[]}; }, async run(){ return {}; } }; } },
};

// 1. Source-level: the live vcard surface is present and intact in the rebased build.
await test('vcard: apiVcard function defined', async () => {
  assert.match(src, /async function apiVcard\s*\(/);
});
await test('vcard: router wires GET /api/vcard', async () => {
  assert.match(src, /path === '\/api\/vcard' && method === 'GET'/);
});
await test('vcard: Medical Team Save/vCard control present', async () => {
  assert.match(src, /\/api\/vcard\?id=/);         // Save button links to vcard export
  assert.match(src, /canSeeMedicalTeam/);          // gate helper retained
});
await test('vcard: mailto Email control retained on Medical Team card', async () => {
  assert.match(src, /href="mailto:/);
});

// 2. Functional: the endpoint still enforces auth (no-regression of behavior).
await test('vcard: unauthenticated GET /api/vcard is rejected (401)', async () => {
  const r = await worker.fetch(new Request('https://tabready.test/api/vcard?id=abc'), env, {});
  assert.equal(r.status, 401);
});
await test('vcard: route still resolves (not 404) — endpoint exists in rebased build', async () => {
  const r = await worker.fetch(new Request('https://tabready.test/api/vcard?id=abc'), env, {});
  assert.notEqual(r.status, 404);
});

// 3. Migration features co-exist (spot check they didn't get clobbered by preserving vcard).
await test('migration: /health still reports 2.9.290 + baseline 6aae0ec2', async () => {
  const r = await worker.fetch(new Request('https://tabready.test/health'), env, {});
  const d = await r.json();
  assert.equal(d.version, '2.9.290');
  assert.equal(d.baseline_sha256, '6aae0ec256efd5cf1c8db6eb093f7d62b859b1b4493643c9260a3bde2c60211b');
});

for (const r of results) console.log(r[0]+' - '+r[1]+(r[2]?'\n'+r[2]:''));
const failed = results.filter(r=>r[0]==='FAIL').length;
console.log(failed? `\n${failed} vcard no-regression test(s) failed` : `\nAll ${results.length} vcard no-regression tests passed.`);
process.exit(failed?1:0);
