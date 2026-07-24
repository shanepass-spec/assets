# ROLLBACK_PLAN.md — receipts-email-intake

Scope: how to restore a known-good version of this worker **without** performing
any destructive or live action during the audit. All deploy steps below are
**HUMAN-GATED** and explicitly out of scope for the read-only audit (STOP
conditions: live email route / production / secret changes).

## Preserved rollback sources (this repo)
- `deployed/personal-account-v1.2.worker.js` — personal account, current live logic
  (secret redacted).
- `deployed/church-account-v1.0.worker.js` — church account, current live logic
  (secret redacted).
- Integrity: SHA-256 in [`CHECKSUMS.txt`](CHECKSUMS.txt). These hashes cover the
  **redacted** copies; the live bundles differ only by the real `INTAKE_SECRET`
  literal (F-01), which must never be committed.

## What rollback restores / never touches
- Restores: **worker code only.**
- Never touches: stored receipts in R2 `receipts-files`, rows in D1 `receipts`
  (incl. `pending_email_receipts`, `receipts`, `check_requests`), Email Routing
  rules, DNS, or any secret value. Rollback is non-destructive by construction.

## Restore procedure (human-gated; do NOT run during this audit)
1. Choose target account + version (see OPEN_HUMAN_DECISIONS D-2 for "which is prod").
2. Confirm the dashboard secret `INTAKE_SECRET` is present in that account and
   matches the current downstream `receipts` secret. **Never** rely on the source
   fallback; it must be removed on the next corrected deploy (F-01).
3. Take the corresponding `deployed/*.worker.js`, re-insert **no** secret literal
   (the corrected version fails closed when the secret is unset).
4. Deploy via the normal sanctioned pipeline (Wrangler/dashboard) as a separately
   authorized action.
5. Verify `GET /health` returns `secret_set: true` and the expected `version`.

## Pre-change safety capture (recommended before any future deploy)
- Re-pull the then-current bundle read-only (`workers_get_worker_code`) and store
  it as `deployed/<account>-<version>-prechange.worker.js` so any deploy is itself
  reversible.

## v2.0 cutover rollback (option (b))
If the hardened `corrected/worker.js` (v2.0) is staged/cut over in the church
account and misbehaves:
1. Redeploy the preserved **church v1.0** bundle (`deployed/church-account-v1.0.worker.js`,
   re-inject the secret at deploy — never from source) OR repoint the production
   Email Routing address back to the still-present v1.0 script if you staged v2.0
   under a separate name (recommended — see STAGING_PLAN Step 1).
2. Because the rotation window keeps `INTAKE_SECRET_PREV` valid downstream
   (SECRET_ROTATION_RUNBOOK), reverting the intake side drops no receipts.
3. Rollback restores code/routing only — never delete receipts, R2 objects, or D1
   rows. The v2.0 dedupe is idempotent, so a re-run after rollback cannot double-write.

## Secret rotation note (F-01)
Rotating `INTAKE_SECRET` must be done on the intake worker(s) **and** the
downstream `receipts` worker **together**; a one-sided rotation black-holes every
receipt because the intake worker ignores the resulting 403 (F-13). Sequence:
set new secret on `receipts` (accept old+new briefly if code allows) → set on
intake → verify `/health` + a sanctioned test forward → retire old. This is a
human-gated change (D-1).
