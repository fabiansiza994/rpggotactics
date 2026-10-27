/**
 * Builds the ONE SQL statement that grants QA test currency. Kept separate from qa-grant.mjs so
 * tests run the exact statement against the real migration.
 *
 * Safety: only `tactics_qa_*` accounts, bounded amount, and an operator-chosen reference id that
 * is UNIQUE per account in the ledger — re-running the same grant is a no-op (OR IGNORE on that UNIQUE key). The
 * ledger trigger applies the balance in the same statement, so it is atomic on its own.
 */
export const QA_USERNAME = /^tactics_qa_[a-z0-9_]{1,24}$/;
export const QA_REFERENCE = /^[a-z0-9][a-z0-9_-]{3,63}$/;
export const QA_MAX_GRANT = 10_000;
export const PREMIUM_CURRENCY_ID = 'arcane_crystals';

export function qaGrantSql({ username, amount, reference, transactionId, now }) {
  if (!QA_USERNAME.test(username)) throw new Error(`Refusing: "${username}" is not a tactics_qa_* account.`);
  if (!Number.isInteger(amount) || amount < 1 || amount > QA_MAX_GRANT) throw new Error(`Amount must be 1..${QA_MAX_GRANT}.`);
  if (!QA_REFERENCE.test(reference)) throw new Error('Reference must match ' + QA_REFERENCE);
  if (!/^txn_qa_[0-9a-f-]{36}$/.test(transactionId)) throw new Error('Bad transaction id.');
  if (!Number.isInteger(now)) throw new Error('Bad timestamp.');
  const c = PREMIUM_CURRENCY_ID;
  return `INSERT OR IGNORE INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, note, created_at)
SELECT '${transactionId}', u.id, '${c}', ${amount}, COALESCE(w.balance, 0), COALESCE(w.balance, 0) + ${amount}, 'QA_GRANT', '${reference}', 'scripts/qa-grant.mjs', ${now}
FROM users u LEFT JOIN tactics_wallets w ON w.user_id = u.id AND w.currency_id = '${c}'
WHERE u.username = '${username}';`;
}
