# Temporary migration workers

Two throwaway workers that move TabReady from the personal account to the
church account without any API token existing anywhere. A D1 binding is a
capability, not a secret — so the credential problem disappears rather than
being managed.

    mig-source   personal account   READS   tabready D1 + tabready-photos R2
    mig-sink     church account     WRITES  tabready-main D1 + tabready-photos R2

The church side drives the copy and pulls. The personal side is a pure reader
that knows nothing about a destination.

**Nothing here is deployed.** These files are source for a gated deploy, not a
live service.

## Safety properties, stated so they can be checked

- **`mig-source` has no write path.** There is no INSERT, UPDATE, DELETE or DDL
  anywhere in it. Deleting the source is not a risk that has been mitigated; it
  is a capability the worker does not have.
- **Neither worker executes caller-supplied SQL.** Every statement is built
  internally. A table name reaches SQL only after matching that database's own
  `sqlite_master`; an unknown name is rejected, never interpolated.
- **Both fail closed.** No secret or no binding gives `503`, never an open
  endpoint. `/health` is the only ungated route and returns no data — just
  whether the bindings and secret are present.
- **The secret is never transmitted.** The caller signs `method`, `path+query`
  and a timestamp with HMAC-SHA256; the receiver recomputes it. Requests older
  than five minutes are rejected, so a captured request cannot be replayed and
  a leaked log line cannot yield the secret.
- **No persistent job state.** Progress is derived from the destination on every
  invocation: a table resumes at its own current row count, an object is skipped
  when already present at the same size. A crash, a timeout or a double tap
  cannot duplicate or skip anything — the worst case is repeated work.
- **Row batches are atomic.** Statements go through `batch()` as prepared
  statements, in a transaction, so a batch lands completely or not at all.

## Deploying through the control plane

This has direct precedent. On 2026-07-27 the control plane created
`tab-curriculum-upload` in the **church** account from nothing and wired it up
in 27 seconds — `stage` 16:17:11, `deploy-direct` 16:17:18 (matching the
worker's `created_on` exactly), `bind` 16:17:38 reporting
`church: before=0 after=1 lost=none`, `enable-subdomain` 16:17:39. New worker
name, new binding, new subdomain, church account. Audit ids 6402–6405.

R2 bindings are supported too — `r2_bucket` appears in the control plane's
binding code alongside `d1`.

Worker secrets: the control plane has a working secret path, proven four times
— `link-secret` installing `SNAPSHEET_LINK_SECRET` with HTTP 201 on 2026-09-06
and HTTP 200 on 2026-09-08, on both `tabready` and `snapsheet-pilot`. What that
proves is the credential and the code path, for one hardcoded secret installed
during deploy. Whether the UI accepts an arbitrarily named secret is a separate
question and is **not** proven. Treat the dashboard as the reliable route for
`MIG_SECRET` until the control-plane route is demonstrated once.

## The human gate — everything, in one sitting

Both deploys, then the same secret entered into both secret stores. The secret
value is never sent to an agent, to Relay, or into a conversation.

**1 — generate a one-time secret.** Any high-entropy value, roughly 40+
characters. Generate it where you can copy it twice and then discard it.

**2 — deploy `mig-source` to the personal account** with:

| Kind | Name | Value |
| --- | --- | --- |
| D1 | `SRC` | `tabready` · `dcadb25c-d503-45a7-9e29-254c2d5f50e5` |
| R2 | `SRC_R2` | `tabready-photos` |
| Secret | `MIG_SECRET` | the value from step 1 |

**3 — deploy `mig-sink` to the church account** with:

| Kind | Name | Value |
| --- | --- | --- |
| D1 | `DST` | `tabready-main` · `548cf797-8313-4a3e-827f-408ff1676b73` |
| R2 | `DST_R2` | `tabready-photos` (church) |
| Secret | `MIG_SECRET` | the same value from step 1 |

**No vars are required.** The source URL defaults to
`https://mig-source.shanepass.workers.dev`, and the worker derives its own
origin from the request it is currently serving rather than being told it.
`MIG_SOURCE_URL` and `MIG_SELF_URL` still work as overrides if a deploy lands
somewhere unexpected.

This matters for how the deploy is done: the control plane can create workers
and set D1 and R2 bindings, but it has **no plain-var write path** — no
`plain_text` or `vars` handling exists anywhere in its source. Requiring vars
would have forced a dashboard visit that is now unnecessary. Asking an operator
to type a worker's own URL into that worker's own config is also a step that can
be got wrong; deriving it cannot.

**4 — confirm without revealing anything.** Open each worker's `/health`. Both
must report their bindings `true` and `secret_present: true`. That is a
presence check; it prints no value.

Bindings drop on dashboard paste-deploys — check `/health` after every deploy,
not just the first.

## Running the copy

    POST /run/d1     load rows in FK order, then indexes, then views, then triggers
    POST /run/r2     copy photo objects
    GET  /verify     the full self-audit, JSON, HTTP 409 if anything failed

`/run/d1` works to a time budget and continues itself, so one call finishes the
job unattended. If it ever stops early, calling it again resumes exactly where
it left off.

Triggers are installed **after** the rows, never before. `trg_content_ins`
writes a `content_versions` row for every `content` row inserted, so a load with
triggers attached fabricates roughly one phantom history row per content row —
and a row-count-only reconciliation would pass it. `/run/d1` refuses to load
into a schema that already carries indexes, triggers or views.

## Tables that exist but stay empty

Fifteen tables are created at the destination and never receive a row:

    auth_request_limits  incident_shares  login_codes  magic_links
    pco_cal_instances    pco_cal_sync_runs  pco_dates_cache  pco_group_cache
    pco_group_members    place_invites    push_subscriptions  recovery_requests
    roster_sync_changes  roster_sync_runs  transfer_jti

The original exclusion list treated "do not copy the rows" and "do not create
the table" as the same decision. They are not. The live app inserts into and
selects from every one of these, so a destination without them throws
`no such table` in production — on the **first login attempt**, in the case of
`magic_links` and `login_codes`. `transfer_jti` backs JWT replay prevention and
`auth_request_limits` backs rate limiting, so their absence would have failed
open on two security controls.

Their contents are a separate question and the original intent stands: live auth
material, JWT replay records, rate-limit counters and PCO cache do not travel.
Schema travels, rows do not. `/verify` asserts both halves — the tables are
present, and they are empty.

The other 27 excluded tables are genuine backups and legacy snapshots and stay
behind: `*_backup_*`, `wave1_backup`, `migration_ledger_wave_a/b`,
`content_routing_snapshot_20260714`, `consolidation_audit`, `gm_marks_legacy_v1`,
`gm_pilot_tokens`, `gchfa_merge_rollback_20260806`.

## What `/verify` proves

Row counts and content fingerprints per table · forbidden tables absent by name
· `app_settings` compared by key name only, plus a failure if any key name is
credential-shaped · indexes, triggers and views present with excluded-table DDL
correctly skipped · history counts with `content_versions` as the trigger canary
· destination reads exercised through real joins and both org views · R2 object
count and total bytes.

R2 etags are compared only where both sides are single-part uploads. A multipart
etag is composite and does not compare across accounts; where those exist the
audit says so and falls back to key set and byte size rather than claiming a
comparison it cannot make.

## Teardown — part of the job, not an afterthought

Once `/verify` returns `ok: true`:

1. delete `mig-sink` from the church account;
2. delete `mig-source` from the personal account;
3. discard the secret — it is single-purpose and has no second use.

Deleting the workers removes the only cross-account path that existed. Nothing
to revoke, because nothing was issued.
