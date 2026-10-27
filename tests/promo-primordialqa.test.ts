import { beforeEach, describe, expect, it } from 'vitest';
import { COSMETICS, DEFAULT_CONTENT, describePromoGrant } from '../src/game';
import { handle } from '../server/src/index';
import { promoCodeSql } from '../server/scripts/promo-code-sql.mjs';
import { addAccount, memoryD1 } from './support/d1';

/**
 * PRIMORDIALQA (QA for the Dragón Primordial ritual + its Store pack): 1500 Arcane Crystals, active,
 * one redemption per account (the existing UNIQUE user+code rule), no expiry, no global cap.
 * Created with the exact admin statement the operator runs remotely (server/scripts/promo-code.mjs).
 */
export const PRIMORDIALQA = {
  code: 'PRIMORDIALQA',
  reward: { type: 'ARCANE_CRYSTALS', amount: 1500 },
  note: 'QA: Ritual del Dragón Primordial + Store pack',
} as const;
const SEEDED = ['WELCOME30', 'TACTICS100', 'WARDRAGON', 'WARRIOROATH', 'ARCANEGIFT', 'RITUALSTART', 'FRIENDS2026', 'THANKYOU', 'FOUNDERSGIFT'];

let db: ReturnType<typeof memoryD1>;
let ids = 0;
const NOW = 1_800_000_000_000;
const deps = () => ({
  content: DEFAULT_CONTENT,
  now: () => NOW,
  seed: () => 7,
  store: { catalog: [], cosmetics: COSMETICS, newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` },
});
type Body = { success?: boolean; code?: string; reward?: { items: { kind: string; label: string; amount: number }[] }; wallet: { balance: number }; error?: { result: string } };
async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await handle(
    new Request(`https://api.test/api/tactics${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    { DB: db, WARRIOR_ENABLED: '1', SUMMONER_RITUALS_ENABLED: '1', PRIMORDIAL_DRAGON_ENABLED: '1' },
    deps(),
  );
  return { status: res.status, body: (await res.json()) as Body };
}
async function player(username: string) {
  const a = addAccount(db, username);
  await call(a.token, 'POST', '/profile', {});
  return a;
}
const ledger = (userId: number) =>
  db.sql.prepare("SELECT amount_delta, reason FROM tactics_wallet_ledger WHERE user_id = ? AND reason = 'PROMO_GRANT'").all(userId);
const codes = () => db.sql.prepare('SELECT code, is_active, starts_at, expires_at, max_global_uses, reward_json, uses FROM tactics_promo_codes ORDER BY code').all();

beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
});

describe('PRIMORDIALQA promo code', () => {
  it('admin SQL creates it active, no window, no global cap, 1500 crystals; existing codes untouched', () => {
    const before = codes();
    db.sql.exec(promoCodeSql({ ...PRIMORDIALQA, now: NOW }));
    const after = codes();
    expect(after.filter((r) => r.code !== 'PRIMORDIALQA')).toEqual(before);
    expect(before.map((r) => r.code)).toEqual(expect.arrayContaining(SEEDED));
    expect(after.find((r) => r.code === 'PRIMORDIALQA')).toEqual({
      code: 'PRIMORDIALQA',
      is_active: 1,
      starts_at: null,
      expires_at: null,
      max_global_uses: null,
      reward_json: '{"type":"ARCANE_CRYSTALS","amount":1500}',
      uses: 0,
    });
  });

  it('+1500 once per account through one PROMO_GRANT ledger row; retries rejected; another account can use it once; balance persists', async () => {
    db.sql.exec(promoCodeSql({ ...PRIMORDIALQA, now: NOW }));
    const a = await player('tactics_qa_a'),
      b = await player('tactics_qa_b');
    const first = await call(a.token, 'POST', '/store/promo/redeem', { code: 'primordial-qa' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ success: true, code: 'PRIMORDIALQA', wallet: { balance: 1500 } });
    expect(first.body.reward!.items).toEqual([{ kind: 'CURRENCY', id: 'arcane_crystals', label: '1.500 Cristales Arcanos', amount: 1500 }]);
    const again = await call(a.token, 'POST', '/store/promo/redeem', { code: 'PRIMORDIALQA' });
    expect(again.body.success).not.toBe(true);
    expect(again.body.error?.result).toBe('ALREADY_REDEEMED');
    expect(ledger(a.id)).toEqual([{ amount_delta: 1500, reason: 'PROMO_GRANT' }]);
    // Refresh / new request: the stored balance is unchanged.
    expect((await call(a.token, 'GET', '/wallet')).body.wallet.balance).toBe(1500);
    expect((await call(b.token, 'POST', '/store/promo/redeem', { code: 'PRIMORDIALQA' })).body.wallet.balance).toBe(1500);
    expect((await call(b.token, 'POST', '/store/promo/redeem', { code: 'PRIMORDIALQA' })).body.error?.result).toBe('ALREADY_REDEEMED');
    expect(ledger(b.id)).toHaveLength(1);
    expect(db.sql.prepare("SELECT uses FROM tactics_promo_codes WHERE code = 'PRIMORDIALQA'").get()).toEqual({ uses: 2 });
    // Existing codes still work independently.
    expect((await call(a.token, 'POST', '/store/promo/redeem', { code: 'WELCOME30' })).body.wallet.balance).toBe(1800);
  });

  it('visible message: «Recibiste 1.500 Cristales Arcanos.»', async () => {
    expect(describePromoGrant({ crystals: 1500, cards: [], cosmetics: [] }, DEFAULT_CONTENT, COSMETICS)[0]!.label).toBe('1.500 Cristales Arcanos');
    expect(describePromoGrant({ crystals: 300, cards: [], cosmetics: [] }, DEFAULT_CONTENT, COSMETICS)[0]!.label).toBe('300 Cristales Arcanos');
    expect(describePromoGrant({ crystals: 10000, cards: [], cosmetics: [] }, DEFAULT_CONTENT, COSMETICS)[0]!.label).toBe('10.000 Cristales Arcanos');
  });
});
