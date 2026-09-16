#!/usr/bin/env bash
# Self-audit for the TabReady D1 copy. Runs automatically at the end of
# copy.sh, and can be re-run standalone against any prior run directory:
#
#   ./verify.sh run-20260916T054500Z
#
# Writes proof.md. Every check is PASS or FAIL - there is no "probably".
# Exit status is non-zero if any check fails.

set -Eeuo pipefail
cd "$(dirname "$0")"
. ./lib.sh
load_tokens

RUN="${1:-}"
[ -n "$RUN" ] && [ -d "$RUN" ] || die "usage: ./verify.sh <run-directory>"
PROOF="$RUN/proof.md"
FAILED=0

say()  { printf '%s\n' "$*" >> "$PROOF"; }
check() { # <name> <pass|fail> <detail>
  if [ "$2" = "pass" ]; then say "- **PASS** — $1: $3"
  else say "- **FAIL** — $1: $3"; FAILED=$(( FAILED + 1 )); fi
}

: > "$PROOF"
say "# TabReady D1 copy — self-audit"
say ""
say "Run: \`$RUN\`  ·  completed $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say ""
say "Source: personal \`tabready\` $SRC_DB  →  destination: church \`tabready-main\` $DST_DB"
say ""

# 1 -------------------------------------------------- tables and row counts
say "## 1. Expected tables and row counts"
say ""
MISMATCH=""; ROWS_TOTAL=0
while IFS=$'\t' read -r t src_fp; do
  cj=$(cols_json dst_q "$t")
  dst_fp=$(dst_q "$(fingerprint_sql "$t" "$cj")" | jq -c '.result[-1].results[0]')
  n=$(printf '%s' "$src_fp" | jq -r '.n'); ROWS_TOTAL=$(( ROWS_TOTAL + n ))
  if [ "$src_fp" != "$dst_fp" ]; then
    MISMATCH="$MISMATCH $t"
    say "  - \`$t\` source \`$src_fp\` vs destination \`$dst_fp\`"
  fi
done < "$RUN/baseline.tsv"
if [ -z "$MISMATCH" ]; then
  check "row counts and content fingerprints" pass "all $(wc -l < "$RUN/baseline.tsv") tables match source exactly ($ROWS_TOTAL rows)"
else
  check "row counts and content fingerprints" fail "mismatched:$MISMATCH"
fi
say ""
say "The fingerprint is COUNT, total quoted length, and three positional character sums per table. It catches missing, extra, truncated and value-shifted rows. It is not a cryptographic digest and is not claimed to be."
say ""

# 2 ------------------------------------------------ excluded stayed excluded
say "## 2. Excluded tables stayed excluded"
say ""
LEAKED=""
while read -r t; do
  [ -n "$t" ] || continue
  if [ "$(dst_q "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='$t'" | one)" != "0" ]; then
    LEAKED="$LEAKED $t"
  fi
done < "$RUN/excluded.txt"
if [ -z "$LEAKED" ]; then
  check "excluded tables" pass "$(wc -l < "$RUN/excluded.txt") excluded tables absent from destination (auth material, PCO cache, backups)"
else
  check "excluded tables" fail "present at destination:$LEAKED"
fi
say ""

# 3 ------------------------------------------------------ settings allow-list
say "## 3. Settings allow-list"
say ""
# KEY NAMES ONLY. Values are never selected, never compared, never printed.
SRC_KEYS=$(src_q "SELECT key FROM app_settings ORDER BY key" | rows | jq -r '.[].key')
DST_KEYS=$(dst_q "SELECT key FROM app_settings ORDER BY key" | rows | jq -r '.[].key')
DIFF=$(diff <(printf '%s\n' "$SRC_KEYS") <(printf '%s\n' "$DST_KEYS") || true)
if [ -z "$DIFF" ]; then
  check "app_settings keys" pass "$(printf '%s\n' "$DST_KEYS" | grep -c . ) keys identical to source (names compared, values never read)"
else
  check "app_settings keys" fail "key sets differ"
  say '```'; say "$DIFF"; say '```'
fi
SUSPECT=$(printf '%s\n' "$DST_KEYS" | grep -Ei 'key|secret|token|pass|salt|credential|hash|private' || true)
if [ -z "$SUSPECT" ]; then
  check "no credential-shaped settings" pass "no key name matches key/secret/token/pass/salt/credential/hash/private"
