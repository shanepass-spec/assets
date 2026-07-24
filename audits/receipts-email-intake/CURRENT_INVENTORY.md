# CURRENT_INVENTORY.md — receipts-email-intake

**Audit date:** 2026-07-24
**Auditor:** Claude (read-only inspection + offline reproduction)
**Proof basis:** Live deployed bundles pulled read-only from the Cloudflare API
(`workers_get_worker_code`) on 2026-07-24, plus Cloudflare account resource
listings from the same session. This is **current** evidence, not old docs.

> Scope guard: this audit covers **only** `receipts-email-intake`. It is
> deliberately kept separate from the Guardian3.2 control-plane audit, the Tab UI
> Design System / Section 5 work, Snapshot 3046, and any control-plane
> history/rollback investigation.

---

## 0. Headline: there are TWO live deployments, and they differ

| | Personal account | Church account |
|---|---|---|
| Cloudflare account | `26c8013cfb2cf72dde19e55e6cf390b1` (Shanepass@gmail.com) | `ffd360b239936d51e85d9961fdaeb65a` (Media@thetabsarasota.org) |
| Script id (tag) | `f26c03bdf9164d3d84081402b27219e4` | `ec69106405e34cc4b34ea7cb4a2c8798` |
| Source version (from bundle header) | **v1.2** | **v1.0** |
| `modified_on` (CF) | 2026-07-08T19:56:23Z | 2026-06-15T14:53:56Z |
| `created_on` (CF) | 2026-06-14T17:22:10Z | 2026-06-14T17:10:54Z |
| Intent routing (receipt vs check) | **yes** | no |
| Attachments forwarded | largest single | **all** attachments |
| No-attachment body capture | no | **yes** (forwards raw HTML body) |
| Typed-note (`memo`) extraction | yes | no |

Which one Email Routing actually delivers to is **not provable from the tools
available** (see §7, evidence gap). This version/behavior drift is itself a
finding (AUDIT_FINDINGS F-11).

---

## 1. Worker route / URL — CLAIMED-NOT-VERIFIED (live), VERIFIED (existence)

- Both deployments expose an HTTP `fetch` handler with a single public route
  `GET /health`, plus the Email Worker `email()` entrypoint.
- Expected workers.dev health URLs:
  - `https://receipts-email-intake.shanepass.workers.dev/health` (personal)
  - church-account workers.dev subdomain not confirmed.
- **Live reachability NOT verified:** outbound egress to `*.workers.dev` is
  denied by this session's agent proxy (HTTP 403 on CONNECT; confirmed via
  `$HTTPS_PROXY/__agentproxy/status`). The `/health` JSON could therefore not be
  fetched live. The **deployed bundle** (authoritative source of truth) WAS
  retrieved and is what every finding below is proven against.

## 2. Source repository / deployed artifact — VERIFIED (and a finding)

- **No source for this worker exists in the `shanepass-spec/assets` repo.** A
  repo-wide search for `receipts-email-intake` / `receipt` returns only the
  unrelated `tab-supplies-worker` and `tabready` receipts logic, and the
  sermon-oriented `tab-email-ingest` worker. The only source of truth for
  `receipts-email-intake` is the deployed artifact itself.
- Faithful redacted copies of both live bundles are preserved in
  [`deployed/`](deployed/) as the rollback reference (AUDIT_FINDINGS F-12).

## 3. Deployed version / checksum — VERIFIED (redacted copies)

