-- Real-money Cristales Arcanos purchases (ePayco Smart Checkout). Additive only: two new tables +
-- triggers. Crystals are credited ONLY through tactics_wallet_ledger (reason PURCHASE_CURRENCY,
-- reference_id 'EPAYCO:<order_id>'), whose UNIQUE (user, currency, reason, reference) makes a
-- second credit for the same order impossible. No card data is ever stored (ePayco hosts the form).

-- One row per checkout started by a signed-in account. amount/currency/crystals are the server
-- catalog's values at creation time (never the client's). `invoice` is the reference sent to ePayco.
CREATE TABLE IF NOT EXISTS tactics_real_money_orders (
  order_id                 TEXT    PRIMARY KEY,
  user_id                  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id               TEXT    NOT NULL,
  invoice                  TEXT    NOT NULL UNIQUE,
  provider                 TEXT    NOT NULL CHECK (provider IN ('EPAYCO')),
  test_mode                INTEGER NOT NULL CHECK (test_mode IN (0, 1)),
  provider_session_id      TEXT,
  provider_reference       TEXT,
  provider_transaction_id  TEXT,
  amount                   INTEGER NOT NULL CHECK (amount > 0),
  currency                 TEXT    NOT NULL CHECK (currency = 'COP'),
  crystals                 INTEGER NOT NULL CHECK (crystals > 0),
  status                   TEXT    NOT NULL CHECK (status IN ('CREATED', 'PENDING', 'PAID', 'FULFILLED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'DISPUTED')),
  -- Last provider state code seen (x_cod_transaction_state) and its text, for support.
  provider_state           TEXT,
  failure_reason           TEXT,
  -- 1 = a signed webhook disagreed with the order (amount/currency/environment) or a refund
  -- arrived after fulfilment: a human must look at it. Never credited automatically.
  needs_review             INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
  ledger_transaction_id    TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  paid_at                  INTEGER,
  fulfilled_at             INTEGER,
  CHECK ((status = 'FULFILLED') = (fulfilled_at IS NOT NULL) OR status IN ('REFUNDED', 'DISPUTED'))
);
CREATE INDEX IF NOT EXISTS idx_tactics_rm_orders_user ON tactics_real_money_orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tactics_rm_orders_status ON tactics_real_money_orders(status, updated_at);
-- One provider transaction / reference can only ever belong to one order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tactics_rm_orders_txn ON tactics_real_money_orders(provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tactics_rm_orders_ref ON tactics_real_money_orders(provider, provider_reference) WHERE provider_reference IS NOT NULL;

-- Fulfilment happens once: once fulfilled_at is set it can never be set again or cleared, so a
-- second (replayed / concurrent) fulfilment batch aborts as a whole, ledger row included.
CREATE TRIGGER IF NOT EXISTS tactics_rm_orders_fulfil_once BEFORE UPDATE OF fulfilled_at ON tactics_real_money_orders
WHEN OLD.fulfilled_at IS NOT NULL AND (NEW.fulfilled_at IS NULL OR NEW.fulfilled_at <> OLD.fulfilled_at)
BEGIN
  SELECT RAISE(ABORT, 'order already fulfilled');
END;
-- The sale terms are frozen at creation.
CREATE TRIGGER IF NOT EXISTS tactics_rm_orders_terms_frozen BEFORE UPDATE OF user_id, package_id, invoice, amount, currency, crystals, provider, test_mode ON tactics_real_money_orders
BEGIN
  SELECT RAISE(ABORT, 'order terms are immutable');
END;

-- Every confirmation call received (valid or not), for support/debugging. Only provider ids,
-- codes, amount/currency and our verdict: no card data, customer PII, signature or keys.
CREATE TABLE IF NOT EXISTS tactics_payment_events (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  provider                 TEXT    NOT NULL,
  order_id                 TEXT,
  invoice                  TEXT,
  provider_reference       TEXT,
  provider_transaction_id  TEXT,
  state_code               TEXT,
  response_text            TEXT,
  response_reason          TEXT,
  amount                   TEXT,
  currency                 TEXT,
  test_request             TEXT,
  signature_valid          INTEGER NOT NULL CHECK (signature_valid IN (0, 1)),
  outcome                  TEXT    NOT NULL,
  created_at               INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tactics_payment_events_order ON tactics_payment_events(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tactics_payment_events_created ON tactics_payment_events(created_at);
