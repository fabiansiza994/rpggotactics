-- Additive Phase 3 private PvP registry and final results only; no progression rewards.
CREATE TABLE IF NOT EXISTS tactics_pvp_rooms (
 code TEXT PRIMARY KEY, player_a INTEGER NOT NULL, player_b INTEGER,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS tactics_pvp_rooms_a ON tactics_pvp_rooms(player_a,expires_at);
CREATE INDEX IF NOT EXISTS tactics_pvp_rooms_b ON tactics_pvp_rooms(player_b,expires_at);
CREATE TABLE IF NOT EXISTS tactics_pvp_matches (
 match_id TEXT PRIMARY KEY, player_a INTEGER NOT NULL, player_b INTEGER NOT NULL,
 champion_a TEXT NOT NULL, champion_b TEXT NOT NULL, winner INTEGER NOT NULL,
 loser INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
 finished_at INTEGER NOT NULL, command_count INTEGER NOT NULL, first_player INTEGER NOT NULL
);
