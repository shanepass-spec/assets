# receipts-email-intake — Security & Correctness Audit

Read-only audit of the TabReady Cloudflare Email Worker **`receipts-email-intake`**,
which catches receipts forwarded to a receipts address, extracts the attachment
(or body), tags an intent (receipt vs check-request), and POSTs it to the
downstream `receipts` ledger app's `/api/intake` for human confirmation.

> **Scope isolation.** This project is deliberately separate from: the Guardian3.2
> control-plane audit, the Tab UI Design System / Section 5 swap, Snapshot 3046,
> and any control-plane history/rollback investigation. Nothing here touches those.

**Audit posture:** read-only inspection of the live deployed bundles + offline
reproduction. **No staging, no deploy, no email-route/DNS/secret/binding changes,
no live storage or DB writes, no receipt or rollback-source deletion** were
performed. Secret values are redacted everywhere.

## Artifacts
| File | What it is |
|---|---|
| [`CURRENT_INVENTORY.md`](CURRENT_INVENTORY.md) | Phase 1 — frozen inventory (routes, versions, bindings, storage, routing, status), VERIFIED/CLAIMED per line |
| [`GOVERNING_SPEC.md`](GOVERNING_SPEC.md) | Phase 2 — the frozen standard the worker is judged against |
| [`AUDIT_FINDINGS.md`](AUDIT_FINDINGS.md) | Phase 3/4 — 15 findings, each proven, with smallest correction + regression test |
| [`DATA_FLOW.md`](DATA_FLOW.md) | Full path trace incl. trust boundaries |
| [`TEST_PLAN.md`](TEST_PLAN.md) | Hostile-path coverage matrix + how to run |
| [`test/`](test/) | Offline reproduction (`intake.test.mjs`, `harness.mjs`) + captured `OUTPUT.txt` (12/12 pass) |
| [`deployed/`](deployed/) | Preserved **redacted** copies of both live bundles (rollback reference) |
| [`ROLLBACK_PLAN.md`](ROLLBACK_PLAN.md) | Non-destructive restore procedure (human-gated) |
| [`OPEN_HUMAN_DECISIONS.md`](OPEN_HUMAN_DECISIONS.md) | 5 decisions only Shane/Business Office can make |
| [`CHECKSUMS.txt`](CHECKSUMS.txt) | SHA-256 of preserved artifacts |

## Top risks (see AUDIT_FINDINGS.md for proof)
- **F-01 (Critical)** — shared `INTAKE_SECRET` is hard-coded in worker source
  (same literal across 3 scripts / 2 accounts); the ledger's intake endpoint is
  public. Forgeable intake channel.
- **F-02 (Critical)** — the receipt is routed to a user purely by the **unauthenticated
  `From` header** (no SPF/DKIM/DMARC). A forged `From` deposits an attacker item
  into a named staffer's lane.
- **F-03 / F-04 / F-05 / F-08 / F-09 / F-13 (High)** — accept-all sender default;
  attacker-controllable check-request intent; `image/svg+xml` + raw-HTML-body
  passthrough (stored-XSS chain); no idempotency/replay protection; downstream
  failures silently dropped.

## Reproduce the findings offline
```
node --test audits/receipts-email-intake/test/intake.test.mjs
```
No network, no secrets, no live resources. Latest result: 12 pass / 0 fail
([`test/OUTPUT.txt`](test/OUTPUT.txt)).

---

