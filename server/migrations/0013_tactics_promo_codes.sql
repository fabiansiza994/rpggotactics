-- Gift / promo codes. Additive only: three new tables + triggers; wallet, store and RPG-GO tables
-- are untouched (crystals go through the existing ledger with reason PROMO_GRANT).
-- Codes are created by migration/seed or the admin script (server/scripts/promo-code-sql.mjs);
-- there is no endpoint that creates codes or grants arbitrary rewards.

-- One row per code. `code` is the normalised text (A-Z0-9, 4–32 chars: see normalizePromoCode).
-- `uses` counts redemptions; the CHECK makes the global cap part of the redeeming transaction,
-- so redemption N+1 of an N-use code aborts even under concurrency.
CREATE TABLE IF NOT EXISTS tactics_promo_codes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT    NOT NULL UNIQUE CHECK (length(code) BETWEEN 4 AND 32 AND code NOT GLOB '*[^A-Z0-9]*'),
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  starts_at        INTEGER,
  expires_at       INTEGER,
  max_global_uses  INTEGER CHECK (max_global_uses IS NULL OR max_global_uses > 0),
  uses             INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0 AND (max_global_uses IS NULL OR uses <= max_global_uses)),
  reward_json      TEXT    NOT NULL,
  note             TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  CHECK (starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at)
);

-- One row per successful redemption = the audit of what was granted. UNIQUE (user_id,
-- promo_code_id) is the one-use-per-account rule and makes a retried/double request harmless.
-- status exists only so the redeeming batch can abort itself from a final guard (set to NULL).
CREATE TABLE IF NOT EXISTS tactics_promo_redemptions (
  redemption_id   TEXT    PRIMARY KEY,
  promo_code_id   INTEGER NOT NULL REFERENCES tactics_promo_codes(id),
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code            TEXT    NOT NULL,
  status          TEXT    NOT NULL CHECK (status = 'COMPLETED'),
  reward_json     TEXT    NOT NULL,
  transaction_id  TEXT,
  redeemed_at     INTEGER NOT NULL,
  UNIQUE (user_id, promo_code_id)
);
CREATE INDEX IF NOT EXISTS idx_tactics_promo_redemptions_code ON tactics_promo_redemptions(promo_code_id);

-- Re-checked inside the transaction: a code deactivated or out of its window between the server's
-- read and the write cannot be redeemed.
CREATE TRIGGER IF NOT EXISTS tactics_promo_redemptions_check BEFORE INSERT ON tactics_promo_redemptions
BEGIN
  SELECT RAISE(ABORT, 'promo code not redeemable')
  WHERE NOT EXISTS (
    SELECT 1 FROM tactics_promo_codes c
    WHERE c.id = NEW.promo_code_id AND c.is_active = 1
      AND (c.starts_at IS NULL OR NEW.redeemed_at >= c.starts_at)
      AND (c.expires_at IS NULL OR NEW.redeemed_at < c.expires_at)
  );
END;

-- Counting IS part of the insert (the uses CHECK above enforces the global cap).
CREATE TRIGGER IF NOT EXISTS tactics_promo_redemptions_count AFTER INSERT ON tactics_promo_redemptions
BEGIN
  UPDATE tactics_promo_codes SET uses = uses + 1, updated_at = NEW.redeemed_at WHERE id = NEW.promo_code_id;
END;

-- History is kept; only RPG-GO account deletion (users row already gone → cascade) removes rows.
-- The code's `uses` is never decremented, so deleting accounts cannot reopen a capped code.
CREATE TRIGGER IF NOT EXISTS tactics_promo_redemptions_no_delete BEFORE DELETE ON tactics_promo_redemptions
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
BEGIN
  SELECT RAISE(ABORT, 'tactics_promo_redemptions is append-only');
END;

-- Recent redeem attempts (successes and failures) for rate limiting and short-term audit. The
-- Worker prunes a user's rows older than 7 days; no session/token data is stored.
CREATE TABLE IF NOT EXISTS tactics_promo_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code        TEXT,
  result      TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tactics_promo_attempts_user ON tactics_promo_attempts(user_id, created_at);

-- Initial catalog (qa/promo-codes/CODES.md). Rewards are validated again at every redemption
-- against the released content, so a code naming missing content can never grant it.
-- FOUNDERSGIFT names a founder frame that does not exist yet: seeded INACTIVE.
INSERT OR IGNORE INTO tactics_promo_codes (code, is_active, starts_at, expires_at, max_global_uses, reward_json, note, created_at, updated_at) VALUES
  ('WELCOME30',    1, NULL, NULL, NULL, '{"type":"ARCANE_CRYSTALS","amount":300}', 'Welcome gift', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('TACTICS100',   1, NULL, NULL, NULL, '{"type":"ARCANE_CRYSTALS","amount":100}', NULL, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('WARDRAGON',    1, NULL, NULL, NULL, '{"type":"CARD","cardId":"summon_war_drake","copies":1}', 'Invocar Dragón de Guerra', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('WARRIOROATH',  1, NULL, NULL, NULL, '{"type":"CARD","cardId":"execution","copies":1}', 'Ejecución', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('ARCANEGIFT',   1, NULL, NULL, NULL, '{"type":"CARD","cardId":"frost_nova","copies":1}', 'Frost Nova', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('RITUALSTART',  1, NULL, NULL, NULL, '{"type":"MULTI","items":[{"type":"CARD","cardId":"rune_stone","copies":1},{"type":"CARD","cardId":"rune_shell","copies":1}]}', 'Minor ritual pieces (Caparazón Ancestral)', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('FRIENDS2026',  1, NULL, NULL, NULL, '{"type":"ARCANE_CRYSTALS","amount":150}', NULL, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('THANKYOU',     1, NULL, NULL, NULL, '{"type":"ARCANE_CRYSTALS","amount":200}', NULL, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('FOUNDERSGIFT', 0, NULL, NULL, NULL, '{"type":"COSMETIC","cosmeticId":"frame_founder"}', 'Inactive until a founder frame exists in the cosmetics registry', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
