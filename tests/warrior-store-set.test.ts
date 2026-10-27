import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_RELEASED } from './support/drops';
import {
  addCard,
  contentValue,
  COSMETICS,
  createProfile,
  DECK_RULES,
  DEFAULT_CONTENT,
  ownedFor,
  PITY_THRESHOLD,
  REWARD_POOLS,
  removeCard,
  rollReward,
  starterDeck,
  STORE_CATALOG,
  validateCatalog,
  validateDeck,
  type GameEngine,
  type RewardPoolId,
  type StoreContext,
} from '../src/game';
import { handle } from '../server/src/index';
import { qaGrantSql } from '../server/scripts/qa-grant-sql.mjs';
import { addAccount, memoryD1 } from './support/d1';
import { makeEngine, mutable, ofType, p, setHand, unit } from './helpers';

/** Warrior store set «Juramento del Verdugo»: the Ejecución card, the pack, its frame. */
const PACK = 'pack_warrior_executioner_oath';
const FRAME = 'frame_executioner_oath';
const EXECUTION = DEFAULT_CONTENT.cards.execution!;
const ctx: StoreContext = { content: DEFAULT_CONTENT, rules: DECK_RULES, cosmetics: COSMETICS };
// Authoring view: every card set released (offers of unreleased sets are only hidden, never invalid).
const releasedCtx: StoreContext = { ...ctx, content: ALL_RELEASED };
const NOW = 1_795_000_000_000;

function arena(hero = p(1, 2), orcs = [p(2, 2)]) {
  return makeEngine({
    layout: ['.......', '.......', '.......', '.......', '.......'],
    hero: { heroId: 'warrior', pos: hero },
    enemies: orcs.map((pos, i) => ({ id: `orc-${i + 1}`, enemyId: 'orc_warrior', pos })),
  });
}
const play = (engine: GameEngine, target = p(2, 2)) => {
  const [uid] = setHand(engine, ['execution']);
  mutable(engine).player.energy = 9;
  return engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target });
};
const momentum = (engine: GameEngine) => unit(engine, 'warrior').momentum!.value;
const setMomentum = (engine: GameEngine, v: number) => (unit(engine, 'warrior').momentum!.value = v);
const orcAt = (engine: GameEngine, hp: number, shield = 0) => Object.assign(unit(engine, 'orc-1'), { hp, shield });
const alive = (engine: GameEngine) => engine.state.units.some((u) => u.id === 'orc-1');

describe('Ejecución: card data', () => {
  it('is a Warrior RARE melee attack, cost 2, not in the starter deck, 1 copy per deck', () => {
    expect(EXECUTION).toMatchObject({ heroId: 'warrior', rarity: 'RARE', cost: 2, category: 'ATTACK', targeting: { type: 'UNIT', range: 1, unitFilter: 'ENEMY' } });
    expect(EXECUTION.tags).toEqual(expect.arrayContaining(['melee', 'momentum', 'finisher']));
    expect(DEFAULT_CONTENT.heroes.warrior!.deck.some((e) => e.cardId === 'execution')).toBe(false);
    expect(ownedFor(createProfile(DEFAULT_CONTENT), 'warrior', DEFAULT_CONTENT)('execution')).toBe(0);
  });

  it('deck rules: legal once owned, refused for other champions, refused when locked, max 1 copy', () => {
    const owned = (id: string) => (id === 'execution' ? 1 : ownedFor(createProfile(DEFAULT_CONTENT), 'warrior', DEFAULT_CONTENT)(id));
    const deck = addCard(removeCard(starterDeck(DEFAULT_CONTENT.heroes.warrior!), 'steady_advance'), 'execution');
    expect(validateDeck(deck, 'warrior', owned, DEFAULT_CONTENT, DECK_RULES)).toEqual([]);
    expect(validateDeck(deck, 'warrior', ownedFor(createProfile(DEFAULT_CONTENT), 'warrior', DEFAULT_CONTENT), DEFAULT_CONTENT, DECK_RULES)).toContainEqual(
      expect.objectContaining({ code: 'LOCKED', cardId: 'execution' }),
    );
    const two = addCard(removeCard(deck, 'steady_advance'), 'execution');
    expect(validateDeck(two, 'warrior', () => 3, DEFAULT_CONTENT, DECK_RULES)).toContainEqual(expect.objectContaining({ code: 'COPY_LIMIT', cardId: 'execution', limit: 1 }));
    const mage = addCard(removeCard(starterDeck(DEFAULT_CONTENT.heroes.mage!), 'blink'), 'execution');
    expect(validateDeck(mage, 'mage', () => 3, DEFAULT_CONTENT, DECK_RULES)).toContainEqual(expect.objectContaining({ code: 'WRONG_HERO', cardId: 'execution' }));
  });
});

