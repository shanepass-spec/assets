# SECRET_ROTATION_RUNBOOK.md — coordinated INTAKE_SECRET rotation

**HUMAN-GATED. Nothing in this runbook was executed.** It rotates the shared
`INTAKE_SECRET` across the intake worker(s) and the downstream `receipts` worker
so the F-01 hard-coded fallback can be removed without dropping any receipt.

## Why coordination is mandatory
The intake worker sends `x-intake-secret`; the downstream `/api/intake` compares it.
Today both sides fall back to the SAME literal baked in source (F-01). If you remove
the fallback or rotate one side without the other, every forwarded receipt is
rejected 403 downstream — and the current v1.0 worker **silently drops** it (F-13).
The v2.0 candidate makes that failure visible + retryable, but you still must
rotate both sides together.

## Preconditions
- Downstream `receipts` worker updated to **accept two secrets during the window**
  (primary + previous), env-only, no source fallback. (Small companion change:
  `secret === env.INTAKE_SECRET || secret === env.INTAKE_SECRET_PREV`.)
- New secret generated out-of-band (e.g. `openssl rand -hex 32`), stored only in a
  password manager. **Never** commit it; never paste it into chat, code, or logs.
- Staging validated (see STAGING_PLAN.md).

## Sequence (zero-drop)
1. **Downstream: add new secret as primary, keep old as PREV.**
   `wrangler secret put INTAKE_SECRET` (new) and `INTAKE_SECRET_PREV` (old) on
   `receipts`. Deploy. Downstream now accepts BOTH. (Old intake still works.)
2. **Intake (church prod): set the new secret, deploy the v2.0 candidate.**
   `wrangler secret put INTAKE_SECRET` (new) on `receipts-email-intake` (church).
   Deploy v2.0 (no source fallback). Intake now sends the new secret.
3. **Verify** via STAGING_PLAN smoke test + `/health` (`secret_set:true`) + a real
   sanctioned forward: confirm one pending row appears, correct owner/intent.
4. **Retire the old secret.** Remove `INTAKE_SECRET_PREV` from `receipts`; redeploy.
   Downstream now accepts only the new secret.
5. **Rotate/retire the personal-account v1.2 script** (D-2 retirement, separate gate)
   so no other script holds a working secret. Until retired, set its secret to the
   new value only if it must stay reachable; otherwise disable it.

## Rollback of the rotation
- If step 2/3 misbehaves: re-deploy the previously-preserved intake bundle
  (`deployed/…` or a pre-change capture) and set its secret back — downstream still
  accepts PREV, so no drop. Then investigate. (Never delete receipts or R2 objects.)

## Guardrails
- Do **not** print the secret in CI logs, `wrangler` output, commits, or `/health`.
- `/health` must only ever expose `secret_set: <bool>`, never the value.
- Confirm the deploy pipeline (`deploy.yml`) carries secret bindings as `inherit`
  (it already does) so a later unrelated deploy can't wipe the secret.
