# Deliverable 7 — Risk Register

Likelihood / Impact: L/M/H. Owner: TabReady Admin unless noted. Rollback response references Deliverable 4 §7.

| # | Risk | L | I | Mitigation | Rollback response | Owner |
|---|------|---|---|------------|-------------------|-------|
| R1 | **Session cookie doesn't cross hosts** → everyone logged out on church host | H (certain w/o handoff) | H | Build the ≤60s single-use **transfer-token handoff** (D4 §4); keep `SESSION_SECRET` identical | Disable handoff → path-preserving redirect + Restore Access / code login | Admin |
| R2 | **`SESSION_SECRET` differs** between accounts → handoff tokens won't verify | M | H | Copy the exact secret to Media before cutover; verify with a signed-token round-trip test | Re-set correct secret; re-run E9/E10 | Admin |
| R3 | **Secrets missing in Media** (deploy uses `inherit`; fresh deploy has none) | H | H | Explicit pre-cutover checklist to set all 10 secrets (D2 §1); test G4 | Set missing secret; app degraded until then | Admin |
| R4 | **`VAPID_*` keys rotated** → all `push_subscriptions` break silently | M | M | Reuse identical VAPID keypair; if intentional rotation, plan re-subscribe prompt | Restore original keys | Admin |
| R5 | **Cron trigger not recreated** in Media → PCO 429 storms + digests stop | H | M | Recreate the weekly cron on the Media Worker; test G5; alarm on non-execution | Add trigger; warm cache manually via admin Refresh | Admin |
| R6 | **Data copy incomplete / IDs changed** → broken roles, orphaned audit/photos | M | H | Clean-load into Media; **row-count + checksum reconcile**; assert byte-identical `usr_…` (G1‑G3) as a No-Go gate | Re-import from final source export; source untouched | Admin |
| R7 | **Media DB has stale skeleton/partial artifacts** (24 tables, migration_ledger_*) colliding | M | M | Recreate the Media DB clean (or fresh DB + repoint) before load; don't merge onto the skeleton | Drop + reload | Admin |
| R8 | **Digest emails point at old host** (`DIGEST_BASE` hard-coded) | H (if unaddressed) | M | Ship `CANONICAL_BASE_URL` config (zero-behavior until set); set at cutover; test G12 | Revert setting → falls back to request origin | Admin |
| R9 | **Old printed QR / bookmark breaks** if personal Worker deleted too early | M | H | **Do not delete** personal Worker; run it as the bridge indefinitely (brief §7/§21) | N/A — bridge stays up | Admin |
| R10 | **Redirect drops path/query** → users dumped on homepage | M | M | Bridge preserves full path + query (E2); explicit test | Fix bridge forwarding logic | Admin |
| R11 | **Email-code loop persists** post-migration (no request rate-limit, generic success) | M | M | Add request rate-limit + real failure surfacing + "I previously had TabReady" path (D5 §3) | Keep Restore Access as the human fallback | Admin |
| R12 | **No session revocation** for lost/stolen device | M | M | Add `session_epoch` per-user version (D4 §5) | Rotate `SESSION_SECRET` (nuclear: logs out everyone) | Admin |
| R13 | **Delegated helper over-reach / self-promotion** once scoped writes exist | M | H | Server-side `canOnboard` scope; hard-block admin/sensitive/cross-ministry grants; audit every action | Revoke helper scope; audit review | Shane |
| R14 | **Public general-member path leaks ministry/sensitive access** | L | H | Public path may write **only** general-member role; sensitive depts Admin-only; server-enforced | Disable public path; audit | Shane |
| R15 | **iOS PWA cross-host quirk** (ITP / standalone `start_url` pinned to old host) | M | M | Device-test M1‑M13 on real iPhone **before** mass onboarding; bridge handles pinned old `start_url` | Prompt icon replacement (M14) | Admin |
| R16 | **Collision with in-flight migration work** (restore-runner, ledgers, wave backups already present) | M | H | Reconcile with whoever built the existing migration prep before acting (D2 §8) | Pause; align on one ledger | Shane |
| R17 | **Cutover during active use** → write lost between export and DNS switch | M | M | Freeze writes for final sync; low-traffic window; final backup + delta | Restore from final backup | Admin |
| R18 | **`tab-shared-docs` R2 shared with sibling apps** diverges after copy | L | M | Coordinate bucket copy timing; treat as shared dependency | Re-sync objects | Admin |
| R19 | **Resend domain not verified in Media-side project** → emails fail | L | H | Confirm `thetabsrq.net` verified for the key used by the Media deployment (G6) | Revert to working key/project | Admin |
| R20 | **"Done" declared on deploy success alone** (brief §21) | M | H | Go/No-Go requires device tests + reconcile evidence, not deploy 200 | Reopen; run full matrix | Shane |

**Top 3 to resolve first:** R1 (session handoff), R3 (secrets in Media), R6 (data reconcile). All three are hard
gates — none can be waved through.
