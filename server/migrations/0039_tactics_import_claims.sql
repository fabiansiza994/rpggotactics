-- Security Hardening 1.0 (SEC-001, owner decision B): unverifiable claims of the one-time local
-- import are PRESERVED for an eventual manual review — never granted automatically.
-- - One row per account (PRIMARY KEY): the import happens once, writes are bounded and a claim
--   can never be recorded twice.
-- - claims_json / claims_digest are immutable after insert (trigger): the evidence cannot drift.
-- - status moves once from PENDING_REVIEW to a terminal state (trigger). A future approved grant
--   must record a unique resolution_txn, so one claim can never produce resources twice.
-- - Nothing in the Worker reads this table to grant ownership. Contains card ids/counts only.
-- Additive; no existing table changes. Account deletion cascades (no orphaned personal data).
CREATE TABLE IF NOT EXISTS tactics_import_claims (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  claims_json     TEXT    NOT NULL CHECK (length(claims_json) <= 65536),
  claims_digest   TEXT    NOT NULL CHECK (length(claims_digest) = 64),
  policy          TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  created_at      INTEGER NOT NULL,
  reviewed_at     INTEGER,
  reviewer        TEXT,
  resolution_note TEXT,
  resolution_txn  TEXT UNIQUE
);
CREATE TRIGGER IF NOT EXISTS tactics_import_claims_immutable
BEFORE UPDATE OF user_id, claims_json, claims_digest, policy, created_at ON tactics_import_claims
BEGIN SELECT RAISE(ABORT, 'import claims are immutable'); END;
CREATE TRIGGER IF NOT EXISTS tactics_import_claims_single_resolution
BEFORE UPDATE OF status, resolution_txn ON tactics_import_claims
WHEN OLD.status <> 'PENDING_REVIEW'
BEGIN SELECT RAISE(ABORT, 'import claim already resolved'); END;
