-- PvP match history + player stats (GET /api/tactics/pvp/history, /stats, /head-to-head).
-- Additive only: one nullable column on tactics_pvp_matches and one new table.
--
-- tactics_pvp_matches stays the authoritative per-match record (one row per match_id, written by
-- the PvPMatchRoom Durable Object). tactics_pvp_match_players is its per-participant projection:
-- one row per (match, player) with that player's point of view (own champion, rival, WIN/LOSS/DRAW),
-- so "my history", "my stats" and head-to-head are single-table indexed reads.
--
-- Both are written in ONE D1 batch with ON CONFLICT DO NOTHING: a repeated finish (alarm retry,
-- rematch, reconnect, DO restart) never duplicates a match or a player row.
--
-- Legacy: matches finished before this migration have no player rows and are NOT backfilled
-- (history starts with this version). No FK to users: a deleted account's username simply stops
-- resolving and the rival's history shows "Jugador eliminado".

-- When the game actually started (both ready), not when the lobby was opened. NULL = legacy row.
ALTER TABLE tactics_pvp_matches ADD COLUMN started_at INTEGER;

CREATE TABLE IF NOT EXISTS tactics_pvp_match_players (
  match_id           TEXT    NOT NULL,
  user_id            INTEGER NOT NULL,
  opponent_id        INTEGER NOT NULL,
  seat               INTEGER NOT NULL CHECK (seat IN (0, 1)),
  champion           TEXT    NOT NULL,
  opponent_champion  TEXT    NOT NULL,
  mode               TEXT    NOT NULL,
  result             TEXT    NOT NULL CHECK (result IN ('WIN', 'LOSS', 'DRAW')),
  reason             TEXT    NOT NULL,
  rounds             INTEGER NOT NULL DEFAULT 0,
  duration_seconds   INTEGER,
  started_at         INTEGER,
  finished_at        INTEGER NOT NULL,
  PRIMARY KEY (match_id, user_id),
  CHECK (user_id <> opponent_id)
);
-- History page (newest first, keyset on finished_at + match_id) and stats GROUP BYs.
CREATE INDEX IF NOT EXISTS idx_tactics_pvp_players_history ON tactics_pvp_match_players(user_id, finished_at, match_id);
-- Head-to-head between two accounts.
CREATE INDEX IF NOT EXISTS idx_tactics_pvp_players_h2h ON tactics_pvp_match_players(user_id, opponent_id, finished_at);
