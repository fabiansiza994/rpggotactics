-- Champion onboarding + account-wide unlocks. Additive only.
--
-- Backfill policy: every profile that exists when this runs gets champion_mode = 'LEGACY'
-- (the column default), which means "every released champion stays unlocked" — before this
-- feature all champions were free, so no existing account loses access or is sent through
-- onboarding. Only profiles created by the new Worker are written with 'PROGRESSION'.
--
-- Rollback: the previous Worker never reads these columns/table. Profiles it creates during a
-- rollback get the default 'LEGACY' (open roster), so a rollback can never lock anyone out.
-- Nothing here touches cards, decks, runs or pity.

ALTER TABLE tactics_profiles ADD COLUMN champion_mode TEXT NOT NULL DEFAULT 'LEGACY';
-- First-time choice (NULL until made; always NULL for LEGACY profiles).
ALTER TABLE tactics_profiles ADD COLUMN starting_champion_id TEXT;
-- Most campaign encounters completed in any champion's run (account-wide milestones).
ALTER TABLE tactics_profiles ADD COLUMN campaign_best INTEGER NOT NULL DEFAULT 0;

-- One row per champion the player unlocked, with the milestone it consumed.
CREATE TABLE IF NOT EXISTS tactics_champion_unlocks (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hero_id      TEXT    NOT NULL,
  milestone    TEXT    NOT NULL,             -- START | ASCENT_3 | ASCENT_6
  unlocked_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, hero_id)
);

-- A single-grant milestone can be consumed once per player, even by two concurrent requests
-- (the losing transaction fails as a whole). ASCENT_6 grants every remaining champion.
CREATE UNIQUE INDEX IF NOT EXISTS tactics_champion_unlocks_once
  ON tactics_champion_unlocks (user_id, milestone) WHERE milestone IN ('START', 'ASCENT_3');
