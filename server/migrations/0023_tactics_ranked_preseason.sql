-- Ranked Preseason v0.1: RP per account and season, one applied result per (match, player),
-- one-time tier milestones, and a tiny first-come-first-served 1v1 queue.
-- Additive only. Rank is NOT stored: it is derived from rp (src/game/ranked/ranked.ts).
-- No backfill: casual matches finished before this migration never count for ranked.

-- Current RP per account and season. Written ONLY by the trigger on tactics_ranked_results.
CREATE TABLE IF NOT EXISTS tactics_ranked_players (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id   TEXT    NOT NULL,
  rp          INTEGER NOT NULL DEFAULT 0 CHECK (rp >= 0),
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  draws       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, season_id)
);

-- One row per participant of a ranked match. The PRIMARY KEY is the idempotency key: a repeated
-- finish (alarm retry, reconnect, DO restart) hits ON CONFLICT DO NOTHING and the trigger below
-- never fires twice. No FK to users, like tactics_pvp_match_players (history survives a deletion).
CREATE TABLE IF NOT EXISTS tactics_ranked_results (
  match_id     TEXT    NOT NULL,
  user_id      INTEGER NOT NULL,
  opponent_id  INTEGER NOT NULL,
  season_id    TEXT    NOT NULL,
  outcome      TEXT    NOT NULL CHECK (outcome IN ('WIN', 'LOSS', 'ABANDON', 'DRAW')),
  rp_before    INTEGER NOT NULL CHECK (rp_before >= 0),
  rp_after     INTEGER NOT NULL CHECK (rp_after >= 0),
  rp_delta     INTEGER NOT NULL,
  -- 1 = anti-farm cap (same rival too often in 24 h): the match counts, the RP does not.
  capped       INTEGER NOT NULL DEFAULT 0 CHECK (capped IN (0, 1)),
  finished_at  INTEGER NOT NULL,
  PRIMARY KEY (match_id, user_id),
  CHECK (user_id <> opponent_id),
  CHECK (rp_after = rp_before + rp_delta)
);
CREATE INDEX IF NOT EXISTS idx_tactics_ranked_results_pair ON tactics_ranked_results(user_id, opponent_id, season_id, finished_at);

CREATE TRIGGER IF NOT EXISTS tactics_ranked_results_apply AFTER INSERT ON tactics_ranked_results
BEGIN
  INSERT INTO tactics_ranked_players (user_id, season_id, rp, updated_at)
  SELECT NEW.user_id, NEW.season_id, 0, NEW.finished_at WHERE EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id)
  ON CONFLICT (user_id, season_id) DO NOTHING;
  UPDATE tactics_ranked_players
     SET rp = NEW.rp_after,
         wins = wins + (NEW.outcome = 'WIN'),
         losses = losses + (NEW.outcome IN ('LOSS', 'ABANDON')),
         draws = draws + (NEW.outcome = 'DRAW'),
         updated_at = NEW.finished_at
   WHERE user_id = NEW.user_id AND season_id = NEW.season_id;
END;

-- First time an account reaches a tier in a season. (user, season, tier) is unique: the reward
-- (a RANKED_MILESTONE wallet ledger row with reference "<season>:<tier>") is paid once.
CREATE TABLE IF NOT EXISTS tactics_ranked_milestones (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id   TEXT    NOT NULL,
  tier_id     TEXT    NOT NULL,
  match_id    TEXT    NOT NULL,
  crystals    INTEGER NOT NULL CHECK (crystals >= 0),
  reached_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, season_id, tier_id)
);

-- Queue: at most one ticket per account (PRIMARY KEY). room_code NULL = searching.
-- expires_at is a heartbeat refreshed by the client poll; a dead client drops out on its own.
CREATE TABLE IF NOT EXISTS tactics_ranked_queue (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hero_id     TEXT    NOT NULL,
  joined_at   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  room_code   TEXT,
  matched_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tactics_ranked_queue_waiting ON tactics_ranked_queue(room_code, joined_at);
