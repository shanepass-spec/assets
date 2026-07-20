# Deliverable 4 — Migration Design

Goal (brief §20): move TabReady from the personal Cloudflare account to the Media account **without** forcing
existing users to re-onboard, recreate accounts, recover departments, or depend on Shane for routine login — and
keep every existing personal `.workers.dev` link, QR, bookmark, and home-screen icon reaching the right place.

The design rests on four facts established in Deliverables 1–3:
1. The app is **origin-relative** (only `DIGEST_BASE` is hard-coded).
2. Sessions are **stateless HMAC cookies, host-only, no revocation** → the hard problem.
3. `SESSION_SECRET` identical across hosts ⇒ a signed token minted on the old host **verifies** on the new host.
4. Church domain `thetabsrq.net` is already Resend-verified; the **web** route for `tabready.thetabsrq.net` does not exist yet.

---

## 1. Permanent church-owned domain

- **Proposed:** `tabready.thetabsrq.net` (confirm final host with Shane before implementation — brief §8).
- **Stability contract:** the church domain is the *only* address that appears in **new** QR codes, links, emails,
  printed instructions, and docs. Workers, databases, maintainers, and even the Cloudflare account can change
  behind it without changing the public address.
- **Setup:** add `tabready.thetabsrq.net` as a **Custom Domain** on the production Worker (SSL auto-provisioned by
  Cloudflare). Do this in the account that will serve production (Media) at cutover; can be pre-staged on a
  non-production hostname (e.g. `tabready-stage.thetabsrq.net`) for private testing without touching live traffic.
- **`CANONICAL_BASE_URL`** config value (Deliverable 3 §D) is set to this host **only at cutover**; until then it
  stays unset so behavior equals today's (`request.origin`).

## 2. Data-copy method (D1 → D1, cross-account)

Source `tabready` D1 (`dcadb25c…`, personal) → target `tabready` D1 (`27f36d41…`, Media, currently a 24-table
empty skeleton — must receive the **full** ~70-table dataset).

Recommended, safest-first:
1. **Freeze-light:** pick a low-traffic window; optionally set a maintenance banner. Full data freeze is only
   needed for the final sync (see §6).
2. **Export:** `wrangler d1 export tabready --output tabready.sql` (or the D1 REST export) from the **personal**
   account — a complete SQL dump (schema + data).
3. **Load:** `wrangler d1 execute` / import the dump into the **Media** `tabready` DB. Because the Media DB already
   has a partial skeleton, **recreate it clean first** (or import into a fresh DB and repoint the binding) to avoid
   half-migrated `migration_ledger_*`/`wave1_backup` artifacts colliding.
4. **Reconcile (mandatory gate):** compare **row counts per table** and a **content checksum** source-vs-target.
   Baseline to match: **users 157, user_roles 227, roles 15, content 140, people_registry 21** (+ every other
   table). Internal user IDs (`usr_…`) must be **byte-identical** — they anchor sessions, audit history, roles,
   and PCO mapping. Any mismatch is a No-Go.
5. **R2:** copy `tabready-photos` and `tab-shared-docs` objects into Media buckets (rclone/`wrangler r2` or the
   S3 API). Photo keys are stored in D1 rows, so keys must be preserved exactly.
6. **Do NOT** carry forward the dated backup tables (`*_backup_*`, `wave1_backup`) as live data — keep them in the
   source for rollback only.

**Determinism note:** avoid live edits between export and cutover, or use the final-sync step (§6) to capture the
delta. Because there is no `sessions` table, sessions are **not** part of the data copy — they live only in
users' cookies, which is precisely why §4 (session transfer) exists.

## 3. Compatibility bridge (old host stays alive)

The personal Worker `tabready` at `tabready.shanepass.workers.dev` **is not deleted** (brief §21). After cutover it
becomes a thin **bridge** that:

1. **Preserves the full path + query string** on every forward — never redirect to the homepage (brief §9).
   `old/directory?x=1` → `https://tabready.thetabsrq.net/directory?x=1`.
2. For a request carrying a **valid existing session cookie**, performs the **session handoff** (§4) instead of a
   bare redirect, so the user lands logged-in on the church host.
3. For anonymous requests (incl. an old **printed QR** hitting `/auth/verify?token=…`), forwards path+query to the
   church host, where the same magic-link logic runs (tokens are DB-backed and host-agnostic).

Two build options for the bridge:
- **Simplest:** keep the bridge running the **same full Worker code** but with `CANONICAL_BASE_URL` pointed at the
  church host and a top-of-`fetch` shim that 302s non-handoff traffic onward. Same DB binding during a short
  dual-run, or read-only.
- **Leanest (preferred long-term, brief §7):** replace the old Worker with a **tiny redirect+handoff-only Worker**
  (no DB, no features) once the church host is stable. Keep it **indefinitely** — it's cheap and protects every
  legacy artifact.

## 4. Secure session transfer (the core of the non-negotiable requirement)

**Problem:** the `tabready_session` cookie is host-only (`worker.js:4879`, no `Domain=`), so it will **not** travel
from `…shanepass.workers.dev` to `…thetabsrq.net`. Without a handoff, every user is logged out on the new host.

