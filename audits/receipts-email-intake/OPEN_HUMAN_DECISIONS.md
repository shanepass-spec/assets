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

## D-2 — Which deployment is production? — FACT RESOLVED 2026-07-24; product choice remains
**The factual question is now VERIFIED:** production is the **church account
`ffd3…`, running v1.0.** Proof (read-only, metadata-only aggregate over downstream
D1 `pending_email_receipts`, no contents/PII read): 13 of 49 rows are `text/html`
body-captures — a behavior **only v1.0 produces** — most recent **2026-07-19**;
and **zero** rows carry `intent='check'` or a typed `note`, the outputs **only
v1.2 produces**. The newer personal **v1.2 is not wired to Email Routing** (which
lives in the church account per `deploy.yml`); it is an un-promoted iteration.

Consequence: the LIVE worker is the OLDER, less-safe **v1.0**, so **F-09 (raw-HTML
body-capture stored-XSS path) is a LIVE exposure** — ~27% of real intake traffic
(13/49) took that path. Conversely **F-04 (check-intent abuse) is currently
LATENT** — it only becomes live if v1.2 is promoted.

- **Decision that REMAINS (product, Shane's call):** target one hardened worker in
  the **church** account (structural — Email Routing for the domain is there) and
  either (a) harden v1.0 in place and retire personal v1.2, or (b) harden v1.2,
  promote it to church, and retire v1.0. Option (b) must gate check-intent (F-04)
  before going live.
- **Owner:** Shane. **Needed for:** converging to one version and prioritizing the
  live F-09 fix.

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
