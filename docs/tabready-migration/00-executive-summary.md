# Deliverable 0 — Executive Summary

**For Shane. No live changes have been made.** This is the discovery + design review gate. Everything below was
verified against the **live `worker.js` (v2.9.276) and the live production database**, not assumed.

## The 12 things to know

1. **TabReady is a real, ~150-person production system.** Live DB: **157 users** (5 admins), **227 role
   assignments** across **15 roles**, **140 content resources**. Migration must be non-destructive.

2. **Onboarding today is admin-only and one-at-a-time.** Two code paths create users — admin "Add Person" and a
   **dormant** secret-gated machine "provision" endpoint. Each mints an individual, single-use, expiring magic-link
   QR. **There is no self-service signup, no batch onboarding, and no delegation** — everything routes through a
   global admin (you).

3. **There is no Restore Access flow.** A returning user who lost their phone/login has only ordinary email login
   (code or link) or an admin manually re-issuing a link. The **"email-code loop" is real and reproducible**: the
   server always says "code sent" even when email fails, with **no rate limit on requests**, so users can loop
   forever with no way out but you.

4. **Sessions are the hard part.** They're **stateless signed cookies with no `Domain`** → **a session will not
   survive a hostname change**, and there is **no way to revoke one** (short of logging everyone out). Moving hosts
   logs everyone out *unless we build an explicit, secure session handoff.*

5. **The good news: `SESSION_SECRET` shared across hosts makes a seamless handoff feasible.** A ≤60-second,
   single-use transfer token minted on the old host verifies on the new one → users land logged-in on the church
   domain with no email code. This is the mechanism that satisfies your non-negotiable requirement.

6. **The app is almost entirely origin-relative** — QR links, manifest, and service worker are all relative and
   the service worker caches nothing. **The only hard-coded personal URL is `DIGEST_BASE`**, and it sits inside
   **monthly digest emails users click**. That single value must become config-driven; almost nothing else needs
   URL changes.

7. **The church domain is already half-ready.** `thetabsrq.net` is **already a verified email sending domain**
   (`tabready@thetabsrq.net`). The permanent public address is **`https://tabready.thetabsrq.net`** (**confirmed by
   Shane 2026‑07‑20**). What's missing is the **web** route for it — a Custom Domain on the Worker.

8. **Home-screen installs are genuine PWAs, and favorable for migration.** No stale cached shell is pinned to the
   old host; only the installed icon's `start_url` points at the old host — which is exactly why the **old Worker
   must stay alive as a bridge** that forwards (path + query preserved) into the church host with a session
   handoff. Real-device iPhone + Android testing is required before mass onboarding.

9. **Migration has already been partly started by someone/something.** The Media account already has a `tabready`
   database (**schema skeleton, 0 users, 0 data**) and restore-test DBs; the source DB has `migration_ledger_*` and
   `wave*_backup` tables; the deploy pipeline is already dual-account aware. **Reconcile with that in-flight work
   before acting** — this plan assumes a clean, ledgered cutover.

10. **Nothing moves between Cloudflare accounts automatically.** Secrets live in Cloudflare (not the repo) and a
    fresh Media deploy starts with **zero** secrets; D1 IDs, R2 buckets, routes, and the **weekly cron** must all
    be recreated. A migrated Worker with no cron silently reproduces the PCO rate-limit failure and stops digests.

11. **The delegation model is ~30% there.** Member / Volunteer / Admin already work cleanly. **Ministry Leader** is
    half-built across two unrelated primitives; **Onboarding Helper** and any ministry-scoped role-granting are
    entirely absent — that's the bulk of the onboarding build, and it needs explicit server-side self-promotion
    guards.

12. **One real bug found:** the admin "Add Person" link is minted for **15 minutes** but the UI tells the admin
    it's "good for 7 days" (`worker.js:3472` vs `18200`). Fix during the build.

## Recommended sequencing (maps to brief §14 phases)

1. **Phase 2 first, safely:** ship the `CANONICAL_BASE_URL` config plumbing (zero behavior change until set) and
   fix the link-copy bug. Stand up `tabready.thetabsrq.net` as a Custom Domain (can pre-stage).
2. **Phase 3:** build Restore Access + "I previously had TabReady" + code-request rate-limit + session revocation
   (`session_epoch`). This removes you as the recovery desk and can ship on the current host **before** the account
   move.
3. **Phase 4/5:** clean full data copy into Media with **row-count + checksum reconcile** and byte-identical user
   IDs; recreate secrets/bindings/cron; build the old-host **bridge + session handoff**; test on real devices.
4. **Phase 6:** freeze → final sync → reconcile → point the church domain at Media → convert old Worker to bridge
   → verify on real iPhone + Android. **Go/No-Go gate (Deliverable 8) is signed before DNS.**
5. **Phase 7:** keep the bridge indefinitely; prompt icon updates only when telemetry shows it's needed.

## What I did **not** do (by design)

- No Cloudflare/D1/Worker mutations. No code changes to `worker.js`. No DNS/route changes. No mass actions.
- All database access was **read-only** discovery.
- Final hostname, and the go-ahead to build/cut over, are yours to approve.

## Where to go next
Read **[01 Current-State Findings](./01-current-state-findings.md)** for the evidence, then
**[04 Migration Design](./04-migration-design.md)** and **[05 Onboarding Design](./05-onboarding-design.md)** for
the build, and gate on **[08 Go/No-Go](./08-go-no-go-checklist.md)**.
