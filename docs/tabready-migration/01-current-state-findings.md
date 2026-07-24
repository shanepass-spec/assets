# Deliverable 1 — Current-State Findings

All findings verified against live `workers/tabready/worker.js` (`VERSION 2.9.276`, 21,986 lines) and the
**live production D1 database** (`tabready`, `dcadb25c-d503-45a7-9e29-254c2d5f50e5`, Shane's account
`26c8013cfb2cf72dde19e55e6cf390b1`). Citations are `worker.js:LINE`.

## 0. Live production scale (queried 2026‑07‑20)

| Metric | Value |
|---|---|
| Users | **157** (5 global admins) |
| Role assignments (`user_roles`) | 227 across **15** roles |
| Content resources | 140 |
| People registry | 21 |
| Historical magic links | 226 · Login codes | 11 · Push subscriptions | 2 |

This is a real, in-use system for ~150 volunteers/staff. Migration must be non-destructive.

---

## 1. How onboarding works today

### 1.1 New users are created **only** by an admin or a machine secret — never self-service

There are exactly **two** `INSERT INTO users` paths in the entire file (`worker.js:3462`, `worker.js:3592`):

| Path | Route | Gate | Behavior |
|---|---|---|---|
| Admin "Add Person" | `POST /api/admin/users` → `apiAdminCreateUser` (`3435`) | `is_global_admin` (`3438`) | Creates a new `users` row (`id = 'usr_'+uuid`), assigns roles from the request, mints a login link + QR. 409 on duplicate email. |
| Machine provision | `POST /api/provision` → `apiProvision` (`3560`) | header `x-provision-secret == env.PROVISION_SECRET` (`3563`) | **Idempotent upsert by email**; adds mapped roles (never removes); hard-codes `is_global_admin=0`. **Dormant** — returns 503 if the secret is unset (`3562`). |

**There is no public sign-up.** The root page serves a login page (`worker.js:1002`); `handleAuthRequest`/`handleAuthCodeRequest` only proceed if the email **already** maps to a user (`worker.js:1343`, `1420`) and otherwise return a generic "if that email is on file…" response. A stranger cannot enroll.

### 1.2 The onboarding credential is a magic link, rendered as a QR

- **QR generation is in-app** (bundled MIT QR library, `worker.js:5596‑7843`; wrapper `qrSvg()` at `7887`). Comment: "generated in-app so a login token never leaves Cloudflare." It renders an SVG — no external QR service, no canvas.
- **The QR encodes a login URL:** `` `${new URL(request.url).origin}/auth/verify?token=${token}` `` (`worker.js:3477`, identical at `3511/3546/3612/1352`).
- **Embedded hostname = the request host.** It is **not** hard-coded and **not** a config constant — the QR points at whatever host served the admin's browser when they generated it. Today that is `tabready.shanepass.workers.dev` (Shane's personal Worker). *Implication: QR/host correctness is automatically inherited from wherever the app is served — which both helps (relative) and hurts (a QR generated on the old host embeds the old host).*

### 1.3 The credential is single-use and expiring — enforced server-side

Token = `crypto.randomUUID() + '-' + crypto.randomUUID()` (~244 bits) stored in `magic_links(token,user_id,expires_at,used_at)`.

