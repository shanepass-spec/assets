# Incident — Relay Control-Plane Credential Exposure

## Phase 0 Inventory — `scout-claude-relay` (rollback baseline)

**Sanitized evidence. No credential values appear in this file — only names, roles,
and source line numbers.**

- **Capture date:** 2026-07-27
- **Operator:** Claude (read-only)
- **Source:** live worker bundle retrieved via Cloudflare `workers_get_worker_code`
- **Posture:** PREP / READ-ONLY — nothing rotated, deployed, or modified

---

### Worker identity
- **Name:** `scout-claude-relay`
- **Account:** personal `26c8013cfb2cf72dde19e55e6cf390b1`
- **Script tag:** `a4370cd728e548cfb506d6e54df4b2aa`
- **Version (in-source):** `v1.17.0`

### Source hash (rollback / change-proof)
- **`worker.js` body SHA-256:**
  `096ca75756a8d89a9aa22582105c306c9877aecb2f546df31e446abe3bb7dba9`
- **Body size:** 1,860 lines
- **Capture method:** from the multipart bundle, strip the header (first 3 lines) and
  the closing boundary (last line); hash the remaining `worker.js` body. Re-run the
  same method on a re-pulled bundle to compare.

### `env.*` surface (names only — actual binding presence not readable via tools)
| Name | Type (by usage) | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | secret | Anthropic dispatch calls |
| `ADMIN_KEY` | secret | this worker's own admin gate — **fail-open** (source lines 81/83/87) |
| `RELAY_WRITE_TOKEN` | secret | relay write auth |
| `BUILDER_TOKEN` | secret | builder proof-lane auth |
| `COMPASS_DB` | D1 binding | Compass DB (tables: `relay_state`, `dispatch_packets`, `relay_tokens`, `relay_messages`) |

### Exposure location (values NOT reproduced here)
- The exposed **control-plane stage token** and **control-plane admin key** are
  hardcoded literals inside the `const SYSTEM` prompt.
  - `SYSTEM` definition: source line 1037
  - Stage token literal: source line 1051
  - Admin key literal: source line 1052
  - Deploy recipe embedding the admin key: source line 1053
  - `SYSTEM` sent to the model: source line 1139
- These control-plane credentials are **not** bound as `env.*` today; they exist only
  as the prompt literals above. Target bindings `CONTROLPLANE_ADMIN_KEY` /
  `CONTROLPLANE_STAGE_TOKEN` are **new** (create, not overwrite). Removing the leak
  means deleting the three prompt lines, not editing a config value.

### Non-secret referenced names (no values)
- Hosts: `scout-claude-relay.shanepass.workers.dev` (self),
  `controlplane.shanepass.workers.dev` (deploy hub, referenced in the prompt)
- Model: `claude-sonnet-4-6`

### Rollback expectation to record
After the repair, the re-pulled `worker.js` body SHA-256 **must differ** from
`096ca7…`. The diff should touch **only** the `SYSTEM` prompt lines (credential
removal) and the `checkKey` gate (fail-open → fail-closed) — nothing else.

---

## Status labels
- **VERIFIED (read directly from source):** both control-plane credentials are
  embedded in `scout-claude-relay` source and fed to the model (lines 1037/1051–1053/1139).
- **CLAIMED-NOT-VERIFIED:** current live validity of the exposed values (not tested;
  no control-plane access).
- **HUMAN-GATED:** credential rotation, Worker Secret entry, authentication changes,
  staging authorization, and production deployment.
- **PARKED:** receipts `INTAKE_SECRET` cleanup (project #63) and Relay board `/board`
  + `/archive` cleanup remain behind this higher-priority exposure.

## Owner next
- **Shane:** Phase 1 — invalidate the exposed control-plane admin key and stage token
  in the live control plane. Do not place old or replacement values into chat, Relay,
  prompts, source, or logs.
