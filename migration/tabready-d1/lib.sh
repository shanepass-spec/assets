#!/usr/bin/env bash
# Shared helpers for the TabReady D1 migration runner.
#
# Credentials are read from the environment and are NEVER echoed, logged or
# written to any artifact this kit produces:
#   CF_SRC_TOKEN  personal account, D1 Read   (source)
#   CF_DST_TOKEN  church  account, D1 Edit    (destination)

SRC_ACCT="26c8013cfb2cf72dde19e55e6cf390b1"   # Shanepass@gmail.com
SRC_DB="dcadb25c-d503-45a7-9e29-254c2d5f50e5" # tabready
DST_ACCT="ffd360b239936d51e85d9961fdaeb65a"   # Media@thetabsarasota.org
DST_DB="548cf797-8313-4a3e-827f-408ff1676b73" # tabready-main
ROLLBACK_DB="27f36d41-c5c9-421a-8173-d6d23e940c37" # church tabready, June partial - READ ONLY

API="https://api.cloudflare.com/client/v4"
MAX_SQL_BYTES=90000   # conservative per-request SQL budget
PAGE_ROWS=300         # rows read per source page

die() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

# _q <token> <account> <database> <sql>  -> raw JSON on stdout
_q() {
  local tok="$1" acct="$2" db="$3" sql="$4" body resp
  body=$(jq -nc --arg s "$sql" '{sql:$s}')
  resp=$(printf '%s' "$body" | curl -sS -X POST \
    "$API/accounts/$acct/d1/database/$db/query" \
    -H "Authorization: Bearer $tok" \
    -H "Content-Type: application/json" \
    --data-binary @-) || die "transport error talking to $db"
  if [ "$(printf '%s' "$resp" | jq -r '.success')" != "true" ]; then
    # Error text may quote the offending SQL; print only Cloudflare's message.
    printf '%s' "$resp" | jq -r '.errors[]? | "  cf_error \(.code): \(.message)"' >&2
    die "query rejected by $db"
  fi
  printf '%s' "$resp"
}

src_q() { _q "$CF_SRC_TOKEN" "$SRC_ACCT" "$SRC_DB" "$1"; }
dst_q() { _q "$CF_DST_TOKEN" "$DST_ACCT" "$DST_DB" "$1"; }
rbk_q() { _q "$CF_DST_TOKEN" "$DST_ACCT" "$ROLLBACK_DB" "$1"; }

# Flatten every statement's rows into one JSON array.
rows()  { jq -c '[.result[].results[]]'; }
# First column of the first row of the last statement, as text.
one()   { jq -r '.result[-1].results[0] | to_entries[0].value // empty'; }

require_tokens() {
  [ -n "${CF_SRC_TOKEN:-}" ] || die "CF_SRC_TOKEN is not set (personal account, D1 Read)"
  [ -n "${CF_DST_TOKEN:-}" ] || die "CF_DST_TOKEN is not set (church account, D1 Edit)"
}

# Column list for a table, as a JSON array of names.
cols_json() { # <side_fn> <table>
  "$1" "SELECT name FROM pragma_table_info('$2') ORDER BY cid" | rows | jq -c '[.[].name]'
}

# Order-independent per-table fingerprint SQL.
# rt is the row rendered through quote(), so NULLs, blobs and embedded quotes
# all round-trip. Catches missing, extra, reordered-value and truncated rows.
# It does NOT catch a permutation that preserves length and those three chars -
# stated plainly rather than sold as a cryptographic checksum.
fingerprint_sql() { # <table> <cols_json>
  local t="$1" cj="$2" expr
  expr=$(printf '%s' "$cj" | jq -r 'map("quote(\"" + . + "\")") | join(" || char(31) || ")')
  cat <<SQL
SELECT COUNT(*) AS n,
       COALESCE(SUM(LENGTH(rt)),0) AS len,
       COALESCE(SUM(UNICODE(rt)),0) AS h1,
       COALESCE(SUM(UNICODE(SUBSTR(rt,(LENGTH(rt)+1)/2,1))),0) AS h2,
       COALESCE(SUM(UNICODE(SUBSTR(rt,LENGTH(rt),1))),0) AS h3
FROM (SELECT $expr AS rt FROM "$t")
SQL
}
