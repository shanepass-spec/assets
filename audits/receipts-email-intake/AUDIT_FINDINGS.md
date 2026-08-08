# AUDIT_FINDINGS.md — receipts-email-intake

**Date:** 2026-07-24 · **Basis:** live deployed bundles (both accounts) +
downstream `receipts` bundle, retrieved read-only via Cloudflare API, plus
offline reproduction (`node --test`, 12/12 pass — [`test/OUTPUT.txt`](test/OUTPUT.txt)).

Legend — **VERIFIED**: proven from current deployed source and/or an executed
test. **CLAIMED-NOT-VERIFIED**: depends on evidence this session could not obtain
(live vars, Email Routing rules, client-side rendering). No finding is called
"fixed" on the basis of a comment or doc.

Severity: Critical / High / Medium / Low. Line refs are to the preserved copies in
[`deployed/`](deployed/) unless marked *(downstream)* (the `receipts` bundle).

Rule ids reference [`GOVERNING_SPEC.md`](GOVERNING_SPEC.md).

---

## F-01 — Hard-coded shared secret literal in worker source · **Critical** · VERIFIED
- **Violated rule:** S7, S11.2 (no secret literal in source).
- **Where:** `process()` / `postIntake()` — header
  `'x-intake-secret': env.INTAKE_SECRET || 'rcpt_…<40 hex>…'` in **both** the
  personal (v1.2) and church (v1.0) bundles; the **same** literal is the accepted
  fallback in downstream `handleEmailIntake` *(downstream ~line 2187)*:
  `const expectedSecret = env.INTAKE_SECRET || 'rcpt_…';`. Downstream header comment
  admits it: *"v3.3.1: shared intake token is now baked into the code."*
