-- TabReady v2.9.289 auth/recovery migration
-- One-time migration for a database at the v2.9.288 schema.
-- The Worker also verifies these additions defensively at runtime.

ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE magic_links ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login';
ALTER TABLE magic_links ADD COLUMN issued_by TEXT;
ALTER TABLE magic_links ADD COLUMN revoke_sessions INTEGER NOT NULL DEFAULT 0;

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
