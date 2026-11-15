-- Additive bot participants; no synthetic users, no changes to historical human results.
CREATE TABLE IF NOT EXISTS tactics_match_reservations (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 room_code TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'HUMAN' CHECK(kind IN('HUMAN','BOT')),
 expires_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS tactics_match_single_start BEFORE UPDATE OF started_at ON tactics_pvp_rooms
WHEN NEW.started_at IS NOT NULL AND OLD.started_at IS NULL
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM tactics_match_reservations WHERE user_id IN(NEW.player_a,NEW.player_b) AND room_code<>NEW.code AND expires_at>NEW.started_at)
 OR EXISTS(SELECT 1 FROM tactics_pvp_rooms WHERE code<>NEW.code AND finished_at IS NULL AND started_at IS NOT NULL AND expires_at>NEW.started_at AND (player_a IN(NEW.player_a,NEW.player_b) OR player_b IN(NEW.player_a,NEW.player_b)))
 THEN RAISE(ABORT,'IN_MATCH') END;
 INSERT INTO tactics_match_reservations(user_id,room_code,expires_at) VALUES(NEW.player_a,NEW.code,NEW.expires_at) ON CONFLICT(user_id) DO UPDATE SET room_code=excluded.room_code,expires_at=excluded.expires_at;
 INSERT INTO tactics_match_reservations(user_id,room_code,expires_at) SELECT NEW.player_b,NEW.code,NEW.expires_at WHERE NEW.player_b IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET room_code=excluded.room_code,expires_at=excluded.expires_at;
END;
CREATE TRIGGER IF NOT EXISTS tactics_match_release AFTER UPDATE OF finished_at ON tactics_pvp_rooms WHEN NEW.finished_at IS NOT NULL
BEGIN DELETE FROM tactics_match_reservations WHERE room_code=NEW.code; END;
CREATE TABLE IF NOT EXISTS tactics_ranked_bot_encounters (
 match_id TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 room_code TEXT NOT NULL UNIQUE,
 bot_json TEXT NOT NULL,
 policy_json TEXT NOT NULL,
 hero_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS tactics_bot_encounters_user ON tactics_ranked_bot_encounters(user_id,created_at);
CREATE TABLE IF NOT EXISTS tactics_ranked_bot_results (
 match_id TEXT PRIMARY KEY REFERENCES tactics_ranked_bot_encounters(match_id),
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 season_id TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN('WIN','LOSS','ABANDON','DRAW','SERVER_ERROR')),
 day TEXT NOT NULL,
 rp_before INTEGER NOT NULL CHECK(rp_before>=0),
 rp_delta INTEGER NOT NULL,
 rp_after INTEGER NOT NULL CHECK(rp_after=rp_before+rp_delta AND rp_after>=0),
 xp INTEGER NOT NULL CHECK(xp>=0),
 valid INTEGER NOT NULL CHECK(valid IN(0,1)),
 finished_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tactics_bot_daily ON tactics_ranked_bot_results(user_id,day);
CREATE TRIGGER IF NOT EXISTS tactics_bot_apply_rp AFTER INSERT ON tactics_ranked_bot_results
BEGIN
 INSERT INTO tactics_ranked_players(user_id,season_id,rp,updated_at) VALUES(NEW.user_id,NEW.season_id,0,NEW.finished_at) ON CONFLICT(user_id,season_id) DO NOTHING;
 UPDATE tactics_ranked_players SET rp=MAX(0,rp+NEW.rp_delta),updated_at=NEW.finished_at WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
END;
-- Competitive reward eligibility excludes positive RP earned from IA, including via later human losses.
CREATE INDEX IF NOT EXISTS tactics_bot_timeline ON tactics_ranked_bot_results(user_id,season_id,finished_at);
CREATE INDEX IF NOT EXISTS tactics_human_timeline ON tactics_ranked_results(user_id,season_id,finished_at);
CREATE VIEW IF NOT EXISTS tactics_ranked_competitive_results AS
 WITH timeline AS (
  SELECT match_id,user_id,opponent_id,season_id,outcome,rp_before,rp_after,rp_delta,capped,finished_at,1 AS human,0 AS ai_positive FROM tactics_ranked_results
  UNION ALL
  SELECT match_id,user_id,NULL,season_id,outcome,rp_before,rp_after,rp_delta,0,finished_at,0,MAX(0,rp_delta) FROM tactics_ranked_bot_results
 ), accumulated AS (
  SELECT *,SUM(ai_positive) OVER(PARTITION BY user_id,season_id ORDER BY finished_at,human ROWS UNBOUNDED PRECEDING) AS ai_total FROM timeline
 )
 SELECT match_id,user_id,opponent_id,season_id,outcome,rp_before,rp_after,rp_delta,capped,finished_at,MAX(0,rp_after-ai_total) AS competitive_rp
 FROM accumulated WHERE human=1;

ALTER TABLE tactics_ranked_queue ADD COLUMN bot_request TEXT;
ALTER TABLE tactics_ranked_queue ADD COLUMN bot_seed INTEGER;
