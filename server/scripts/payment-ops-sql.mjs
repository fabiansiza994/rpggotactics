/**
 * Real-money operations as plain SQL (no admin API exists). Pure functions: every value is
 * validated here and emitted as a literal, so the CLI can print the SQL for review before --apply.
 * Mirrors server/src/epayco.ts (STALE policy, event rules). Tested in tests/epayco-ops.test.ts.
 */

export const STALE = { createdMs: 60 * 60_000, pendingNoReferenceMs: 24 * 60 * 60_000, reviewMs: 72 * 60 * 60_000 };

const ORDER_ID = /^rmo_[0-9a-f-]{36}$/;
const PACKAGE_ID = /^crystals_[0-9a-z]{1,31}$/;
const REASON = /^[A-Za-z0-9 _.,:-]{1,80}$/;
const int = (v, name, min = 0) => {
  if (!Number.isInteger(v) || v < min) throw new Error(`${name} must be an integer ≥ ${min}`);
  return v;
};
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const orderId = (id) => {
  if (!ORDER_ID.test(id ?? '')) throw new Error('orderId must look like rmo_<uuid>');
  return lit(id);
};
const packageId = (id) => {
  if (!PACKAGE_ID.test(id ?? '')) throw new Error('packageId must look like crystals_<id>');
  return lit(id);
};

/** Non-final orders older than `olderThanMs` (no customer data). */
export const stuckOrdersSql = (now, olderThanMs = 15 * 60_000) =>
  `SELECT order_id, user_id, package_id, amount, status, provider_reference IS NOT NULL AS has_reference, needs_review, datetime(created_at/1000,'unixepoch') AS created
FROM tactics_real_money_orders WHERE status IN ('CREATED','PENDING','PAID') AND created_at < ${int(now - olderThanMs, 'cutoff')} ORDER BY created_at;`;

export const reviewQueueSql = () =>
  `SELECT order_id, user_id, package_id, amount, crystals, status, review_reason, failure_reason, datetime(updated_at/1000,'unixepoch') AS updated
FROM tactics_real_money_orders WHERE needs_review = 1 ORDER BY updated_at;`;

/** Same rules as expireStaleStatements in server/src/epayco.ts, for every account. */
export function expireStaleSql(now) {
  int(now, 'now', 1);
  const stale = `fulfilled_at IS NULL AND ((status = 'CREATED' AND created_at < ${now - STALE.createdMs}) OR (status = 'PENDING' AND provider_reference IS NULL AND created_at < ${now - STALE.pendingNoReferenceMs}))`;
  return `INSERT OR IGNORE INTO tactics_payment_events (provider, order_id, invoice, event_type, source, processed, signature_valid, outcome, created_at)
  SELECT provider, order_id, invoice, 'EXPIRED', 'POLICY', 1, 0, 'EXPIRED_STALE', ${now} FROM tactics_real_money_orders WHERE ${stale};
UPDATE tactics_real_money_orders SET status = 'EXPIRED', expired_at = ${now}, failure_reason = COALESCE(failure_reason, 'STALE'), updated_at = ${now} WHERE ${stale};
UPDATE tactics_real_money_orders SET needs_review = 1, review_reason = COALESCE(review_reason, 'STALE_PENDING_WITH_REFERENCE'), updated_at = ${now}
  WHERE status = 'PENDING' AND provider_reference IS NOT NULL AND needs_review = 0 AND created_at < ${now - STALE.reviewMs};`;
}

/**
 * Chargeback / dispute reported by ePayco or the bank (no documented webhook state exists for it).
 * One processed DISPUTED event per order (unique index); a repeat changes nothing.
 */
export function disputeSql({ order, reason, now }) {
  if (!REASON.test(reason ?? '')) throw new Error('reason: 1–80 plain characters');
  int(now, 'now', 1);
  const id = orderId(order);
  return `INSERT OR IGNORE INTO tactics_payment_events (provider, order_id, invoice, provider_reference, amount, currency, event_type, source, processed, signature_valid, outcome, detail, created_at)
  SELECT provider, order_id, invoice, provider_reference, CAST(amount AS TEXT), currency, 'DISPUTED', 'ADMIN', 1, 0, 'DISPUTED', ${lit(reason)}, ${now}
  FROM tactics_real_money_orders WHERE order_id = ${id};
UPDATE tactics_real_money_orders SET status = 'DISPUTED', disputed_at = ${now}, needs_review = 1, review_reason = ${lit(`DISPUTE: ${reason}`)}, updated_at = ${now}
  WHERE order_id = ${id} AND status <> 'DISPUTED';`;
}

/**
 * Controlled reversal after a refund/dispute: debits the order's crystals ONCE (unique ledger
 * reference) and only if the player still has them — the ledger trigger/CHECK aborts the whole
 * statement when the balance would go below 0, so it can never break later purchases. Never automatic.
 */
export function reversalSql({ order, now, transactionId }) {
  int(now, 'now', 1);
  if (!/^txn_rev_[A-Za-z0-9-]{8,64}$/.test(transactionId ?? '')) throw new Error('transactionId must look like txn_rev_<id>');
  const id = orderId(order);
  return `INSERT INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, note, created_at)
  SELECT ${lit(transactionId)}, o.user_id, 'arcane_crystals', -o.crystals, COALESCE(w.balance, 0), COALESCE(w.balance, 0) - o.crystals, 'REAL_MONEY_REVERSAL', 'EPAYCO:' || o.order_id,
         json_object('provider', o.provider, 'orderId', o.order_id, 'crystals', o.crystals, 'status', o.status), ${now}
  FROM tactics_real_money_orders o LEFT JOIN tactics_wallets w ON w.user_id = o.user_id AND w.currency_id = 'arcane_crystals'
  WHERE o.order_id = ${id} AND o.status IN ('REFUNDED', 'DISPUTED') AND o.fulfilled_at IS NOT NULL;
UPDATE tactics_real_money_orders SET review_reason = 'REVERSED_BY_ADMIN', updated_at = ${now} WHERE order_id = ${id} AND status IN ('REFUNDED', 'DISPUTED');`;
}

/** Price / activation / order / bonus of one package (affects NEW orders only). */
export function packageUpdateSql({ pkg, priceCOP, active, sortOrder, baseCrystals, bonusCrystals, now }) {
  const id = packageId(pkg);
  int(now, 'now', 1);
  const sets = [];
  if (priceCOP !== undefined) sets.push(`price_cop = ${int(priceCOP, 'priceCOP', 1)}`);
  if (active !== undefined) sets.push(`active = ${active ? 1 : 0}`);
  if (sortOrder !== undefined) sets.push(`sort_order = ${int(sortOrder, 'sortOrder')}`);
  if (baseCrystals !== undefined) sets.push(`base_crystals = ${int(baseCrystals, 'baseCrystals', 1)}`);
  if (bonusCrystals !== undefined) sets.push(`bonus_crystals = ${int(bonusCrystals, 'bonusCrystals')}`);
  if (!sets.length) throw new Error('nothing to change');
  return `UPDATE tactics_crystal_packages SET ${sets.join(', ')}, updated_at = ${now} WHERE package_id = ${id};`;
}

/** Orders that reconciliation can resolve (ePayco gave us a reference but never a final state). */
export const reconcileCandidatesSql = () =>
  `SELECT order_id, provider_reference, status FROM tactics_real_money_orders
WHERE status IN ('CREATED','PENDING','EXPIRED') AND fulfilled_at IS NULL AND provider_reference IS NOT NULL ORDER BY created_at;`;