describe('Ejecución: resolution', () => {
  it('healthy target: 3 damage, no finisher', () => {
    const engine = arena();
    const r = play(engine);
    expect(r.ok).toBe(true);
    expect(unit(engine, 'orc-1').hp).toBe(8 - 3);
    expect(ofType(r.ok ? r.events : [], 'FINISHER_TRIGGERED')).toEqual([]);
  });

  it('target at or below 5 HP: 5 damage instead (threshold inclusive), announced before the hit', () => {
    const engine = arena();
    orcAt(engine, 5);
    const r = play(engine);
    const events = r.ok ? r.events : [];
    const types = events.map((e) => e.type);
    expect(types.indexOf('FINISHER_TRIGGERED')).toBeLessThan(types.indexOf('UNIT_DAMAGED'));
    expect(ofType(events, 'FINISHER_TRIGGERED')[0]).toMatchObject({ unitId: 'orc-1', casterId: 'warrior', hpAtMost: 5, amount: 5 });
    expect(alive(engine)).toBe(false);
    // 6 HP is above the threshold: the normal 3 damage.
    const e2 = arena();
    orcAt(e2, 6);
    play(e2);
    expect(unit(e2, 'orc-1').hp).toBe(3);
  });

  it('counterplay: shield (Guard) and armor still apply to the finisher hit; the threshold reads HP only', () => {
    const engine = arena();
    orcAt(engine, 4, 3);
    const r = play(engine);
    expect(ofType(r.ok ? r.events : [], 'UNIT_DAMAGED')[0]).toMatchObject({ rawAmount: 5, shieldAbsorbed: 3, hpLost: 2 });
    expect(unit(engine, 'orc-1').hp).toBe(2);
    const armored = arena();
    Object.assign(orcAt(armored, 5), { armor: 1 });
    play(armored);
    expect(unit(armored, 'orc-1').hp).toBe(1);
  });

  it('melee only: no reach, no diagonals (the target can deny it by keeping its distance)', () => {
    const engine = arena(p(1, 2), [p(3, 2), p(2, 3)]);
    const [uid] = setHand(engine, ['execution']);
    expect(engine.getValidTargets(uid!)).toEqual([]);
    expect(play(engine, p(3, 2)).ok).toBe(false);
  });

  it('Impulso 2: consumed automatically; 4 damage, or 7 to a target at 7 HP or less', () => {
    const engine = arena();
    setMomentum(engine, 2);
    const r = play(engine);
    expect(r.ok && ofType(r.events, 'CARD_PLAYED')[0]!.empowered).toBe(true);
    expect(unit(engine, 'orc-1').hp).toBe(4);
    expect(momentum(engine)).toBe(0);
    const e2 = arena();
    setMomentum(e2, 3);
    orcAt(e2, 7);
    const r2 = play(e2);
    expect(ofType(r2.ok ? r2.events : [], 'FINISHER_TRIGGERED')[0]).toMatchObject({ hpAtMost: 7, amount: 7 });
    expect(alive(e2)).toBe(false);
    expect(momentum(e2)).toBe(1); // spends exactly 2
  });

  it('Impulso 1 is not enough: base effect, nothing spent', () => {
    const engine = arena();
    setMomentum(engine, 1);
    orcAt(engine, 7);
    play(engine);
    expect(unit(engine, 'orc-1').hp).toBe(4);
    expect(momentum(engine)).toBe(1);
  });

  it('the preview shows exactly what the play will do (finisher included) and mutates nothing', () => {
    const engine = arena();
    setMomentum(engine, 2);
    orcAt(engine, 6);
    const [uid] = setHand(engine, ['execution']);
    const preview = engine.previewCard(uid!, p(2, 2));
    expect(ofType(preview.predictedEvents, 'FINISHER_TRIGGERED')).toHaveLength(1);
    expect(ofType(preview.predictedEvents, 'UNIT_DEFEATED')).toHaveLength(1);
    expect(unit(engine, 'orc-1').hp).toBe(6);
    expect(momentum(engine)).toBe(2);
  });

  it('balance guard: never more damage than its threshold, and below Vanguard Fury unconditional at full Impulso', () => {
    for (const fx of [...EXECUTION.effects, ...EXECUTION.empowered!.effects]) {
      if (fx.type !== 'DAMAGE') continue;
      expect(fx.finisher!.amount).toBeLessThanOrEqual(fx.finisher!.hpAtMost);
      expect(fx.amount).toBeLessThanOrEqual(4);
    }
    // Against a full-health Warrior/Mage hero the finisher never applies.
    expect(DEFAULT_CONTENT.heroes.mage!.maxHp).toBeGreaterThan(7 * 2);
  });
});

