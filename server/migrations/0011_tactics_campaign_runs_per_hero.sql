-- Multi-champion campaigns: one campaign run per (player, campaign, champion), so the Mage and
-- the Summoner keep independent progress through the same encounters.
--
-- Additive (applied once through wrangler's migration tracking; the ALTER is not re-runnable).
-- `tactics_campaign_runs` (one run per player + campaign) is NOT
-- dropped: every existing row is copied here as the Mage run (all runs before this migration
-- were Mage runs), and the server keeps mirroring Mage runs into it so a Worker rollback still
-- finds current Mage progress. Neutral cards use hero_id = '*' in tactics_player_cards (no
-- schema change needed).

CREATE TABLE IF NOT EXISTS tactics_hero_campaign_runs (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id   TEXT    NOT NULL,
  hero_id       TEXT    NOT NULL,
  run_json      TEXT    NOT NULL,
  save_version  INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, campaign_id, hero_id)
);

INSERT OR IGNORE INTO tactics_hero_campaign_runs (user_id, campaign_id, hero_id, run_json, save_version, updated_at)
  SELECT user_id, campaign_id, 'mage', run_json, save_version, updated_at FROM tactics_campaign_runs;

-- Which champion a reward event belongs to (NULL = logged before this migration: Mage, or the
-- Summoner for campaign_id = 'skirmish').
ALTER TABLE tactics_reward_log ADD COLUMN hero_id TEXT;
