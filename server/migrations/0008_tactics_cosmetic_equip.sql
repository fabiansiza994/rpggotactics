-- Phase 4C: which owned cosmetic is shown in each slot (ownership ≠ equipped).
-- Additive only: one new table; no existing table or RPG-GO table is modified.
-- The composite FK makes "equipped but not owned" impossible at the database level; deleting
-- the account (users row) cascades through tactics_player_cosmetics to this table.
CREATE TABLE IF NOT EXISTS tactics_equipped_cosmetics (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'PROFILE_FRAME' today; later e.g. 'SUMMON_SKIN:fox' (see cosmeticSlot in src/game/store/store.ts).
  slot         TEXT    NOT NULL,
  cosmetic_id  TEXT    NOT NULL,
  equipped_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot),
  FOREIGN KEY (user_id, cosmetic_id) REFERENCES tactics_player_cosmetics (user_id, cosmetic_id) ON DELETE CASCADE
);
