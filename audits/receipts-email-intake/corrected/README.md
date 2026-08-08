# corrected/ — hardened receipts-email-intake v2.0 (offline candidate)

**Status: OFFLINE ONLY. Not deployed, not staged, not routed. No secret rotated.**
This is option (b) from OPEN_HUMAN_DECISIONS D-2: harden the personal **v1.2**
source into a deployment-ready candidate for the **church** account, replacing the
live v1.0 — *when Shane separately authorizes staging and rotation.*

## Files
- `worker.js` — the hardened candidate (ES module; pure functions exported for test).
- `test/corrected.test.mjs` — regression suite (27 tests) + `test/OUTPUT.txt`.
- `v1.2-to-v2.0.patch` — the exact diff from the preserved v1.2 base to this candidate.
- `wrangler.example.toml` — bindings/vars for the eventual gated deploy (no secrets).

## Run the tests
```
node --test audits/receipts-email-intake/corrected/test/corrected.test.mjs   # 27 pass / 0 fail
```

## What changed vs v1.2 / v1.0 (maps to AUDIT_FINDINGS + D-3 policy)
| Area | v1.0 / v1.2 (live/base) | v2.0 (this candidate) |
|---|---|---|
| Downstream secret (F-01) | `env.INTAKE_SECRET \|\| '<hard-coded>'` | `env.INTAKE_SECRET` only; **fail closed** if unset |
| Routing identity (F-02, D-3 #2-5) | visible `From` header, no auth | **trusted-ingress** `Authentication-Results` (first line, authserv-id checked) + **alignment**; DMARC pass, else aligned DKIM/SPF pass |
| Sender gate (F-03, D-3 #1) | default **accept-all** | **deny by default**; exact staff allowlist |
| Check intent (F-04, D-3 #8,#9) | trusted, attacker-triggerable | requires `CHECK_ALLOWLIST` + auth; else **rejected** (never downgraded/rerouted) |
| Attachment types (F-05) | `image/*` prefix incl. svg | **magic-byte allow-set**; svg/active types rejected |
| Type source (F-06/F-07) | declared header / filename | **content sniff** decides; declared family must agree |
| Body-only email (F-09, D-3 #7,#10) | v1.0 stores raw HTML | **rejected**; nothing stored |
| Idempotency (F-08) | none | **content-hash** dedupe (+ optional KV); survives new Message-ID |
| Downstream failure (F-13) | response ignored, silent drop | **retry w/ backoff**, then **dead-letter + throw** (visible) or enqueue |
| Duplicate ledger writes | possible | `dedupe_key` sent for downstream `UNIQUE` (companion change) |
| Read cap (F-15) | silent truncation | truncated read **rejected** |
| Logging | n/a | **safe**: domain + verdict only; never contents/secret/local-part |

## Trusted-authentication note (important to verify before staging)
The worker treats the **first** `Authentication-Results` header as the trusted one
**only if** its authserv-id equals `TRUSTED_AUTHSERV` (default `mx.cloudflare.net`).
Cloudflare Email Routing prepends this header at ingress, above any attacker-supplied
copies in the forwarded body. **Before staging, confirm on a real received message:**
(a) the exact authserv-id Cloudflare stamps, and (b) that DMARC/DKIM/SPF results are
present in that header. If Cloudflare's format differs, set `TRUSTED_AUTHSERV`
accordingly — this is the one assumption that must be validated against live ingress.

## Companion downstream changes (in the `receipts` worker — required, separate PR)
Tracked here, applied under the same gated deploy:
1. Remove the downstream hard-coded `INTAKE_SECRET` fallback; require the env secret.
2. Add `dedupe_key` column + `UNIQUE` index on `pending_email_receipts`; intake
   INSERT becomes `... ON CONFLICT(dedupe_key) DO NOTHING` (no duplicate ledger writes).
3. Wrap the R2-put/D1-insert so a D1 failure deletes the just-written R2 object
   (F-14 orphan cleanup); add a periodic orphan sweep.
4. Serve stored attachments with `Content-Disposition: attachment` and a locked-down
   content-type (defense in depth for any legacy stored HTML/SVG).