## RESTART RECORD
```
STATUS:            Audit complete (read-only). Corrections designed, NOT applied. No deploy.
TOOL:              receipts-email-intake  (Cloudflare Email Worker)
SOURCE:            No VCS source pre-audit. Live bundles pulled read-only 2026-07-24;
                   preserved redacted in deployed/. Personal script f26c03bdf9164d3d84081402b27219e4 (v1.2),
                   Church script ec69106405e34cc4b34ea7cb4a2c8798 (v1.0).
ROUTE:             GET /health + email() entrypoint. workers.dev health URL(s) exist but
                   were NOT reachable this session (proxy blocks *.workers.dev). Email Routing
                   rules NOT readable (no Email Routing API). Downstream: receipts.shanepass.workers.dev/api/intake.
CURRENT VERSION:   personal v1.2 / church v1.0 (divergent — F-11). PRODUCTION = church v1.0
                   (VERIFIED 2026-07-24 via D1 fingerprint aggregate); personal v1.2 un-promoted.
                   => live worker is the older/less-safe v1.0: F-09 is a LIVE exposure, F-04 latent.
GOVERNING SPEC:    GOVERNING_SPEC.md (frozen 2026-07-24).
LAST VERIFIED PROOF: Cloudflare API bundle retrieval + `node --test` (12/12), 2026-07-24.
OPEN FINDINGS:     F-01..F-15 all OPEN (none fixed). Criticals: F-01, F-02.
NEXT ACTOR:        Shane — resolve OPEN_HUMAN_DECISIONS D-1, D-3, D-4, D-5 (D-2 fact resolved).
NEXT SAFE ACTION:  D-2 fact resolved (prod = church v1.0). Get D-3 (auth policy) + D-2 product
                   choice (harden v1.0 in place vs promote hardened v1.2 to church); then
                   implement the smallest corrections behind a separately authorized deploy.
                   Prioritize the LIVE F-09 body-capture path in v1.0.
DO NOT:            Deploy/stage; change email routing/DNS/domains; change prod bindings/secrets;
                   modify live storage/DB; delete receipts or rollback sources; expose secret
                   values; overlap Guardian3.2 or Section 5; claim live status without proof.
SHANE NEEDED ONLY FOR: secret rotation (D-1), prod/version choice (D-2), sender auth &
                   check-intent policy (D-3), retention/privacy (D-4), cross-account boundary (D-5).
DO:                Read-only inspection, offline reproduction, documentation, test creation,
                   correction design — all complete here.
```

## CLOSEOUT
```
NEXT STEP:            Shane decides D-2 and D-3; then a separately authorized branch implements
                      F-01/F-02 first (fail-closed secret + SPF/DKIM-gated routing).
DONE:                 Phases 1-4 complete. Inventory + spec frozen; 15 findings proven; 12 offline
                      tests written & passing; both live bundles preserved (redacted) with checksums;
                      rollback plan + open-decisions recorded.
VERIFIED:             Existence/versions/code of both deployments; bindings & secret NAMES used;
                      downstream storage (R2 receipts-files, D1 receipts) & routing logic; F-01,F-02,
                      F-03,F-04,F-05(passthrough),F-06,F-07,F-08,F-09(passthrough),F-10,F-11,F-12,F-13,F-14;
                      clean probes (object-key, cross-user read, PII logging, delete/overwrite).
CLAIMED-NOT-VERIFIED: Live /health output & dashboard var/secret values (proxy + no vars API);
                      Email Routing address(es) & which account is prod; live-bundle byte checksum;
                      F-05/F-09 script EXECUTION (client-render dependent); F-15 end-to-end effect.
FAILED:               None (no test asserts a safe/correct behavior that the code violates and passes;
                      all 12 reproductions succeed).
HUMAN-GATED:          D-1 rotation deploy, D-2 prod/version, D-3 auth policy, D-4 retention/privacy,
                      D-5 cross-account boundary. Also: any live/e2e test, staging, or deploy.
OWNER:                Shane (decisions + authorized deploy). Auditor: this thread (offline only).
RESTART RECORD:       see above.
DONE LOOKS LIKE:      Both accounts converged to one supported version with: no in-source secret
                      (rotated), SPF/DKIM-gated routing (deny/hold default), strict type allow-list +
                      content sniff, idempotency/dedupe, confirmed-or-dead-lettered downstream calls,
                      inert serving, and source-of-truth in VCS — GOVERNING_SPEC S11 all green.
STOP CONDITIONS:      Hit & respected — a live email-route/prod/secret change and any e2e test are
                      required to go further, and Shane must decide ownership/privacy/retention (D-1..D-5).
```

## FINAL RULING
**FAIL — return for specific offline correction.**

The worker does not meet the governing spec: a hard-coded shared secret (F-01),
unauthenticated `From`-based routing (F-02), open sender default (F-03),
attacker-controllable check-request intent (F-04), active-content passthrough
(F-05/F-09), missing idempotency (F-08), and silent drop on downstream failure
(F-13) are each proven against the current deployed code. The specific,
smallest corrections and regression tests are enumerated in
[`AUDIT_FINDINGS.md`](AUDIT_FINDINGS.md); the deploy of any fix is gated on
[`OPEN_HUMAN_DECISIONS.md`](OPEN_HUMAN_DECISIONS.md) D-1/D-2/D-3 and must be a
separately authorized action (this audit performs none).
