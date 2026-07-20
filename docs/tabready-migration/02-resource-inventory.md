# Deliverable 2 — Resource Inventory

Live inventory queried 2026‑07‑20 across both Cloudflare accounts. Scope is TabReady and its direct
dependencies; sibling apps are listed where TabReady links to them.

- **Personal account** — "Shanepass@gmail.com's Account" · `26c8013cfb2cf72dde19e55e6cf390b1`
- **Media account** — "Media@thetabsarasota.org's Account" · `ffd360b239936d51e85d9961fdaeb65a` (migration target)

> ⚠️ Nothing here can be assumed to move automatically between accounts. Cloudflare bindings, secrets,
> D1 database IDs, R2 buckets, routes, and DNS are **per-account** and must be recreated in Media.

---

## 1. TabReady Worker — bindings & secrets (from live `env.*` usage in `worker.js`)

The Worker `tabready` (id `6a102681b74548e4ad5e0d735c3087f8`) references these bindings. All must exist in the
Media deployment or the app breaks:

| Binding | Type | Purpose | Recreate in Media |
|---|---|---|---|
| `DB` | D1 | Main database (`tabready`) | New D1 + full data copy |
| `PHOTOS` | R2 | Directory + incident photos (`tabready-photos`) | New bucket + object copy |
| `DOCS` | R2 | Shared documents (`tab-shared-docs`) | New bucket + object copy |
| `SESSION_SECRET` | secret | HMAC session signing | **Must be identical** to keep transfer tokens verifiable |
| `PROVISION_SECRET` | secret | Machine provisioning gate | Copy (or rotate + update orchestrator) |
| `PCO_APP_ID` / `PCO_SECRET` | secret | Planning Center Online API | Copy |
| `RESEND_API_KEY` | secret | Email (Resend) | Copy; verify `thetabsrq.net` domain in the Media Resend project |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | secret | Web-push | **Must be identical** or all `push_subscriptions` break |
| `ANTHROPIC_API_KEY` | secret | "Ask" AI feature | Copy |
| `SCHEDULE_INTAKE_SECRET` | secret | Schedule email-intake auth | Copy |

**Secret sourcing note:** the GitHub Actions deploy (`.github/workflows/deploy.yml`) **preserves existing
secrets** on every deploy via Cloudflare's `inherit` binding type — secrets live in Cloudflare, **not** in the
repo. A fresh Media deployment therefore starts with **zero** secrets; each must be set in the Media account
before first real traffic. This is the most common silent-failure trap in the migration.

---

## 2. D1 Databases

| Account | Name | UUID | Size | Notes |
|---|---|---|---|---|
| Personal | **`tabready`** (production) | `dcadb25c-d503-45a7-9e29-254c2d5f50e5` | 2.28 MB | **Source of truth.** 157 users, 140 content, ~70 tables. |
| Personal | `tabready-restore-test` | `389e4524-11f1-4579-a5bf-0283e9112464` | 28 KB | Restore-drill scratch (migration prep). |
| Media | **`tabready`** (target) | `27f36d41-c5c9-421a-8173-d6d23e940c37` | 286 KB | **Schema skeleton only — 24 tables, 0 users, 0 content.** Data not yet migrated. |
| Media | `tabready-restore-test` | `6cd66311-3dfd-4772-a52b-fff5b52b0735` | 462 KB | Restore drill created 2026‑07‑17. |

> The Media `tabready` DB exists but is empty of user/content data and has only 24 of the source's ~70 tables.
> A **full, verified data copy** (with record-count + checksum reconciliation) is still required — see Deliverable 4.

### Source `tabready` table groups (~70 tables)
- **Identity/authz:** `users`, `user_roles`, `roles`, `role_assignments`, `role_pco_map`, `people_registry`, `registry_settings`.
- **Auth credentials:** `magic_links`, `login_codes` (no `sessions` table — sessions are stateless).
- **Content:** `content` (+ `content_backup_*`, `content_routing_snapshot_*`), `category_defs`, `location_defs`, `map_descriptions`.
- **Safety:** `incident_reports`, `incident_acks`, `incident_shares`, `watch_list_entries`, `emergency_contacts`, `medical_team`, `medical_presence`, `safety_archive`, `card_access_overrides`, `card_access_audit`.
- **Scheduling:** `schedule_assignments`, `schedule_blackouts`, `time_off_requests`, `time_off_recipients`, `date_prefs`.
- **PCO cache:** `pco_group_cache`, `pco_group_members`, `pco_dates_cache`, `roster_sync_runs`, `roster_sync_changes`, `roster_protect`, `recon_not_pco`.
- **Comms/ops:** `announcements`, `alerts`, `team_notes`, `note_replies`, `push_subscriptions`, `connect_cards`, `staff_spotlight`, `digest_log`, `audit_log`, `audit_log_v2`, `ops_metrics`, `app_settings`, `change_requests`.
- **Migration artifacts already present:** `migration_ledger_wave_a/b`, `wave1_backup`, `user_roles_backup_eric_20260718`, `content_backup_personnel_20260718` — evidence prior partial migration/reorg work has occurred; preserve for rollback, do **not** carry forward as live tables blindly.

