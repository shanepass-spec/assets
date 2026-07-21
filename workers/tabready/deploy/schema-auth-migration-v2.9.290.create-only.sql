-- Idempotent subset of the v2.9.290 auth/recovery migration.
-- Only the CREATE ... IF NOT EXISTS statements (safe to re-run any number of
-- times). The four ALTER TABLE ADD COLUMN statements are applied separately and
-- guarded by a PRAGMA check in the release workflow, because SQLite has no
-- "ADD COLUMN IF NOT EXISTS". Additive only — no DROP/DELETE.

CREATE TABLE IF NOT EXISTS auth_request_limits (
  limit_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  requested_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  resolved_by TEXT,
  restore_link_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_recovery_requests_status
  ON recovery_requests(status, created_at);

CREATE TABLE IF NOT EXISTS transfer_jti (
  jti_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
