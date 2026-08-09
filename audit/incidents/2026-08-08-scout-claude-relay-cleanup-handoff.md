# Relay Cleanup — ready-to-deploy handoff (scout-claude-relay)

**Prepared by:** Claude (read-only session) · **Date:** 2026-08-08
**Security status:** control-plane admin key + stage token already rotated 2026-08-07;
leaked values verified rejected 2026-08-08. **This is hygiene, not urgent.**
**No secret values appear in this file.**

## Why this cleanup
The old (now-dead) control-plane credentials are still written as literal lines inside
the `const SYSTEM` prompt in `scout-claude-relay`, and that prompt is sent to the model on
every dispatch. Even though the values are invalid, an AI prompt should never carry a
deploy recipe or key. Removing them stops the pattern and clears the confusion of
dead-but-real-looking creds sitting in source.

## Change 1 — remove dead credential lines from the SYSTEM prompt (safe, zero functional risk)
Inside the `const SYSTEM = \`...\`` template, delete the bullet lines that begin with each of
these labels (match on the label prefix; do **not** copy their values anywhere):
- `- Control plane DB:`
- `- Stage token:`
- `- Admin key:`
- `- Deploy path:`
- `- WAF blocks POST from Anthropic IPs`

Replace them with a single line:
```
- Control-plane deploy credentials are held server-side only and are never included in this prompt.
```
Everything else in the prompt (roles, architecture rules, control-plane-first rule) stays
unchanged. This only changes text the model reads; no route/auth/schema/binding change.

## Change 2 — fail-open admin gate (SEPARATE hardening; test before deploy)
`checkKey` currently returns authorized when `env.ADMIN_KEY` is unset
(`if (!env.ADMIN_KEY) return true;`). Correct behavior is fail-closed. **Do not ship this
blindly:** first confirm `ADMIN_KEY` is actually set on `scout-claude-relay` (via the
control-plane preview / a dry-run), or flipping it could lock out the relay's admin lane.
Recommended as its own small change after Change 1, with a preview gate.

## Deploy path (keyed-session-gated — not this chat)
Any relay deploy runs through the audited Control Plane. Finish via ONE of:
- a keyed Claude Code / direct-Cloudflare Builder session using the Control Plane
  `self-stage-with-patch` route (fetch live source → apply Change 1 → `/preview` → deploy), or
- Shane, through the Control Plane Upload/Preview/Deploy UI.
Use `/preview` (dry-run) first; confirm bindings are preserved and only the SYSTEM-prompt
lines changed. Keep the current version for rollback.

## Expected side effect already present
The relay's automatic deploying has been failing since the 2026-08-07 rotation (it still
holds the old keys). This cleanup plus supplying the new keys server-side (Change 2 window)
restores it. Not required for security.

## Scout / Builder handoff packet
MISSION: Apply Change 1 (remove dead credential lines from the scout-claude-relay SYSTEM
prompt) via the Control Plane self-stage-with-patch route; preview, then deploy under a
keyed session. Change 2 (fail-closed admin gate) optional, separate, preview-gated.
DO: match lines by label prefix; preserve all bindings; /preview before deploy; keep rollback.
DO NOT: copy any credential value into source/prompt/board/logs; deploy without a passing
preview; collapse Change 2 into Change 1.
STOP IF: preview shows any change beyond the five prompt lines; bindings would drop;
`ADMIN_KEY` set-state unknown when attempting Change 2.