- Personal: `v1.2`; Church: `v1.0` (from each bundle's header comment).
- SHA-256 of the preserved **redacted** copies are in [`CHECKSUMS.txt`](CHECKSUMS.txt).
  The live bundle bytes differ only by the real `INTAKE_SECRET` literal that was
  redacted; a raw-bundle checksum is intentionally NOT recorded to avoid writing
  the secret to disk (CLAIMED-NOT-VERIFIED for the live-byte hash).

## 4. Email routes / forwarding rules that invoke it — CLAIMED-NOT-VERIFIED

- The worker is an Email Worker (`email()` entrypoint), so Cloudflare **Email
  Routing** rules (custom addresses / catch-all) forward mail to it.
- **The rules themselves could not be read:** the Cloudflare MCP toolset exposes
  Workers, D1, KV, R2, and Hyperdrive, but **no** Email Routing API. The receiving
  address(es) (e.g. a `receipts@…` / `checks@…` custom address on
  `thetabsarasota.org`) are inferred from code and downstream comments, not proven.
- The v1.2 intent logic reads `message.to`, so at least one "check/reimburse/
  payment" local-part address is expected to exist alongside the receipts address.

## 5. Bindings and secret names — VERIFIED (from bundle) / CLAIMED (dashboard values)

The worker references only these `env` keys (grep of the deployed source):

| Kind | Name | Purpose | Notes |
|---|---|---|---|
| Secret | `INTAKE_SECRET` | shared bearer for downstream `/api/intake` | **hard-coded fallback literal present in source** → F-01 |
| Var | `RECEIPTS_URL` | downstream base URL | defaults to `https://receipts.shanepass.workers.dev` |
| Var | `ALLOWED_DOMAINS` | sender domain allow-list | **defaults to accept-ALL** when unset → F-03 |

- **No** D1, KV, R2, queue, Durable Object, or service bindings are declared or
  used by this worker. It holds no storage of its own.
- Whether `INTAKE_SECRET` / `ALLOWED_DOMAINS` are actually set in each account's
  dashboard is **not readable** via available tools (CLAIMED-NOT-VERIFIED). Even
  if set, F-01 stands because the fallback secret is baked into source.

## 6. D1 / KV / R2 / queues / APIs / storage used — VERIFIED (via downstream)

This worker performs **one** outbound action: `POST {RECEIPTS_URL}/api/intake`
with header `x-intake-secret`. All storage happens **downstream** in the
`receipts` worker (personal account, verified from its deployed bundle):

- **R2 bucket** `receipts-files` (binding `BUCKET`) — object key
  `pending/<uuid>.<ext>` (`ext ∈ {pdf,png,jpg,html}`). Key is a server-generated
  `crypto.randomUUID()`; **not** attacker-influenced → object-key manipulation
  is NOT possible (probe cleared).
- **D1 database** `receipts` (uuid `4a61e8a6-8d2a-40b1-8581-2820742b56db`, binding
  `DB`) — table `pending_email_receipts` (routing/status), promoted into
  `receipts` and `check_requests`.
- **External API:** Anthropic Messages API (downstream only, for parsing; this
  worker does not call it).
- **Queues:** none anywhere in this path.

## 7. Authentication & sender-verification model — VERIFIED

- **Inbound (email):** sender identity = the `From:` header, parsed by
  `extractSenderEmail`. **No SPF / DKIM / DMARC / ARC check.** `senderAllowed`
  is a domain-suffix allow-list that **defaults to open**. → F-02, F-03.
- **Outbound (to downstream):** static shared secret in `x-intake-secret`, with a
  hard-coded fallback. `/api/intake` requires no user PIN. → F-01.

## 8. Receipt ownership & account-routing logic — VERIFIED

- The worker sends `from_addr` (the parsed, forgeable `From`) downstream.
- Downstream `handleEmailIntake` resolves the owner: exactly one active user
  whose primary `users.email` OR `user_emails.email` equals `from_addr` →
  `status='pending'`, `user_id=<that user>`; 0 or >1 matches → `status='unassigned'`.
- **Consequence:** whoever controls the `From` header selects the destination
  user. Downstream READ paths (`/api/pending/:id/image|promote|discard`) DO
  enforce `owns || (unassigned && admin)`, so cross-user *read* is gated — the
  exposure is on the *injection/routing* side. → F-02.

## 9. Downstream workers / services — VERIFIED

- `receipts` (personal account, script `4a8251fcb83642a5b541058502e0bed3`,
  `receipts.shanepass.workers.dev`) — the ledger app; sole consumer of this
  worker's output. Confirmed from its deployed bundle (v3.7.x; `/api/intake`
  handler at line ~2185).

## 10. Current staging / production status — CLAIMED-NOT-VERIFIED

- Both scripts are deployed (present in `workers_list`). No `staging`/`production`
  environment tags are exposed by the tools. "Production" = whichever account's
  Email Routing points a live address at its worker (unproven — §4).

## 11. Rollback source — VERIFIED (now preserved)

- Before this audit there was **no** rollback source in version control (F-12).
- The preserved redacted bundles in [`deployed/`](deployed/) now serve as the
  reference. A true redeploy still requires re-inserting the real `INTAKE_SECRET`
  as a dashboard secret (never in source) — see [`ROLLBACK_PLAN.md`](ROLLBACK_PLAN.md).

## 12. Proof source & date

- Cloudflare API (`workers_list`, `workers_get_worker`, `workers_get_worker_code`,
  `r2_buckets_list`, `d1_databases_list`) — 2026-07-24.
- Offline reproduction: `node --test` over extracted deployed logic — 2026-07-24,
  results in [`test/OUTPUT.txt`](test/OUTPUT.txt) (12/12 pass).

## 13. VERIFIED vs CLAIMED-NOT-VERIFIED summary

| Item | Status |
|---|---|
| Both deployments exist; script ids; versions; code | **VERIFIED** |
| Bindings/secret **names** used by the worker | **VERIFIED** (from source) |
| Downstream storage (R2 `receipts-files`, D1 `receipts`) | **VERIFIED** |
| No D1/KV/R2/queue binding on the intake worker | **VERIFIED** |
| Live `/health` output & live dashboard var/secret values | CLAIMED-NOT-VERIFIED (proxy blocks egress; tools can't read vars) |
| Email Routing address(es) & which account is "prod" | CLAIMED-NOT-VERIFIED (no Email Routing API) |
| Live-bundle byte checksum (with real secret) | CLAIMED-NOT-VERIFIED (secret intentionally not written to disk) |