- **Single-use** is enforced on the POST confirm, not the GET: `handleAuthVerify` GET (`1480`) validates but deliberately does **not** consume (so email/SMS link-scanners can't burn the token, `1493‑1498`); `handleAuthVerifyConfirm` POST (`1502`) checks `used_at`/expiry then `UPDATE magic_links SET used_at = unixepoch()` (`1520`) and creates the session.
- **Expiry constants** (`worker.js:739‑742`): login link 15 min · admin relink 1 hr · **onboarding link 7 days** · login code 15 min.
- Minting a new link invalidates the user's prior unused links (`1365`, `3502`, `3537`, `3605`).

> ⚠️ **Defect found:** the admin "Add Person" endpoint mints its token with the **15‑minute** `MAGIC_LINK_EXPIRY_SECONDS` (`worker.js:3472`), but the UI tells the admin the link is *"good for 7 days"* (`worker.js:18200`). The dedicated onboard-link and provision paths correctly use 7 days. This should be reconciled during the build.

### 1.4 Roles/departments are assigned **before** activation

Roles are written into `user_roles` at the moment the account is created (`3465‑3469` admin; `3596‑3601` provision), `assigned_by = admin.id | 'provision'`. When the user later taps the link, **no role logic runs** — activation is pure login (`1520‑1523`). So roles are pre-provisioned by the admin/orchestrator, not chosen by the user.

### 1.5 What is **missing** today

| Capability the brief requires | Status |
|---|---|
| Dedicated **Restore Access** flow (distinct from onboarding) | ❌ **Does not exist.** Closest is admin **relink** (`POST /api/admin/users/relink`, `3487`) — admin-only, 1‑hr link, mechanically identical to onboarding. |
| **"I previously had TabReady"** on the login screen | ❌ Not present. `loginPage()` (`12962`) offers only email→code / email→link. |
| **Batch / roster onboarding** of login accounts | ❌ Not present. PCO roster sync (`9013`) syncs *role membership*, not `users` accounts, one email per provision call. |
| **Self-service general-member** path | ❌ Not present. |
| **Delegated onboarding** (non-admin can invite within a ministry) | ❌ Not present. Every create/relink/onboard/role endpoint is `is_global_admin`-gated. |

---

## 2. How recovery works today

There is **no account-recovery flow separate from ordinary login.** A returning user re-authenticates through:

1. **Email code** — `/auth/code/request` → 6-digit code (`login_codes`), 15 min, newest-only, **5-attempt cap on verify** (`1461`).
2. **Email magic link** — `/auth/request` → link, 15 min, two-phase single-use.
3. **Admin relink** (`/api/admin/users/relink`) — admin manually mints a fresh 1-hr link when a user's email drops the automated message.

### 2.1 The "email-code loop" is real and reproducible

`handleAuthCodeRequest` (`1408`) **always returns generic success** regardless of whether Resend actually delivered (`1440`), and the login UI (`sendCode`, `3011`) doesn't even read the response — it unconditionally advances to "enter code." There is **no rate limit on code *requests*** (the 5-attempt cap is only on verify). So: request → nothing arrives (spam filter / bad address / provider drop) → "Send a new code" (`resend()`, `13052`) → repeat forever, no error ever surfaced. This is exactly the failure the brief calls out, and it traps users with no admin-free way out.

---

## 3. Session behavior — the single biggest migration constraint

**Sessions are stateless, HMAC-signed cookies. There is no `sessions` table.** (`createSessionToken`/`verifySessionToken`, `worker.js:4850‑4867`.)

```
tabready_session = base64(JSON{user_id, exp}) + "." + HMAC-SHA256(SESSION_SECRET, payload)
```

Cookie attributes (`sessionCookie()`, `worker.js:4878`): `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=34560000` (**400 days**), **no `Domain=` attribute** → **host-only cookie**. Rolling-refreshed on every `/api/me` (`1590‑1602`).

Two consequences that drive the whole migration design:

1. **A session does NOT survive a hostname change.** Because the cookie is host-only, the browser will never send `tabready_session` set on `tabready.shanepass.workers.dev` to `tabready.thetabsrq.net`. Moving hosts logs everyone out **unless we build an explicit session-transfer handoff** (see Deliverable 4 §Session Transfer). Note: the signature *would* validate on the new host if `SESSION_SECRET` is identical — this is what makes a short-lived transfer token feasible.
2. **There is no server-side session revocation.** No version, no blocklist. A token is valid until its 400-day `exp`. The only lever is rotating `SESSION_SECRET`, which force-logs-out **everyone** at once. The brief's "revoke old device sessions when a phone is lost" requirement is **new work** — it needs either a per-user token version column or a session table.

---

## 4. Home-screen / PWA behavior

**TabReady is a genuine installable PWA, not a bare bookmark.**

- **Manifest** (`/manifest.webmanifest`, `handleManifest` `1254`): `name/short_name "TabReady"`, `start_url "/"`, `scope "/"`, `display "standalone"`, maskable 192/512 icons. `start_url` and `scope` are **relative** → the manifest is host-portable.
- **Service worker** (`/service-worker.js`, `1275`): **push/notification only, no `fetch` handler by design**, and on `activate` it **deletes all caches** and `clients.claim()`s (`1281‑1286`). It caches nothing and contains **no hard-coded hostnames**. This is very favorable for migration — there is no stale cached shell pinned to the old host.
- **Install UX** (`19262+`): captures `beforeinstallprompt` for Android/Chromium (one-tap install); iOS/Safari gets manual "Share → Add to Home Screen" instructions. iPad-as-Mac detected via `maxTouchPoints`.

**Home-screen behavior across the migration** (to be confirmed by device testing — Deliverable 6):
- An installed iOS/Android PWA's `start_url` is captured **at install time as an absolute URL on the old host**. So an existing icon will **open the old host** (`tabready.shanepass.workers.dev`) — which is exactly why the old Worker must remain as a **compatibility bridge** (brief §9), forwarding into the new host with a session handoff.
- Because the SW never caches and the manifest is relative, once a user is bridged/reinstalled on the new host, nothing old is pinned client-side except the icon's captured `start_url`.

---

## 5. Which hostname does each artifact currently use?

| Artifact | Host today | Portable? |
|---|---|---|
| QR / onboarding / login links | request origin → `tabready.shanepass.workers.dev` | ✅ relative logic, but a QR *printed today* embeds the old host |
| Manifest `start_url`/`scope` | relative `/` | ✅ |
| Service worker + cache URLs | relative, none cached | ✅ |
| **Digest emails** (monthly) deep links | **hard-coded** `https://tabready.shanepass.workers.dev` (`DIGEST_BASE`, `worker.js:20647`; used at `21330`) | ❌ **must become config-driven** |
| Email **From** address | `TabReady <tabready@thetabsrq.net>` (`worker.js:896`) | ✅ **already church-owned** |
| Cross-tool launcher tiles | `tab-workorders / tab-supplies-worker / receipts .shanepass.workers.dev` (`14172‑78`, `16085‑86`); `tab-curriculum.media-ffd.workers.dev` (`14876`) | ⚠️ point at *other* apps; curriculum already on Media |

**Headline:** the app is almost entirely origin-relative. The only hard-coded absolute self-reference is `DIGEST_BASE`, and it lives in **emails users click** — so it is the highest-priority config change. The church domain `thetabsrq.net` is **already a verified Resend sending domain**, which de-risks the permanent-domain choice `tabready.thetabsrq.net`.

---

## 6. iPhone vs Android differences (current)

| | iPhone / Safari | Android / Chromium |
|---|---|---|
| Install | Manual (no `beforeinstallprompt`) — "Share → Add to Home Screen" (`19293`) | Native one-tap deferred prompt (`19297+`) |
| PWA container | `navigator.standalone` | `display-mode: standalone` |
| Session cookie | Same host-only semantics; iOS is stricter about cross-site and ITP, so host-only + `SameSite=Lax` is fine same-origin but reinforces that **cross-host transfer must be an explicit same-origin redirect**, not a shared cookie | Same |

Both platforms share the same server session/QR/manifest logic; the differences are install ergonomics and iOS's stricter cookie isolation — which only strengthens the case for a redirect-based session handoff rather than any cross-domain cookie trick.
