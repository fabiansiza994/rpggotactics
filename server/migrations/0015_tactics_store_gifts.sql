-- Store gifting: a player buys a store offer for a friend; the friend opens and claims it.
-- Additive only: two new tables + triggers. Wallet, ledger, store, social and RPG-GO tables are
-- untouched (the sender pays through the existing ledger with reason STORE_GIFT_PURCHASE,
-- reference_id = gift_id; the recipient's cards/cosmetics go into the existing ownership tables
-- with source STORE_GIFT when the gift is claimed).
-- Requires 0007 (store) and 0009 (social): the creating transaction re-checks the friendship.

-- One row per gift. reward_snapshot / price_snapshot = what was sold, as sold (a later catalog
-- change never alters a bought gift). UNIQUE (sender_user_id, idempotency_key): a retried or
-- double-clicked request returns this row instead of charging again.
-- Lifecycle: PENDING → CLAIMED. CANCELLED / EXPIRED / REVOKED are reserved for support tooling
-- (no code writes them yet). A gift that cannot be claimed right now stays PENDING.
-- The sender may delete their account: the gift survives (sender_user_id → NULL).
CREATE TABLE IF NOT EXISTS tactics_gifts (
  gift_id            TEXT    PRIMARY KEY,
  sender_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipient_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key    TEXT    NOT NULL,
  product_id         TEXT    NOT NULL,
  status             TEXT    NOT NULL CHECK (status IN ('PENDING', 'CLAIMED', 'CANCELLED', 'EXPIRED', 'REVOKED')),
  currency_id        TEXT    NOT NULL,
  price_snapshot     INTEGER NOT NULL CHECK (price_snapshot > 0),
  reward_snapshot    TEXT    NOT NULL,
  transaction_id     TEXT    NOT NULL,
  message            TEXT    CHECK (message IS NULL OR length(message) BETWEEN 1 AND 120),
  metadata           TEXT,
  created_at         INTEGER NOT NULL,
  claimed_at         INTEGER,
  expires_at         INTEGER,
  updated_at         INTEGER NOT NULL,
  UNIQUE (sender_user_id, idempotency_key),
  CHECK (sender_user_id IS NULL OR sender_user_id <> recipient_user_id),
  CHECK ((status = 'CLAIMED') = (claimed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_tactics_gifts_recipient ON tactics_gifts(recipient_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_tactics_gifts_sender ON tactics_gifts(sender_user_id, created_at);

-- What a gift delivers, one row per line (copy of reward_snapshot in queryable form). Pending
-- lines count against the recipient's copy caps / unique cosmetics, so two friends cannot both
-- gift the last free copy. owner_id = the collection that receives the card (champion or the
-- shared neutral pool '*'); hero_id = the offer's champion.
CREATE TABLE IF NOT EXISTS tactics_gift_items (
  gift_id   TEXT    NOT NULL REFERENCES tactics_gifts(gift_id) ON DELETE CASCADE,
  line      INTEGER NOT NULL,
  kind      TEXT    NOT NULL CHECK (kind IN ('CARD', 'COSMETIC')),
  item_id   TEXT    NOT NULL,
  hero_id   TEXT,
  owner_id  TEXT,
  copies    INTEGER NOT NULL CHECK (copies >= 1),
  PRIMARY KEY (gift_id, line),
  CHECK (kind = 'COSMETIC' OR (hero_id IS NOT NULL AND owner_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_tactics_gift_items_item ON tactics_gift_items(item_id, owner_id);

-- What was sold never changes, and a gift only ever leaves PENDING (CLAIMED is final).
-- sender_user_id may only become NULL (account deletion, ON DELETE SET NULL).
CREATE TRIGGER IF NOT EXISTS tactics_gifts_immutable BEFORE UPDATE ON tactics_gifts
WHEN NEW.gift_id IS NOT OLD.gift_id
  OR NEW.recipient_user_id IS NOT OLD.recipient_user_id
  OR (NEW.sender_user_id IS NOT OLD.sender_user_id AND NEW.sender_user_id IS NOT NULL)
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.product_id IS NOT OLD.product_id
  OR NEW.currency_id IS NOT OLD.currency_id
  OR NEW.price_snapshot IS NOT OLD.price_snapshot
  OR NEW.reward_snapshot IS NOT OLD.reward_snapshot
  OR NEW.transaction_id IS NOT OLD.transaction_id
  OR NEW.message IS NOT OLD.message
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.status <> 'PENDING' AND NEW.status IS NOT OLD.status)
BEGIN
  SELECT RAISE(ABORT, 'tactics_gifts: sold gifts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS tactics_gift_items_no_update BEFORE UPDATE ON tactics_gift_items
BEGIN
  SELECT RAISE(ABORT, 'tactics_gift_items is append-only');
END;
