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
