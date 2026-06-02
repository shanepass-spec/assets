# Receipt Worker v2.8.5 — Carry-Forward Patch

Seven targeted replacements. Apply in order. No other lines change.

---

## Change 1 — VERSION

**Find:**
```js
const VERSION = '2.8.4';
```
**Replace with:**
```js
const VERSION = '2.8.5';
```

---

## Change 2 — autoMatch (primary bug fix)

**Find (entire function):**
```js
async function autoMatch(env, stmtId, userId, month) {
  const { results: lines } = await env.DB.prepare(
    'SELECT id,transaction_date,vendor_clean,amount FROM statement_lines WHERE statement_id=? AND is_credit=0'
  ).bind(stmtId).all();

  const { results: receipts } = await env.DB.prepare(`
    SELECT id,receipt_date,vendor_name,amount FROM receipts
    WHERE user_id=? AND status='captured' AND strftime('%Y-%m',captured_at)=?
  `).bind(userId,month).all();
```

**Replace with:**
```js
async function autoMatch(env, stmtId, userId, month) {
  const { results: lines } = await env.DB.prepare(
    'SELECT id,transaction_date,vendor_clean,amount FROM statement_lines WHERE statement_id=? AND is_credit=0'
  ).bind(stmtId).all();

  // month param kept for signature compat but no longer used as a filter —
  // any unreconciled receipt (captured or carry_forward) is eligible to match
  // any statement, including receipts from prior months that posted late.
  const { results: receipts } = await env.DB.prepare(`
    SELECT id,receipt_date,vendor_name,amount FROM receipts
    WHERE user_id=? AND status IN ('captured','carry_forward')
  `).bind(userId).all();
```

---

## Change 3 — new function carryForwardUnpostedReceiptsToNextCycle

Insert this new function immediately after the closing brace of `autoMatch`:

```js
// Marks any captured receipt from a prior month as carry_forward so it
// surfaces in the Carry Forward Excel tab and PDF packet extras for the
// current statement cycle. Runs after autoMatch so already-matched receipts
// are excluded (they have status='matched' by this point).
async function carryForwardUnpostedReceiptsToNextCycle(env, userId, statementMonth) {
  await env.DB.prepare(`
    UPDATE receipts
    SET status='carry_forward', updated_at=datetime('now')
    WHERE user_id=?
      AND status='captured'
      AND strftime('%Y-%m', captured_at) < ?
  `).bind(userId, statementMonth).run();
}
```

---

## Change 4 — handleStatementUpload: call carry-forward trigger

**Find:**
```js
  const matched = await autoMatch(env, stmtId, user.id, statementMonth);

  return json({ ok: true, statement_id: stmtId, line_count: parsed.transactions.length, auto_matched: matched, purchase_total: parsed.purchase_total });
```

**Replace with:**
```js
  const matched = await autoMatch(env, stmtId, user.id, statementMonth);
  await carryForwardUnpostedReceiptsToNextCycle(env, user.id, statementMonth);

  return json({ ok: true, statement_id: stmtId, line_count: parsed.transactions.length, auto_matched: matched, purchase_total: parsed.purchase_total });
```

---

## Change 5 — /api/export fallback path: include carry_forward from any month

**Find:**
```js
    const { results: capRecs } = await env.DB.prepare(`
      SELECT id,receipt_date,vendor_name,amount,purpose,notes,budget_code,status,card_last_four,captured_at
      FROM receipts WHERE user_id=?1 AND strftime('%Y-%m',captured_at)=?2
      ORDER BY captured_at ASC
    `).bind(user.id, month).all();
```

**Replace with:**
```js
    // Include receipts captured this month plus any carry_forward receipts
    // from prior months that were not matched to an earlier statement.
    const { results: capRecs } = await env.DB.prepare(`
      SELECT id,receipt_date,vendor_name,amount,purpose,notes,budget_code,status,card_last_four,captured_at
      FROM receipts
      WHERE user_id=?1
        AND (strftime('%Y-%m',captured_at)=?2 OR status='carry_forward')
      ORDER BY captured_at ASC
    `).bind(user.id, month).all();
```

---

## Change 6 — /api/export statement path: populate carry_rows

In the statement path, `carryRows` is always empty. After the `if (usingStatement) { for (const sl of stmtRows) { ... } }` block, add the carry_rows query.

**Find:**
```js
    const codeArr = Array.from(codeSet);
    let nameMap = {};
    if (codeArr.length) {
      const { results: names } = await env.DB.prepare(`SELECT code,name FROM budget_codes WHERE code IN (${codeArr.map(()=>'?').join(',')})`).bind(...codeArr).all();
      (names||[]).forEach(n=>{nameMap[n.code]=n.name;});
    }
    rows.forEach(r=>{ r.code_name=nameMap[r.code]||(r.code==='TBD'?'Pending Review':''); r.code_label=r.code_name?(r.code+' — '+r.code_name):r.code; });
    carryRows.forEach(r=>{ r.code_name=nameMap[r.code]||''; r.code_label=r.code_name?(r.code+' — '+r.code_name):r.code; });
```

