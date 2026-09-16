#!/usr/bin/env bash
# Shared helpers for the TabReady D1 migration runner.
#
# CREDENTIAL HANDLING (Relay msg 1758 — token values never enter a conversation)
#
#   Tokens are read from a secure store at runtime. They are never passed as
#   arguments, never written to any artifact, never echoed, and never placed
#   on a command line where the process table would expose them.
#
#   Supply them either way:
#     CF_SRC_TOKEN_FILE / CF_DST_TOKEN_FILE   path to a 0600 file, or a
#                                             systemd credential, or the
#                                             output of a password-manager CLI
#     CF_SRC_TOKEN      / CF_DST_TOKEN        direct environment entry
#
#   File form is preferred: an environment variable is readable from
#   /proc/<pid>/environ by any process running as the same user.

SRC_ACCT="26c8013cfb2cf72dde19e55e6cf390b1"   # Shanepass@gmail.com
SRC_DB="dcadb25c-d503-45a7-9e29-254c2d5f50e5" # tabready
DST_ACCT="ffd360b239936d51e85d9961fdaeb65a"   # Media@thetabsarasota.org
DST_DB="548cf797-8313-4a3e-827f-408ff1676b73" # tabready-main
ROLLBACK_DB="27f36d41-c5c9-421a-8173-d6d23e940c37" # church tabready, June partial - READ ONLY

API="https://api.cloudflare.com/client/v4"
MAX_SQL_BYTES=90000   # conservative per-request SQL budget
PAGE_ROWS=300         # rows read per source page

# Tables that MUST EXIST but MUST STAY EMPTY. The live app reads and writes
# every one of them, so a destination without them throws "no such table" in
# production. Their CONTENTS are a separate question: auth material, JWT replay
# records, rate-limit counters and PCO cache stay behind. Schema travels, rows
# do not.
SCHEMA_ONLY="auth_request_limits incident_shares login_codes magic_links pco_cal_instances pco_cal_sync_runs pco_dates_cache pco_group_cache pco_group_members place_invites push_subscriptions recovery_requests roster_sync_changes roster_sync_runs transfer_jti"
is_schema_only() { case " $SCHEMA_ONLY " in *" $1 "*) return 0;; esac; return 1; }

die() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

# _q <token-var-name> <account> <database> <sql>  -> raw JSON on stdout
#
# The bearer header is written to a 0600 file in a private temp dir and handed
# to curl with -H @file, so the token never appears in argv and never shows up
# in ps output.
_q() {
  local var="$1" acct="$2" db="$3" sql="$4" body resp hdr
  hdr="$SECURE_TMP/$var.hdr"
  [ -s "$hdr" ] || die "no header material for $var (call load_tokens first)"
  body=$(jq -nc --arg s "$sql" '{sql:$s}')
  resp=$(printf '%s' "$body" | curl -sS -X POST \
    "$API/accounts/$acct/d1/database/$db/query" \
    -H "@$hdr" \
    -H "Content-Type: application/json" \
    --data-binary @-) || die "transport error talking to $db"
  if [ "$(printf '%s' "$resp" | jq -r '.success')" != "true" ]; then
    printf '%s' "$resp" | jq -r '.errors[]? | "  cf_error \(.code): \(.message)"' >&2
    die "query rejected by $db"
  fi
  printf '%s' "$resp"
}

src_q() { _q SRC "$SRC_ACCT" "$SRC_DB" "$1"; }
dst_q() { _q DST "$DST_ACCT" "$DST_DB" "$1"; }
rbk_q() { _q DST "$DST_ACCT" "$ROLLBACK_DB" "$1"; }

# Flatten every statement's rows into one JSON array.
rows()  { jq -c '[.result[].results[]]'; }
# First column of the first row of the last statement, as text.
one()   { jq -r '.result[-1].results[0] | to_entries[0].value // empty'; }

# A shell trace would print every expanded variable, including a token.
# Refuse to run under -x rather than leak one into a terminal or a log.
case "$-" in *x*) echo "FAIL: refusing to run with shell tracing enabled" >&2; exit 1;; esac

SECURE_TMP=""
_cleanup_secure() {
  [ -n "$SECURE_TMP" ] && [ -d "$SECURE_TMP" ] && rm -rf "$SECURE_TMP"
  unset CF_SRC_TOKEN CF_DST_TOKEN
}

# _read_secret <VAR>  -> value on stdout, from _FILE first, then the env var.
_read_secret() {
  local name="$1" file_var="CF_${1}_TOKEN_FILE" env_var="CF_${1}_TOKEN" path
  path="${!file_var:-}"
  if [ -n "$path" ]; then
    [ -r "$path" ] || die "$file_var points at $path, which is not readable"
    tr -d '\r\n' < "$path"
  else
    printf '%s' "${!env_var:-}"
  fi
}

load_tokens() {
  SECURE_TMP=$(mktemp -d "${TMPDIR:-/tmp}/tabready-mig.XXXXXX")
  chmod 700 "$SECURE_TMP"
  trap _cleanup_secure EXIT INT TERM
  local side val
  for side in SRC DST; do
    val=$(_read_secret "$side")
    if [ -z "$val" ]; then
      die "no credential for $side — set CF_${side}_TOKEN_FILE (preferred) or CF_${side}_TOKEN"
    fi
    # Cloudflare API tokens are 40 URL-safe characters. Catch a pasted
    # placeholder or a truncated value before it reaches the network.
    case "$val" in
      *[!A-Za-z0-9_-]*) die "$side credential contains characters no Cloudflare API token contains — check what was entered" ;;
    esac
    [ "${#val}" -ge 30 ] || die "$side credential is ${#val} characters; a Cloudflare API token is 40"
    ( umask 077; printf 'Authorization: Bearer %s\n' "$val" > "$SECURE_TMP/$side.hdr" )
    printf '%s' "$val" > "$SECURE_TMP/$side.raw"; chmod 600 "$SECURE_TMP/$side.raw"
    val=""
  done
  unset CF_SRC_TOKEN CF_DST_TOKEN
}

# Fail the run if a token value reached any file the run produced.
assert_no_leak() { # <directory>
  local side hit
  for side in SRC DST; do
    [ -s "$SECURE_TMP/$side.raw" ] || continue
    if hit=$(grep -rlF -f "$SECURE_TMP/$side.raw" "$1" 2>/dev/null) && [ -n "$hit" ]; then
      die "credential material found in run artifacts: $hit — run directory left in place for inspection"
    fi
  done
  return 0
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