- **Safe reproduction:** read either deployed bundle; the literal is present in
  clear. (The value is redacted in this repo's copies; it is present live.)
- **Expected:** the shared secret exists ONLY as an injected dashboard secret;
  absence ⇒ fail closed.
- **Actual:** `/api/intake` is a public endpoint on `receipts.shanepass.workers.dev`.
  Anyone in possession of the literal (which lives in retrievable worker code and
  is identical across three scripts/two accounts) can POST arbitrary receipts and
  check-request drafts and set `from_addr` to route them to any user. If
  `INTAKE_SECRET` is unset in any environment, the literal is silently the live
  credential.
- **Impact:** full forgery of the intake channel; financial-workflow injection;
  bypass of the only authentication between the internet and the receipts ledger.
- **Smallest correction:** remove the `|| '…'` fallback in all three call sites;
  require `env.INTAKE_SECRET` and **fail closed** (return without POST / 403) when
  unset. Then **rotate** the secret in the dashboard for the intake worker(s) and
  the `receipts` worker together. (Rotation = human-gated deploy step — see
  OPEN_HUMAN_DECISIONS D-1; do not deploy in this audit.)
- **Regression test:** unit-assert the built source contains no `rcpt_` literal and
  that `postIntake` throws/returns when `INTAKE_SECRET` is falsy (add on fix).

## F-02 — Sender identity taken from unauthenticated `From` header · **Critical** · VERIFIED
- **Violated rule:** S2, S3, S9 (privacy/routing boundary).
- **Where:** `sender = extractSenderEmail(getHeader(raw,'From'))`; sent as
  `from_addr`. Downstream routes owner by `lower(from_addr)` against
  `users.email`/`user_emails.email` *(downstream ~2221-2234)*. No SPF/DKIM/DMARC/ARC
  is consulted anywhere.
- **Safe reproduction:** `test [F-02]` — a message with `From: julie@thetabsarasota.org`
  yields `sender === 'julie@thetabsarasota.org'` regardless of the true origin.
- **Expected:** route to a named user only after authenticating the sender.
- **Actual:** a forged `From` matching one active user deposits an
  attacker-supplied receipt/check draft directly into that user's `pending` lane
  as if they submitted it.
- **Impact:** targeted content injection into a specific staffer's financial
  workflow; laundering an attacker item under a trusted identity; enables the
  check-request abuse in F-04.
- **Smallest correction:** gate user-routing on Cloudflare's message
  authentication verdict. Minimum: only assign an owner when SPF/DKIM for the
  `From` domain passed; otherwise force `unassigned`. (Cloudflare Email Workers
  expose auth results / the raw `Authentication-Results` header.)
- **Regression test:** `test [F-02]` documents current behavior; extend to assert
  "no auth ⇒ unassigned" after fix.

## F-03 — Sender allow-list defaults to accept-ALL · **High** · VERIFIED
- **Violated rule:** S2, S3 (deny-by-default).
- **Where:** `senderAllowed()` — `if (list.length === 0) return true;` when
  `ALLOWED_DOMAINS` is empty/unset.
- **Safe reproduction:** `test [F-03]` — `senderAllowed('attacker@evil.example', {})
  === true`.
- **Expected:** unset ⇒ hold as unassigned / deny, not accept-and-route.
- **Actual:** with the (default) empty config, every sender on the internet is
  accepted; combined with F-02 the `From` then chooses the owner.
- **Impact:** removes the only sender gate; widens F-01/F-02 to the whole internet.
- **Smallest correction:** default-deny (or default-hold-unassigned) when unset;
  require an explicit allow-list to auto-route.
- **Regression test:** `test [F-03]`.

## F-04 — Check-request intent is attacker-controllable · **High** · VERIFIED
- **Violated rule:** S2/S3 + financial-integrity intent of the check lane.
- **Where:** `detectIntent(toAddr, subject, memo)` (v1.2). Downstream trusts the
  tag (`intent === 'check' ? 'check' : 'receipt'`, *~2238*) and files a
  check-request draft.
- **Safe reproduction:** `test [F-04]` — a `checks@…`/`reimburse@…`/`payment@…`
  destination, or subject/note containing "cut a check"/"reimburse"/"pay to",
  yields `intent === 'check'`.
- **Expected:** creating a payment/check artifact requires an authenticated,
  authorized requester.
- **Actual:** a forwarded email (subject-only trigger) can seed a check-request
  draft attributed to a spoofed requester. Mitigating factor: downstream holds
  the draft until a logged-in user confirms the amount and submits — so it is a
  **draft-injection / social-engineering** vector, not an automatic payout.
- **Impact:** fraudulent check drafts surface in the payment workflow under a
  trusted name; risk of an approver acting on a planted draft.
- **Smallest correction:** only honor `intent:'check'` for authenticated senders
  (F-02) and/or require the destination-address signal (not subject keywords)
  plus an allow-listed requester; otherwise file as an ordinary unassigned receipt.
- **Regression test:** `test [F-04]`.

## F-05 — Attachment type allow-list too broad; `image/svg+xml` passes through · **High** · VERIFIED (intake); stored-XSS chain CLAIMED-NOT-VERIFIED (client render)
- **Violated rule:** S4 (reject active/scriptable types), S9 (serve inertly).
- **Where:** `extractBestAttachment` / `extractAllAttachments` —
  `isImage = ct.startsWith('image/')` accepts ANY image subtype; `content_type` is
  forwarded verbatim. Downstream stores it and `/api/pending/:id/image` streams it
  back with `Content-Type: row.content_type` and no `Content-Disposition:
  attachment` *(downstream ~2488)*.
- **Safe reproduction:** `test [F-05]` — an `image/svg+xml` attachment is accepted
  and `att.content_type === 'image/svg+xml'`.
- **Expected:** only `png/jpeg/gif/webp/heic/pdf`; svg and other active types
  rejected.
- **Actual:** an SVG (which can carry `<script>`) is accepted, stored, and served
  inline on the app origin. If the client preview opens it as a document/iframe/new
  tab (rather than an `<img>`), script executes in `receipts.shanepass.workers.dev`
  → session/action abuse against the viewing user/admin. Whether the client opens
  it executably is not provable from the worker alone (**CLAIMED-NOT-VERIFIED**);
  the unsafe passthrough + inline serving are **VERIFIED**.
- **Impact:** potential stored XSS / account takeover in the receipts app.
- **Smallest correction (intake):** replace `ct.startsWith('image/')` with an
  explicit allow-set `{image/png,image/jpeg,image/gif,image/webp,image/heic}` and
  reject everything else. (Downstream should also serve with `Content-Disposition:
  attachment` and a locked-down type — cross-referenced, downstream-owned.)
- **Regression test:** `test [F-05]`.

## F-06 — Declared content-type trusted; no content sniff at intake · **Medium** · VERIFIED
- **Violated rule:** S4 (content must match declared type).
- **Where:** intake resolves/forwards the header-declared type; no magic-byte
  check. (Downstream `sniffMediaType` runs only on **promote**, not on the
  `/image` preview.)
- **Safe reproduction:** `test [F-06]` — HTML bytes declared `image/png` are
  accepted and forwarded as `image/png`.
- **Expected:** sniff bytes; reject type/content mismatch.
- **Actual:** stored/served type is attacker-chosen independent of the bytes,
  compounding F-05.
- **Smallest correction:** sniff the decoded bytes at intake and drop mismatches
  (share the downstream `sniffMediaType` logic).
- **Regression test:** `test [F-06]`.

## F-07 — `application/octet-stream` typed purely from filename extension · **Medium** · VERIFIED
- **Violated rule:** S4.
- **Where:** octet-stream branch — `resolvedCt` derived from `filename` regex only.
- **Safe reproduction:** `test [F-07]` — octet-stream + `filename="evil.pdf"`
  ⇒ `content_type === 'application/pdf'`, no byte inspection.
- **Expected:** type from content, not attacker-supplied filename.
- **Actual:** filename dictates stored type/extension.
- **Smallest correction:** fold into the F-06 sniff; use the extension only as a
  tie-break after content confirms a compatible family.
- **Regression test:** `test [F-07]`.

## F-08 — No idempotency / replay protection · **High** · VERIFIED
- **Violated rule:** S5.
- **Where:** intake never reads `Message-ID` and keeps no state; downstream
  `handleEmailIntake` inserts a fresh `crypto.randomUUID()` row unconditionally
  *(downstream ~2199, ~2240)*.
- **Safe reproduction:** `test [F-08]` — the same raw email parses to identical
  output twice; a `Message-ID` exists but is never consulted. Two deliveries ⇒ two
  R2 objects + two pending rows. A same-attachment/new-Message-ID resend is also
  not de-duplicated (no content hash).
- **Expected:** at most one pending item per message identity; content-hash
  dedupe for same-bytes resend.
- **Actual:** transport retries and manual re-forwards create duplicate pending
  receipts and (via promote) duplicate ledger entries — double-charge risk in
  reconciliation.
- **Smallest correction:** compute a stable key (`Message-ID`, else
  sha256(sender+subject+attachment)) and pass it as `dedupe_key`; downstream
  `INSERT … ON CONFLICT(dedupe_key) DO NOTHING` (add a unique column).
- **Regression test:** `test [F-08]` (documents current); extend downstream on fix.

## F-09 — v1.0 body-capture forwards raw, unsanitized HTML · **High** · VERIFIED (passthrough); execution CLAIMED-NOT-VERIFIED
- **Violated rule:** S4, S9.
- **Where:** church v1.0 `extractBody()` → `postIntake({content_type:'text/html',
  body_html:<raw>})`; downstream stores as `pending/<id>.html` and serves via
  `/api/pending/:id/image` with `Content-Type: text/html` inline.
- **Safe reproduction:** `test [F-09]` — `<script>`/`onerror=` in an email body
  survive intake verbatim in `body.html`.
- **Expected:** sanitize/inert before storage; serve non-executably.
- **Actual:** an attacker-authored HTML email body is stored and served as
  executable HTML on the app origin (stored-XSS) — subject to the same
  client-render caveat as F-05.
- **Impact:** stored XSS via the no-attachment path (church deployment).
- **Smallest correction:** in v1.0, stop forwarding raw `body_html`; forward
  sanitized text only (or align to v1.2's attachment-only behavior). Downstream
  must serve stored bodies inert.
- **Regression test:** `test [F-09]`.

## F-10 — 800-char base64 gate is not content validation · **Low** · VERIFIED
- **Violated rule:** S4.
- **Where:** `if (b64.length < 800) continue;` is the only "is this real?" check.
- **Safe reproduction:** `test [F-10]` — an 801-char payload of `'A'` passes as a
  valid attachment.
- **Expected:** validate the payload decodes to a well-formed file of an allowed
  type.
- **Actual:** any ≥600-byte blob is accepted as a "receipt".
- **Smallest correction:** subsumed by the F-06 content sniff.
- **Regression test:** `test [F-10]`.

## F-11 — Two divergent live deployments (v1.0 vs v1.2) · **Medium** · VERIFIED
- **Violated rule:** S10 (deterministic, single source of truth).
- **Where:** personal `f26c03bd…` = v1.2 (intent, single attachment, memo); church
  `ec691064…` = v1.0 (all attachments, body capture, no intent). Different
  behavior, different exposure (F-09 only affects church).
- **Impact:** unclear which is authoritative/"production" (see inventory §4/§10);
  a fix applied to one leaves the other exposed; audit conclusions differ per
  environment.
- **Smallest correction:** decide the single supported version, converge both
  accounts to it, retire the other. (Product choice remains for Shane — D-2.)
- **Status:** VERIFIED that both exist and differ. **Production resolved
  2026-07-24: church v1.0 is live; personal v1.2 is un-promoted** (D1 fingerprint
  aggregate — see CURRENT_INVENTORY §10). **Live-vs-latent impact:** because v1.0
  is the live worker, **F-09 (raw-HTML body-capture stored-XSS) is a LIVE
  exposure** (~27% of intake traffic used that path); **F-04 (check-intent abuse)
  is LATENT** until v1.2 is promoted. All shared findings (F-01, F-02, F-03, F-05,
  F-06, F-07, F-08, F-13) are live via v1.0.

## F-12 — No source / rollback source in version control · **Medium** · VERIFIED
- **Violated rule:** S10.
- **Where:** repo search finds no `receipts-email-intake` source; only deployed
  artifacts existed. This audit adds preserved redacted copies in `deployed/`.
- **Impact:** no reviewable history, no deterministic rollback, drift (F-11)
  undetectable.
- **Smallest correction:** keep the `deployed/` copies as the tracked source of
  truth and deploy from them (secret injected at deploy). See ROLLBACK_PLAN.md.

## F-13 — Downstream POST result ignored; failures silently dropped · **High** · VERIFIED
- **Violated rule:** S6, S8.
- **Where:** `await fetch(base + '/api/intake', …)` — the `Response` is never
  inspected (no `res.ok`), inside `ctx.waitUntil(process(...))` with the whole body
  wrapped so errors vanish. No retry, no dead-letter, no log.
- **Safe reproduction:** static/interpretive — the return value of `fetch` is
  unused at every call site (VERIFIED by reading the source; no runtime needed).
- **Expected:** confirm 2xx; on failure retry/backoff or dead-letter; never lose a
  receipt silently.
- **Actual:** a downstream 4xx/5xx (e.g. bad secret after a rotation, or a storage
  error) discards the receipt with zero trace — data loss.
- **Impact:** silent loss of financial documents; a secret rotation that misses one
  side (F-01 fix) would black-hole every receipt.
- **Smallest correction:** check `res.ok`; on failure log a minimal record and
  retry with backoff (Email Workers can `message.setReject()`/return an error to
  trigger transport retry) or write to a dead-letter (KV/queue).
- **Regression test:** add on fix (mock fetch → non-2xx must not resolve silently).

## F-14 — Partial-write orphan: R2 put before D1 insert, no cleanup · **Medium** · VERIFIED *(downstream, in this data path)*
- **Violated rule:** S6 (atomic; no orphan object).
- **Where:** downstream `handleEmailIntake` — `BUCKET.put(...)` then unguarded
  `INSERT pending_email_receipts` *(downstream ~2206 then ~2240)*. If the INSERT
  throws, the R2 object remains with no referencing row.
- **Expected:** atomic effect / orphan cleanup.
- **Actual:** DB failure after a successful put leaves an orphan `pending/<uuid>`
  object; no reconciliation sweep exists.
- **Smallest correction (downstream-owned):** wrap the INSERT; on failure
  `BUCKET.delete(r2key)`; add a periodic orphan sweep. Flagged here because the
  intake worker originates the write and F-13 makes the failure invisible upstream.
- **Regression test:** downstream integration test on fix.

## F-15 — 15 MB raw-read cap can silently truncate a large attachment · **Low/Medium** · VERIFIED (logic) / effect PLAUSIBLE
- **Violated rule:** S4 (no silently-stored truncated payload).
- **Where:** `readEmailRaw` breaks at 15 MB and decodes the partial buffer; a
  legitimately large (but <14 MB decoded) receipt near other MIME parts can be cut
  mid-base64, yielding a corrupt attachment that still passes the 800-char gate.
- **Expected:** if the cap truncates content, flag/reject rather than store partial.
- **Actual:** possible corrupt/partial receipt stored; the exact trigger depends on
  message layout (**PLAUSIBLE**, not reproduced end-to-end offline).
- **Smallest correction:** if the read hits the cap, abort with a recorded error
  instead of proceeding.

---

## Probes that came back CLEAN (documented, no finding)
- **Object-key / path manipulation:** downstream key is `pending/<crypto.randomUUID()>.<ext>`;
  no user/filename input reaches the key ⇒ not manipulable. **VERIFIED.**
- **Cross-user READ / leakage on retrieval:** `/api/pending/:id/{image,promote,discard}`
  all enforce `owns || (unassigned && admin)` *(downstream ~2353,2482,2498)* ⇒ a
  user cannot read another user's pending object by id. The exposure is on the
  *routing/injection* side (F-02), not read. **VERIFIED.**
- **Logging of receipt contents / PII (intake worker):** neither bundle writes
  receipt bytes, body, memo, or card data to `console`/logs (the personal worker
  has no logging at all). **VERIFIED.** (Downstream stores subject/from/memo in D1
  by design — within the privacy boundary.)
- **Unauthorized delete/overwrite from intake:** the intake worker has no delete
  path and no storage binding; it cannot delete or overwrite receipts. **VERIFIED.**

## Severity roll-up
| id | title | sev | status |
|----|-------|-----|--------|
| F-01 | hard-coded shared secret in source | Critical | VERIFIED |
| F-02 | unauthenticated From drives routing | Critical | VERIFIED |
| F-03 | sender allow-list default-open | High | VERIFIED |
| F-04 | check-request intent attacker-controllable | High | VERIFIED |
| F-05 | svg/active type accepted + served inline | High | VERIFIED / render CNV |
| F-06 | no content sniff (MIME/content mismatch) | Medium | VERIFIED |
| F-07 | octet-stream typed from filename only | Medium | VERIFIED |
| F-08 | no idempotency/replay protection | High | VERIFIED |
| F-09 | v1.0 raw HTML body passthrough (stored XSS) | High | VERIFIED / render CNV |
| F-10 | 800-char gate ≠ content validation | Low | VERIFIED |
| F-11 | two divergent live deployments | Medium | VERIFIED |
| F-12 | no source/rollback in VCS | Medium | VERIFIED |
| F-13 | downstream failures silently dropped | High | VERIFIED |
| F-14 | partial-write orphan (downstream) | Medium | VERIFIED |
| F-15 | 15MB read truncation | Low/Med | VERIFIED logic / PLAUSIBLE effect |

CNV = CLAIMED-NOT-VERIFIED (client-render dependency).
