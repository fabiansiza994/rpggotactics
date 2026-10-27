-- Independent verified skirmishes: server seed + frozen legal deck + durable offer.
CREATE TABLE IF NOT EXISTS tactics_skirmishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_json TEXT NOT NULL,
  deck_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tactics_skirmishes_user ON tactics_skirmishes(user_id, id);
-- Unique step receipts prevent concurrent/repeated victory or claim transactions.
CREATE TABLE IF NOT EXISTS tactics_skirmish_steps (
  battle_id INTEGER NOT NULL REFERENCES tactics_skirmishes(id) ON DELETE CASCADE,
  step TEXT NOT NULL CHECK (step IN ('VICTORY','CLAIM')),
  PRIMARY KEY (battle_id, step)
);
-- Existing v0.1 players retain earned cards; grant only the new starter familiar.
INSERT OR IGNORE INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at)
SELECT user_id, 'summoner', 'summon_fox', 3, 0, 'STARTER', unlocked_at
FROM tactics_player_cards WHERE hero_id = 'summoner' AND card_id = 'summon_chicken';
