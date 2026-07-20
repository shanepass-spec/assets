# Deliverable 3 — URL & Dependency Audit

Searched the full source of every worker under `workers/`, the D1 schema/contents, config, and docs for:
`.workers.dev`, personal Worker names, account IDs, D1 IDs, hard-coded absolute URLs, QR payloads, manifest/SW
URLs, cross-worker calls, email links, and webhook destinations.

**Headline result:** TabReady is overwhelmingly **origin-relative**. Nearly every internal link is built from
`new URL(request.url).origin`, and the PWA manifest + service worker are relative and cache nothing. The audit
surface is therefore small and precise.

## Classification legend
- **KEEP-TEMP** — leave for compatibility, remove later.
- **CONFIG** — replace hard-coded value with a central config value (canonical base URL / sibling-app map).
- **REDIRECT** — handled by the old-host compatibility bridge.
- **PRESERVE** — keep as-is (already correct / already church-owned).
- **FIX** — code defect to correct during the build.

---

## A. TabReady self-referencing URLs

| # | Location | Value | Class | Action |
|---|---|---|---|---|
| A1 | `worker.js:20647` `DIGEST_BASE` (used `21330`) | `https://tabready.shanepass.workers.dev` | **CONFIG** | **Highest priority.** Sole hard-coded self-URL; appears in **digest emails users click**. Replace with a single canonical base-URL value (see §D). |
| A2 | QR/login/onboard/relink links (`1352`, `3477`, `3511`, `3546`, `3612`) | `${request.origin}/auth/verify?token=…` | **PRESERVE** | Already relative. After cutover these self-correct to the church host. (A QR *printed on the old host today* embeds the old host → covered by REDIRECT bridge.) |
| A3 | Manifest `start_url`/`scope` (`1259‑1260`) | `/` | **PRESERVE** | Relative; host-portable. |
| A4 | Service worker + notification `data.url` (`1275‑1312`) | relative `/` | **PRESERVE** | No cached hosts; nothing to change. |
| A5 | Email **From** (`worker.js:896`) | `TabReady <tabready@thetabsrq.net>` | **PRESERVE** | Already church-owned + Resend-verified. |
| A6 | VAPID `sub` (`worker.js:2318`) | `mailto:spass@thetabsarasota.org` | **CONFIG (low)** | Personal contact address in push JWT; optionally move to a church address, but changing VAPID identity must not rotate the keypair (would break subs). |

## B. Cross-tool / sibling-app URLs (TabReady → other apps)

| # | Location | Value | Class | Action |
|---|---|---|---|---|
| B1 | `14172`, `16085` | `https://tab-workorders.shanepass.workers.dev` | **CONFIG** | Move to a sibling-app URL map; app migrates on its own timeline. |
| B2 | `14173`, `16086` | `https://tab-supplies-worker.shanepass.workers.dev/` | **CONFIG** | Same. |
| B3 | `14178` | `https://receipts.shanepass.workers.dev` | **CONFIG** | Same. |
| B4 | `14876` | `https://tab-curriculum.media-ffd.workers.dev/` | **CONFIG / KEEP-TEMP** | Already points at the **Media** account — inconsistent host style (`media-ffd.workers.dev`). Fold into the same map; ideally give curriculum a church-domain host too. |

## C. Other workers referencing `*.shanepass.workers.dev` (context, not TabReady-blocking)

These are separate apps; listed so the church-wide picture is complete. Each becomes CONFIG when that app migrates.

| Worker | Refs |
|---|---|
| `jennie-gateway` | `compass-api.shanepass.workers.dev` (`35`,`2103`,`2117`), self `auth/callback` (`2316`,`2334`), `packet-archive.shanepass.workers.dev` (`2431`) |
| `jennie-lite` | self `jennie-lite.shanepass.workers.dev` (`329`) |
| `tab-email-ingest` | `tab-sermons.shanepass.workers.dev` (`271`,`317`) |
| `tab-website-ai` | `tab-sermons.shanepass.workers.dev` (`132`), self (`1824`) |

> Note `jennie-gateway` embeds OAuth `auth/callback` URLs on the personal host — if any OAuth provider registration
> pins those, migrating that worker needs a provider-side redirect-URI update. **TabReady itself has no OAuth
> callback URLs** (PCO is server-to-server), so this does not block the TabReady migration.

## D. Recommended central configuration

Introduce **one** canonical base-URL source of truth and a small sibling-app map, both **config-driven** (via
`app_settings` rows and/or an `env` var), never repeated inline:

```
CANONICAL_BASE_URL   → e.g. https://tabready.thetabsrq.net   (from app_settings 'canonical_base_url', fallback env, fallback request.origin)
SIBLING_APP_URLS     → { workorders, supplies, receipts, curriculum } (from app_settings JSON)
```

Design principles (from brief §13/§8):
- **Prefer relative internal URLs** — already the norm; keep it.
- **Emails and any absolute link** read `CANONICAL_BASE_URL`, resolved at request time.
- **No public URL** may contain the personal Worker name, `workers.dev` host, account ID, D1 ID, Worker ID, or preview/staging host.
- Fallback order makes it safe pre-cutover: if the setting is unset, behavior is today's behavior (`request.origin`), so shipping the config plumbing is a **zero-behavior-change** step until Shane sets the value.

## E. Identifiers that must NOT leak into public links (verified absent in user-facing output)

Confirmed these appear only in server/config context, never emitted to users:
- Account IDs `26c8013…` / `ffd360…` — not present in `worker.js` (only in `deploy.yml` env, server-side).
- D1 UUIDs, Worker IDs — not present in `worker.js`.
- `PROVISION_SECRET`, `SESSION_SECRET`, tokens — never logged or placed in query strings surfaced to users (magic tokens are in links by design, single-use + expiring).

## F. Audit summary

| Class | Count (TabReady) | Priority |
|---|---|---|
| CONFIG | 5 (A1, A6, B1‑B4) | A1 first (emails), then sibling map |
| PRESERVE | 4 (A2‑A5) | — |
| FIX | 1 (§01 defect: 15‑min vs 7‑day link copy) | with build |
| REDIRECT | covered by bridge (old-host QR/bookmarks) | Deliverable 4 |

**Bottom line:** exactly **one** hard-coded self-URL (`DIGEST_BASE`) must be config-driven before emails point at
the wrong host, plus a handful of sibling-app links. The relative-first architecture means the migration's URL
surface is genuinely small — the hard part is sessions and data, not URLs.
