import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ASCENT_CAMPAIGN,
  campaignBattleContent,
  currentEncounter,
  DEFAULT_CONTENT,
  DECK_RULES,
  GameEngine,
  PREMIUM_CURRENCY_ID,
  type PlayerProfile,
  type RunState,
} from '../src/game';
import { handle } from '../server/src/index';
import { creditedRewards, rewardDay, victoryCrystalStatements } from '../server/src/economy';
import { walletBalance, ledgerStatement } from '../server/src/store';
import { addAccount, memoryD1 } from './support/d1';
import { playBattle } from './support/bot';
import { CrystalPurchaseModal } from '../src/presentation/shop/CrystalPurchaseModal';
import { EarnCrystalsModal } from '../src/presentation/shop/EarnCrystalsModal';
let db: ReturnType<typeof memoryD1>;
let now: number;
let id = 0;
const newId = () => `economy-${++id}`;
const day = Date.UTC(2026, 9, 20, 12);
const victory = {
  heroId: 'mage',
  campaignId: ASCENT_CAMPAIGN.id,
  encounterId: 'ascent_03_open_field',
};
beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
  now = day;
  id = 0;
});
async function call(token: string | null, method: string, path: string, body?: unknown) {
  return handle(
    new Request(`https://api.test/api/tactics${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { DB: db },
    {
      content: DEFAULT_CONTENT,
      now: () => now,
      seed: () => 7,
      store: { newId, catalog: [], cosmetics: {} },
    },
  );
}
async function grant(user: number, v = victory) {
  const plan = victoryCrystalStatements(db, user, now, v, newId);
  await db.batch(plan.statements);
  return creditedRewards(db, user, plan.rewards);
}
describe('free economy authoritative ledger', () => {
  it('preserves balance, grants daily once per account across heroes and resets on UTC server day', async () => {
    const a = addAccount(db, 'daily');
    await db.batch([
      ledgerStatement(db, {
        transactionId: newId(),
        userId: a.id,
        currencyId: PREMIUM_CURRENCY_ID,
        delta: 123,
        reason: 'QA_GRANT',
        referenceId: 'existing',
        now,
      }),
    ]);
    const v = { ...victory, encounterId: 'ascent_01_guard_post' };
    expect((await grant(a.id, v)).map((r) => r.amount)).toEqual([40]);
    expect(await grant(a.id, { ...v, heroId: 'summoner' })).toEqual([]);
    expect(await walletBalance(db, a.id, PREMIUM_CURRENCY_ID)).toBe(163);
    now += 86400000;
    expect((await grant(a.id, v)).map((r) => r.amount)).toEqual([40]);
    expect(rewardDay(Date.UTC(2026, 9, 20, 23, 59, 59))).toBe('2026-10-20');
  });
  it('concurrent rewards pay one daily and one milestone; retry and historical clears do not repay', async () => {
    const a = addAccount(db, 'milestone');
    // Use the real encounter ID rather than trusting a display number.
    const encounter = ASCENT_CAMPAIGN.encounters[2]!;
    const v = { ...victory, encounterId: encounter.id };
    await Promise.all([grant(a.id, v), grant(a.id, v)]);
    expect(await walletBalance(db, a.id, PREMIUM_CURRENCY_ID)).toBe(70);
    expect(
      db.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM tactics_wallet_ledger WHERE reason='CAMPAIGN_MILESTONE'",
        )
        .get(),
    ).toMatchObject({ n: 1 });
    const old = addAccount(db, 'old');
    db.sql
      .prepare(
        `INSERT INTO tactics_reward_log(user_id,campaign_id,hero_id,run_seed,encounter_id,pool,event,offered_json,chosen_json,pity_before,pity_after,created_at) VALUES(?,?,?,1,?,'NORMAL','NO_DROP',NULL,NULL,0,0,1)`,
      )
      .run(old.id, v.campaignId, v.heroId, v.encounterId);
    expect((await grant(old.id, v)).map((r) => r.reason)).toEqual(['DAILY_FIRST_WIN']);
    const legacy = addAccount(db, 'legacy-null-hero');
    db.sql.prepare(`INSERT INTO tactics_reward_log(user_id,campaign_id,hero_id,run_seed,encounter_id,pool,event,offered_json,chosen_json,pity_before,pity_after,created_at) VALUES(?,?,NULL,1,?,'NORMAL','NO_DROP',NULL,NULL,0,0,1)`).run(legacy.id,v.campaignId,v.encounterId);
    expect((await grant(legacy.id,v)).map(r=>r.reason)).toEqual(['DAILY_FIRST_WIN']);
  });
  it('invalid/unverified victory cannot grant; verified victory and retry use the real route atomically', async () => {
    const a = addAccount(db, 'route');
    await call(a.token, 'POST', '/profile', {});
    await call(a.token, 'POST', '/campaign/start', { heroId: 'mage' });
    const state = (await (await call(a.token, 'GET', '/state')).json()) as {
      profile: PlayerProfile;
      run: RunState;
    };
    expect(
      (await call(a.token, 'POST', '/campaign/victory', { proof: { seed: 1, commands: [] } }))
        .status,
    ).toBe(422);
    expect(await walletBalance(db, a.id, PREMIUM_CURRENCY_ID)).toBe(0);
    const engine = new GameEngine(
      currentEncounter(ASCENT_CAMPAIGN, state.run),
      campaignBattleContent(DEFAULT_CONTENT, state.profile, state.run, DECK_RULES),
      1,
    );
    playBattle(engine, 30);
    expect(engine.state.outcome?.result).toBe('WON');
    const proof = {
      encounterId: state.run.currentEncounterId,
      seed: 1,
      commands: JSON.parse(JSON.stringify(engine.history)),
    };
    const res = await call(a.token, 'POST', '/campaign/victory', { proof });
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      wallet: { balance: number };
      crystalRewards: { amount: number }[];
    };
    expect(result.wallet.balance).toBe(40);
    expect(result.crystalRewards[0]!.amount).toBe(40);
    now += 86400000;
    expect((await call(a.token, 'POST', '/campaign/victory', { proof })).status).toBe(200);
    expect(await walletBalance(db, a.id, PREMIUM_CURRENCY_ID)).toBe(40);
  });
  it('payment flag defaults off; checkout and public package catalog never touch orders', async () => {
    const a = addAccount(db, 'nopayment');
    const result = await call(a.token, 'POST', '/store/real-money/checkout', {
      packageId: 'anything',
    });
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ error: { code: 'PAYMENTS_DISABLED' } });
    const catalog = await (await call(null, 'GET', '/store/real-money/packages')).json();
    expect(catalog).toMatchObject({ available: false, packages: [] });
    expect(await walletBalance(db, a.id, PREMIUM_CURRENCY_ID)).toBe(0);
  });
  it('hides purchase UI while keeping a real-source earn panel', () => {
    expect(
      renderToStaticMarkup(
        createElement(CrystalPurchaseModal, {
          open: true,
          onClose: () => {},
          token: null,
          onWallet: () => {},
          onAuthExpired: () => {},
        }),
      ),
    ).toBe('');
    const html = renderToStaticMarkup(
      createElement(EarnCrystalsModal, { open: true, onClose: () => {} }),
    );
    expect(html).toContain('Consigue Cristales Arcanos');
    expect(html).toContain('+40');
    expect(html).not.toMatch(/ePayco|COP|Comprar Cristales|paquetes 500/i);
  });
});
