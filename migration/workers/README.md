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

## The human gate — everything, in one sitting

Both deploys, then the same secret typed into both dashboards. The secret value
is never sent to an agent, to Relay, or into a conversation.

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
| Var | `MIG_SOURCE_URL` | the deployed `mig-source` URL |
| Var | `MIG_SELF_URL` | `mig-sink`'s own URL — lets a long copy continue itself |
| Secret | `MIG_SECRET` | the same value from step 1 |

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