**Solution — one-time transfer token, verified by the shared `SESSION_SECRET`:**

```
1. User opens old icon / old URL on tabready.shanepass.workers.dev.
2. Old bridge reads the valid tabready_session cookie → extracts user_id.
3. Bridge mints a BRIEF, SINGLE-USE transfer token:
      xfer = base64({ user_id, dest_path, exp: now+60s, jti }) + "." + HMAC(SESSION_SECRET, payload)
   (≤60s TTL; jti = random nonce.)
4. Bridge 302 → https://tabready.thetabsrq.net{dest_path}?__xfer=<token>
5. Church Worker verifies HMAC (same SESSION_SECRET) + exp + one-time jti.
6. Loads the SAME internal user_id from the migrated DB → same roles/departments.
7. Issues a fresh church-domain tabready_session cookie (identical mechanism).
8. Invalidates the jti (single-use) and 303-redirects to the clean dest_path (drops __xfer from the URL).
9. User is on the church host, logged in, at the page they wanted — no email code, no QR, no Shane.
```

Design constraints honored (brief §10, §16):
- Transfer token is **very brief (≤60s), single-use, tied to one user + one action**, HMAC-signed, never logged.
- Enforcing **single-use** requires a tiny server-side `jti` store on the church side (a `transfer_jti` D1 table
  with TTL cleanup, or a KV namespace with 60s TTL). This is the **one** new piece of server state the handoff
  needs. (Without it, "single-use" is best-effort within the 60s window.)
- `SESSION_SECRET` **must be identical** in both deployments for step 5 to work — see Deliverable 2.
- User messaging (adapt to TabReady's voice, brief §10): *"TabReady is moving to its permanent church address —
  your access is being transferred securely,"* then *"Access transferred."*

**Fallback:** if a user arrives on the church host with **no** transfer token and **no** cookie (e.g. cleared
data, brand-new device), they hit the normal login — which is exactly the case **Restore Access** (Deliverable 5)
is built to make painless without Shane.

## 5. Session revocation & lost-device support (new capability)

Because there is no revocation today (§01.3), add a **per-user token version**:
- New column `users.session_epoch INTEGER DEFAULT 0`; include `epoch` in the session payload; verify
  `payload.epoch === users.session_epoch` at auth time.
- "Sign out all my devices" / admin "revoke sessions for lost phone" = `UPDATE users SET session_epoch =
  session_epoch + 1`. All prior tokens fail verification instantly; the user re-authenticates once.
- This is additive and backward-compatible (existing tokens treated as epoch 0). It also gives the migration a
  clean **global** invalidation lever if ever needed, without rotating `SESSION_SECRET` (which would break the
  transfer bridge).

## 6. Cutover sequence (data-consistency)

1. Announce + optional maintenance banner in a low-traffic window.
2. **Freeze writes** on the source (read-only mode) for the final sync.
3. Take a **final backup** of the source D1 (and a snapshot of Media pre-load).
4. **Final export → import** (or delta sync) into Media `tabready`.
5. **Reconcile** row counts + checksums + spot-check 5 known users' IDs/roles (No-Go on mismatch).
6. Set Media secrets, R2 objects, **cron trigger**, and `CANONICAL_BASE_URL`.
7. Point `tabready.thetabsrq.net` (Custom Domain) at the **Media** Worker.
8. Convert the personal Worker to the **bridge** (with session handoff live).
9. Unfreeze; smoke-test on **real iPhone + Android devices** (Deliverable 6) before declaring done.

## 7. Rollback plan

| Trigger | Rollback |
|---|---|
| Reconcile mismatch pre-DNS | Abort; source untouched; nothing user-visible changed. |
| Church host serves errors post-DNS | Repoint `tabready.thetabsrq.net` back to (or leave) the personal Worker serving production; bridge not yet engaged. |
| Session handoff failing on devices | Disable handoff shim (bridge falls back to plain path-preserving redirect; users log in via Restore Access / code). |
| Data corruption discovered post-cutover | Restore source D1 from the final backup; source Worker still exists and can be re-promoted (it was never deleted — brief §21). |

**Snapshots to keep:** final source D1 export, pre-load Media snapshot, dated backup tables already in-DB, and the
`migration_ledger_*` ledger. Do not delete the personal Worker or its DB until Shane approves, with evidence
(brief §7, §21).

## 8. Monitoring plan (brief §14 Phase 6/7)

- **Health endpoint** must report the expected `VERSION` (2.9.276+) and DB connectivity on the church host.
- **Bridge telemetry:** count old-host hits, successful vs failed session handoffs, and top forwarded paths — this
  is how "prompt users to update saved icons only when necessary" (brief §7) is driven by evidence, not guesswork.
- **Email link health:** verify a real digest email now points at the church host (`DIGEST_BASE`→`CANONICAL_BASE_URL`).
- **PCO 429 watch:** confirm the migrated cron is warming `pco_group_cache`; a missing cron trigger reproduces the
  v2.9.267 rate-limit failure.
- **Auth funnel:** watch `login_codes` request→verify success rate to confirm the email-code loop mitigation.
- Alarm on: church host 5xx, handoff failure rate > threshold, digest send failures, cron non-execution.