describe('Ejecución: normal rewards (not store-only)', () => {
  const owned = ownedFor(createProfile(DEFAULT_CONTENT), 'warrior', DEFAULT_CONTENT);
  const offered = (poolId: RewardPoolId, seeds = 300, pity = PITY_THRESHOLD) =>
    Array.from({ length: seeds }, (_, seed) =>
      rollReward({ content: DEFAULT_CONTENT, heroId: 'warrior', owned, pity, rules: DECK_RULES, poolId, seed, count: 3 }),
    ).filter((r) => r.options.some((o) => o.kind === 'ADD_CARD' && o.cardId === 'execution'));

  it('drops from Warrior elite and boss rewards as a RARE; NORMAL (rare weight 0) only after every non-rare', () => {
    expect(REWARD_POOLS.NORMAL.rarityWeights.RARE).toBe(0);
    // 30-card starter: only Agarre and Embestida are still unowned non-rares, so a NORMAL offer's
    // third slot falls back to the rares (weightedPick: no positive weight left → uniform). It is
    // never offered ahead of them.
    for (const r of offered('NORMAL'))
      for (const id of ['grapple', 'ram']) expect(r.options.some((o) => o.kind === 'ADD_CARD' && o.cardId === id), id).toBe(true);
    expect(offered('ELITE').length).toBeGreaterThan(0);
    expect(offered('BOSS').length).toBeGreaterThan(0);
    const option = offered('BOSS')[0]!.options.find((o) => o.kind === 'ADD_CARD' && o.cardId === 'execution');
    expect(option).toMatchObject({ rarity: 'RARE', isNew: true });
  });

  it('never offered to other champions; never offered once at its copy cap', () => {
    for (const heroId of ['mage', 'summoner'])
      for (let seed = 0; seed < 200; seed++) {
        const roll = rollReward({ content: DEFAULT_CONTENT, heroId, owned: ownedFor(createProfile(DEFAULT_CONTENT), heroId, DEFAULT_CONTENT), pity: 4, rules: DECK_RULES, poolId: 'BOSS', seed, count: 3 });
        expect(roll.options.some((o) => o.kind === 'ADD_CARD' && o.cardId === 'execution')).toBe(false);
      }
    const capped = (id: string) => (id === 'execution' ? 1 : owned(id));
    for (let seed = 0; seed < 200; seed++) {
      const roll = rollReward({ content: DEFAULT_CONTENT, heroId: 'warrior', owned: capped, pity: 4, rules: DECK_RULES, poolId: 'BOSS', seed, count: 3 });
      expect(roll.options.some((o) => o.kind === 'ADD_CARD' && o.cardId === 'execution')).toBe(false);
    }
  });

  it('pity still forces a card drop (the new card does not change the drop economy)', () => {
    for (let seed = 0; seed < 100; seed++) {
      const roll = rollReward({ content: DEFAULT_CONTENT, heroId: 'warrior', owned, pity: PITY_THRESHOLD, rules: DECK_RULES, poolId: 'NORMAL', seed, count: 3 });
      expect(roll.cardDrop).toBe(true);
    }
  });
});

