#!/usr/bin/env node
/**
 * QA-only: fund a tactics_qa_* account with test Cristales Arcanos (ledger reason QA_GRANT).
 * Not an API: it runs through `wrangler d1 execute`, so it needs the operator's Cloudflare login.
 *
 *   node scripts/qa-grant.mjs --user tactics_qa_a --amount 2000 --ref phase4a-smoke-a [--remote]
 *
 * Without --remote it targets the local dev database (.wrangler/state, or --persist-to <dir>). Re-running with the same
 * --ref is a no-op (the ledger's unique reference rejects it).
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { qaGrantSql } from './qa-grant-sql.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const remote = args.includes('--remote');
const transactionId = `txn_qa_${randomUUID()}`;
const sql = qaGrantSql({
  username: opt('user') ?? '',
  amount: Number(opt('amount')),
  reference: opt('ref') ?? '',
  transactionId,
  now: Date.now(),
});
const cwd = fileURLToPath(new URL('..', import.meta.url));
const wrangler = (command) =>
  execFileSync(
    fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url)),
    ['d1', 'execute', 'rpggo-auth', remote ? '--remote' : '--local', ...(remote ? [] : ['--persist-to', opt('persist-to') ?? '.wrangler/state']), '--json', '--command', command],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
wrangler(sql);
// Validated by qaGrantSql above, so safe to interpolate.
const result = JSON.parse(
  wrangler(
    `SELECT u.id AS userId, u.username, w.balance, (SELECT COUNT(*) FROM tactics_wallet_ledger WHERE transaction_id = '${transactionId}') AS granted
     FROM users u LEFT JOIN tactics_wallets w ON w.user_id = u.id AND w.currency_id = 'arcane_crystals' WHERE u.username = '${opt('user')}'`,
  ),
)[0]?.results?.[0];
if (!result) throw new Error('No such account.');
// granted 0 = this --ref was already used for this account (nothing changed).
console.log(JSON.stringify({ target: remote ? 'remote' : 'local', ...result, granted: result.granted === 1 }));
