# Post-cutover verification

Proves the church runtime no longer depends on the personal account.

Every check below is written so it can be run identically by any session: the
exact query or probe, the pass condition, and — where a machine genuinely
cannot settle it — an explicit note that a human has to look. Nothing here is
"spot check the app."

Two of these must be captured **before** cutover. They are listed first for
that reason.

---

## 0. BEFORE CUTOVER — capture the quiet-database baseline

The strongest available proof that the church app is bound to church resources
is negative: **after cutover the personal database must stop growing.** That
only works if the growth counters are captured first.

Run against personal `tabready` `dcadb25c-d503-45a7-9e29-254c2d5f50e5` and keep
the output:

```sql
SELECT 'audit_log' t, COUNT(*) n, COALESCE(MAX(rowid),0) hi FROM audit_log
UNION ALL SELECT 'audit_log_v2', COUNT(*), COALESCE(MAX(rowid),0) FROM audit_log_v2
UNION ALL SELECT 'msg_events',   COUNT(*), COALESCE(MAX(rowid),0) FROM msg_events
UNION ALL SELECT 'msg_deliveries',COUNT(*),COALESCE(MAX(rowid),0) FROM msg_deliveries
UNION ALL SELECT 'alerts',       COUNT(*), COALESCE(MAX(rowid),0) FROM alerts
UNION ALL SELECT 'incident_reports',COUNT(*),COALESCE(MAX(rowid),0) FROM incident_reports
UNION ALL SELECT 'content_versions',COUNT(*),COALESCE(MAX(rowid),0) FROM content_versions
UNION ALL SELECT 'login_codes',   COUNT(*), COALESCE(MAX(rowid),0) FROM login_codes
UNION ALL SELECT 'magic_links',   COUNT(*), 0 FROM magic_links;
```

## 0b. BEFORE CUTOVER — record the accepted cross-account call list

`../tabready-d1/binding-inventory.md` holds the current inventory. Check 2 below
diffs against it, so it has to be current at cutover time, not at the time it
was first written.

---

## 1. Church bindings point at church resources

**1a — the personal database goes quiet.** After the church app has taken real
traffic (a service day, or a deliberate round of logins, alerts and content
edits), re-run the query from step 0 against the personal database.

- **PASS**: every counter is unchanged from the baseline.
- **FAIL**: any counter moved. Something is still writing to the personal
  database, which means a binding still points at it.

**1b — the church database is the one moving.** Run the same query against
church `tabready-main` `548cf797-8313-4a3e-827f-408ff1676b73` before and after
the same window.

- **PASS**: counters moved here.
- **FAIL**: nothing moved anywhere — the app took no traffic, so 1a proved
  nothing. Re-run the window; do not record 1a as a pass on an idle system.

Together these are the real proof. 1a alone passes trivially on an idle system,
which is exactly how a binding check gets recorded as green while being
meaningless.

**1c — binding configuration, human eye.** Available tooling returns a worker's
name and id but not which database or bucket a binding resolves to. Confirming
the configuration directly needs the control plane or the dashboard. **A human
reads this one.** 1a+1b are the behavioural substitute and are stronger than a
config screenshot, because they prove what the running code actually did.

## 2. No runtime calls back to the personal account

Re-run the extraction that produced `binding-inventory.md`, against the
**church-deployed** worker code, and diff against the accepted list.

- **PASS**: every `shanepass.workers.dev` reference is one already recorded and
  accepted as cleanup debt, and no new one has appeared.
- **FAIL**: any unrecorded reference.

Known and accepted at the time of writing: `safety-intake` → `tabready.shanepass.workers.dev`
(hardcoded — after cutover it keeps writing into the OLD personal TabReady while
appearing to work), `toolbox` ×3, `susanofficehelper` → receipts,
`tab-email-ingest` → `tab-sermons`, `tab-workorders` self-links in email bodies.

`tabready`'s `CUR_BASE` → `tab-curriculum.media-ffd.workers.dev` already points
at church and becomes same-account after the move.

**Not a passive check.** `safety-intake` writing into the old database is a
data-loss path, not a cosmetic leftover. It is accepted debt only for as long as
someone is tracking it.

## 3. Login and auth

**Machine pre-checks**, all against church `tabready-main`:

```sql
SELECT (SELECT COUNT(*) FROM magic_links)          AS magic_links_rows,      -- expect 0
       (SELECT COUNT(*) FROM login_codes)          AS login_codes_rows,      -- expect 0
       (SELECT COUNT(*) FROM transfer_jti)         AS transfer_jti_rows,     -- expect 0
       (SELECT COUNT(*) FROM auth_request_limits)  AS rate_limit_rows,       -- expect 0
       (SELECT COUNT(*) FROM users WHERE login_email IS NOT NULL) AS login_emails,
       (SELECT COUNT(*) FROM sqlite_master WHERE type='index'
          AND name='ux_users_login_email')         AS login_email_index;     -- expect 1
```

- **PASS**: the four auth tables exist and are empty, `login_email_index` is 1,
  and `login_emails` matches the source count.
- **FAIL**: a missing table is the defect that would have blocked every login —
  see the schema-vs-data rule. An absent `ux_users_login_email` means duplicate
  login emails become possible.

**Human eye:** one real login, end to end, on the church app. No machine check
substitutes for it, because the failure modes that matter — a magic link that
arrives but does not resolve, a session that does not persist — live in the mail
path and the browser, not in the database.

## 4. Email and integrations

**Machine pre-checks:**

- `SELECT COUNT(*) FROM notify_recipients WHERE active=1` on church
  `tabready-main` matches source.
- Each church worker's `/health` reports its bindings `true`. Bindings drop on
  dashboard paste-deploys, so this is checked after **every** deploy.
- PCO cache tables exist and are empty; they repopulate on the next sync. A
  non-empty PCO cache at the destination means stale cache travelled.

**Human eye:** one real outbound email and one real PCO sync. Email routing and
DNS are owner-gated and are not touched by any check here.

## 5. Rollback still available

```sql
-- personal tabready, compared against the step 0 baseline
-- church tabready (June partial) 27f36d41-c5c9-421a-8173-d6d23e940c37
SELECT COUNT(*) AS tables FROM sqlite_master WHERE type='table';
```

- **PASS**: the personal database still matches its pre-copy baseline — it was
  never written — and the June partial is untouched.
- **FAIL**: either moved. The path back is compromised and cutover should not
  be declared complete.

Rollback for the data itself stays simple for as long as the personal database
is unchanged: the old app and the old database are both still there. That
property is worth protecting deliberately — it ends the moment anything writes
to the personal side after cutover, which is precisely what check 1a detects.

---

## What this package deliberately does not claim

- It does not prove binding **configuration**; it proves binding **behaviour**.
  Where those disagree, behaviour is the thing that matters, but the
  distinction is stated rather than blurred.
- Checks 3 and 4 have human-eye halves that no query replaces. They are marked,
  not quietly dropped.
- A green run on an idle system proves nothing. Check 1b exists specifically to
  make that failure visible instead of letting it read as success.