describe('«Juramento del Verdugo»: catalog', () => {
  const pack = STORE_CATALOG.find((o) => o.id === PACK)!;

  it('the catalog stays valid; the pack is Ejecución + Embestida + Agarre + the frame', () => {
    expect(validateCatalog(STORE_CATALOG, releasedCtx)).toEqual([]);
    expect(pack).toMatchObject({ type: 'CHAMPION_PACK', heroId: 'warrior', purchaseLimit: 1, startAt: null, endAt: null });
    expect(pack.contents).toEqual([
      { kind: 'CARD', cardId: 'execution', copies: 1 },
      { kind: 'CARD', cardId: 'ram', copies: 1 },
      { kind: 'CARD', cardId: 'grapple', copies: 1 },
      { kind: 'COSMETIC', cosmeticId: FRAME },
    ]);
    expect(pack.categories).toEqual(expect.arrayContaining(['FEATURED', 'WARRIOR']));
    expect(COSMETICS[FRAME]).toMatchObject({ kind: 'PROFILE_FRAME', heroId: 'warrior' });
  });

  it('price: 680 for 800 of parts (85%), above its priciest part; singles at the ladder price', () => {
    const parts = pack.contents.map((c) => contentValue(c, ctx));
    expect(parts).toEqual([250, 150, 100, 300]);
    expect(pack.price).toBe(680);
    expect(pack.price).toBeLessThan(parts.reduce((a, b) => a + b, 0));
    expect(pack.price).toBeGreaterThan(Math.max(...parts));
    expect(STORE_CATALOG.find((o) => o.id === 'card_execution')).toMatchObject({ price: 250, heroId: 'warrior', categories: ['CARDS', 'WARRIOR'] });
    expect(STORE_CATALOG.find((o) => o.id === `cosmetic_${FRAME}`)).toMatchObject({ price: 300, heroId: 'warrior', purchaseLimit: 1 });
  });

  it('every gameplay card it sells is also a Warrior reward drop (no pay-to-win exclusives)', () => {
    const owned = ownedFor(createProfile(DEFAULT_CONTENT), 'warrior', DEFAULT_CONTENT);
    for (const c of pack.contents) {
      if (c.kind !== 'CARD') continue;
      const drops = (['ELITE', 'BOSS', 'NORMAL'] as RewardPoolId[]).some((poolId) =>
        Array.from({ length: 300 }, (_, seed) => seed).some((seed) =>
          rollReward({ content: DEFAULT_CONTENT, heroId: 'warrior', owned, pity: 4, rules: DECK_RULES, poolId, seed, count: 3 }).options.some(
            (o) => o.kind === 'ADD_CARD' && o.cardId === c.cardId,
          ),
        ),
      );
      expect(drops, c.cardId).toBe(true);
    }
  });
});

// ── Server: listing gate, quote, purchase, grants, persistence ────────────────────────────
let db: ReturnType<typeof memoryD1>;
let n = 0;
const store = { catalog: STORE_CATALOG, cosmetics: COSMETICS, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
const deps = { content: DEFAULT_CONTENT, now: () => NOW, seed: () => 7, store };
const QA_ENV = { WARRIOR_QA: '1' };
const SET_CARDS = "('execution', 'ram', 'grapple')";
type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(token: string, method: string, path: string, body?: unknown, env: Record<string, string> = QA_ENV): Promise<Res> {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const res = await handle(new Request(`https://api.test/api/tactics${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { DB: db, ...env }, deps);
  return { status: res.status, body: await res.json() };
}
const grant = (username: string, amount: number) =>
  db.sql.prepare(qaGrantSql({ username, amount, reference: `ref-${++n}`, transactionId: `txn_qa_00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, now: NOW })).run();
async function player(username = 'tactics_qa_a') {
  const account = addAccount(db, username);
  await call(account.token, 'POST', '/profile', {});
  return account;
}
const own = (userId: number, cardId: string, copies: number) =>
  db.sql.prepare("INSERT INTO tactics_player_cards VALUES (?, 'warrior', ?, ?, 9, 'NORMAL_DROP', 0)").run(userId, cardId, copies);
const offer = async (token: string, id = PACK, env?: Record<string, string>) =>
  (await call(token, 'GET', '/store/catalog', undefined, env)).body.offers.find((o: { id: string }) => o.id === id);
const buy = (token: string, key: string, offerId = PACK, env?: Record<string, string>) =>
  call(token, 'POST', '/store/purchase', { offerId, idempotencyKey: key }, env);
const copies = (body: any, cardId: string) => body.profile.heroes.warrior?.collection[cardId]?.copies ?? 0; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
});