---

## 3. R2 Buckets

| Account | Bucket | Used by TabReady? |
|---|---|---|
| Personal | `tabready-photos` | ✅ `PHOTOS` binding |
| Personal | `tab-shared-docs` | ✅ `DOCS` binding (shared with sibling tools) |
| Personal | `receipts-files`, `workorders-photos`, `jennie-home-photos`, `build-bridge-files` | ❌ other apps |
| Media | `tab-curriculum`, `tab-akb-files`, `tab-facilities-docs` | ❌ other apps (curriculum already on Media) |

TabReady needs `tabready-photos` and `tab-shared-docs` recreated in Media and their objects copied. `tab-shared-docs`
is shared with other tools — coordinate so a copy doesn't diverge.

## 4. KV Namespaces

TabReady uses **no KV** (confirmed: no `env.<KV>` references; personal KV namespaces belong to `PACKET_ARCHIVE`,
`JENNIE_LITE_*`, `build-room`, `tab-sermons`). Media account has **0** KV namespaces. **Nothing to migrate for TabReady.**

## 5. Routes / Custom Domains

- Current public host: **`tabready.shanepass.workers.dev`** (personal `workers.dev`). Confirmed as the base used in digest emails (`DIGEST_BASE`).
- **No custom domain is wired to TabReady yet.** The permanent church host `tabready.thetabsrq.net` (brief's proposal) is **not yet a Cloudflare route** — it must be created (DNS + Worker custom domain) in the account that will serve production. *The exact final hostname must still be confirmed by Shane (brief §8).*
- Church email domain `thetabsrq.net` is **already verified for Resend sending** (`RESEND_FROM_ADDRESS`, `worker.js:896`) — but a **web** route for `tabready.thetabsrq.net` is separate and does not exist yet.

## 6. Scheduled Jobs (cron)

`worker.js` references a weekly cron that warms the PCO group cache and drives the monthly digest (v2.9.267 note,
`worker.js:1`). The cron **trigger definition is Cloudflare-side config, not in the repo**, so it must be
**recreated in the Media deployment** — a migrated Worker with no cron trigger will silently stop warming the
cache (causing PCO 429 storms) and stop sending digests. Verify the exact schedule in the personal account's
`tabready` Triggers before cutover.

## 7. Integrations

| Integration | Mechanism | Migration action |
|---|---|---|
| **Planning Center (PCO)** | REST API via `PCO_APP_ID`/`PCO_SECRET` (50+ call sites) | Copy secrets; confirm the API token's account scope; no PCO-side callback to change (server-to-server). |
| **Resend (email)** | REST API via `RESEND_API_KEY`, From `tabready@thetabsrq.net` | Ensure the Media-side Resend project owns/verifies `thetabsrq.net`; copy key. |
| **Web Push (VAPID)** | `VAPID_*` keys, `push_subscriptions` table, `sub: mailto:spass@thetabsarasota.org` (`worker.js:2318`) | Keys **must be identical** or existing subscriptions are invalidated. |
| **Cross-tool launcher links** | Direct links to `tab-workorders`, `tab-supplies-worker`, `receipts` (personal), `tab-curriculum` (Media) | Make config-driven (Deliverable 3); these are separate apps with their own migration timelines. |
| **`onboarding-orchestrator` Worker** | Personal account, calls `POST /api/provision` (the "Relay") | Point at the new base once live; keep provision secret in sync. |
| **GitHub Actions deploy** | `deploy.yml`, secrets `CF_API_TOKEN`/`CF_ACCOUNT_ID` (personal) + `CF_API_TOKEN_CHURCH` (Media) | Already dual-account aware; add `tabready` to the church deploy list only at cutover. |

## 8. Migration-in-progress signals (already present — do not disturb)

The Media account and the source DB show that migration prep has **already started**:
- Media has a `tabready` D1 (schema skeleton) and a `tabready-restore-test` D1.
- Personal account has `d1-restore-runner`, `backup-inspector`, `onboarding-orchestrator`, `guard-test`, `controlplane` Workers.
- Source DB contains `migration_ledger_wave_a/b`, `wave1_backup`, and dated backup tables.
- `deploy.yml` already carries church-account plumbing (`CHURCH_ACCOUNT_ID`, `CF_API_TOKEN_CHURCH`, `CHURCH_WORKERS`).

**Recommendation:** before any new migration action, reconcile with whoever created these — this package assumes a
clean, ledgered cutover and should not collide with an in-flight one.
