# TabReady v2.9.290 — Deploy Assets

Supports the **manual, gated Phase-A code release**
`.github/workflows/tabready-v2.9.290-code-release.yml`. Nothing here deploys on
its own, and the old `deploy.yml` no longer touches `tabready` (it is filtered
out of the matrix and hard-guarded).

## Two phases (Scout decision)
- **Phase A (this workflow):** deploy the v2.9.290 **code** to the existing
  **personal-account** Worker via Cloudflare versioned uploads. No Media-account
  migration, no cross-account data copy, no R2 migration, no DNS/route cutover,
  no session-bridge cutover. The only production write besides the code version
  is the **additive** D1 schema, taken with a pre-change backup.
- **Phase B (separate, later):** destination D1/R2 provisioning, full reconciled
  data copy, secret creation, session bridge, DNS/route cutover, exact cron
  recreation, real-device testing, source-account retirement.

## Identities
| Role | Version | SHA-256 |
|------|---------|---------|
| Candidate (`../worker.js`) | 2.9.290 | `2aeaed0af0eb3d2c7b22cb585859b89c3b5f13504a22d2529958bc290f88e2be` |
| Rollback target | 2.9.289 | `6aae0ec256efd5cf1c8db6eb093f7d62b859b1b4493643c9260a3bde2c60211b` |

## Phase-A workflow — what it actually executes
1. **build-verify-preview** (no traffic):
   - hash `worker.js` == candidate; version/vCard/migration structural checks;
   - run 16 migration + 7 vCard tests;
   - validate required secret **names** exist (no values);
   - capture the current live version id (rollback target);
   - **backup** the live D1 (`wrangler d1 export`, uploaded as an artifact);
   - apply the **additive** schema — guarded `ALTER ADD COLUMN` (skips if present) + `CREATE … IF NOT EXISTS`; then verify columns/tables exist;
   - `wrangler versions upload` → new version **without traffic** + preview URL;
   - **preview checks** on the versioned URL: `/health` == 2.9.290, `/api/vcard` unauth → 401, login/manifest reachable.
2. **promote** (GitHub `production` Environment — approval pauses **here, before any traffic change**):
   - gradual `wrangler versions deploy NEW@<canary> PREV@<rest>`;
   - verify at limited traffic (health/`/api/vcard`/login);
   - promote `NEW@100`; verify at 100% (version, `/api/vcard`, `/api/me` not 500).
3. **rollback** (`if: failure()`): redeploy the previous version at 100% (or `wrangler rollback`). **Additive schema is left in place** (backward-compatible — not reversed). Backup artifact retained.

## Files
- `../wrangler.toml` — personal-account config; `[triggers]`/`crons` **omitted** so the existing weekly cron is preserved. ⚠️ Verify the `CONTENT_DB` `database_id` matches the live binding before first run.
- `schema-auth-migration-v2.9.290.sql` — full one-time migration (v2.9.288→290).
- `schema-auth-migration-v2.9.290.create-only.sql` — idempotent CREATE subset used by the workflow.
- `legacy-bridge.js` — Phase-B bridge (not used in Phase A).
- `tests/` — 16 migration + 7 vCard no-regression suites (run in CI against the exact deploy bytes).
- `DEPLOYMENT-GATE.md` — full gate checklist (includes Phase-B items).

## One-time setup required from Shane before the first run
- Repo **Environment `production`** with required reviewers (gates the `promote` job).
- GitHub secrets `CF_API_TOKEN`, `CF_ACCOUNT_ID`.
- Confirm the pinned `WRANGLER_VERSION` and the `CONTENT_DB` `database_id`.

**Untested until first run:** exact `wrangler versions`/`rollback` flags and the
version-id parsing are written to current docs but have not executed against the
live account; the first run is the supervised proof.
