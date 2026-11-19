CREATE TABLE tactics_paypal_orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  crystals INTEGER NOT NULL CHECK (crystals > 0),
  usd TEXT NOT NULL,
  paypal_order_id TEXT UNIQUE,
  checkout_url TEXT,
  capture_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','APPROVED','PENDING','DECLINED','FULFILLED','REVIEW')),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, operation_id)
);

CREATE INDEX tactics_paypal_history ON tactics_paypal_orders(user_id, created_at DESC);

CREATE TABLE tactics_paypal_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  paypal_order_id TEXT,
  capture_id TEXT,
  resource_id TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX tactics_paypal_event_order ON tactics_paypal_events(paypal_order_id);
CREATE INDEX tactics_paypal_event_capture ON tactics_paypal_events(capture_id);
