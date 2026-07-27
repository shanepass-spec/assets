# scout-claude-relay — board read-path fix (first implementation slice)

**Status: DRAFT / staging patch. Code-only, read-path only. Not deployed. No `relay_state`
row or schema change.**

Sanitized patch bundle. The live worker source is **not** included (it carries embedded
credentials — see `SECURITY-NOTE.md`). Apply the hunks manually to a locally redacted
snapshot of the worker that stays **outside git**, then deploy via the project's
control-plane-first path.

## Bundle
| File | What it is |
|---|---|
| `relay-board-readpath.patch` | Anchored hunks for the changed handlers + helpers only. Authoritative graft. No credentials. |
| `relay-board-readpath.logic.mjs` | The pure helpers + SQL constants (exported for tests). Identical to the patch's helper hunk. |
| `relay-board-readpath.test.mjs` | Dependency-free pure-logic tests. |
| `APPLY.md` | This file. |
| `SECURITY-NOTE.md` | Sanitized record of the embedded-credential finding (types only, never values). |

## What the patch changes (all read-path)
1. **Status normalization before bucketing** — lowercase, trim, `_`→`-`, and treat
   `done`/`closed`/`complete`/`completed`/`verified` **and any `verified-*`** as terminal.
   Fixes `verified_done`, `verified-with-followups`, `verified-live` (previously `other`).
2. **Explicit lightweight columns** instead of `SELECT *` on the board read paths
   (`id, project, status, next_actor, updated_at, shane_needed_only_for`).
3. **Terminal-residual retention** — a terminal row stays on `/board` when `next_actor`
   is populated, **or** `shane_needed_only_for` is populated, **or** it was updated within
   30 days. So rows **73, 78, 87** are not hidden merely for being terminal.
4. **`/archive`** (HTML) + **`/relay/archive`** (JSON) — all terminal rows, paginated newest-first.
5. **Hard page size / pagination** on every read path — no unbounded full-table response.

## Manual application steps
1. Work on a **local redacted snapshot** of `scout-claude-relay` (outside git). Do **not**
   commit the worker source or any transcript that contains it.
2. Apply the hunks in `relay-board-readpath.patch` in order:
   - bump `VERSION` → `1.18.0`;
   - replace `bucketFor` with the helper/SQL block (or reuse the worker's `isRealGate` for
     `isPopulated`);
   - replace `handleRelayBoard` and `handleBoardView`;
   - add `handleRelayArchive` and `handleArchiveView`;
   - extend `boardViewHTML`'s signature with `counts` and add the `/archive` link;
   - add the two router lines (`/relay/archive`, `/archive`).
3. Remove the now-dead v1.17.0 helpers (`BOARD_CORE`, `BOARD_CAP`, `BOARD_DONE_LIMIT`,
   `boardTrim`, `boardCore`) and the `?full=1` branch.

## Verification (staging, before cutover — HUMAN-GATED)
Run the logic tests locally:
```
node workers/scout-claude-relay/patch/relay-board-readpath.test.mjs
```
Then, against a **staging** deployment (not production):
- `GET /relay/board` → response is small; `counts` shows the true totals (active/parked/
  blocked/done/other); `fields_returned` is the 6 lean columns; no wide free-text present.
- `GET /relay/board` includes rows **78** and **87** (residual actors) but **not** old
  no-residual terminal rows.
- `GET /relay/archive?page=1` → paginated, newest-first, all terminal rows; `has_more`
  flips correctly across pages.
- `GET /board` renders; `GET /archive` renders and paginates.
- Confirm rows **86** and **88** are unchanged (read-only patch writes nothing).

### Design note — HTML `/board` columns
The JSON `/relay/board` (the path that hit `ResponseTooLargeError` from a GPT action)
fetches exactly the 6 lean columns. The HTML `/board` card needs a few more fields to
render, so `SQL_BOARD_VIEW` lists those **explicitly and caps each in SQL**, while dropping
the widest free-text columns (`current_truth`, `approved_scope`, `dispatch_*`,
`latest_scout_decision`, `verified`, `unchanged`, …). Reducing the HTML board to only the
6 lean columns is a one-line follow-up if desired.

> 30-day window today (2026-07-27): every terminal row is dated 2026-07-02 → 2026-07-22,
> i.e. all within retention, so they remain on `/board` for now and age into `/archive`
> over the coming weeks. `/archive` already lists all 36 today. Today's size reduction
> comes from lean columns + the hard cap.

## Follow-on sequence (not in this slice — still human-gated)
2. Field-by-field diff of duplicate rows **86** vs **88**.
3. Resolve terminal rows still pointing at an actor (reopen / clear stale actor / split).
4. Merge or archive the duplicate **only after review**.
5. Add a normalized-name controlled upsert / uniqueness check **after** the duplicate is gone
   (a unique constraint first would fail or force an unsafe cleanup).