describe('«Juramento del Verdugo»: release gate (Warrior QA-only)', () => {
  it('not listed and not sold where the Warrior is not released (flags off, or a non-QA account)', async () => {
    const qa = await player('tactics_qa_a');
    grant('tactics_qa_a', 2000);
    for (const id of [PACK, 'card_execution', `cosmetic_${FRAME}`]) expect(await offer(qa.token, id, {}), id).toBeUndefined();
    expect((await buy(qa.token, 'gate-key-0001', PACK, {})).status).toBe(404);
    const ana = await player('ana');
    expect(await offer(ana.token, PACK)).toBeUndefined(); // WARRIOR_QA covers QA accounts only
    expect((await buy(ana.token, 'gate-key-0002')).status).toBe(404);
    // Other champions' offers are unaffected.
    expect(await offer(ana.token, 'pack_summoner_bestiary')).toBeDefined();
  });

  it('listed for the QA accounts with WARRIOR_QA, and for everyone with WARRIOR_ENABLED', async () => {
    const qa = await player('tactics_qa_a');
    expect(await offer(qa.token)).toMatchObject({ price: 680, basePrice: 680, excluded: [], availability: { purchasable: true } });
    const ana = await player('ana');
    expect(await offer(ana.token, PACK, { WARRIOR_ENABLED: '1' })).toMatchObject({ price: 680 });
  });
});

describe('«Juramento del Verdugo»: quote and dynamic pricing', () => {
  it('owns Agarre at cap → left out, 680 × 700/800 = 600; plus the frame → 340', async () => {
    const { token, id } = await player();
    own(id, 'grapple', 3);
    const one = await offer(token);
    expect(one).toMatchObject({ price: 600, basePrice: 680, availability: { purchasable: true } });
    expect(one.excluded).toEqual([{ kind: 'CARD', cardId: 'grapple', copies: 1, owned: 3, cap: 3 }]);
    db.sql.prepare("INSERT INTO tactics_player_cosmetics VALUES (?, ?, 'PROFILE_FRAME', 'STORE_PURCHASE', 'x', 0)").run(id, FRAME);
    const two = await offer(token);
    expect(two.price).toBe(340);
    expect(two.contents.map((c: { cardId?: string }) => c.cardId)).toEqual(['execution', 'ram']);
  });

  it('owning some copies below the cap does not reduce the price (each line is still granted)', async () => {
    const { token, id } = await player();
    own(id, 'ram', 1);
    own(id, 'grapple', 2);
    expect(await offer(token)).toMatchObject({ price: 680, excluded: [] });
  });

  it('every playable card at cap and the frame owned → ALL_OWNED, refused by the server', async () => {
    const { token, id } = await player();
    grant('tactics_qa_a', 2000);
    own(id, 'execution', 1);
    own(id, 'ram', 2);
    own(id, 'grapple', 3);
    db.sql.prepare("INSERT INTO tactics_player_cosmetics VALUES (?, ?, 'PROFILE_FRAME', 'STORE_PURCHASE', 'x', 0)").run(id, FRAME);
    expect((await offer(token)).availability).toEqual({ purchasable: false, reason: { code: 'ALL_OWNED' } });
    const res = await buy(token, 'all-owned-0001');
    expect(res.status).toBe(409);
    expect(res.body.error.reason).toEqual({ code: 'ALL_OWNED' });
  });

  it('cards at cap but frame not owned → still sold as the frame alone, at a reduced price (300 × 0.85 → 260)', async () => {
    const { token, id } = await player();
    own(id, 'execution', 1);
    own(id, 'ram', 2);
    own(id, 'grapple', 3);
    expect(await offer(token)).toMatchObject({ price: 260, contents: [{ kind: 'COSMETIC', cosmeticId: FRAME }] });
  });
});

