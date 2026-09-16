#!/usr/bin/env bash
# TabReady D1 bulk copy: personal tabready -> church tabready-main.
#
# Move, then audit itself. Data never passes through a conversation: rows are
# rendered into INSERT statements by the SOURCE database and POSTed straight to
# the DESTINATION.
#
#   ./copy.sh            load, install DDL, verify
#   ./copy.sh --reset    empty the destination tables first
#   ./copy.sh --dry-run  preflight and baseline only, no writes
#
# Aborts on the first failure. The destination is a fresh database whose only
# content is this copy, so the rollback is always: drop and re-run.

set -Eeuo pipefail
cd "$(dirname "$0")"
. ./lib.sh

RESET=0; DRY=0
for a in "$@"; do
  case "$a" in
    --reset) RESET=1 ;;
    --dry-run) DRY=1 ;;
    *) die "unknown argument: $a" ;;
  esac
done

load_tokens
OUT="./run-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"

# ---------------------------------------------------------------- preflight

log "preflight: reading table sets"
DST_TABLES=$(dst_q "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name" | rows | jq -r '.[].name')
SRC_TABLES=$(src_q "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name" | rows | jq -r '.[].name')
[ -n "$DST_TABLES" ] || die "destination has no tables - run the schema phase first"

# The destination schema IS the include list. Nothing is hardcoded, so the
# exclusion decision cannot drift away from what was actually created.
printf '%s\n' "$DST_TABLES" > "$OUT/include.txt"
comm -23 <(printf '%s\n' "$SRC_TABLES") <(printf '%s\n' "$DST_TABLES") > "$OUT/excluded.txt"
log "preflight: $(wc -l < "$OUT/include.txt") tables to load, $(wc -l < "$OUT/excluded.txt") deliberately excluded"

# Every destination table must exist at the source, or the include list is wrong.
ORPHANS=$(comm -13 <(printf '%s\n' "$SRC_TABLES") <(printf '%s\n' "$DST_TABLES") || true)
[ -z "$ORPHANS" ] || die "destination tables absent from source: $(printf '%s' "$ORPHANS" | tr '\n' ' ')"

# Triggers must NOT be live during a bulk load. trg_content_ins writes a
# content_versions row per inserted content row; loading with triggers attached
# fabricates history that reconciliation by row count alone would not catch.
LIVE_DDL=$(dst_q "SELECT COUNT(*) AS n FROM sqlite_master WHERE type IN ('index','trigger','view') AND sql IS NOT NULL" | one)
[ "$LIVE_DDL" = "0" ] || die "destination already carries $LIVE_DDL index/trigger/view objects - load must run against a bare schema"

# ------------------------------------------------- foreign-key load ordering
# Only 12 FK edges exist across the included set. Rather than trust a static
# list, recompute the edges now and assert the tiers below still satisfy them.
TIER_FIRST="users roles people_registry weekly_updates weekly_packets weekly_priv_steps"
TIER_MID_LAST="weekly_versions"
TIER_LAST="alerts audit_log user_roles role_assignments weekly_correction_requests weekly_review_notes weekly_priv_step_history weekly_packet_items"

tier_of() {
  case " $TIER_FIRST "    in *" $1 "*) echo 0; return;; esac
  case " $TIER_MID_LAST " in *" $1 "*) echo 2; return;; esac
  case " $TIER_LAST "     in *" $1 "*) echo 3; return;; esac
  echo 1
}

log "preflight: re-deriving foreign-key edges from the live destination schema"
dst_q "SELECT m.name AS child, f.\"table\" AS parent FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' GROUP BY child, parent" \
  | rows | jq -r '.[] | "\(.child) \(.parent)"' > "$OUT/fk-edges.txt"
while read -r child parent; do
  [ -n "$child" ] || continue
  cp=$(tier_of "$child"); pp=$(tier_of "$parent")
  [ "$pp" -lt "$cp" ] || die "load order does not satisfy FK $child -> $parent (tier $cp vs $pp); update the tiers in copy.sh"
done < "$OUT/fk-edges.txt"
log "preflight: $(wc -l < "$OUT/fk-edges.txt") FK edges, all satisfied by the tier order"

# ----------------------------------------------------- rollback anchor + baseline

log "baseline: recording source counts (this is also the rollback proof anchor)"
: > "$OUT/baseline.tsv"
while read -r t; do
  is_schema_only "$t" && continue
  cj=$(cols_json src_q "$t")
  fp=$(src_q "$(fingerprint_sql "$t" "$cj")" | jq -c '.result[-1].results[0]')
  printf '%s\t%s\n' "$t" "$fp" >> "$OUT/baseline.tsv"
