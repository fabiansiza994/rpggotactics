-- Additive recipient restriction. Existing public codes and all redemption history are kept.
ALTER TABLE tactics_promo_codes ADD COLUMN allowed_user_id INTEGER REFERENCES users(id);
-- Enforce the recipient inside the same transaction that writes receipt and ledger.
-- This also protects a rollback to a Worker that does not understand the new column.
CREATE TRIGGER tactics_promo_recipient_check BEFORE INSERT ON tactics_promo_redemptions
WHEN EXISTS (SELECT 1 FROM tactics_promo_codes c WHERE c.id=NEW.promo_code_id
  AND c.allowed_user_id IS NOT NULL AND c.allowed_user_id<>NEW.user_id)
BEGIN
 SELECT RAISE(ABORT, 'promo code not redeemable by this account');
END;
-- A private code cannot accidentally be made public or reassigned by a later admin upsert.
CREATE TRIGGER tactics_promo_recipient_immutable BEFORE UPDATE OF allowed_user_id ON tactics_promo_codes
WHEN OLD.allowed_user_id IS NOT NULL AND NEW.allowed_user_id IS NOT OLD.allowed_user_id
BEGIN
 SELECT RAISE(ABORT, 'private promo recipient is immutable');
END;
