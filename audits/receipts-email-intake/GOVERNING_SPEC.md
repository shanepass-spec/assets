# GOVERNING_SPEC.md — receipts-email-intake (FROZEN 2026-07-24)

This is the standard the worker is audited **against**. It is frozen before any
correction. It encodes the intended contract; where the deployed code diverges,
that divergence is a finding in [`AUDIT_FINDINGS.md`](AUDIT_FINDINGS.md), not a
change to this spec. Items marked **(HUMAN)** require Shane / Business Office to
ratify a policy choice (see [`OPEN_HUMAN_DECISIONS.md`](OPEN_HUMAN_DECISIONS.md)).

## S1. What an accepted receipt email is
An email delivered by Cloudflare Email Routing to the designated receipts
address that carries EITHER:
- one or more base64 attachments of an **allowed type** (see S4), OR
- (church/v1.0 body-capture mode only) a vendor receipt rendered in the email
  body with no attachment.

The email must originate from an **authorized submitter** (S2) as established by
verified sender authentication (S2), not merely a `From` string.

## S2. Who is allowed to submit one
- **(HUMAN)** The authorized set is: staff/volunteers whose sending address (or a
  registered `user_emails` alias) is known to the Receipts app, plus explicitly
  allow-listed vendor/forwarding domains.
- Sender authenticity MUST be established from **message authentication**
  (SPF/DKIM/DMARC/ARC results that Cloudflare provides), not from the raw `From`
  header alone.
- If `ALLOWED_DOMAINS` is unset, the correct default is **deny/hold-as-unassigned**,
  never accept-all-and-route.

## S3. How the destination user/account is determined
- Routing to a specific user is permitted **only** when the sender is
  authenticated (S2) AND exactly one active user matches the authenticated
  address. Otherwise the item is held **unassigned** for an admin.
- The forwarded-mail `From`/typed content MUST NOT be sufficient, on its own, to
  deposit an item into a named user's lane.
- Cross-account isolation: an item may only ever be routed within the account/org
  that owns the receiving address; a submission must never land in a different
  org's ledger.

## S4. Allowed attachment formats and limits
- **Types (allow-list):** `application/pdf`, `image/png`, `image/jpeg`,
  `image/gif`, `image/webp`, `image/heic`. Nothing else — in particular
  **`image/svg+xml` and any active/scriptable type are rejected.**
- **Content must match the declared type** (magic-byte sniff); MIME/content
  mismatches are rejected.
- **Size:** individual attachment ≤ 14 MB decoded; total raw message read is
  bounded (currently 15 MB). If the bound truncates a real attachment, the item
  must be flagged, never silently stored truncated.
- **Minimum:** an attachment too small to be a real receipt is rejected, but a
  size gate MUST NOT be treated as content validation.

## S5. Duplicate and retry behavior
- Every accepted email has a stable identity = its `Message-ID` (fallback: hash of
  sender+subject+attachment bytes).
- The same message delivered/redelivered MUST be **idempotent**: it produces at
  most one pending item. A re-send of the *same attachment under a new Message-ID*
  is de-duplicated by content hash within a reasonable window.
- Email Routing / transport retries MUST NOT create duplicate ledger/pending rows.

## S6. Required storage and database outcomes
- One accepted attachment ⇒ exactly one R2 object under a server-generated,
  non-guessable key AND exactly one `pending_email_receipts` row referencing it.
- Storage and DB write MUST be **atomic in effect**: no orphan R2 object without a
  row, no row pointing at a missing object. On partial failure the successful
  half is rolled back or reconciled by a cleanup path.
- The intake worker MUST confirm the downstream `/api/intake` call **succeeded**
  (2xx) and MUST surface/retry (not silently drop) on failure.

## S7. Required audit records
- Each intake attempt records: timestamp, authenticated sender, message identity,
  destination resolution (user or unassigned + reason), attachment type/size,
  intent, and outcome (stored / rejected+reason / downstream-failed).
- Audit records MUST NOT contain receipt image bytes, full body text, card
  numbers, or other financial PII beyond the minimum needed to trace an item.

## S8. Failure behavior
- Reject-and-record for: unauthenticated/disallowed sender, disallowed type,
  content/type mismatch, oversize, empty/corrupt payload.
- Downstream unavailability ⇒ retry with backoff or dead-letter; **never** a
  silent drop.
- No unhandled exception may cause a receipt to be lost without a record.

## S9. Privacy boundary
- Receipt contents (image/PDF/body, memo, subject, sender) are personal/financial
  data. They may cross ONLY the intended boundary: submitter → this worker →
  downstream `receipts` app for the resolved owner/admin.
- No logging of receipt contents or private identifiers to `console`/log sinks.
- Content served back to users must be served **inertly** (no inline execution of
  attacker-supplied HTML/SVG/script) and only to authorized viewers.
- Cross-account/cross-org routing of contents is prohibited (S3).

## S10. Rollback behavior
- The exact deployed source of each environment is preserved in version control
  (secrets redacted, injected at deploy from dashboard) so any version can be
  restored deterministically.
- Rollback restores code only; it never rewrites or deletes stored receipts or
  ledger rows. Secrets are re-supplied out-of-band, never from the repo.

## S11. Pass/fail standard
**PASS** requires ALL of:
1. Sender authenticated (S2) before any user-routing; open-default removed (S3).
2. No secret literal in source; downstream auth via injected secret only (S7/F-01).
3. Attachment type allow-list + content sniff enforced; svg/active types rejected (S4).
4. Idempotent on redelivery; content-hash dedupe for same-bytes/new-id (S5).
5. Atomic storage+DB with orphan cleanup; downstream success confirmed, failures
   retried/dead-lettered, never silently dropped (S6/S8).
6. Contents served inertly to authorized viewers only; no PII logging (S9).
7. Deployed source preserved with a deterministic rollback (S10).

Any unmet item ⇒ **FAIL** (or **BLOCKED** if a (HUMAN) decision or missing proof
prevents evaluation).
