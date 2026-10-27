-- ePayco phase 2 (production prep). Additive only: one new table, new nullable columns, indexes.
-- Existing orders, events and ledger rows are not rewritten (only backfills of the new columns).

-- Package catalog as data: prices/activation/order change with an UPDATE (server/scripts/payment-ops.mjs),
-- never in payment logic or the frontend. Orders snapshot amount/crystals at creation, so a price
-- change never alters an order already started.
CREATE TABLE IF NOT EXISTS tactics_crystal_packages (
  package_id      TEXT    PRIMARY KEY CHECK (package_id GLOB 'crystals_[0-9a-z]*' AND length(package_id) <= 40),
  display_name    TEXT    NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  base_crystals   INTEGER NOT NULL CHECK (base_crystals > 0),
  bonus_crystals  INTEGER NOT NULL DEFAULT 0 CHECK (bonus_crystals >= 0),
  price_cop       INTEGER NOT NULL CHECK (price_cop > 0),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);
-- Phase-1 sandbox values (provisional; final prices pending approval, qa/epayco-phase2/REPORT.md).
INSERT OR IGNORE INTO tactics_crystal_packages (package_id, display_name, base_crystals, bonus_crystals, price_cop, active, sort_order, updated_at) VALUES
  ('crystals_500',  '500 Cristales Arcanos',   500,  0,  9900, 1, 1, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('crystals_1200', '1.200 Cristales Arcanos', 1200, 0, 19900, 1, 2, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('crystals_2700', '2.700 Cristales Arcanos', 2700, 0, 39900, 1, 3, CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('crystals_6000', '6.000 Cristales Arcanos', 6000, 0, 79900, 1, 4, CAST(strftime('%s','now') AS INTEGER) * 1000);

-- Orders: tax model (policy undecided: gross = what the player pays; tax/net stay NULL until the
-- merchant defines IVA), refund/dispute/reconciliation bookkeeping.
ALTER TABLE tactics_real_money_orders ADD COLUMN gross_amount INTEGER;
ALTER TABLE tactics_real_money_orders ADD COLUMN tax_amount INTEGER;
ALTER TABLE tactics_real_money_orders ADD COLUMN net_amount INTEGER;
ALTER TABLE tactics_real_money_orders ADD COLUMN tax_policy TEXT;
ALTER TABLE tactics_real_money_orders ADD COLUMN review_reason TEXT;
ALTER TABLE tactics_real_money_orders ADD COLUMN refunded_at INTEGER;
ALTER TABLE tactics_real_money_orders ADD COLUMN disputed_at INTEGER;
ALTER TABLE tactics_real_money_orders ADD COLUMN expired_at INTEGER;
ALTER TABLE tactics_real_money_orders ADD COLUMN last_reconciled_at INTEGER;
UPDATE tactics_real_money_orders SET gross_amount = amount, tax_policy = 'UNDECIDED' WHERE gross_amount IS NULL;
CREATE INDEX IF NOT EXISTS idx_tactics_rm_orders_review ON tactics_real_money_orders(needs_review, updated_at);

-- Audit: what kind of event, from where, and whether it changed anything. A state transition
-- (FULFILLED / REFUNDED / DISPUTED / EXPIRED) is processed at most once per order: the partial unique
-- index rejects a second processed row, so a repeated refund/dispute is recorded as processed = 0.
ALTER TABLE tactics_payment_events ADD COLUMN event_type TEXT;
ALTER TABLE tactics_payment_events ADD COLUMN source TEXT NOT NULL DEFAULT 'WEBHOOK';
ALTER TABLE tactics_payment_events ADD COLUMN processed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tactics_payment_events ADD COLUMN detail TEXT;
UPDATE tactics_payment_events SET event_type = 'FULFILLED', processed = 1 WHERE outcome = 'FULFILLED' AND event_type IS NULL;
UPDATE tactics_payment_events SET event_type = 'CONFIRMATION' WHERE event_type IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tactics_payment_events_transition
  ON tactics_payment_events(order_id, event_type)
  WHERE processed = 1 AND event_type IN ('FULFILLED', 'REFUNDED', 'DISPUTED', 'EXPIRED');
