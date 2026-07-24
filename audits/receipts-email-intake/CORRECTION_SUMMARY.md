# CORRECTION_SUMMARY.md — receipts-email-intake hardening (option (b))

**Date:** 2026-07-24 · **Decision:** Shane chose **(b)** — harden personal **v1.2**
into a church-account candidate; live church **v1.0** untouched. Sender policy
**D-3** supplied and implemented. **Nothing staged, rotated, routed, or deployed.**

## Exact diff
- `corrected/worker.js` — hardened **v2.0** candidate (from the v1.2 base).
- `corrected/v1.2-to-v2.0.patch` — exact unified diff (`git diff --no-index`
  `deployed/personal-account-v1.2.worker.js` → `corrected/worker.js`), 665 lines.

## Correction checklist (all implemented in `corrected/worker.js`)
| Required correction | Where | Proven by |
|---|---|---|
| Remove hard-coded `INTAKE_SECRET` | `postWithRetry`, `processEmail` guard | test *no INTAKE_SECRET → fail closed* |
| Environment-secret lookup only | `env.INTAKE_SECRET` (no `\|\|` fallback) | same |
| Coordinated intake/downstream rotation plan | `SECRET_ROTATION_RUNBOOK.md` | runbook |
| Sender authentication + alignment | `parseTrustedAuthResults`, `evaluateAuth` | forged From / forged A-R / SPF-DKIM-DMARC fail tests |
| Deny-by-default allowlist routing | `isStaffAllowlisted` | unknown-sender, empty-allowlist tests |
| Check-intent authorization | `isCheckAuthorized` + `processEmail` | unauthorized/authorized check tests |
| MIME/content verification | `sniffMediaType`, `selectValidAttachment` | mismatch test + unit sniff |
| SVG rejection | allow-set + sniff | SVG test |
| Attachment size/count limits | `MAX_ATTACHMENT_BYTES`, `MAX_MIME_PARTS` | oversize unit test |
| Idempotency + replay protection | `sha256Hex`, `seenBefore`, `dedupe_key` | dup-msgid + same-bytes-new-id tests |
| Visible, safely retryable downstream failures | `postWithRetry` + dead-letter/throw | timeout-retry + persistent-failure tests |
| No duplicate ledger writes | `dedupe_key` → downstream `UNIQUE` (companion) | same-key-across-retries test + corrected/README companion #2 |
| Safe logging (no contents/secret) | `safeLog` | logging test |
| Drop v1.0 raw-HTML body capture | body path removed | raw-HTML-body-only test |

## Regressions added (required list — all present, all green)
forged visible From · forged Authentication-Results (incl. untrusted authserv) ·
SPF/DKIM/DMARC failure · unknown sender · forwarded/ambiguous sender ·
unauthorized check intent · authorized check intent · duplicate Message-ID ·
same attachment under a new Message-ID · MIME/content mismatch · SVG ·
raw HTML body-only email · downstream timeout & retry · partial-write
recovery (idempotent retries) — plus fail-closed, deny-by-default, safe-logging,
and unit checks.

## Test totals
| Suite | File | Result |
|---|---|---|
| Original findings reproduction | `test/intake.test.mjs` | **12 / 12 pass** (`test/OUTPUT.txt`) |
| Hardened v2.0 regressions | `corrected/test/corrected.test.mjs` | **27 / 27 pass** (`corrected/test/OUTPUT.txt`) |
| **Total** | | **39 / 39 pass** |

Run:
```
node --test audits/receipts-email-intake/test/intake.test.mjs
node --test audits/receipts-email-intake/corrected/test/corrected.test.mjs
```

## Remaining human decisions
- **D-1** authorize the coordinated secret rotation (SECRET_ROTATION_RUNBOOK).
- **D-2 (product half)** confirm cutover: stage v2.0 in church, then retire v1.0 +
  personal v1.2.
- **D-3 config values** provide the actual `STAFF_ALLOWLIST` and `CHECK_ALLOWLIST`
  addresses (code enforces the policy; the lists are data).
- **D-4 / D-5** retention/dead-letter destination and cross-account boundary (unchanged).
- **One assumption to validate live (STAGING_PLAN Step 0):** the trusted ingress
  `authserv-id` and that DMARC/DKIM/SPF appear in Cloudflare's first
  `Authentication-Results` header. Everything else is offline-proven.

## Runbooks / plans included
- `SECRET_ROTATION_RUNBOOK.md` — zero-drop coordinated rotation.
- `STAGING_PLAN.md` — church-account staging + smoke tests + cutover + retirement.
- `ROLLBACK_PLAN.md` — updated with v2.0 cutover rollback.
- `corrected/wrangler.example.toml` — bindings/vars (no secrets).

## Confirmation
Nothing was staged, deployed, rotated, routed, or written to live storage/DB during
this work. The live church v1.0 worker is untouched. All corrections and tests are
offline. The single read of production data this session was the earlier
metadata-only D1 aggregate that resolved D-2 (no receipt contents or PII).

## HUMAN-GATED (still not done, by design)
actual secret rotation · church-account staging · Email Routing changes ·
production deployment · retirement of v1.0 and personal v1.2.
