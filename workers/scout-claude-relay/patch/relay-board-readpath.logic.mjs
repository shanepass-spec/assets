// scout-claude-relay board read-path — pure logic + SQL (testable core).
// =====================================================================
// No worker source, no credentials. This is the exact logic grafted by
// relay-board-readpath.patch (the patch strips the `export` keywords, since the
// worker's top-level helpers are plain declarations). Kept identical to the patch's
// helper hunk so tests exercise the shipped logic. CODE-ONLY; nothing here writes.

// ── Tunables ─────────────────────────────────────────────────────────────────
export const TERMINAL_RETENTION_DAYS = 30; // terminal rows younger than this stay on /board
export const BOARD_HARD_CAP = 200;         // absolute max rows any board read returns
export const ARCHIVE_PAGE_DEFAULT = 25;    // default /archive page size
export const ARCHIVE_PAGE_MAX = 100;       // hard max /archive page size

// Exact terminal spellings (after separator normalization). Any "verified-*" is also terminal.
export const TERMINAL_EXACT = ["done", "closed", "complete", "completed", "verified"];

// The lean column list the JSON board read path is allowed to fetch.
export const BOARD_LEAN_COLS = ["id", "project", "status", "next_actor", "updated_at", "shane_needed_only_for"];

// ── Pure helpers ─────────────────────────────────────────────────────────────

// Normalize a raw status: lowercase, trim, unify separators ('_' -> '-').
export function normStatus(status) {
  return String(status == null ? "" : status).trim().toLowerCase().replace(/_/g, "-");
}

// Terminal = finished work. Matches the exact set plus any "verified-*" spelling.
export function isTerminal(status) {
  const s = normStatus(status);
  if (TERMINAL_EXACT.indexOf(s) !== -1) return true;
  if (s === "verified" || s.indexOf("verified-") === 0) return true;
  return false;
}

// Same bucket names as before; terminal now routes to "done" via isTerminal, so
// verified_done / verified-live / verified-with-followups no longer fall to "other".
export function bucketFor(status) {
  const s = normStatus(status);
  if (s === "parked") return "parked";
  if (s === "blocked") return "blocked";
  if (isTerminal(s)) return "done";
  if (s === "active" || s === "open" || s === "in-progress" || s === "in progress" || s === "") return "active";
  return "other";
}

// Mirrors the worker's existing isRealGate(): "populated / actionable" means not blank
// and not a throwaway placeholder. (When grafting, the worker's isRealGate may be reused.)
const _EMPTY_MARKERS = ["", "none", "none.", "-", "—", "n/a", "nothing", "nothing."];
export function isPopulated(v) {
  return _EMPTY_MARKERS.indexOf(String(v == null ? "" : v).trim().toLowerCase()) === -1;
}

// next_actor is "live" when it names a real actor (not blank / not "none").
export function hasLiveActor(row) {
  const na = String(row.next_actor == null ? "" : row.next_actor).trim().toLowerCase();
  return na !== "" && na !== "none";
}

// A terminal row has actionable residue when it still points at an actor OR still
// records a real Shane gate.
export function hasResidual(row) {
  return hasLiveActor(row) || isPopulated(row.shane_needed_only_for);
}

// Parse relay_state timestamps ("YYYY-MM-DD HH:MM:SS", stored UTC) to epoch ms.
export function parseUpdatedAt(updated_at) {
  if (!updated_at) return NaN;
  return Date.parse(String(updated_at).replace(" ", "T") + "Z");
}

export function withinDays(updated_at, days, nowMs) {
  const t = parseUpdatedAt(updated_at);
  if (isNaN(t)) return false;
  return (nowMs - t) <= days * 86400000;
}

// The core rule: which rows belong on the LIVE board (/board) vs /archive.
// Non-terminal rows are always live. Terminal rows are live only while they carry
// residual ownership or were updated within the retention window.
export function boardEligible(row, nowMs) {
  if (!isTerminal(row.status)) return true;
  return hasResidual(row) || withinDays(row.updated_at, TERMINAL_RETENTION_DAYS, nowMs);
}

