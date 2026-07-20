# TabReady — Onboarding, Recovery & Media-Account Migration

**Status:** Discovery + design complete. **No live changes have been made.**
This package is the review gate described in the governing brief (§19 Deliverables). Nothing in
Cloudflare, D1, or `worker.js` has been modified. Every finding below was verified against the
**live code and the live production database**, not assumed from prior discussion.

**Prepared:** 2026‑07‑20 · **Against:** `workers/tabready/worker.js` `VERSION = '2.9.276'` (21,986 lines).

---

## How to read this package

| # | Document | Answers |
|---|----------|---------|
| 0 | [`00-executive-summary.md`](./00-executive-summary.md) | The 12 things Shane needs to know, and the recommended path. |
| 1 | [`01-current-state-findings.md`](./01-current-state-findings.md) | How onboarding, recovery, sessions, and home-screen installs work **today** — with `worker.js:line` evidence. |
| 2 | [`02-resource-inventory.md`](./02-resource-inventory.md) | Every Worker, D1, R2, KV, secret, binding, route, cron, and integration across both accounts. |
| 3 | [`03-url-audit.md`](./03-url-audit.md) | Every hard-coded URL / account identifier, each classified (keep / change / config-drive / redirect / remove). |
| 4 | [`04-migration-design.md`](./04-migration-design.md) | Permanent domain, compatibility bridge, session-transfer design, data-copy method, rollback, monitoring. |
| 5 | [`05-onboarding-design.md`](./05-onboarding-design.md) | Initial onboarding, Restore Access, delegated + batch + general-member onboarding, permission boundaries, audit model. |
| 6 | [`06-test-matrix.md`](./06-test-matrix.md) | iPhone / Android / desktop / old-link / QR / session / recovery / ministry-scope acceptance tests. |
| 7 | [`07-risk-register.md`](./07-risk-register.md) | Risk · likelihood · impact · mitigation · rollback · owner. |
| 8 | [`08-go-no-go-checklist.md`](./08-go-no-go-checklist.md) | The gate Shane signs before any cutover. |

## Decision log & authorization status

| Date | Decision / gate | Status |
|------|-----------------|--------|
| 2026‑07‑20 | **Permanent public hostname** = `https://tabready.thetabsrq.net` | ✅ **Confirmed by Shane** (documentation only) |
| — | Documentation update recording the hostname | ✅ **Approved** |
| — | **Code changes** (incl. the `CANONICAL_BASE_URL` config plumbing) | ⛔ **Not approved — on hold** |
| — | **Cloudflare / DNS / D1 / route / secret / deployment changes** | ⛔ **Not approved** |
| — | **Next gate:** Scout completes the security + migration review and records the approved sequence in **Relay** | ⏳ Pending |
| — | **First investigation after Scout's review:** reconcile the migration prep already present in the Media account + production DB (what is current, abandoned, or in‑progress) **before** Builder changes code or starts another migration path | ⏳ Queued (post‑review) |

> Recording the hostname locks the address as planning documentation; it does **not** authorize any implementation.
> No code, Cloudflare, DNS, D1, route, secret, or deployment change proceeds until Scout's review is recorded in Relay.

## Ground rules honored in this package

- **Discovery before change.** No Cloudflare/D1 mutations were performed. Read-only queries only.
- **No new public URLs** containing Shane's Worker name, account IDs, D1 IDs, or preview hosts are proposed for user-facing use.
- **Non-negotiable acceptance statement** (brief §20) is treated as the definition of done and restated in §00 and §08.
