# Deliverable 8 — Go / No-Go Checklist

Shane signs this gate **before** the DNS cutover in Deliverable 4 §6 step 7. Every item is a hard gate — a single
unchecked **No-Go** item stops the cutover. Do **not** declare complete on deployment success alone (brief §21).

## The non-negotiable acceptance statement (brief §20) — restated

> Moving TabReady from the personal Cloudflare account to the Media account must **not** require existing users to
> re-onboard, create a new account, recover their departments, or depend on Shane for routine access restoration.
> Existing personal `.workers.dev` links, QR codes, bookmarks, text links, and home-screen icons must continue to
> reach the corresponding church-domain TabReady location. Existing identities, roles, and department permissions
> must remain intact. Where technically possible, valid sessions must transfer securely to the church domain
> without requiring an emailed code.

Every checkbox below exists to prove that statement true.

---

## A. Domain & configuration
- [ ] Final church hostname **confirmed by Shane** (e.g. `tabready.thetabsrq.net`).
- [ ] Custom Domain wired to the **Media** production Worker; SSL valid.
- [ ] `CANONICAL_BASE_URL` set to the church host; digest email verified to use it (G12).
- [ ] No public link/QR/email/print contains personal Worker name, `workers.dev`, account/D1/Worker IDs, or preview host.

## B. Data integrity (hard gate)
- [ ] Media `tabready` DB loaded **clean** (no stale skeleton/partial artifacts merged).
- [ ] Row counts match source: **users 157, user_roles 227, roles 15, content 140, people_registry 21**, and every other table (G1).
- [ ] Internal `usr_…` IDs **byte-identical** source vs Media (G2).
- [ ] Per-user roles/departments diff is empty (G3).
- [ ] R2 `tabready-photos` + `tab-shared-docs` objects copied; photo keys resolve on church host (G11).
- [ ] Final source backup + pre-load Media snapshot captured.

## C. Bindings, secrets, jobs
- [ ] All bindings present in Media: `DB, PHOTOS, DOCS` (G4).
- [ ] All secrets set in Media: `SESSION_SECRET` (identical), `PROVISION_SECRET, PCO_APP_ID, PCO_SECRET, RESEND_API_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY` (identical), `ANTHROPIC_API_KEY, SCHEDULE_INTAKE_SECRET`.
- [ ] `SESSION_SECRET` round-trip verified (token minted on old host verifies on church host).
- [ ] Weekly **cron trigger** recreated on the Media Worker; cache warm + digest tested (G5).
- [ ] Resend `thetabsrq.net` verified for the Media deployment's key (G6, R19).
- [ ] Health endpoint reports version `2.9.276`+ on church host (G7).

## D. Compatibility bridge & sessions
- [ ] Old personal Worker **still running** as the bridge (not deleted — brief §21).
- [ ] Bridge preserves **full path + query** (E2, R10).
- [ ] Session **handoff** works on real iPhone **and** Android — logged in, no email code (E3, M6).
- [ ] Transfer token **single-use + ≤60s expiry** enforced (E9, E10).
- [ ] Existing home-screen icons (iOS + Android, shortcut + installed PWA) reach church host logged in (E8, M1‑M4, M13).
- [ ] Expired/cleared-data users fall through to login/Restore Access with **no loop** (M7, M8).

## E. Onboarding, recovery, delegation (if shipping in this cutover)
> These are Phase-3 build items; check only the ones included in this cutover. Migration can cut over **before**
> these ship — but the "no dependence on Shane for routine restoration" clause needs at least Restore Access live.
- [ ] **Restore Access** live: fresh recovery QR, no duplicate user, permissions preserved, works without email, single-use, audited (R1‑R8).
- [ ] **"I previously had TabReady"** path + code-request rate limit (R9, R10 recovery-side).
- [ ] Delegated scope enforced **server-side**; no cross-ministry/self-promotion (D2‑D7).
- [ ] Session revocation (`session_epoch`) available for lost devices (R7).
- [ ] Link-copy defect fixed: 7-day link actually lasts 7 days (N9 / §01.3).

## F. Rollback readiness
- [ ] Personal Worker + source DB intact and re-promotable (G8, R9).
- [ ] Documented rollback steps rehearsed for: reconcile-mismatch, church-host errors, handoff failure, data corruption (D4 §7).
- [ ] Monitoring live: church 5xx, handoff failure rate, digest sends, cron execution, PCO 429 (D4 §8).

## G. Process
- [ ] Reconciled with any **in-flight** migration work (existing restore-runner / ledgers / wave backups) — no collision (R16).
- [ ] Cutover scheduled in a low-traffic window with maintenance messaging.
- [ ] **Mobile transition tests complete before any mass onboarding** (brief §11).
- [ ] Shane has reviewed this package and explicitly approved the gate.

---

### Decision

| | Name | Date | Signature |
|---|---|---|---|
| **GO / NO-GO** | Shane | ________ | ________ |

A **GO** authorizes only the cutover sequence in Deliverable 4 §6. Post-cutover, the old bridge remains
indefinitely (brief §7); removing it is a **separate** later decision requiring its own evidence of near-zero
legacy traffic.
