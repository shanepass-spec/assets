# OPEN_HUMAN_DECISIONS.md — receipts-email-intake

Decisions only Shane / the Business Office can make. The audit stops at these;
none were actioned. Each blocks or shapes a specific correction.

## D-1 — Secret rotation authorization (blocks F-01 fix deploy)
The shared `INTAKE_SECRET` is hard-coded in source and shared across the intake
worker(s) and the downstream `receipts` worker. Removing the fallback requires a
coordinated **secret rotation + deploy** (a live production/secret change, out of
audit scope).
- **Decision:** approve rotation and schedule the coordinated deploy (see
  ROLLBACK_PLAN "Secret rotation note").
- **Owner:** Shane. **Until then:** F-01 stays open; do not deploy.

## D-2 — Which deployment is production? (blocks F-11 convergence)
Two live deployments diverge: personal `v1.2` (intent routing, single attachment)
vs church `v1.0` (all attachments + raw HTML body capture). The Email Routing
rules that decide which actually receives mail could not be read this session.
- **Decision:** confirm which account/address is the live receipts intake, which
  version is authoritative, and whether the other should be retired.
- **Owner:** Shane. **Needed for:** converging both accounts and closing F-09
  (only the church v1.0 body-capture path is exposed).

## D-3 — Sender authorization & authentication policy (shapes F-02/F-03/F-04)
What is the authoritative rule for "who may submit a receipt / seed a check
request"?
- Require SPF/DKIM/DMARC pass before auto-routing to a named user? (recommended)
- Default behavior when `ALLOWED_DOMAINS` is unset: deny, or hold-unassigned?
  (recommended: hold-unassigned)
- May subject/note keywords alone create a check-request draft, or only a
  dedicated authenticated address?
- **Owner:** Shane + Business Office. **Needed for:** the F-02/F-03/F-04 fixes.

## D-4 — Retention / privacy for held items (shapes F-09/F-13/F-14 handling)
- How long may unassigned/failed/orphaned intake items persist before cleanup?
- Is storing the raw HTML email **body** (church path) acceptable at all, or should
  intake forward sanitized text only?
- Dead-letter destination + retention for downstream-failed receipts (F-13)?
- **Owner:** Shane + Business Office. **Needed for:** F-09 scope, F-13 dead-letter,
  F-14 orphan-sweep policy.

## D-5 — Cross-account boundary (confirms F-02 impact ceiling)
The church-account worker posts into the **personal** account's `receipts` app.
Confirm this cross-account arrangement is intended and define the privacy boundary
for church receipts landing in a personal-account ledger.
- **Owner:** Shane. **Needed for:** finalizing the S9 privacy boundary.
