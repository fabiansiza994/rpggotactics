-- Security Hardening 1.0 — final remediation of SEC-006 (independent review B1–B3).
-- Supersedes the single mutable row of 0038 (tactics_story_attempts), which is left untouched and
-- is no longer read or written: applied migration history is never edited.
--
-- tactics_story_attempt_admissions: one immutable row per Story admission (account + campaign +
--   champion + run seed + encounter), created in the SAME batch as the run write that admits it.
--   - admission_id is a random identity; identity columns and mode can never change (trigger).
--   - mode is decided once, when the admission is created: BOUND only when STORY_SEED_BINDING was
--     on at that moment; LEGACY otherwise, and for admissions that predate this table
--     (origin RECONCILED). Issuing attempts never turns a LEGACY admission into a BOUND one.
--   - At most one OPEN admission per account/campaign/champion (partial unique index). It closes
--     exactly once (trigger): CONCLUDED by the confirmed victory, SUPERSEDED by a newer admission.
-- tactics_story_attempt_receipts: one immutable row per issued attempt of an admission. Receipts
--   are never evicted while the admission exists, so a pending victory never expires because other
--   devices or tabs requested newer attempts. Growth is bounded per admission by the Worker, which
--   re-issues the latest receipt instead of adding rows past its cap (no eviction).
-- Additive only. Account deletion cascades (no orphaned personal data).
CREATE TABLE IF NOT EXISTS tactics_story_attempt_admissions (
  admission_id  TEXT    PRIMARY KEY CHECK (length(admission_id) BETWEEN 16 AND 64),
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id   TEXT    NOT NULL,
  hero_id       TEXT    NOT NULL,
  run_seed      INTEGER NOT NULL,
  encounter_id  TEXT    NOT NULL,
  mode          TEXT    NOT NULL CHECK (mode IN ('LEGACY', 'BOUND')),
  origin        TEXT    NOT NULL CHECK (origin IN ('ADMITTED', 'RECONCILED')),
  created_at    INTEGER NOT NULL,
  closed_at     INTEGER,
  close_reason  TEXT    CHECK (close_reason IS NULL OR close_reason IN ('CONCLUDED', 'SUPERSEDED')),
  CHECK ((closed_at IS NULL) = (close_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_story_attempt_admissions_open
  ON tactics_story_attempt_admissions (user_id, campaign_id, hero_id) WHERE closed_at IS NULL;
CREATE TRIGGER IF NOT EXISTS tactics_story_attempt_admissions_identity
BEFORE UPDATE OF admission_id, user_id, campaign_id, hero_id, run_seed, encounter_id, mode, origin, created_at
ON tactics_story_attempt_admissions
BEGIN SELECT RAISE(ABORT, 'story admission identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS tactics_story_attempt_admissions_single_close
BEFORE UPDATE OF closed_at, close_reason ON tactics_story_attempt_admissions
WHEN OLD.closed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'story admission already closed'); END;

CREATE TABLE IF NOT EXISTS tactics_story_attempt_receipts (
  attempt_id    TEXT    PRIMARY KEY CHECK (length(attempt_id) BETWEEN 16 AND 64),
  admission_id  TEXT    NOT NULL REFERENCES tactics_story_attempt_admissions(admission_id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL CHECK (seq >= 1),
  seed          INTEGER NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  issued_at     INTEGER NOT NULL,
  UNIQUE (admission_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_story_attempt_receipts_seed ON tactics_story_attempt_receipts (admission_id, seed);
CREATE TRIGGER IF NOT EXISTS tactics_story_attempt_receipts_immutable
BEFORE UPDATE ON tactics_story_attempt_receipts
BEGIN SELECT RAISE(ABORT, 'story attempt receipts are immutable'); END;