// Clamp a requested page size to [1, max].
export function clampLimit(raw, dflt, max) {
  const n = parseInt(raw, 10);
  if (!n || n < 1) return dflt;
  return n > max ? max : n;
}

// ── SQL (mirrors the JS logic so filtering/pagination happen in the DB) ────────
// D1/SQLite has REPLACE/LOWER/TRIM and datetime(). Normalized status:
//   REPLACE(LOWER(TRIM(status)),'_','-').

const NS = "REPLACE(LOWER(TRIM(status)),'_','-')";
const TERMINAL_PRED =
  `(${NS} IN ('done','closed','complete','completed','verified') OR ${NS} LIKE 'verified-%')`;
const RESIDUAL_PRED =
  `((LOWER(TRIM(COALESCE(next_actor,''))) NOT IN ('','none')) ` +
  `OR (LOWER(TRIM(COALESCE(shane_needed_only_for,''))) NOT IN ('','none','none.','-','—','n/a','nothing','nothing.')))`;

// Live-board rows: not terminal, OR terminal with residue, OR terminal & recent.
// bind: ['-30 days', BOARD_HARD_CAP]
export const SQL_BOARD_ELIGIBLE =
  `SELECT ${BOARD_LEAN_COLS.join(", ")} FROM relay_state ` +
  `WHERE (NOT ${TERMINAL_PRED}) OR ${RESIDUAL_PRED} OR (updated_at >= datetime('now', ?)) ` +
  `ORDER BY updated_at DESC, id DESC LIMIT ?`;

// True bucket totals across ALL rows (counts are never truncated).
export const SQL_BUCKET_COUNTS =
  `SELECT CASE ` +
  `WHEN ${NS} = 'parked' THEN 'parked' ` +
  `WHEN ${NS} = 'blocked' THEN 'blocked' ` +
  `WHEN ${NS} IN ('done','closed','complete','completed','verified') OR ${NS} LIKE 'verified-%' THEN 'done' ` +
  `WHEN ${NS} IN ('active','open','in-progress','in progress','') THEN 'active' ` +
  `ELSE 'other' END AS bucket, COUNT(*) AS n FROM relay_state GROUP BY bucket`;

// All terminal rows, newest first, paginated. bind: [limit, offset]
export const SQL_ARCHIVE =
  `SELECT ${BOARD_LEAN_COLS.join(", ")} FROM relay_state ` +
  `WHERE ${TERMINAL_PRED} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`;
export const SQL_ARCHIVE_COUNT =
  `SELECT COUNT(*) AS n FROM relay_state WHERE ${TERMINAL_PRED}`;

// HTML /board: explicit, bounded column list. Drops the widest free-text columns
// (current_truth, approved_scope, dispatch_*, latest_scout_decision, verified,
// unchanged, blocked_only_if, ...) and caps the remaining card fields in SQL.
// bind: ['-30 days', BOARD_HARD_CAP]
export const SQL_BOARD_VIEW =
  `SELECT id, project, status, next_actor, updated_at, ` +
  `substr(COALESCE(shane_needed_only_for,''),1,400) AS shane_needed_only_for, ` +
  `substr(COALESCE(shane_read,''),1,600)            AS shane_read, ` +
  `approval_required, proof_required, ` +
  `substr(COALESCE(next_safe_action,''),1,600)      AS next_safe_action, ` +
  `substr(COALESCE(latest_builder_status,''),1,800) AS latest_builder_status, ` +
  `substr(COALESCE(handoff_note,''),1,600)          AS handoff_note ` +
  `FROM relay_state ` +
  `WHERE (NOT ${TERMINAL_PRED}) OR ${RESIDUAL_PRED} OR (updated_at >= datetime('now', ?)) ` +
  `ORDER BY updated_at DESC, id DESC LIMIT ?`;
