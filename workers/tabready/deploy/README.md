# TabReady v2.9.290 — Gated Deploy Assets

This directory supports the **manual, gated** deployment workflow
`.github/workflows/tabready-v2.9.290-gated-deploy.yml`. Nothing here deploys on
its own.

## Why this exists
The old `.github/workflows/deploy.yml` deployed `workers/<name>/worker.js` to
production **on every push to `main`**. For `tabready` that was unsafe: a merge
could overwrite live production with whatever `worker.js` happened to be on
`main`. `deploy.yml` has been changed to **never auto-deploy `tabready`** (it is
filtered out of the matrix and hard-guarded); all other workers are unaffected.
TabReady now deploys **only** through the gated workflow.

## Identities
| Role | Version | SHA-256 |
|------|---------|---------|
| Candidate (`../worker.js`) | 2.9.290 | `2aeaed0af0eb3d2c7b22cb585859b89c3b5f13504a22d2529958bc290f88e2be` |
| Rollback target | 2.9.289 | `6aae0ec256efd5cf1c8db6eb093f7d62b859b1b4493643c9260a3bde2c60211b` |

`/health` reports `version=2.9.290` and `baseline_sha256=6aae0ec2…` (the live
baseline this build was derived from). The workflow separately verifies the
**deployed artifact** hashes to the candidate `2aeaed0a…`.

## Contents
- `legacy-bridge.js` — redirect/handoff-only old-host bridge (no app D1/R2 binding).
- `schema-auth-migration-v2.9.290.sql` — additive migration (`transfer_jti`, `session_epoch`, restore tables). Reversible.
- `DEPLOYMENT-GATE.md` — the full gate checklist.
- `tests/` — `test-build.mjs` (16 migration) + `test-vcard-noregress.mjs` (7 vCard) + the candidate/bridge under test.

## Workflow stages (all must pass; production is also human-gated)
1. **verify-candidate** — worker.js hash == candidate; version/vCard/migration present; 16+7 tests.
2. **config-validation** — required secret *names* exist (no values printed).
3. **schema-migration** — additive schema to staging D1.
4. **provision-staging** — ensure Media staging D1/R2; set staging secrets.
5. **data-copy-integrity** — export source → import staging → reconcile counts/checksums/`usr_*` IDs (fail on mismatch).
6. **deploy-staging** — candidate + bridge to an isolated staging host.
7. **test-staging** — health/version, `/api/vcard` 401, auth, bridge behaviour.
8. **deploy-production** — needs *all* prior + the GitHub `production` Environment approval (reviewer attests real-device iPhone/Android tests and DNS-cutover readiness — the two things CI cannot do). Only runs when `stage=production`.
9. **verify-production** — deployed hash == candidate; health; primary workflows; `/api/vcard`; bindings; cron; error rates; row-count/integrity == source.
10. **rollback** — automatic on any production-stage failure → restore v2.9.289 / `6aae0ec2`; keep prior version + backups.

## Privileged setup still required from Shane (one-time)
- Add repo **Environment `production`** with required reviewers (so step 8 pauses for human approval).
- Ensure GitHub secrets exist: `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_API_TOKEN_CHURCH` (+ the Worker secrets set on the deployments themselves).
- Confirm the exact weekly **cron** schedule from the current Worker's Triggers (not exposed via tooling) so it can be recreated on Media.
