-- Additive: existing orders remain unchanged; no account age/DOB/document collection.
CREATE TABLE tactics_purchase_consents (
  order_id TEXT PRIMARY KEY REFERENCES tactics_real_money_orders(order_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL,
  adult_declared INTEGER NOT NULL CHECK(adult_declared = 1),
  terms_accepted INTEGER NOT NULL CHECK(terms_accepted = 1),
  accepted_at INTEGER NOT NULL
);
CREATE INDEX idx_purchase_consent_user ON tactics_purchase_consents(user_id, accepted_at);
CREATE TRIGGER tactics_purchase_consent_immutable BEFORE UPDATE ON tactics_purchase_consents
BEGIN SELECT RAISE(ABORT, 'purchase consent is immutable'); END;
