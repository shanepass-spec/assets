# STAGING_PLAN.md — church-account staging for receipts-email-intake v2.0

**HUMAN-GATED. Not executed.** No worker deployed, no Email Routing changed, no
secret set, no live storage touched. This is the plan to validate the v2.0
candidate in the **church** account (ffd360…) before it replaces the live v1.0.

## Guardrails (do not violate)
- Stage to a **separate** script name (e.g. `receipts-email-intake-staging`) so the
  live `receipts-email-intake` (v1.0) keeps serving until cutover.
- Point staging at a **staging downstream** or the real `receipts` app guarded by a
  distinct staging secret — never write test data into the production ledger.
- Do not modify the production Email Routing rule until cutover (a separate gate).

## Step 0 — Verify the one live assumption
On a **real** message already received by the live worker, capture the raw headers
and confirm:
- the exact `authserv-id` Cloudflare stamps on the first `Authentication-Results`
  (set `TRUSTED_AUTHSERV` to it), and
- that `dmarc=`, `dkim=`, `spf=` appear there.
If the format differs from the assumed `mx.cloudflare.net`, adjust the var. This is
the only assumption the offline tests could not cover.

## Step 1 — Deploy staging script
- `wrangler deploy` the candidate as `receipts-email-intake-staging` in the church
  account with `STAFF_ALLOWLIST`/`CHECK_ALLOWLIST` populated and a **staging**
  `INTAKE_SECRET`.
- Confirm `GET /health`: `version:v2.0`, `secret_set:true`, `deny_by_default:false`
  (once allowlist set), `trusted_authserv` correct.

## Step 2 — Route a test address
- Add a **new** Email Routing custom address (e.g. `receipts-staging@…`) → staging
  worker. Do not touch the production address.

## Step 3 — Smoke tests (mirror the offline suite against live ingress)
Send from real mailboxes and confirm outcomes + safe logs:
1. Allowlisted staff, real PDF/photo → **accepted**, one pending row, correct owner.
2. Allowlisted staff, forwarded receipt → **accepted** (routes to the staff forwarder).
3. Non-allowlisted sender → **rejected** `sender_not_allowlisted`, nothing stored.
4. Spoofed From (send from a domain failing DMARC as the staff address) → **rejected** `auth_*`.
5. Check address, non-check-allowlisted staff → **rejected** `check_not_authorized`.
6. Check address, check-allowlisted staff → **accepted** intent `check`.
7. Same receipt forwarded twice → second **suppressed** (needs `DEDUPE_KV` bound, else
   verify downstream `UNIQUE(dedupe_key)` prevents the duplicate row).
8. SVG / HTML-body-only / oversize → **rejected**; confirm nothing stored.
9. Kill the downstream briefly → confirm retry + dead-letter + a **visible** error
   (log/metric), and that a receipt is not lost.

## Step 4 — Cutover (separate authorization)
Only after Steps 0–3 pass and the secret rotation (SECRET_ROTATION_RUNBOOK) is ready:
- Repoint the **production** receipts address from v1.0 → v2.0 (or deploy v2.0 over
  the production script), with the rotated production secret.
- Watch logs/metrics for one business cycle. Keep v1.0 preserved for rollback.

## Step 5 — Retirement (separate authorization, D-2)
- Retire the personal-account v1.2 script and the old church v1.0 once v2.0 is stable.
- Tear down the staging script/address and staging secret.
