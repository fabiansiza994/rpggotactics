-- Phase 2: server-side card progression. Additive and idempotent; touches no existing table.

-- Per-champion progression state that outlives campaign runs. reward_pity = wins in a row
-- without a card reward (see PITY_THRESHOLD in src/game/run/rewards.ts). Only the Worker writes
-- it, from replay-verified victories and validated claims.
CREATE TABLE IF NOT EXISTS tactics_hero_progress (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hero_id      TEXT    NOT NULL,
  reward_pity  INTEGER NOT NULL DEFAULT 0 CHECK (reward_pity >= 0),
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, hero_id)
);

-- Audit trail of reward decisions (support / farming investigation), one row per step:
--   OFFERED  — a verified victory produced this offer (offered_json)
--   NO_DROP  — a verified victory produced nothing (normal fight without a drop)
--   CLAIMED  — the player took chosen_json from the stored offer
CREATE TABLE IF NOT EXISTS tactics_reward_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id   TEXT    NOT NULL,
  run_seed      INTEGER NOT NULL,
  encounter_id  TEXT    NOT NULL,
  pool          TEXT    NOT NULL,
  event         TEXT    NOT NULL CHECK (event IN ('OFFERED', 'NO_DROP', 'CLAIMED')),
  offered_json  TEXT,
  chosen_json   TEXT,
  pity_before   INTEGER NOT NULL,
  pity_after    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tactics_reward_log_user ON tactics_reward_log(user_id, created_at);
