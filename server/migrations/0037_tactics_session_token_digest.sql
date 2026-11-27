-- Security Hardening 1.0 (SEC-002 / SEC-009): digest of the opaque session token at rest.
-- Additive and backwards compatible: existing sessions keep working (lookups fall back to the
-- raw token and backfill the digest on first use); the auth Worker keeps inserting rows as today.
-- No session is invalidated by this migration.
ALTER TABLE sessions ADD COLUMN token_digest TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_digest ON sessions(token_digest);