done < "$OUT/include.txt"

rbk_q "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'" | one > "$OUT/rollback-anchor.txt"
log "baseline: June partial (church tabready) holds $(cat "$OUT/rollback-anchor.txt") tables - untouched, read only"

if [ "$DRY" = "1" ]; then log "dry run complete - no writes performed; artifacts in $OUT"; exit 0; fi

# ------------------------------------------------------------------- reset

if [ "$RESET" = "1" ]; then
  log "reset: emptying destination tables (children first)"
  for tier in 3 2 1 0; do
    while read -r t; do
      [ "$(tier_of "$t")" = "$tier" ] || continue
      dst_q "DELETE FROM \"$t\"" >/dev/null
    done < "$OUT/include.txt"
  done
fi

NONEMPTY=""
while read -r t; do
  n=$(dst_q "SELECT COUNT(*) AS n FROM \"$t\"" | one)
  [ "$n" = "0" ] || NONEMPTY="$NONEMPTY $t($n)"
done < "$OUT/include.txt"
[ -z "$NONEMPTY" ] || die "destination not empty:$NONEMPTY - re-run with --reset"

# -------------------------------------------------------------------- load

flush() { # <sql buffer file>
  [ -s "$1" ] || return 0
  dst_q "$(cat "$1")" >/dev/null
  : > "$1"
}

BUF="$OUT/.buf.sql"; : > "$BUF"
TOTAL=0
for tier in 0 1 2 3; do
  while read -r t; do
    [ "$(tier_of "$t")" = "$tier" ] || continue
    is_schema_only "$t" && continue
    cj=$(cols_json src_q "$t")
    collist=$(printf '%s' "$cj" | jq -r 'map("\"" + . + "\"") | join(",")')
    vals=$(printf '%s' "$cj" | jq -r 'map("quote(\"" + . + "\")") | join(" || \",\" || ")')
    order="rowid"
    if ! src_q "SELECT rowid FROM \"$t\" LIMIT 1" >/dev/null 2>&1; then order="1"; fi

    off=0; n_t=0
    while :; do
      page=$(src_q "SELECT 'INSERT INTO \"$t\" ($collist) VALUES (' || $vals || ');' AS s FROM \"$t\" ORDER BY $order LIMIT $PAGE_ROWS OFFSET $off" | rows)
      cnt=$(printf '%s' "$page" | jq 'length')
      [ "$cnt" -gt 0 ] || break
      while IFS= read -r stmt; do
        if [ $(( $(wc -c < "$BUF") + ${#stmt} )) -gt "$MAX_SQL_BYTES" ]; then flush "$BUF"; fi
        printf '%s\n' "$stmt" >> "$BUF"
      done < <(printf '%s' "$page" | jq -r '.[].s')
      off=$(( off + cnt )); n_t=$(( n_t + cnt ))
      [ "$cnt" -eq "$PAGE_ROWS" ] || break
    done
    flush "$BUF"
    TOTAL=$(( TOTAL + n_t ))
    [ "$n_t" -eq 0 ] || log "loaded $t: $n_t rows"
  done < "$OUT/include.txt"
done
rm -f "$BUF"
log "load complete: $TOTAL rows across $(wc -l < "$OUT/include.txt") tables"

# ------------------------------------------------------- post-load DDL

log "post-load: indexes, then views, then triggers"
apply_ddl() { # <type>
  src_q "SELECT type, tbl_name, replace(replace(sql,char(10),' '),char(13),' ') AS sql FROM sqlite_master WHERE type='$1' AND sql IS NOT NULL" \
    | rows | jq -c '.[]' | while IFS= read -r row; do
      tbl=$(printf '%s' "$row" | jq -r '.tbl_name')
      ddl=$(printf '%s' "$row" | jq -r '.sql')
      if [ "$1" != "view" ] && ! grep -qxF "$tbl" "$OUT/include.txt"; then
        printf '%s\t%s\tskipped (table excluded)\n' "$1" "$tbl" >> "$OUT/ddl.log"; continue
      fi
      dst_q "$ddl" >/dev/null
      printf '%s\t%s\tcreated\n' "$1" "$tbl" >> "$OUT/ddl.log"
    done
}
apply_ddl index; apply_ddl view; apply_ddl trigger
log "post-load: $(grep -c created "$OUT/ddl.log") objects created, $(grep -c skipped "$OUT/ddl.log") skipped as excluded"

# ----------------------------------------------------------------- verify

assert_no_leak "$OUT"
log "handing off to verify.sh"
OUT="$OUT" ./verify.sh "$OUT"
