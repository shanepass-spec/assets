# Binding and cross-account dependency inventory

Read-only. Built 2026-09-16 from the control-plane snapshot store by extracting
matches server-side in SQL, so no worker source passed through a conversation.

    personal  26c8013cfb2cf72dde19e55e6cf390b1   subdomain  shanepass.workers.dev
    church    ffd360b239936d51e85d9961fdaeb65a   subdomain  media-ffd.workers.dev

## Bindings each worker's code requires

Derived from `env.<NAME>` references in the latest control-plane snapshot.
This is what the code *needs*, which is the thing worth checking a deploy
against. It is not a read of live binding configuration — see Limits.

| Worker | Snapshot | Bindings referenced |
| --- | --- | --- |
| `tabready` | 4552 | **DB** (D1), **CONTENT_DB** (D1), **PHOTOS** (R2), ANTHROPIC_API_KEY, PCO_APP_ID, PCO_SECRET, RESEND_API_KEY, SESSION_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY |
| `tabready-admin` | 4560 | DB, ADMIN_PIN, PCO_APP_ID, PCO_SECRET, PCO_TOKEN, PCO_BASIC |
| `tab-email-ingest` | 4562 | DB, SERMONS, ADMIN_TOKEN, ANTHROPIC_API_KEY, INTAKE_SECRET, **CF_API_TOKEN**, **CF_ACCOUNT_ID**, **D1_DATABASE_ID** |
| `tab-website-ai` | 4557 | DB, SERMONS, ADMIN_TOKEN, ANTHROPIC_API_KEY, PCO_APP_ID, PCO_SECRET, SERMONS_WORKER_URL |
| `tab-supplies-worker` | 4573 | DB, RESEND_API_KEY, RECEIPT_INGEST_TOKEN, CAFE_CODE, KITCHEN_CODE, SHANE_CODE, SUPPLIES_EMAIL_ALLOW |
| `susanofficehelper` | 4223 | DB, RECEIPTS_DB, RECEIPTS_FILES, ANTHROPIC_API_KEY, RESEND_API_KEY, BUILDER_PASSWORD, SUSAN_PASSWORD |
| `receipts-email-intake` | 4566 | RECEIPTS_URL, INTAKE_SECRET, ALLOWED_DOMAINS |

`tabready` binding `CONTENT_DB` is why `tab-website-content` is part of this
migration at all — it is a TabReady dependency, not a separate application.

`tab-email-ingest` holding **CF_API_TOKEN / CF_ACCOUNT_ID / D1_DATABASE_ID** is
worth a decision before cutover: a worker carrying a Cloudflare API token needs
that token pointed at the right account, or it silently keeps operating on the
old one. Flagged, not touched. No secret value was read.

## Runtime calls that reach back into the personal account

Every `*.workers.dev` literal in the latest snapshots:

| Worker | Points at | Configurable? |
| --- | --- | --- |
| `safety-intake` | `APP_INGEST_URL = "https://tabready.shanepass.workers.dev…"` | **No — hardcoded** |
| `toolbox` | `tabready.shanepass.workers.dev` ×3, `toolbox.shanepass.workers.dev` | **No — hardcoded** |
| `susanofficehelper` | `RECEIPTS_URL = "https://receipts.shanepass.workers.dev"` | **No — hardcoded** |
| `tab-email-ingest` | `tab-sermons.shanepass.workers.dev` ×2 | **No — hardcoded** |
| `tab-workorders` | `tab-workorders.shanepass.workers.dev` ×2 (self-links in email bodies) | No — display only |
| `receipts-email-intake` | `receipts.shanepass.workers.dev` | Yes — `env.RECEIPTS_URL` overrides |
| `tabready` | `CUR_BASE = "https://tab-curriculum.media-ffd.workers.dev"` | No — but points at **church**, so it becomes same-account after the move |

This is the evidence behind the post-cutover check "no runtime calls still go
back to the personal account." The church copy of `safety-intake` posting to
`tabready.shanepass.workers.dev` is the sharpest case: after cutover it would
keep writing into the *old personal* TabReady while appearing to work. It is
already recorded as accepted cleanup debt; this inventory is where it is
proven, not re-litigated.

## Destination resources already provisioned

Created in the church account on 2026-09-16, not by Builder:

| Resource | Kind | Created | State |
| --- | --- | --- | --- |
| `tabready-main` `548cf797` | D1 | 01:48:35Z | 113 tables, `roles` 20 rows, awaiting the data load |
| `tabready-photos` | R2 | 01:48:38Z | exists |
| `tab-shared-docs` | R2 | 01:48:40Z | exists |
| `tab-workorders-main` `73c5002c` | D1 | 02:00:51Z | church-internal consolidation |
| `tab-website-content` `1781dba9` | D1 | 02:00:54Z | already a faithful row copy (256/25/9) |
| `workorders-photos` | R2 | 02:00:56Z | exists |

