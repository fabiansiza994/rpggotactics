-- Ranked Reward Track v0.1 (src/game/ranked/rewardTrack.ts). Additive only.
--
-- One row per (account, season, reward) ever granted: the PRIMARY KEY is the idempotency key, so a
-- repeated grant (result retry, alarm, reconnect, refresh, concurrent reconcile) inserts nothing and
-- the AFTER INSERT triggers below never fire twice. Rows are written ONLY by the Worker from server
-- state: peak RP = MAX(rp_after) of tactics_ranked_results (0023) — no new RP column.
--
-- Crystals are NOT granted here: the track shows the existing 0023 tier milestones
-- (tactics_ranked_milestones + RANKED_MILESTONE ledger rows), which stay the only crystal source.
-- Titles need no extra table: owning the TITLE row is owning the title (equipped in
-- tactics_profile_titles, the one slot shared with Champion Mastery).
CREATE TABLE IF NOT EXISTS tactics_ranked_rewards (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id    TEXT    NOT NULL,
  reward_id    TEXT    NOT NULL,
  node_id      TEXT    NOT NULL,
  reward_type  TEXT    NOT NULL CHECK (reward_type IN ('CARD', 'TITLE', 'COSMETIC')),
  item_id      TEXT    NOT NULL,
  hero_id      TEXT,
  item_kind    TEXT,
  -- Copies requested (the playset) and copies actually added (never past the copy limit; 0 = the
  -- account already had them: the reward still counts as reached, no compensation in v0.1).
  quantity     INTEGER NOT NULL CHECK (quantity >= 1),
  granted      INTEGER NOT NULL CHECK (granted >= 0 AND granted <= quantity),
  required_rp  INTEGER NOT NULL,
  -- Ranked match that crossed the threshold, or 'RECONCILE' (legacy peak / safety net).
  match_id     TEXT    NOT NULL,
  granted_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, season_id, reward_id)
);

-- Cards: add the granted copies (existing row → +copies; else a new acquisition). Source keeps the
-- provenance on the collection row; season + reward id live in this table.
CREATE TRIGGER IF NOT EXISTS tactics_ranked_rewards_card AFTER INSERT ON tactics_ranked_rewards
WHEN NEW.reward_type = 'CARD' AND NEW.granted > 0
BEGIN
  UPDATE tactics_player_cards
     SET copies = copies + NEW.granted,
         acquired = (SELECT COALESCE(MAX(acquired), 0) + 1 FROM tactics_player_cards WHERE user_id = NEW.user_id AND hero_id = NEW.hero_id),
         source = 'RANKED_TRACK'
   WHERE user_id = NEW.user_id AND hero_id = NEW.hero_id AND card_id = NEW.item_id;
  INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at)
  SELECT NEW.user_id, NEW.hero_id, NEW.item_id, NEW.granted,
         (SELECT COALESCE(MAX(acquired), 0) + 1 FROM tactics_player_cards WHERE user_id = NEW.user_id AND hero_id = NEW.hero_id),
         'RANKED_TRACK', NEW.granted_at
  WHERE NOT EXISTS (SELECT 1 FROM tactics_player_cards WHERE user_id = NEW.user_id AND hero_id = NEW.hero_id AND card_id = NEW.item_id);
END;

-- Cosmetics: unique ownership (tactics_player_cosmetics PK); reference "<season>:<reward id>".
CREATE TRIGGER IF NOT EXISTS tactics_ranked_rewards_cosmetic AFTER INSERT ON tactics_ranked_rewards
WHEN NEW.reward_type = 'COSMETIC'
BEGIN
  INSERT INTO tactics_player_cosmetics (user_id, cosmetic_id, kind, source, reference_id, acquired_at)
  VALUES (NEW.user_id, NEW.item_id, NEW.item_kind, 'RANKED_TRACK', NEW.season_id || ':' || NEW.reward_id, NEW.granted_at)
  ON CONFLICT (user_id, cosmetic_id) DO NOTHING;
END;

-- A granted reward is never edited (demotion never removes anything). Deleting the account still
-- cascades (no DELETE guard, like tactics_mastery_ledger).
CREATE TRIGGER IF NOT EXISTS tactics_ranked_rewards_no_update BEFORE UPDATE ON tactics_ranked_rewards
BEGIN
  SELECT RAISE(ABORT, 'tactics_ranked_rewards is append-only');
END;

CREATE INDEX IF NOT EXISTS idx_tactics_ranked_rewards_match ON tactics_ranked_rewards(match_id);
