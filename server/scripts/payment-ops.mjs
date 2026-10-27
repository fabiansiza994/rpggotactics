#!/usr/bin/env node
/**
 * Real-money operations (ePayco). Prints SQL; with --apply runs it through `wrangler d1 execute`
 * (operator's Cloudflare login), local unless --remote. Run from server/.
 *
 *   node scripts/payment-ops.mjs stuck [--apply --remote]          non-final orders > 15 min
 *   node scripts/payment-ops.mjs review [--apply --remote]         needs_review queue
 *   node scripts/payment-ops.mjs expire-stale [--apply --remote]   stale policy for all accounts
 *   node scripts/payment-ops.mjs candidates [--apply --remote]     orders reconciliation can resolve
 *   node scripts/payment-ops.mjs reconcile --ref <ref_payco> --api <worker origin>
 *        re-delivers ePayco's own signed record (secure.epayco.co validation API) to the webhook;
 *        the Worker verifies the signature/invoice/amount exactly as for a live confirmation.
 *   node scripts/payment-ops.mjs dispute --order rmo_… --reason "contracargo banco" [--apply --remote]
 *   node scripts/payment-ops.mjs reverse --order rmo_… [--apply --remote]   controlled debit (never < 0)
 *   node scripts/payment-ops.mjs package --id crystals_500 [--price 9900] [--active 0|1] [--sort 1] [--base 500] [--bonus 0] [--apply --remote]
 *
 * Nothing here prints keys, tokens or customer data.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { disputeSql, expireStaleSql, packageUpdateSql, reconcileCandidatesSql, reversalSql, reviewQueueSql, stuckOrdersSql } from './payment-ops-sql.mjs';

const [command, ...args] = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const num = (name) => (opt(name) === undefined ? undefined : Number(opt(name)));
const now = Date.now();

if (command === 'reconcile') {
  const ref = opt('ref') ?? '';
  const api = opt('api') ?? '';
  if (!/^[A-Za-z0-9]{6,64}$/.test(ref) || !/^https:\/\//.test(api)) throw new Error('--ref <ref_payco> and --api https://<worker> are required');
  const res = await fetch(`https://secure.epayco.co/validation/v1/reference/${ref}`);
  const body = await res.json();
  if (!body?.success || !body.data) throw new Error(`ePayco has no record for that reference (HTTP ${res.status})`);
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body.data)) if (/^x_[a-z0-9_]+$/.test(k) && (typeof v === 'string' || typeof v === 'number')) form.set(k, String(v));
  const hook = await fetch(`${api}/api/tactics/payments/epayco/confirmation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  console.log('webhook', hook.status, await hook.text());
  process.exit(0);
}

const sql = {
  stuck: () => stuckOrdersSql(now),
  review: () => reviewQueueSql(),
  'expire-stale': () => expireStaleSql(now),
  candidates: () => reconcileCandidatesSql(),
  dispute: () => disputeSql({ order: opt('order'), reason: opt('reason'), now }),
  reverse: () => reversalSql({ order: opt('order'), now, transactionId: `txn_rev_${randomUUID()}` }),
  package: () =>
    packageUpdateSql({
      pkg: opt('id'),
      priceCOP: num('price'),
      active: opt('active') === undefined ? undefined : opt('active') === '1',
      sortOrder: num('sort'),
      baseCrystals: num('base'),
      bonusCrystals: num('bonus'),
      now,
    }),
}[command];
if (!sql) throw new Error(`unknown command "${command}" (see the header of this file)`);
const text = sql();
console.log(text);
if (args.includes('--apply')) {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'rpggo-auth', args.includes('--remote') ? '--remote' : '--local', '--command', text],
    { stdio: 'inherit', cwd: fileURLToPath(new URL('..', import.meta.url)) },
  );
}
