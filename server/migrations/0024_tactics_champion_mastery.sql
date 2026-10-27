-- Champion Mastery v0.1: XP per account and champion, an append-only grant ledger, one-time
-- level rewards and the equipped title. Additive only. Level is NOT stored: it is derived from
-- xp (src/game/mastery/mastery.ts). Titles are NOT stored either: a title is unlocked when the
-- champion's level reaches it. No backfill: every account starts at 0 XP (Maestría 1).

-- Total XP per champion. Written ONLY by the ledger trigger below.
CREATE TABLE IF NOT EXISTS tactics_champion_mastery (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hero_id     TEXT    NOT NULL,
  xp          INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, hero_id)
);

-- One row per XP grant. (user, hero, source, reference) is the idempotency key: a retried
-- victory, a repeated PvP finish or a reconnect inserts nothing and XP never moves twice.
-- `day` (UTC yyyy-mm-dd) supports the daily cap on repeatable PvE XP.
CREATE TABLE IF NOT EXISTS tactics_mastery_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hero_id       TEXT    NOT NULL,
  source        TEXT    NOT NULL,
  reference_id  TEXT    NOT NULL,
  xp            INTEGER NOT NULL CHECK (xp > 0),
  day           TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (user_id, hero_id, source, reference_id)
);
CREATE INDEX IF NOT EXISTS idx_tactics_mastery_ledger_day ON tactics_mastery_ledger(user_id, hero_id, source, day);

CREATE TRIGGER IF NOT EXISTS tactics_mastery_ledger_apply AFTER INSERT ON tactics_mastery_ledger
BEGIN
  INSERT INTO tactics_champion_mastery (user_id, hero_id, xp, updated_at)
  VALUES (NEW.user_id, NEW.hero_id, 0, NEW.created_at)
  ON CONFLICT (user_id, hero_id) DO NOTHING;
  UPDATE tactics_champion_mastery SET xp = xp + NEW.xp, updated_at = NEW.created_at
  WHERE user_id = NEW.user_id AND hero_id = NEW.hero_id;
END;
CREATE TRIGGER IF NOT EXISTS tactics_mastery_ledger_no_update BEFORE UPDATE ON tactics_mastery_ledger
BEGIN
  SELECT RAISE(ABORT, 'tactics_mastery_ledger is append-only');
END;

-- Level reward reached (one row per champion and level, ever). Crystal rewards are paid by the
-- trigger as a MASTERY_REWARD wallet ledger row (reference "<hero>:<level>"), the only way a
-- balance changes; the ledger's own UNIQUE key is the last guard against a double payment.
CREATE TABLE IF NOT EXISTS tactics_mastery_rewards (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hero_id     TEXT    NOT NULL,
  level       INTEGER NOT NULL,
  crystals    INTEGER NOT NULL CHECK (crystals >= 0),
  reached_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, hero_id, level)
);
CREATE TRIGGER IF NOT EXISTS tactics_mastery_rewards_pay AFTER INSERT ON tactics_mastery_rewards
WHEN NEW.crystals > 0
BEGIN
  INSERT INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, note, created_at)
  SELECT lower(hex(randomblob(16))), NEW.user_id, 'arcane_crystals', NEW.crystals, b, b + NEW.crystals, 'MASTERY_REWARD',
         NEW.hero_id || ':' || NEW.level, 'Maestría ' || NEW.level || ' · ' || NEW.hero_id, NEW.reached_at
  FROM (SELECT COALESCE((SELECT balance FROM tactics_wallets WHERE user_id = NEW.user_id AND currency_id = 'arcane_crystals'), 0) AS b)
  WHERE NOT EXISTS (SELECT 1 FROM tactics_wallet_ledger WHERE user_id = NEW.user_id AND currency_id = 'arcane_crystals'
                    AND reason = 'MASTERY_REWARD' AND reference_id = NEW.hero_id || ':' || NEW.level);
END;

-- One global equipped title per account (id from the catalog; validated against the level on equip).
CREATE TABLE IF NOT EXISTS tactics_profile_titles (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  title_id    TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL
);
