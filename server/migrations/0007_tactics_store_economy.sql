-- Phase 4A: premium currency wallet, immutable ledger, store purchases, cosmetic ownership.
-- Additive only: new tables + triggers; no existing table or RPG-GO table is modified.
-- The store CATALOG is static content (src/game/data/store-catalog.ts), not a table: each
-- purchase row stores a snapshot of the offer it sold.

-- Cached balance per player and currency. Written ONLY by the ledger trigger below: a balance
-- can never change without a ledger row, and can never go negative.
CREATE TABLE IF NOT EXISTS tactics_wallets (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency_id  TEXT    NOT NULL,
  balance      INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, currency_id)
);

-- Append-only ledger: one row per balance change (QA_GRANT, STORE_PURCHASE, later REFUND,
-- PURCHASE_CURRENCY, …). (user_id, currency_id, reason, reference_id) is unique, so the same
-- grant/purchase/refund can never be applied twice.
CREATE TABLE IF NOT EXISTS tactics_wallet_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id  TEXT    NOT NULL UNIQUE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency_id     TEXT    NOT NULL,
  amount_delta    INTEGER NOT NULL CHECK (amount_delta <> 0),
  balance_before  INTEGER NOT NULL CHECK (balance_before >= 0),
  balance_after   INTEGER NOT NULL CHECK (balance_after >= 0),
  reason          TEXT    NOT NULL,
  reference_id    TEXT    NOT NULL,
  note            TEXT,
  created_at      INTEGER NOT NULL,
  CHECK (balance_after = balance_before + amount_delta),
  UNIQUE (user_id, currency_id, reason, reference_id)
);
CREATE INDEX IF NOT EXISTS idx_tactics_wallet_ledger_user ON tactics_wallet_ledger(user_id, id);

-- The row must start from the wallet's real balance (a stale/forged balance_before aborts).
CREATE TRIGGER IF NOT EXISTS tactics_wallet_ledger_check BEFORE INSERT ON tactics_wallet_ledger
BEGIN
  SELECT RAISE(ABORT, 'ledger balance_before does not match the wallet')
  WHERE NEW.balance_before <> COALESCE((SELECT balance FROM tactics_wallets WHERE user_id = NEW.user_id AND currency_id = NEW.currency_id), 0);
END;

-- Applying the row IS the balance change (same statement, so always atomic with it).
CREATE TRIGGER IF NOT EXISTS tactics_wallet_ledger_apply AFTER INSERT ON tactics_wallet_ledger
BEGIN
  INSERT INTO tactics_wallets (user_id, currency_id, balance, updated_at)
  VALUES (NEW.user_id, NEW.currency_id, 0, NEW.created_at)
  ON CONFLICT (user_id, currency_id) DO NOTHING;
  UPDATE tactics_wallets SET balance = balance + NEW.amount_delta, updated_at = NEW.created_at
  WHERE user_id = NEW.user_id AND currency_id = NEW.currency_id;
END;

-- Immutable history. Only RPG-GO account deletion (users row already gone → cascade) removes rows.
CREATE TRIGGER IF NOT EXISTS tactics_wallet_ledger_no_update BEFORE UPDATE ON tactics_wallet_ledger
BEGIN
  SELECT RAISE(ABORT, 'tactics_wallet_ledger is append-only');
END;
CREATE TRIGGER IF NOT EXISTS tactics_wallet_ledger_no_delete BEFORE DELETE ON tactics_wallet_ledger
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
BEGIN
  SELECT RAISE(ABORT, 'tactics_wallet_ledger is append-only');
END;

-- One row per completed store purchase. (user_id, idempotency_key) is unique: a retried request
-- returns this row instead of charging again. offer_json/granted_json = what was sold, as sold.
-- status REFUNDED is reserved for a later compensating REFUND ledger row (no code writes it yet).
CREATE TABLE IF NOT EXISTS tactics_store_purchases (
  purchase_id      TEXT    PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key  TEXT    NOT NULL,
  offer_id         TEXT    NOT NULL,
  currency_id      TEXT    NOT NULL,
  price            INTEGER NOT NULL CHECK (price >= 0),
  status           TEXT    NOT NULL CHECK (status IN ('COMPLETED', 'REFUNDED')),
  offer_json       TEXT    NOT NULL,
  granted_json     TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_tactics_store_purchases_offer ON tactics_store_purchases(user_id, offer_id);

-- Unique cosmetic ownership (summon skins, card backs, frames, alt art, spell VFX, profile).
-- No cosmetic exists yet; the table is ready so the schema never blocks them.
CREATE TABLE IF NOT EXISTS tactics_player_cosmetics (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cosmetic_id   TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  source        TEXT    NOT NULL,
  reference_id  TEXT,
  acquired_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, cosmetic_id)
);