## R2 is an unscoped hunk

`tabready` binds **PHOTOS**. Every incident photo, directory photo, watch-list
photo, team-note photo and facilities map lives in R2, not D1. The destination
buckets exist; whether any objects have been copied is **unknown** — the
available tooling lists buckets but cannot enumerate objects.

Nothing in the current migration order covers R2 object copy. A D1 cutover
without it produces an app whose records all resolve and whose images are all
missing. Raising it now rather than discovering it after cutover.

## Limits of this inventory — stated, not glossed

- **Live binding configuration was not read.** The available tooling returns a
  worker's name and id only; it does not expose which database or bucket a
  binding actually resolves to. This inventory says what the code requires, not
  what the account currently provides. Confirming the second needs either the
  control plane or the dashboard.
- `tabready`'s list is **probe-based**: the exhaustive scan exceeded what the
  snapshot store could evaluate over a 2 MB file, so a fixed candidate list was
  tested instead. A binding with an unexpected name could be missed. Every
  other worker in the table was enumerated exhaustively.
- `safety-intake` returned no `env.` matches, most likely because it
  destructures its environment. Its bindings are not covered here.
- R2 object inventories are not obtainable with current tooling.

---

# Worker cutover checklist

Added 2026-09-16 as prep for the worker-move hunk, so it can land as one sitting
the way the copy hunk does. Read-only; extracted server-side in SQL.

## Binding types, resolved

Probed by the method actually called on each binding — `.prepare(` means D1,
`.put(`/`.list(`/`.head(` means R2, `.fetch(` means a **service binding**.

| Worker | Binding | Type |
| --- | --- | --- |
| `tabready` | `DB` | D1 |
| `tabready` | `PHOTOS` | **R2** |
| `tabready` | `CONTENT_DB` | D1 (inferred — see limits) |
| `tabready-admin` | `DB` | D1 (inferred) |
| `tab-email-ingest` | `DB` | D1 (inferred) |
| `tab-email-ingest` | `SERMONS` | **service binding** |
| `tab-website-ai` | `DB` | D1 |
| `tab-website-ai` | `SERMONS` | **service binding** |
| `tab-supplies-worker` | `DB` | D1 |
| `susanofficehelper` | `DB` | D1 |
| `susanofficehelper` | `RECEIPTS_DB`, `RECEIPTS_FILES` | D1 / R2 (inferred) |

**Limit:** this probe only sees a method called *directly* on `env.NAME`. A
worker that does `const db = env.DB` and then calls `db.prepare(...)` reads as
"inferred" above — the binding exists, its type is taken from its name and its
target rather than proven by the probe.

## Service bindings are same-account only — the constraint that bites

`tab-email-ingest` and `tab-website-ai` both service-bind `SERMONS` to
`tab-sermons`. **A service binding cannot cross accounts.** `tab-sermons` exists
only in the personal account; the registry records `church-tab-sermons` as
VERIFIED ABSENT.

So the church copy of `tab-email-ingest` cannot have a working `SERMONS`
binding, and must already be falling back to the hardcoded
`tab-sermons.shanepass.workers.dev` HTTPS hop found in the cross-account
inventory above. That is the documented architecture — thin worker in church,
HTTP hop to the app in personal — and it is why both a binding and a URL exist
in the same file.

The consequence for the move: **any worker that moves to church and keeps a
service binding to a personal worker breaks silently.** Each one either needs
its target moved in the same hunk, or needs to be switched to the HTTPS hop
before the move. This is not a thing to discover at cutover.

## `safety-intake` has no bindings at all

Resolved the last gap in this inventory. `safety-intake` (snapshot 4246,
121,905 bytes) contains **no `env.` reference anywhere**, no `env[`, no
`.prepare(`, no `.put(`, and no `addEventListener`. It is a module worker with
`fetch` and `email` handlers and zero bindings.

Its configuration is hardcoded as source constants: `const APP_INGEST_URL` and
`const INTAKE_SECRET`.

Two consequences, stated separately:

- **For the migration, this is a simplification.** Nothing to bind, no secret
  to re-enter. It deploys as-is.
- **For security, it is the debt already on the board.** A shared secret living
  as a source constant is readable by anyone who can read the worker's code,
  and it is carried in the control-plane snapshot store like any other source.
  No value was read here and none is recorded. Scout has ruled not to rebuild
  this worker; this entry is the evidence, not a reopening of that ruling.

## Schema-vs-data rule — remaining databases

Complete. The three church destinations created on 2026-09-16 are
`tabready-main`, `tab-workorders-main` and `tab-website-content`. All three have
now been checked and none has a further gap:

- `tabready-main` — 15 tables were missing and have been created empty.
- `tab-workorders-main` — clean; auth rows correctly left behind.
- `tab-website-content` — clean; only a backup table absent.

Every other database in the church account is church-native and is not a
migration destination. **There is no further schema-vs-data work available
without the deploy gate.**