describe('«Juramento del Verdugo»: purchase flow and persistence', () => {
  it('charges 680 once, grants 3 cards to the Warrior collection and the frame; ledger/purchase rows match', async () => {
    const { token, id } = await player();
    grant('tactics_qa_a', 1000);
    const res = await buy(token, 'oath-key-0001');
    expect(res.status).toBe(200);
    expect(res.body.wallet.balance).toBe(320);
    expect(res.body.purchase).toMatchObject({ offerId: PACK, price: 680, status: 'COMPLETED' });
    expect(res.body.purchase.granted).toEqual({
      cards: [
        { heroId: 'warrior', cardId: 'execution', copies: 1, total: 1, cap: 1 },
        { heroId: 'warrior', cardId: 'ram', copies: 1, total: 1, cap: 2 },
        { heroId: 'warrior', cardId: 'grapple', copies: 1, total: 1, cap: 3 },
      ],
      cosmetics: [{ cosmeticId: FRAME, kind: 'PROFILE_FRAME' }],
    });
    for (const card of ['execution', 'ram', 'grapple']) expect(copies(res.body, card), card).toBe(1);
    const ledger = db.sql.prepare("SELECT amount_delta, balance_after, reason, reference_id FROM tactics_wallet_ledger WHERE user_id = ? AND reason = 'STORE_PURCHASE'").all(id);
    expect(ledger).toEqual([{ amount_delta: -680, balance_after: 320, reason: 'STORE_PURCHASE', reference_id: res.body.purchase.purchaseId }]);
    const rows = db.sql.prepare(`SELECT source FROM tactics_player_cards WHERE user_id = ? AND hero_id = 'warrior' AND card_id IN ${SET_CARDS}`).all(id) as { source: string }[];
    expect(rows.map((r) => r.source)).toEqual(['STORE_PURCHASE', 'STORE_PURCHASE', 'STORE_PURCHASE']);
    const snapshot = JSON.parse((db.sql.prepare('SELECT offer_json FROM tactics_store_purchases WHERE user_id = ?').get(id) as { offer_json: string }).offer_json);
    expect(snapshot).toMatchObject({ id: PACK, price: 680, basePrice: 680 });
    // Reloaded from D1: still there.
    const state = await call(token, 'GET', '/state');
    expect(copies(state.body, 'execution')).toBe(1);
  });

  it('idempotent replay; purchase limit 1; the frame equips and is visible', async () => {
    const { token } = await player();
    grant('tactics_qa_a', 2000);
    await buy(token, 'oath-key-0002');
    const replay = await buy(token, 'oath-key-0002');
    expect(replay.body).toMatchObject({ replayed: true, wallet: { balance: 1320 } });
    const again = await buy(token, 'oath-key-0003');
    expect(again.status).toBe(409);
    expect(again.body.error.reason).toEqual({ code: 'PURCHASE_LIMIT', limit: 1 });
    const equip = await call(token, 'PUT', '/cosmetics/equip', { slot: 'PROFILE_FRAME', cosmeticId: FRAME });
    expect(equip.status).toBe(200);
    expect(equip.body.equipped.PROFILE_FRAME).toBe(FRAME);
    expect(equip.body.owned.map((c: { cosmeticId: string }) => c.cosmeticId)).toContain(FRAME);
  });

  it('insufficient funds: 409, nothing charged, nothing granted', async () => {
    const { token, id } = await player();
    grant('tactics_qa_a', 679);
    const res = await buy(token, 'oath-key-0004');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'INSUFFICIENT_FUNDS' } });
    expect(db.sql.prepare('SELECT COUNT(*) AS c FROM tactics_store_purchases WHERE user_id = ?').get(id)).toEqual({ c: 0 });
    expect(db.sql.prepare('SELECT COUNT(*) AS c FROM tactics_player_cosmetics WHERE user_id = ?').get(id)).toEqual({ c: 0 });
    expect(db.sql.prepare(`SELECT COUNT(*) AS c FROM tactics_player_cards WHERE user_id = ? AND card_id IN ${SET_CARDS}`).get(id)).toEqual({ c: 0 });
  });

  it('a partly-owned pack charges the server quote and grants only the rest', async () => {
    const { token, id } = await player();
    grant('tactics_qa_a', 1000);
    own(id, 'grapple', 3);
    const res = await buy(token, 'oath-key-0005');
    expect(res.body.purchase.price).toBe(600);
    expect(res.body.wallet.balance).toBe(400);
    expect(res.body.purchase.granted.cards.map((c: { cardId: string }) => c.cardId)).toEqual(['execution', 'ram']);
    expect(copies(res.body, 'grapple')).toBe(3);
  });

  it('bought Ejecución makes a server-accepted Warrior deck; the single card is then at cap', async () => {
    const { token, id } = await player();
    // Legacy accounts unlock the Warrior at encounter VI (champion onboarding rules).
    db.sql.prepare('UPDATE tactics_profiles SET campaign_best = 6 WHERE user_id = ?').run(id);
    grant('tactics_qa_a', 1000);
    await buy(token, 'oath-key-0006');
    const deck = addCard(removeCard(starterDeck(DEFAULT_CONTENT.heroes.warrior!), 'steady_advance'), 'execution');
    expect((await call(token, 'PUT', '/decks/warrior/main', { cards: deck })).status).toBe(200);
    expect((await offer(token, 'card_execution')).availability.reason).toMatchObject({ code: 'CARD_AT_CAP', cardId: 'execution', owned: 1, cap: 1 });
  });
});
