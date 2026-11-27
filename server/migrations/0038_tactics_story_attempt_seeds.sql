-- Security Hardening 1.0 (SEC-006): server-issued battle seed per Story attempt.
-- One row per (account, campaign, champion). A row whose run_seed/encounter_id match the run's
-- current admission means that admission is seed-bound: its victory must replay with one of the
-- seeds the server issued for that admission (issued_seeds, bounded to the last 16). Admissions without a row (all
-- admissions created before STORY_SEED_BINDING=1) keep the legacy free-seed verification, so no
-- previously admitted encounter is invalidated. Additive; no existing table is modified.
CREATE TABLE IF NOT EXISTS tactics_story_attempts (
  user_id       INTEGER NOT NULL,
  campaign_id   TEXT    NOT NULL,
  hero_id       TEXT    NOT NULL,
  run_seed      INTEGER NOT NULL,
  encounter_id  TEXT    NOT NULL,
  attempt_seq   INTEGER NOT NULL DEFAULT 0,
  battle_seed   INTEGER,
  previous_seed INTEGER,
  -- Last 16 seeds issued for THIS admission (JSON array). A pending victory stays verifiable across
  -- consecutive reloads / tabs that request new attempts; reset when the admission changes.
  issued_seeds  TEXT    NOT NULL DEFAULT '[]',
  issued_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, campaign_id, hero_id)
);
