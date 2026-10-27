-- Ranked Premium Track v0.1 (src/game/ranked/premiumTrack.ts). Additive only. PREPARED, NOT APPLIED.
--
-- The pass: one row per (account, season), bought with 600 arcane crystals. Inserting the row IS
-- the payment: its trigger writes the RANKED_PREMIUM_PASS debit to the append-only wallet ledger,
-- whose own checks (balance_before = wallet, balance_after >= 0, UNIQUE reason/reference) abort the
-- whole statement on insufficient funds or a second debit. So a pass can never exist unpaid, and a
-- season can never be charged twice (PRIMARY KEY + ledger UNIQUE "<season>").
-- idempotency_key: the client's purchase key; a retried request with the same key is answered
-- from this row without touching the wallet.
CREATE TABLE IF NOT EXISTS tactics_ranked_premium_passes (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id        TEXT    NOT NULL,
  price            INTEGER NOT NULL CHECK (price > 0),
  currency_id      TEXT    NOT NULL,
  idempotency_key  TEXT    NOT NULL,
  purchased_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, season_id)
);

CREATE TRIGGER IF NOT EXISTS tactics_ranked_premium_passes_pay AFTER INSERT ON tactics_ranked_premium_passes
BEGIN
  INSERT INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, note, created_at)
  SELECT lower(hex(randomblob(16))), NEW.user_id, NEW.currency_id, -NEW.price, b, b - NEW.price, 'RANKED_PREMIUM_PASS',
         NEW.season_id, 'Pase Premium Ranked · ' || NEW.season_id, NEW.purchased_at
  FROM (SELECT COALESCE((SELECT balance FROM tactics_wallets WHERE user_id = NEW.user_id AND currency_id = NEW.currency_id), 0) AS b);
END;

-- A bought pass is never edited (refunds, if ever, are a compensating ledger row + its own table).
CREATE TRIGGER IF NOT EXISTS tactics_ranked_premium_passes_no_update BEFORE UPDATE ON tactics_ranked_premium_passes
BEGIN
  SELECT RAISE(ABORT, 'tactics_ranked_premium_passes is append-only');
END;

-- One row per (account, season, premium reward) ever granted: the PRIMARY KEY is the idempotency
-- key (purchase retry, result retry, alarm, reconnect, refresh, concurrent reconcile insert
-- nothing; the AFTER INSERT triggers never fire twice). Written only by the Worker from server
-- state: the pass row + peak RP = MAX(rp_after) of tactics_ranked_results (0023).
CREATE TABLE IF NOT EXISTS tactics_ranked_premium_rewards (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id    TEXT    NOT NULL,
  reward_id    TEXT    NOT NULL,
  node_id      TEXT    NOT NULL,
  reward_type  TEXT    NOT NULL CHECK (reward_type IN ('CARD', 'CRYSTALS', 'TITLE', 'COSMETIC', 'AVATAR')),
  item_id      TEXT    NOT NULL,
  hero_id      TEXT,
  item_kind    TEXT,
  quantity     INTEGER NOT NULL CHECK (quantity >= 1),
  -- Copies actually added (CARD: 0 = the account already owned the card). Otherwise = quantity.
  granted      INTEGER NOT NULL CHECK (granted >= 0 AND granted <= quantity),
  required_rp  INTEGER NOT NULL,
  -- 'PURCHASE' (retroactive grant at purchase), a ranked match id, or 'RECONCILE'.
  match_id     TEXT    NOT NULL,
  granted_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, season_id, reward_id)
);

-- Defence in depth: no premium grant without that season's pass.
CREATE TRIGGER IF NOT EXISTS tactics_ranked_premium_rewards_need_pass BEFORE INSERT ON tactics_ranked_premium_rewards
WHEN NOT EXISTS (SELECT 1 FROM tactics_ranked_premium_passes WHERE user_id = NEW.user_id AND season_id = NEW.season_id)
BEGIN
  SELECT RAISE(ABORT, 'ranked premium reward without a pass');
END;

CREATE TRIGGER IF NOT EXISTS tactics_ranked_premium_rewards_card AFTER INSERT ON tactics_ranked_premium_rewards
WHEN NEW.reward_type = 'CARD' AND NEW.granted > 0
BEGIN
  UPDATE tactics_player_cards
     SET copies = copies + NEW.granted,
         acquired = (SELECT COALESCE(MAX(acquired), 0) + 1 FROM tactics_player_cards WHERE user_id = NEW.user_id AND hero_id = NEW.hero_id),
         source = 'RANKED_PREMIUM'
   WHERE user_id = NEW.user_id AND hero_id = NEW.hero_id AND card_id = NEW.item_id;
  INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at)
  SELECT NEW.user_id, NEW.hero_id, NEW.item_id, NEW.granted,
         (SELECT COALESCE(MAX(acquired), 0) + 1 FROM tactics_player_cards WHERE user_id = NEW.user_id AND hero_id = NEW.hero_id),
         'RANKED_PREMIUM', NEW.granted_at
  WHERE NOT EXISTS (SELECT 1 FROM tactics_player_cards WHERE user_id = NEW.user_id AND hero_id = NEW.hero_id AND card_id = NEW.item_id);
