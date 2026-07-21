# TabReady v2.9.290 — Deployment Gate (rebased onto live 6aae0ec2)

## Before staging

- [ ] Re-fetch live Worker.
- [ ] Live hash equals `6aae0ec256efd5cf1c8db6eb093f7d62b859b1b4493643c9260a3bde2c60211b`.
- [ ] Candidate hash equals `2aeaed0af0eb3d2c7b22cb585859b89c3b5f13504a22d2529958bc290f88e2be`.
- [ ] Phase-B rows #88/#86/#82 reconciled into one current-state record.
- [ ] #86 duplicate status resolved.
- [ ] Source and destination inventory includes `CONTENT_DB → tab-website-content`.
- [ ] All 13 existing source names are mapped.
- [ ] Media has a new `SESSION_SECRET`.
- [ ] Main Worker and bridge share only `SESSION_TRANSFER_SECRET`.
- [ ] Bridge has the old secret only as `LEGACY_SESSION_SECRET`.
- [ ] No secret values appear in Relay, logs, docs, commands, or screenshots.

## Stage main Worker

- [ ] Apply/verify schema against a staging copy.
- [ ] `/health` reports exact candidate version `2.9.290`.
- [ ] `/health` reports baseline SHA `78d7f66c…c498`.
- [ ] Existing login by code works.
- [ ] Existing magic links work.
- [ ] Alternate-email code login works.
- [ ] `/api/vcard` endpoint and Medical Team Email/Save/vCard controls preserved (no regression vs live 6aae0ec2).
- [ ] Admin Add Person QR is actually seven days.
- [ ] New QR/link uses the intended canonical staging/church host.
- [ ] Unknown recovery email and known recovery email receive indistinguishable requester responses.
- [ ] Sixth code request in a 15-minute email window does not send another code.
- [ ] Ministry leader sees only in-scope recovery requests and people.
- [ ] Cross-ministry direct API restore returns 403.
- [ ] Restore credential creates no user and changes no roles.
- [ ] Restore token is single-use under concurrent requests.
- [ ] Restore with revocation invalidates the prior session.
- [ ] Restore without revocation leaves other sessions valid.

## Stage bridge

- [ ] Bridge has no D1/R2 application binding.
- [ ] Anonymous deep link preserves path and query.
- [ ] Valid old cookie transfers through POST body.
- [ ] No transfer token appears in URL/history.
- [ ] Wrong audience rejected.
- [ ] Expired transfer rejected.
- [ ] Replayed transfer rejected.
- [ ] Epoch mismatch rejected.
- [ ] Old authentication POST receives 307 to the church host.
- [ ] Any non-auth mutation receives 409 and never reaches a database.

## Migration integrity

- [ ] Source/Media row counts match for every table.
- [ ] Content checksums match.
- [ ] Internal `usr_…` IDs are byte-identical.
- [ ] Per-user roles match.
- [ ] `CONTENT_DB`, `DB`, `PHOTOS`, and `DOCS` targets verified.
- [ ] R2 keys preserved.
- [ ] Cron recreated and observed running.
- [ ] Resend, PCO, VAPID, Anthropic, provision, and schedule intake tested.

## Real-device gate

- [ ] Existing iPhone PWA/shortcut opens old host, transfers, and lands logged in.
- [ ] Existing Android PWA/shortcut does the same.
- [ ] Cleared-data device reaches normal login/Restore Access without a loop.
- [ ] Lost-phone restore works and revokes the old session when selected.
- [ ] New home-screen install uses the church host.

## Cutover shape

1. Freeze source writes.
2. Final backup/export/import.
3. Reconcile all data.
4. Activate Media production Worker.
5. Replace personal Worker with the lean bridge—no full-worker dual run.
6. Verify old Worker has no production mutation or D1 write binding.
7. Unfreeze Media.
8. Complete real-device tests before declaring done.
