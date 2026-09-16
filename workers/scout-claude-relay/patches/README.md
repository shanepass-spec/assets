# scout-claude-relay — governed patch specs

These files are **patch specs, not deployable worker source**. Each one is a set of
anchored find/replace hunks derived from a proven live base, kept here so the work
survives a session and can be read without a Relay seat.

A spec in this directory has **not** been registered, previewed, staged or deployed.
Applying one is the control plane's job, through the governed lane:

    register (against the named base snapshot) -> preview -> stage -> owner Deploy tap

The whole-file parse and the authoritative result SHA-256 are **registration-time
verifier outputs** (no-export ruling, 2026-09-04). They are deliberately absent here,
and nothing in this directory should be read as claiming them.

## What each spec carries

| Field | Meaning |
| --- | --- |
| `base_snapshot_id`, `base_sha256`, `base_chars` | the exact bytes the hunks were derived from |
| `expected_result_chars` | base chars plus the summed hunk deltas |
| `hunks[].find` / `.replace` | verbatim anchor text and its replacement |
| `hunks[].append_style` | `true` means the find appears inside its own replace — safe under **single** application only, and declared rather than discovered |
| `not_included` | what the patch deliberately does **not** do |

## Static checks run before a spec lands here

1. every `find` occurs **exactly once** in the named base snapshot;
2. no hunk's `find` appears inside another hunk's `replace`;
3. self-containment matches the declared `append_style` flag;
4. every `replace` fragment passes `node --check` in a context matching its real surroundings;
5. new behaviour is exercised against real recorded figures, not invented ones.

## Specs

- `card312-relay-key-expiry-4583-r1.json` — Relay credential expiry is reported in-band on
  `/relay/session`, and the mint ceiling moves from 720 to 2160 hours per the owner ruling of
  2026-09-16. Mints nothing, rotates nothing, edits no existing token row, and reads no token value.
