// Pure-logic tests for the scout-claude-relay board read-path fix.
// Dependency-free. Run:  node workers/scout-claude-relay/patch/relay-board-readpath.test.mjs
import assert from "node:assert/strict";
import {
  normStatus, isTerminal, bucketFor, hasResidual, boardEligible, clampLimit,
  BOARD_LEAN_COLS, BOARD_HARD_CAP, ARCHIVE_PAGE_MAX,
  SQL_BOARD_ELIGIBLE, SQL_BOARD_VIEW, SQL_ARCHIVE, SQL_BUCKET_COUNTS,
} from "./relay-board-readpath.logic.mjs";

// Deterministic "now" = 2026-07-27T12:00:00Z (the inventory date).
const NOW = Date.parse("2026-07-27T12:00:00Z");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.error("FAIL  " + name + "\n      " + e.message); }
}

// Sanitized fixtures modeled on the live inventory (status + the fields the rule reads).
const row78 = { id: 78, status: "verified-with-followups", next_actor: "shane", shane_needed_only_for: "Regenerate packet and eyeball the fill.", updated_at: "2026-07-15 21:06:25" };
const row87 = { id: 87, status: "verified-live",            next_actor: "Scout", shane_needed_only_for: "Nothing.", updated_at: "2026-07-17 23:43:29" };
const row95 = { id: 95, status: "verified_done",            next_actor: "none",  shane_needed_only_for: "Nothing.", updated_at: "2026-07-22 00:41:27" };
const row86 = { id: 86, status: "active", next_actor: "Scout", shane_needed_only_for: "", updated_at: "2026-07-17 23:39:24" }; // duplicate A
const row88 = { id: 88, status: "active", next_actor: "Scout", shane_needed_only_for: "", updated_at: "2026-07-17 23:54:55" }; // duplicate B
const oldDone    = { id: 999, status: "done",   next_actor: "none", shane_needed_only_for: "Nothing.", updated_at: "2026-05-01 00:00:00" };
const recentDone = { id: 998, status: "closed", next_actor: "",     shane_needed_only_for: "",         updated_at: "2026-07-20 00:00:00" };

console.log("normalization + terminal bucketing");
t("normStatus lowercases, trims, unifies separators", () => {
  assert.equal(normStatus("  Verified_Done "), "verified-done");
  assert.equal(normStatus("VERIFIED-LIVE"), "verified-live");
});
t("verified_done / verified-with-followups / verified-live bucket as terminal", () => {
  for (const s of ["verified_done", "verified-with-followups", "verified-live"]) {
    assert.equal(isTerminal(s), true, s + " should be terminal");
    assert.equal(bucketFor(s), "done", s + " should bucket to done");
  }
});
t("plain terminal spellings still terminal", () => {
  for (const s of ["done", "closed", "complete", "completed", "verified"]) assert.equal(bucketFor(s), "done");
});
t("non-terminal statuses keep their buckets", () => {
  assert.equal(bucketFor("active"), "active");
  assert.equal(bucketFor("parked"), "parked");
  assert.equal(bucketFor("blocked"), "blocked");
  assert.equal(bucketFor("in_progress"), "active");
  assert.equal(bucketFor("weird-unknown"), "other");
});

console.log("residual-action visibility");
t("row 87 stays on the board because it points to Scout", () => {
  assert.equal(hasResidual(row87), true);
  assert.equal(boardEligible(row87, NOW), true);
});
t("row 78 stays on the board because it points to Shane", () => {
  assert.equal(hasResidual(row78), true);
  assert.equal(boardEligible(row78, NOW), true);
});
t("row 95 (verified_done, next_actor none, 'Nothing.') has no residual", () => {
  assert.equal(hasResidual(row95), false);
});
t("old terminal row with no residual is archive-only", () => {
  assert.equal(boardEligible(oldDone, NOW), false);
});
t("recent terminal row with no residual kept by the 30-day window", () => {
  assert.equal(boardEligible(recentDone, NOW), true);
});
t("'none' / 'None.' / 'n/a' are not residual", () => {
  assert.equal(hasResidual({ next_actor: "none", shane_needed_only_for: "None." }), false);
  assert.equal(hasResidual({ next_actor: "", shane_needed_only_for: "n/a" }), false);
});

console.log("untouched duplicate rows");
t("duplicate rows 86 & 88 are active -> always eligible, never archived, never mutated", () => {
  // The read path only reads; these assertions confirm the classification, not any write.
  assert.equal(boardEligible(row86, NOW), true);
  assert.equal(boardEligible(row88, NOW), true);
  assert.equal(isTerminal(row86.status), false);
  assert.equal(isTerminal(row88.status), false);
});

console.log("pagination + column safety");
t("clampLimit bounds requests", () => {
  assert.equal(clampLimit("5", 25, 100), 5);
  assert.equal(clampLimit("9999", 25, 100), 100);
  assert.equal(clampLimit(null, 25, 100), 25);
  assert.equal(clampLimit("0", 25, 100), 25);
});
t("board lean columns are exactly the 6 specified", () => {
  assert.deepEqual(BOARD_LEAN_COLS, ["id","project","status","next_actor","updated_at","shane_needed_only_for"]);
});
t("board read paths never SELECT * and never fetch the widest free-text columns", () => {
  for (const sql of [SQL_BOARD_ELIGIBLE, SQL_BOARD_VIEW]) {
    for (const wide of ["current_truth","approved_scope","dispatch_packet","latest_scout_decision","unchanged"]) {
      assert.ok(!sql.includes(wide), "board SQL must not select " + wide);
    }
    assert.ok(!/SELECT\s+\*/i.test(sql), "board SQL must not use SELECT *");
  }
});
t("every board/archive read is bounded (no unbounded full-table response)", () => {
  assert.ok(/LIMIT \?/.test(SQL_BOARD_ELIGIBLE));
  assert.ok(/LIMIT \?/.test(SQL_BOARD_VIEW));
  assert.ok(/LIMIT \? OFFSET \?/.test(SQL_ARCHIVE), "archive must paginate with LIMIT/OFFSET");
});
t("archive selects all terminal rows (both separators + verified-*)", () => {
  assert.ok(SQL_ARCHIVE.includes("verified-%"));
  assert.ok(SQL_ARCHIVE.includes("'done','closed','complete','completed','verified'"));
  assert.ok(SQL_ARCHIVE.includes("ORDER BY updated_at DESC"));
});
t("counts query buckets terminal spellings into 'done' and keeps true totals", () => {
  assert.ok(SQL_BUCKET_COUNTS.includes("verified-%"));
  assert.ok(SQL_BUCKET_COUNTS.includes("GROUP BY bucket"));
});
t("sanity constants", () => {
  assert.ok(BOARD_HARD_CAP > 0 && BOARD_HARD_CAP <= 500);
  assert.ok(ARCHIVE_PAGE_MAX > 0 && ARCHIVE_PAGE_MAX <= 200);
});

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
