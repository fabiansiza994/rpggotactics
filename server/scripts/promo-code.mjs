#!/usr/bin/env node
/**
 * Admin: create or update ONE promo code (no API exists for this). Prints the SQL; with --apply it
 * runs it through `wrangler d1 execute` (operator's Cloudflare login), local unless --remote.
 *
 *   node scripts/promo-code.mjs --code SPRING2027 --reward '{"type":"ARCANE_CRYSTALS","amount":150}' \
 *     [--expires 2027-06-01T00:00:00Z] [--starts …] [--max 1000] [--inactive] [--note "…"] [--apply [--remote]]
 *
 * Deactivate without deleting history: re-run with the same reward and --inactive.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promoCodeSql } from './promo-code-sql.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const time = (name) => {
  const v = opt(name);
  if (v === undefined) return null;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) throw new Error(`--${name} must be an ISO date.`);
  return ms;
};
const sql = promoCodeSql({
  code: (opt('code') ?? '').toUpperCase(),
  reward: JSON.parse(opt('reward') ?? 'null'),
  active: !args.includes('--inactive'),
  startsAt: time('starts'),
  expiresAt: time('expires'),
  maxGlobalUses: opt('max') === undefined ? null : Number(opt('max')),
  note: opt('note') ?? null,
  now: Date.now(),
});
console.log(sql);
if (args.includes('--apply')) {
  const remote = args.includes('--remote');
  execFileSync(
    fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url)),
    ['d1', 'execute', 'rpggo-auth', remote ? '--remote' : '--local', ...(remote ? [] : ['--persist-to', opt('persist-to') ?? '.wrangler/state']), '--command', sql],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' },
  );
}
