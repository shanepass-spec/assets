# TabReady D1 migration — copy runner and self-audit

Moves the TabReady database from the personal Cloudflare account to the church
account and proves the move in the same pass.

    personal 26c8013c…  tabready       dcadb25c-d503-45a7-9e29-254c2d5f50e5
    church   ffd360b2…  tabready-main  548cf797-8313-4a3e-827f-408ff1676b73

## The pattern

Each migration hunk audits itself. `copy.sh` does not finish by saying "done";
it finishes by running `verify.sh`, which writes `proof.md` and exits non-zero
if anything failed.

    move → verify → reconcile source vs destination → test destination reads
         → prove rollback still exists → only then the next hunk

## What this needs to run

Two short-lived Cloudflare API tokens, **D1 permission only**. No Workers
Scripts permission — that belongs to the later cutover step, not this one.

| Credential | Account | Permission | Why |
| --- | --- | --- | --- |
| `SRC` | Shanepass@gmail.com | **D1 → Read** | render source rows into INSERT statements server-side |
| `DST` | Media@thetabsarasota.org | **D1 → Edit** | apply them to `tabready-main` |

The read credential matters as much as the write one. With only a destination
token, the source dump still has to be pulled through a conversation and pushed
back out — which is the exact failure this kit exists to remove. With both, the
rows are rendered by the source database, POSTed straight to the destination,
and never enter anyone's context.

Neither token touches the control plane, and the control-plane token stays
personal-only.

### Token values never enter a conversation

Per the owner ruling of 2026-09-16, token values are entered directly into a
secure store at the machine that runs this kit. They are not pasted into chat,
not sent to Relay, not committed, and not handed to any agent.

Supply them either way — file form is preferred, because an environment
variable is readable from `/proc/<pid>/environ` by anything running as the same
user:

    CF_SRC_TOKEN_FILE=/path/to/src.token     # 0600 file, systemd credential,
    CF_DST_TOKEN_FILE=/path/to/dst.token     # or a password-manager CLI dump

    CF_SRC_TOKEN=…                           # direct environment entry
    CF_DST_TOKEN=…

What the kit guarantees, and what you can check yourself:

- the bearer header is written to a `0600` file inside a private `mktemp -d`
  and passed to curl as `-H @file`, so **the token never appears in `argv`** and
  never shows up in `ps` output;
- the temp directory is removed by an `EXIT`/`INT`/`TERM` trap, and both
  variables are unset once loaded;
- the run **refuses to start under `set -x`**, so a shell trace cannot print a
  token into a terminal or a CI log;
- a value that is not shaped like a Cloudflare API token — wrong characters, or
  shorter than 30 of the expected 40 — is rejected before it reaches the
  network, so a pasted placeholder fails locally rather than in a request;
- after the load and again after the audit, `assert_no_leak` greps every file
  the run produced for the token values and **fails the run** if either appears;
- `run-*/`, `*.token` and `secrets.env` are git-ignored.

## Running it

    export CF_SRC_TOKEN=…   # not stored, not committed
    export CF_DST_TOKEN=…

    ./copy.sh --dry-run     # preflight + baseline, zero writes
    ./copy.sh               # load, install DDL, self-audit
    ./verify.sh run-…       # re-audit a previous run at any time

Each run writes its own `run-<timestamp>/` directory containing the include
list, the exclusion list, the FK edges, the pre-copy source baseline, the DDL
log, and `proof.md`.

## Design decisions worth knowing

**The destination schema is the include list.** Nothing is hardcoded. The
runner copies exactly the tables that exist at the destination, so the
exclusion decision cannot silently drift from what was actually created.
Index and trigger DDL whose table is excluded is skipped for the same reason.

**Triggers are installed last, never before the load.** `trg_content_ins`
inserts a `content_versions` row for every row inserted into `content`. Loading
with triggers attached would fabricate roughly one phantom version row per
content row — corruption that a row-count-only reconciliation would pass.
`copy.sh` refuses to start if the destination already carries any index,
trigger or view.

**`write_context` is part of the copy.** All three `content` triggers read it.
It was missing from the first schema pass; without it every future content edit
on the church side would have thrown at trigger-fire time, and no row-count
check would have noticed. Added 2026-09-16.

**Load order is derived, then asserted.** There are 12 foreign-key edges across
the set. The tiers are written out for readability, but the runner re-reads the
live FK graph on every run and aborts if any edge is not satisfied by the tier
order — so a future schema change cannot quietly break the ordering.

**Reconciliation is a fingerprint, stated honestly.** Per table: row count,
total quoted byte length, and three positional character sums. That catches
missing, extra, truncated and value-shifted rows. It is not a cryptographic
digest and is not claimed to be.

**Settings are compared by key name only.** Values are never selected, never
compared, never printed. The audit additionally fails if any carried-over key
name looks credential-shaped.

## Rollback

The destination is a fresh database whose only contents are this copy, and no
live service points at it. Rollback is drop and re-run.

Two anchors are proven on every run:

- every source table still matches its pre-copy baseline — the copy is
  read-only at the source;
- the June partial copy (church `tabready`, `27f36d41-…`) is untouched and is
  never opened for writing.

## Not covered here

Post-cutover verification is the next hunk, after the worker/app move: church
bindings point at church resources, no runtime call reaches back into the
personal account, login/auth works, email and integrations work, rollback still
available. Those checks need the workers deployed first.
