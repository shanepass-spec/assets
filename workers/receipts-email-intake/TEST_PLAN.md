# TEST_PLAN.md — receipts-email-intake

## How to run (offline, no network, no live resources)
```
node --test workers/receipts-email-intake/test/intake.test.mjs
```
Node ≥ 18 (validated on v22.22.2). Uses only built-in globals (`atob`,
`TextDecoder`, `Buffer`). No Cloudflare, no live email, no secrets.
Latest captured run: [`test/OUTPUT.txt`](test/OUTPUT.txt) — **12 pass / 0 fail**.

The suite exercises the **verbatim** deployed parsing/decision functions
(extracted into [`test/harness.mjs`](test/harness.mjs) from the v1.2 bundle; the
v1.0 body-capture path is copied faithfully for F-09). A passing test reproduces
the behavior described in [`AUDIT_FINDINGS.md`](AUDIT_FINDINGS.md).

## Coverage matrix (hostile paths from the mission brief)

| Mission probe | Finding | Test | Result |
|---|---|---|---|
| Forged `From` headers | F-02 | `[F-02]` | reproduced |
| Forwarded emails / memo extraction | F-02/F-04 | `[F-02]`,`[F-04]` | reproduced |
| Multiple recipients / destination local-part | F-04 | `[F-04]` | reproduced |
| Missing/conflicting account identifiers | F-02/F-03 | `[F-02]`,`[F-03]` | reproduced (open default) |
| Same receipt sent twice / same message retried | F-08 | `[F-08]` | reproduced |
| Same attachment under a new message id | F-08 | `[F-08]` | reproduced (no content hash) |
| Unsupported / active file types (svg) | F-05 | `[F-05]` | reproduced |
| MIME/content mismatch | F-06 | `[F-06]` | reproduced |
| octet-stream extension trick | F-07 | `[F-07]` | reproduced |
| Oversized files | F-15 | (bound reviewed; see note) | logic-verified |
| Empty/corrupt / tiny attachments | F-10 | `[F-10]` | reproduced |
| Path / object-key manipulation | (clean) | n/a | key is server UUID (documented) |
| Cross-account routing attempt | F-02 | `[F-02]` | routing identity forgeable |
| Raw HTML body passthrough (church) | F-09 | `[F-09]` | reproduced |
| Sender allow-list bypass / default-open | F-03 | `[F-03]` | reproduced |
| Silent drop on downstream failure | F-13 | static (fetch result unused) | source-verified |

Probes intentionally NOT turned into failing tests because they came back clean
(see AUDIT_FINDINGS "Probes that came back CLEAN"): object-key manipulation,
cross-user read, PII logging in the intake worker, unauthorized delete/overwrite.

## Tests to ADD once corrections are designed/approved (not yet implemented)
- **F-01:** assert the bundled source contains no `rcpt_` literal; `postIntake`
  fails closed when `INTAKE_SECRET` is falsy.
- **F-02/F-03:** with no passing SPF/DKIM verdict ⇒ owner forced `unassigned`;
  unset `ALLOWED_DOMAINS` ⇒ deny/hold.
- **F-05/F-06/F-07:** allow-set enforced; content sniff drops type/content
  mismatch and svg.
- **F-08:** dedupe key present; downstream `ON CONFLICT DO NOTHING` prevents a
  second row (downstream integration test).
- **F-13:** non-2xx downstream response triggers retry/dead-letter, not a silent
  return.

## Live tests deferred (HUMAN-GATED / require authorized environment)
The following need a sanctioned staging address and are **out of scope** for this
read-only audit (STOP conditions: live email route / production change):
end-to-end delivery through Email Routing, real `/health` fetch (proxy blocked),
real SPF/DKIM verdicts, downstream R2/D1 write assertions.