END;

-- Frames, card back and avatars (kind PROFILE_AVATAR): unique ownership, reference "<season>:<reward id>".
CREATE TRIGGER IF NOT EXISTS tactics_ranked_premium_rewards_cosmetic AFTER INSERT ON tactics_ranked_premium_rewards
WHEN NEW.reward_type IN ('COSMETIC', 'AVATAR')
BEGIN
  INSERT INTO tactics_player_cosmetics (user_id, cosmetic_id, kind, source, reference_id, acquired_at)
  VALUES (NEW.user_id, NEW.item_id, NEW.item_kind, 'RANKED_PREMIUM', NEW.season_id || ':' || NEW.reward_id, NEW.granted_at)
  ON CONFLICT (user_id, cosmetic_id) DO NOTHING;
END;

-- Crystals: a RANKED_PREMIUM_REWARD ledger credit, reference "<season>:<reward id>" (the ledger's
-- UNIQUE key is the last guard against a double payment).
CREATE TRIGGER IF NOT EXISTS tactics_ranked_premium_rewards_crystals AFTER INSERT ON tactics_ranked_premium_rewards
WHEN NEW.reward_type = 'CRYSTALS'
BEGIN
  INSERT INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, note, created_at)
  SELECT lower(hex(randomblob(16))), NEW.user_id, NEW.item_id, NEW.quantity, b, b + NEW.quantity, 'RANKED_PREMIUM_REWARD',
         NEW.season_id || ':' || NEW.reward_id, 'Pase Premium · ' || NEW.node_id, NEW.granted_at
  FROM (SELECT COALESCE((SELECT balance FROM tactics_wallets WHERE user_id = NEW.user_id AND currency_id = NEW.item_id), 0) AS b)
  WHERE NOT EXISTS (SELECT 1 FROM tactics_wallet_ledger WHERE user_id = NEW.user_id AND currency_id = NEW.item_id
                    AND reason = 'RANKED_PREMIUM_REWARD' AND reference_id = NEW.season_id || ':' || NEW.reward_id);
END;

CREATE TRIGGER IF NOT EXISTS tactics_ranked_premium_rewards_no_update BEFORE UPDATE ON tactics_ranked_premium_rewards
BEGIN
  SELECT RAISE(ABORT, 'tactics_ranked_premium_rewards is append-only');
END;

CREATE INDEX IF NOT EXISTS idx_tactics_ranked_premium_rewards_match ON tactics_ranked_premium_rewards(match_id);

-- Diamante I: the ONE Showcase the player picks (PRIMARY KEY = once per account and season).
-- The Worker inserts it only with the pass and a peak at the node; the trigger grants the CARD_ART
-- cosmetic "showcase_<card>" (presentation only: same card, same stats).
CREATE TABLE IF NOT EXISTS tactics_ranked_premium_showcase (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id  TEXT    NOT NULL,
  card_id    TEXT    NOT NULL CHECK (card_id IN ('double_moon_pact', 'fallen_king_wall', 'stalker_heart', 'ash_eclipse', 'primal_ascent')),
  chosen_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, season_id)
);

CREATE TRIGGER IF NOT EXISTS tactics_ranked_premium_showcase_need_pass BEFORE INSERT ON tactics_ranked_premium_showcase
WHEN NOT EXISTS (SELECT 1 FROM tactics_ranked_premium_passes WHERE user_id = NEW.user_id AND season_id = NEW.season_id)
BEGIN
  SELECT RAISE(ABORT, 'ranked premium showcase without a pass');
END;

CREATE TRIGGER IF NOT EXISTS tactics_ranked_premium_showcase_grant AFTER INSERT ON tactics_ranked_premium_showcase
BEGIN
  INSERT INTO tactics_player_cosmetics (user_id, cosmetic_id, kind, source, reference_id, acquired_at)
  VALUES (NEW.user_id, 'showcase_' || NEW.card_id, 'CARD_ART', 'RANKED_PREMIUM', NEW.season_id || ':showcase', NEW.chosen_at)
  ON CONFLICT (user_id, cosmetic_id) DO NOTHING;
END;

CREATE TRIGGER IF NOT EXISTS tactics_ranked_premium_showcase_no_update BEFORE UPDATE ON tactics_ranked_premium_showcase
BEGIN
  SELECT RAISE(ABORT, 'tactics_ranked_premium_showcase is append-only');
END;
