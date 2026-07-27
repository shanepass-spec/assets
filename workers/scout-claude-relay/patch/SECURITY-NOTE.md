# SECURITY NOTE — embedded credentials in scout-claude-relay

**Sanitized. This file names credential *types* and locations only — never any secret value.**

## Finding
While reading the live `scout-claude-relay` worker source to build the board read-path
patch, two secrets were found **hardcoded in plaintext** inside the worker's prompt/context
text block (not read from bindings):

| Credential type | Where | Value in this repo? |
|---|---|---|
| Control-plane **admin key** | inline text in the worker source | **No — never recorded** |
| Control-plane **stage token** | inline text in the worker source | **No — never recorded** |

The same block also restates the two Cloudflare account IDs and the control-plane deploy
URL pattern; the sensitive items are the admin key and stage token.

- **Affected worker:** `scout-claude-relay` (personal account)
- **Discovery date:** 2026-07-27
- **Class:** live credentials committed into deployed source (same class as the already-closed
  board row 32, "SECURITY HOLD — live admin key exposed in relay")
- **Rotation status:** ❌ NOT ROTATED — human-gated
- **Verification proof:** ⏳ pending (old creds fail + new creds stored via bindings)

## Required remediation (HUMAN-GATED)
1. **Treat both credentials as compromised. Rotate/revoke them first**, before any deploy.
2. Store the replacements as **Worker secrets / bindings**, not source text.
3. Remove the plaintext admin key + stage token from the worker source (the read-path patch
   does **not** touch that block).
4. **Verify:** confirm the old admin key and old stage token no longer authorize anything,
   and that the worker still functions reading the new secrets from bindings.

## Tracking — reopen, don't duplicate
Record this against the **existing** Relay security project (**relay_state row 32**,
"SECURITY HOLD — live admin key exposed in relay") rather than opening a new row.

The live write is **deferred and human-gated for two reasons**: (a) row writes to
`relay_state` remain human-gated per the standing stop conditions, and (b) the relay write
lane authenticates with the very admin key now considered compromised — so the reopen should
be recorded **after** rotation, through a rotated credential.

Suggested sanitized text for the row-32 reopen (for approval — not yet written):
- **status:** `active` (reopened)
- **next_actor:** `Shane` (rotation is human-only)
- **shane_needed_only_for:** rotate + revoke the exposed control-plane admin key and stage
  token; store replacements via bindings.
- **note (sanitized):** "Reopened 2026-07-27. Control-plane admin key + stage token found
  hardcoded in scout-claude-relay source (types only; values not recorded). Same class as
  the original row-32 exposure. Remediation: rotate/revoke, move to bindings, strip from
  source, verify old creds dead. No values stored anywhere."

## Done looks like
- Old admin key and old stage token **fail**.
- Replacement secrets are read from **bindings**, not source text.
- The sanitized read-path patch passes its tests and staging proves `/board` + `/archive`
  behavior before cutover.