**Replace with:**
```js
    // In statement path: pull carry_forward receipts not already matched
    // to any statement line. These go to the Carry Forward Excel tab and
    // are excluded from the statement total.
    if (usingStatement) {
      const { results: cfRecs } = await env.DB.prepare(`
        SELECT id,receipt_date,vendor_name,amount,purpose,notes,budget_code
        FROM receipts
        WHERE user_id=? AND status='carry_forward'
        ORDER BY captured_at ASC
      `).bind(user.id).all();
      for (const r of (cfRecs||[])) {
        const code = r.budget_code||'TBD';
        codeSet.add(code);
        carryRows.push({
          post_date: r.receipt_date||'', date: r.receipt_date||'',
          vendor: r.vendor_name||'', amount: Number(r.amount)||0,
          explanation: r.purpose||'', code, code_name: '',
          notes: r.notes||'', status: 'carry_forward',
          has_receipt: true, receipt_id: r.id||null, missing: false,
        });
      }
    }

    const codeArr = Array.from(codeSet);
    let nameMap = {};
    if (codeArr.length) {
      const { results: names } = await env.DB.prepare(`SELECT code,name FROM budget_codes WHERE code IN (${codeArr.map(()=>'?').join(',')})`).bind(...codeArr).all();
      (names||[]).forEach(n=>{nameMap[n.code]=n.name;});
    }
    rows.forEach(r=>{ r.code_name=nameMap[r.code]||(r.code==='TBD'?'Pending Review':''); r.code_label=r.code_name?(r.code+' — '+r.code_name):r.code; });
    carryRows.forEach(r=>{ r.code_name=nameMap[r.code]||''; r.code_label=r.code_name?(r.code+' — '+r.code_name):r.code; });
```

---

## Change 7a — /api/packet-data extras query: remove month filter

**Find:**
```js
      const { results: unmatched } = await env.DB.prepare(`
        SELECT id, receipt_date, vendor_name, amount, purpose, notes, budget_code, image_r2_key, image_purged
        FROM receipts
        WHERE user_id=?1 AND strftime('%Y-%m',captured_at)=?2
          AND id NOT IN (SELECT receipt_id FROM statement_lines WHERE statement_id=?3 AND receipt_id IS NOT NULL)
        ORDER BY captured_at ASC
      `).bind(user.id, month, stmt.id).all();
```

**Replace with:**
```js
      // Include any unmatched receipt for this user regardless of capture month.
      // This is what surfaces May receipts in the June PDF packet.
      const { results: unmatched } = await env.DB.prepare(`
        SELECT id, receipt_date, vendor_name, amount, purpose, notes, budget_code, image_r2_key, image_purged
        FROM receipts
        WHERE user_id=?1
          AND status IN ('captured','carry_forward')
          AND id NOT IN (SELECT receipt_id FROM statement_lines WHERE statement_id=?2 AND receipt_id IS NOT NULL)
        ORDER BY captured_at ASC
      `).bind(user.id, stmt.id).all();
```

---

## Change 7b — /api/packet-data fallback: include carry_forward from any month

**Find:**
```js
      const { results: caps } = await env.DB.prepare(`
        SELECT id, receipt_date, vendor_name, amount, purpose, notes, budget_code, image_r2_key, image_purged, status
        FROM receipts WHERE user_id=?1 AND strftime('%Y-%m',captured_at)=?2
        ORDER BY captured_at ASC
      `).bind(user.id, month).all();
```

**Replace with:**
```js
      const { results: caps } = await env.DB.prepare(`
        SELECT id, receipt_date, vendor_name, amount, purpose, notes, budget_code, image_r2_key, image_purged, status
        FROM receipts
        WHERE user_id=?1
          AND (strftime('%Y-%m',captured_at)=?2 OR status='carry_forward')
        ORDER BY captured_at ASC
      `).bind(user.id, month).all();
```

---

## Acceptance test checklist

- [ ] Upload June statement. Six May receipts auto-match where amount+vendor align.
- [ ] Remaining unmatched May receipts get `status='carry_forward'` (check /api/summary carry_forward count > 0).
- [ ] Download June Excel workbook → Carry Forward tab contains the unmatched May receipts.
- [ ] Download June PDF packet → same receipts appear in the "not on statement" section at the end.
- [ ] Excel statement total does NOT include carry-forward amounts.
- [ ] May-matched receipts (status='matched') do NOT appear in carry_forward tab.
- [ ] Re-uploading the same June statement resets and re-runs: no receipt duplication.
- [ ] A receipt with receipt_date in May but matched to a June statement line → appears as matched on June ledger, not in carry_forward.
- [ ] /api/summary carry_forward count matches Carry Forward tab row count.
- [ ] PDF and Excel carry-forward receipt counts match each other.