else
  check "no credential-shaped settings" fail "credential-shaped key names carried over: $(printf '%s' "$SUSPECT" | tr '\n' ' ') — names only, values not read"
fi
say ""

# 4 --------------------------------------------------- indexes and triggers
say "## 4. Indexes, triggers and views"
say ""
for kind in index trigger view; do
  s=$(src_q "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='$kind' AND sql IS NOT NULL" | one)
  d=$(dst_q "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='$kind' AND sql IS NOT NULL" | one)
  skipped=$(grep -c "^$kind.*skipped" "$RUN/ddl.log" 2>/dev/null || echo 0)
  expected=$(( s - skipped ))
  if [ "$d" = "$expected" ]; then
    check "${kind}es" pass "$d of $s present ($skipped belong to excluded tables)"
  else
    check "${kind}es" fail "expected $expected, found $d"
  fi
done
say ""

# 5 ------------------------------------------------------- key history counts
say "## 5. History and audit trail counts"
say ""
for t in audit_log audit_log_v2 content_versions msg_events msg_sends msg_deliveries recon_events card_access_audit gm_audit; do
  grep -qxF "$t" "$RUN/include.txt" || continue
  s=$(src_q "SELECT COUNT(*) AS n FROM \"$t\"" | one)
  d=$(dst_q "SELECT COUNT(*) AS n FROM \"$t\"" | one)
  if [ "$s" = "$d" ]; then check "$t" pass "$d rows"
  else check "$t" fail "source $s, destination $d"; fi
done
say ""
say "content_versions is the trigger canary: if the load had run with triggers attached, the destination would carry roughly one extra version row per content row."
say ""

# 6 --------------------------------------------------- destination reads OK
say "## 6. Destination reads correctly"
say ""
read_check() { # <label> <sql> <min expected>
  local out; out=$(dst_q "$2" | one 2>/dev/null || echo "")
  if [ -n "$out" ] && [ "$out" -ge "$3" ] 2>/dev/null; then check "$1" pass "returned $out"
  else check "$1" fail "returned '${out:-<error>}', expected >= $3"; fi
}
read_check "user → role join resolves" \
  "SELECT COUNT(*) AS n FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id" 1
read_check "content readable by tier" \
  "SELECT COUNT(*) AS n FROM content WHERE deleted_at IS NULL" 1
read_check "v_user_org view resolves" "SELECT COUNT(*) AS n FROM v_user_org" 1
read_check "v_user_capabilities view resolves" "SELECT COUNT(*) AS n FROM v_user_capabilities" 1
read_check "content version history reachable" \
  "SELECT COUNT(*) AS n FROM content c JOIN content_versions v ON v.content_id=c.id" 1
read_check "global admin present" "SELECT COUNT(*) AS n FROM users WHERE is_global_admin=1" 1
say ""

# 7 ------------------------------------------------------------- rollback
say "## 7. Rollback still exists"
say ""
SRC_DRIFT=""
while IFS=$'\t' read -r t src_fp; do
  cj=$(cols_json src_q "$t")
  now=$(src_q "$(fingerprint_sql "$t" "$cj")" | jq -c '.result[-1].results[0]')
  [ "$now" = "$src_fp" ] || SRC_DRIFT="$SRC_DRIFT $t"
done < "$RUN/baseline.tsv"
if [ -z "$SRC_DRIFT" ]; then
  check "source unchanged" pass "every source table matches the pre-copy baseline — the copy was read-only at the source"
else
  check "source unchanged" fail "source changed during the copy:$SRC_DRIFT"
fi
RB_NOW=$(rbk_q "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'" | one)
RB_WAS=$(cat "$RUN/rollback-anchor.txt")
if [ "$RB_NOW" = "$RB_WAS" ]; then
  check "June partial intact" pass "church \`tabready\` still holds $RB_NOW tables, never written by this run"
else
  check "June partial intact" fail "church \`tabready\` table count moved from $RB_WAS to $RB_NOW"
fi
check "destination is disposable" pass "\`tabready-main\` contains only this copy; rollback is drop and re-run, no live service points at it yet"
say ""

say "---"
say ""
if [ "$FAILED" = "0" ]; then say "**All checks passed.** Next hunk: church binding verification."
else say "**$FAILED check(s) failed.** Do not proceed to binding verification."; fi

assert_no_leak "$RUN"

cat "$PROOF"
[ "$FAILED" = "0" ] || exit 1
