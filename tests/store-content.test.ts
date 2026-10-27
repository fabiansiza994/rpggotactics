import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCard,
  contentValue,
  COSMETICS,
  CURRENCY_PACKAGES,
  copyLimit,
  createProfile,
  DECK_RULES,
  DEFAULT_CONTENT,
  heroProfile,
  ownedFor,
  packageTotal,
  PREMIUM_CURRENCY_ID,
  proratedPrice,
  removeCard,
  starterDeck,
  STORE_CATALOG,
  validateCatalog,
  validateDeck,
  type CurrencyPackage,
  type StoreContext,
} from '../src/game';
import { terrainDefAt } from '../src/game/domain/board/occupancy';
import { handle } from '../server/src/index';
import { ledgerStatement } from '../server/src/store';
import { decideCredit, packageBySku, packageForProduct, paymentReference, type VerifiedReceipt } from '../server/src/payments';
import { qaGrantSql } from '../server/scripts/qa-grant-sql.mjs';
import { addAccount, memoryD1 } from './support/d1';
import { droppableThroughPlay, ALL_RELEASED } from './support/drops';
import { ctxFor, makeEngine, mutable, p, setHand, unit } from './helpers';

/** Phase 4C: new content, prorated bundles, profile frames, payment boundary (model only). */
const NEW_MAGE = ['arcane_burst_ii', 'glacial_field', 'repulse', 'blink_ii', 'glacial_shell'];
const NEW_SUMMONER = ['pack_hymn', 'spur_familiar', 'vital_offering', 'entangle'];
const ctx: StoreContext = { content: DEFAULT_CONTENT, rules: DECK_RULES, cosmetics: COSMETICS };
// Authoring view: every card set released (offers of unreleased sets are only hidden, never invalid).
const releasedCtx: StoreContext = { ...ctx, content: ALL_RELEASED };
const CARDS = DEFAULT_CONTENT.cards;
const NOW = 1_795_000_000_000; // inside the launch rotation (2026-10-11 → 2027-01-11)

describe('new cards: data, champion pools, deck builder, rewards, store', () => {
  it('belong to their champion, carry a rarity and are never at their copy cap in a starter deck', () => {
    for (const [ids, heroId] of [
      [NEW_MAGE, 'mage'],
      [NEW_SUMMONER, 'summoner'],
    ] as const)
      for (const id of ids) {
        const card = CARDS[id]!;
        expect(card.heroId, id).toBe(heroId);
        expect(card.rarity, id).toBeDefined();
        // 30-card starters hold some of them, always below the cap: a copy is still earned or bought.
        const inStarter = DEFAULT_CONTENT.heroes[heroId]!.deck.find((e) => e.cardId === id)?.count ?? 0;
        expect(inStarter, id).toBeLessThan(copyLimit(card, DECK_RULES));
      }
  });

  it('champion restriction: a Mage card never fits a Summoner deck and vice versa', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    const everything = () => 3;
    const mageDeck = addCard(removeCard(starterDeck(DEFAULT_CONTENT.heroes.mage!), 'blink'), 'entangle');
    expect(validateDeck(mageDeck, 'mage', everything, DEFAULT_CONTENT, DECK_RULES)).toContainEqual({ code: 'WRONG_HERO', cardId: 'entangle', heroId: 'mage' });
    const sumDeck = addCard(removeCard(starterDeck(DEFAULT_CONTENT.heroes.summoner!), 'nurture'), 'glacial_shell');
    expect(validateDeck(sumDeck, 'summoner', everything, DEFAULT_CONTENT, DECK_RULES)).toContainEqual({
      code: 'WRONG_HERO',
      cardId: 'glacial_shell',
      heroId: 'summoner',
    });
    expect(heroProfile(profile, 'mage', DEFAULT_CONTENT).collection.glacial_shell).toBeUndefined();
  });

  it('deck builder: owned new cards make legal decks; rarity caps still apply (RARE = 1)', () => {
    const owned = (id: string) => (NEW_MAGE.includes(id) ? copyLimit(CARDS[id]!, DECK_RULES) : (ownedFor(createProfile(DEFAULT_CONTENT), 'mage', DEFAULT_CONTENT)(id)));
    let deck = starterDeck(DEFAULT_CONTENT.heroes.mage!);
    for (const [out, inn] of [
      ['arcane_burst', 'arcane_burst_ii'],
      ['blink', 'blink_ii'],
      ['force_push', 'repulse'],
      ['ice_wall', 'glacial_field'],
      ['barrier', 'glacial_shell'],
    ])
      deck = addCard(removeCard(deck, out!), inn!);
    expect(validateDeck(deck, 'mage', owned, DEFAULT_CONTENT, DECK_RULES)).toEqual([]);
    expect(copyLimit(CARDS.glacial_shell!, DECK_RULES)).toBe(1);
    const twoShells = addCard(removeCard(deck, 'barrier'), 'glacial_shell');
    expect(validateDeck(twoShells, 'mage', owned, DEFAULT_CONTENT, DECK_RULES)).toContainEqual({ code: 'COPY_LIMIT', cardId: 'glacial_shell', count: 2, limit: 1 });
  });

  it('every new card is a normal reward drop for a starter collection (no store exclusives)', () => {
    for (const [ids, heroId] of [
      [NEW_MAGE, 'mage'],
      [NEW_SUMMONER, 'summoner'],
    ] as const)
      for (const id of ids) expect(droppableThroughPlay(heroId, id), `${id} must drop through play`).toBe(true);
  });

  it('the live catalog sells new content and stays valid', () => {
    expect(validateCatalog(STORE_CATALOG, releasedCtx)).toEqual([]);
    const sold = new Set(STORE_CATALOG.flatMap((o) => o.contents.flatMap((c) => (c.kind === 'CARD' ? [c.cardId] : []))));
    for (const id of [...NEW_MAGE, ...NEW_SUMMONER]) expect(sold.has(id), id).toBe(true);
    const bundles = (heroId: string) => STORE_CATALOG.filter((o) => o.heroId === heroId && o.contents.length > 1);
    expect(bundles('mage').length).toBeGreaterThanOrEqual(2);
    expect(bundles('summoner').length).toBeGreaterThanOrEqual(2);
    expect(STORE_CATALOG.filter((o) => o.type === 'CARD').length).toBeGreaterThanOrEqual(4);
    expect(STORE_CATALOG.some((o) => o.categories.includes('FEATURED'))).toBe(true);
    expect(STORE_CATALOG.filter((o) => o.type === 'COSMETIC').every((o) => o.contents.every((c) => c.kind === 'COSMETIC' && COSMETICS[c.cosmeticId]))).toBe(true);
    // Champion sections only hold that champion's offers.
    for (const o of STORE_CATALOG) {
      if (o.categories.includes('MAGE')) expect(o.heroId).toBe('mage');
      if (o.categories.includes('SUMMONER')) expect(o.heroId).toBe('summoner');
    }
    // A section label the UI does not know is rejected.
    expect(validateCatalog([{ ...STORE_CATALOG[0]!, categories: ['MAGE'] }], ctx)).toContainEqual(expect.objectContaining({ code: 'BAD_CATEGORY' }));
  });

  it('sidegrades, not upgrades: every variant gives something up against the card it echoes', () => {
    const c = CARDS;
    // Arcane Burst II: more tiles, but less damage and range at the same cost.
    expect(c.arcane_burst_ii!.cost).toBe(c.arcane_burst!.cost);
    expect((c.arcane_burst_ii!.effects[0] as { amount: number }).amount).toBeLessThan((c.arcane_burst!.effects[0] as { amount: number }).amount);
    // Blink II: farther, but double cost and no short hops.
    expect(c.blink_ii!.cost).toBeGreaterThan(c.blink!.cost);
    expect(c.blink_ii!.targeting).toMatchObject({ minRange: 3 });
    // Repulse: area, but adjacent-only, no base damage, shorter push.
    expect(c.repulse!.effects.some((e) => e.type === 'DAMAGE')).toBe(false);
    // Glacial Shell: bigger shield, but self-only, roots you, and only 1 copy (RARE).
    expect(c.glacial_shell!.targeting.type).toBe('SELF');
    expect(c.glacial_shell!.effects).toContainEqual({ type: 'APPLY_STATUS', status: 'ROOTED', duration: 2, to: 'CASTER' });
    // Ofrenda vital vs Retorno ritual: heal instead of energy + draw (never both).
    expect(c.vital_offering!.effects.some((e) => e.type === 'GAIN_ENERGY' || e.type === 'DRAW')).toBe(false);
    // Enredadera: control without damage.
    expect(c.entangle!.effects.some((e) => e.type === 'DAMAGE')).toBe(false);
  });
});

describe('new cards resolve as written (engine)', () => {
  const ORCS = (positions: [number, number][]) => positions.map(([x, y], i) => ({ id: `orc-${i}`, enemyId: 'orc_warrior', pos: p(x, y) }));
  const play = (engine: ReturnType<typeof makeEngine>, uid: string, target: { x: number; y: number } | null) => {
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: uid, target });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  };

  it('Arcane Burst II hits a 3×3 for 1', () => {
    const e = makeEngine({ enemies: ORCS([[2, 1], [2, 2], [3, 3], [5, 2]]) });
    const [uid] = setHand(e, ['arcane_burst_ii']);
    play(e, uid!, p(2, 2));
    expect([0, 1, 2, 3].map((i) => unit(e, `orc-${i}`).hp)).toEqual([7, 7, 7, 8]);
  });

  it('Glacial Field paints a cross of ICE', () => {
    const e = makeEngine();
    const [uid] = setHand(e, ['glacial_field']);
    play(e, uid!, p(2, 2));
    for (const t of [p(2, 2), p(1, 2), p(3, 2), p(2, 1), p(2, 3)]) expect(terrainDefAt(ctxFor(e), t)?.type).toBe('ICE');
  });

  it('Repulse pushes every adjacent enemy one tile', () => {
    const e = makeEngine({ hero: { heroId: 'mage', pos: p(1, 2) }, enemies: ORCS([[2, 2], [1, 1]]) });
    const [uid] = setHand(e, ['repulse']);
    play(e, uid!, null);
    expect(unit(e, 'orc-0').pos).toEqual(p(3, 2));
    expect(unit(e, 'orc-1').pos).toEqual(p(1, 0));
  });

  it('Blink II only lands 3–5 tiles away', () => {
    const e = makeEngine();
    const [uid] = setHand(e, ['blink_ii']);
    const targets = e.getValidTargets(uid!);
    expect(targets.some((t) => Math.abs(t.x - 0) + Math.abs(t.y - 2) === 2)).toBe(false);
    expect(targets).toContainEqual(p(4, 2));
  });

  it('Glacial Shell: 6 shield, and the Mage stays rooted through its next turn', () => {
    const e = makeEngine({ enemies: ORCS([[6, 0]]) });
    const [uid] = setHand(e, ['glacial_shell']);
    play(e, uid!, null);
    const hero = unit(e, e.heroId);
    expect(hero.shield).toBe(6);
    expect(hero.statuses).toContainEqual({ id: 'ROOTED', turnsLeft: 2 });
    e.dispatch({ type: 'END_TURN' });
    expect(unit(e, e.heroId).statuses.find((s) => s.id === 'ROOTED')?.turnsLeft).toBe(1);
    expect(e.getLegalMoves()).toEqual([]);
  });

  const summoner = (enemies = ORCS([[6, 2]])) => makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) }, enemies });
  const withFox = (e: ReturnType<typeof summoner>, card: string) => {
    const [fox, other] = setHand(e, ['summon_fox', card]);
    play(e, fox!, p(1, 2));
    return { fox: e.state.units.find((u) => u.kind === 'SUMMON')!, uid: other! };
  };

  it('Enredadera roots an enemy in line of sight, without damage', () => {
    const e = summoner(ORCS([[3, 2]]));
    const [uid] = setHand(e, ['entangle']);
    play(e, uid!, p(3, 2));
    expect(unit(e, 'orc-0')).toMatchObject({ hp: 8, statuses: [{ id: 'ROOTED', turnsLeft: 1 }] });
  });

  it('Azuzar pushes your own summon 2 tiles away from you, no damage', () => {
    const e = summoner();
    const { fox, uid } = withFox(e, 'spur_familiar');
    play(e, uid, fox.pos);
    expect(unit(e, fox.id)).toMatchObject({ pos: p(3, 2), hp: fox.maxHp });
  });

  it('Ofrenda vital recalls the summon and heals the Summoner 3', () => {
    const e = summoner();
    const { fox, uid } = withFox(e, 'vital_offering');
    mutable(e).units.find((u) => u.id === e.heroId)!.hp = 10;
    play(e, uid, fox.pos);
    expect(e.state.units.some((u) => u.id === fox.id)).toBe(false);
    expect(unit(e, e.heroId).hp).toBe(13);
  });

  it('Canto de la manada heals 1 and shields 1 your nearby summons only', () => {
    const e = summoner(ORCS([[2, 2]]));
    const { fox, uid } = withFox(e, 'pack_hymn');
    mutable(e).units.find((u) => u.id === fox.id)!.hp = 5;
    mutable(e).units.find((u) => u.id === 'orc-0')!.hp = 5;
    play(e, uid, null);
    expect(unit(e, fox.id)).toMatchObject({ hp: 6, shield: 1 });
    expect(unit(e, 'orc-0')).toMatchObject({ hp: 5, shield: 0 });
  });
});

describe('prorated price (pure)', () => {
  it('full when nothing is owned; proportional, rounded to 10, never 0 or above base', () => {
    expect(proratedPrice(380, 450, 450)).toBe(380);
    expect(proratedPrice(380, 450, 300)).toBe(250);
    expect(proratedPrice(380, 450, 150)).toBe(130);
    expect(proratedPrice(380, 450, 1)).toBe(10);
    expect(proratedPrice(380, 450, -5)).toBe(10);
    expect(proratedPrice(380, 450, 999)).toBe(380);
    for (let rem = 1; rem <= 450; rem += 7) {
      const price = proratedPrice(380, 450, rem);
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThanOrEqual(380);
      expect(price % 10).toBe(0);
    }
  });

  it('a reduced live bundle stays cheaper than buying its remaining cards one by one', () => {
    for (const o of STORE_CATALOG.filter((x) => x.contents.length > 1)) {
      const values = o.contents.map((c) => contentValue(c, ctx));
      const full = values.reduce((a, b) => a + b, 0);
      for (let skip = 0; skip < values.length; skip++) {
        const remaining = full - values[skip]!;
        expect(proratedPrice(o.price, full, remaining), o.id).toBeLessThan(remaining);
      }
    }
  });
});

// ── Server: prorated bundles, cosmetics equip, payments boundary ─────────────────────────
let db: ReturnType<typeof memoryD1>;
let n = 0;
const store = { catalog: STORE_CATALOG, cosmetics: COSMETICS, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
const deps = { content: DEFAULT_CONTENT, now: () => NOW, seed: () => 7, store };
type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(token: string | null, method: string, path: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handle(new Request(`https://api.test/api/tactics${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { DB: db }, deps);
  return { status: res.status, body: await res.json() };
}
const grant = (username: string, amount: number) =>
  db.sql.prepare(qaGrantSql({ username, amount, reference: `ref-${++n}`, transactionId: `txn_qa_00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, now: NOW })).run();
async function player(username = 'tactics_qa_a') {
  const account = addAccount(db, username);
  await call(account.token, 'POST', '/profile', {});
  return account;
}
/** Sets the copies owned (the 30-card starter already stores rows for some bundle cards). */
const own = (userId: number, heroId: string, cardId: string, copies: number) =>
  db.sql
    .prepare("INSERT INTO tactics_player_cards VALUES (?, ?, ?, ?, 9, 'NORMAL_DROP', 0) ON CONFLICT (user_id, hero_id, card_id) DO UPDATE SET copies = excluded.copies")
    .run(userId, heroId, cardId, copies);
const catalogOffer = async (token: string, id: string) => (await call(token, 'GET', '/store/catalog')).body.offers.find((o: { id: string }) => o.id === id);

beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
});

describe('dynamic bundle pricing (server-authoritative)', () => {
  const BESTIARY = 'pack_summoner_bestiary'; // turtle + raven + aegis (UNCOMMON ×3) = 450 → 380

  it('owns nothing → full price; one at cap → that card left out, price 250; two → 130', async () => {
    const { token, id } = await player();
    expect(await catalogOffer(token, BESTIARY)).toMatchObject({ price: 380, basePrice: 380, excluded: [], availability: { purchasable: true } });
    own(id, 'summoner', 'summon_turtle', 2);
    const one = await catalogOffer(token, BESTIARY);
    expect(one).toMatchObject({ price: 250, basePrice: 380, availability: { purchasable: true } });
    expect(one.contents.map((c: { cardId: string }) => c.cardId)).toEqual(['summon_raven', 'familiar_aegis']);
    expect(one.excluded).toEqual([{ kind: 'CARD', cardId: 'summon_turtle', copies: 1, owned: 2, cap: 2 }]);
    own(id, 'summoner', 'summon_raven', 2);
    expect(await catalogOffer(token, BESTIARY)).toMatchObject({ price: 130 });
  });

  it('owns everything at cap → unavailable (ALL_OWNED), nothing charged', async () => {
    const { token, id } = await player();
    grant('tactics_qa_a', 1000);
    for (const c of ['summon_turtle', 'summon_raven', 'familiar_aegis']) own(id, 'summoner', c, 2);
    expect((await catalogOffer(token, BESTIARY)).availability).toEqual({ purchasable: false, reason: { code: 'ALL_OWNED' } });
    const res = await call(token, 'POST', '/store/purchase', { offerId: BESTIARY, idempotencyKey: 'all-owned-01' });
    expect(res.body.error).toMatchObject({ code: 'ALREADY_OWNED', reason: { code: 'ALL_OWNED' } });
    expect((await call(token, 'GET', '/wallet')).body.wallet.balance).toBe(1000);
  });

  it('charges the server quote (forged price ignored), grants only what fits, snapshots the sale', async () => {
    const { token, id } = await player();
    grant('tactics_qa_a', 1000);
    own(id, 'summoner', 'summon_turtle', 1); // 1/2: one more copy still fits → nothing excluded
    own(id, 'summoner', 'summon_raven', 2); // at cap → excluded
    const res = await call(token, 'POST', '/store/purchase', { offerId: BESTIARY, idempotencyKey: 'prorate-key-01', price: 1, basePrice: 1 });
    expect(res.status).toBe(200);
    expect(res.body.purchase.price).toBe(250);
    expect(res.body.wallet.balance).toBe(750);
    expect(res.body.purchase.granted.cards.map((c: { cardId: string; total: number }) => [c.cardId, c.total])).toEqual([
      ['summon_turtle', 2],
      ['familiar_aegis', 2], // the starter's copy + the one bought
    ]);
    const row = db.sql.prepare('SELECT price, offer_json FROM tactics_store_purchases WHERE user_id = ?').get(id) as { price: number; offer_json: string };
    const sold = JSON.parse(row.offer_json);
    expect(row.price).toBe(250);
    expect(sold).toMatchObject({ id: BESTIARY, price: 250, basePrice: 380, excluded: [{ cardId: 'summon_raven' }] });
    expect(sold.contents.map((c: { cardId: string }) => c.cardId)).toEqual(['summon_turtle', 'familiar_aegis']);
    const debit = db.sql.prepare("SELECT amount_delta FROM tactics_wallet_ledger WHERE reason = 'STORE_PURCHASE'").get() as { amount_delta: number };
    expect(debit.amount_delta).toBe(-250);
  });

  it('a retry replays the stored price even if ownership changed since', async () => {
    const { token, id } = await player();
    grant('tactics_qa_a', 1000);
    const first = await call(token, 'POST', '/store/purchase', { offerId: 'pack_mage_void_mastery', idempotencyKey: 'replay-key-001' });
    expect(first.body.purchase.price).toBe(340);
    own(id, 'summoner', 'summon_wolf', 1); // unrelated change after the sale
    const retry = await call(token, 'POST', '/store/purchase', { offerId: 'pack_mage_void_mastery', idempotencyKey: 'replay-key-001' });
    expect(retry.body).toMatchObject({ replayed: true, purchase: { purchaseId: first.body.purchase.purchaseId, price: 340 } });
    expect((await call(token, 'GET', '/wallet')).body.wallet.balance).toBe(660);
  });

  it('racing a single card against a bundle that contains it: never above cap, each sale charged its own quote', async () => {
    const { token, id } = await player();
    grant('tactics_qa_a', 1000);
    const [a, b] = await Promise.all([
      call(token, 'POST', '/store/purchase', { offerId: 'card_glacial_shell', idempotencyKey: 'race-shell-01' }),
      call(token, 'POST', '/store/purchase', { offerId: 'pack_mage_glacial_control', idempotencyKey: 'race-pack-01' }),
    ]);
    const shells = db.sql.prepare("SELECT copies FROM tactics_player_cards WHERE user_id = ? AND card_id = 'glacial_shell'").get(id) as { copies: number };
    expect(shells.copies).toBe(1); // RARE cap
    const ok = [a, b].filter((r) => r.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of [a, b].filter((x) => x.status !== 200)) expect(['ALREADY_OWNED', 'PURCHASE_CONFLICT']).toContain(r.body.error.code);
    const debits = db.sql.prepare("SELECT -amount_delta AS paid, reference_id FROM tactics_wallet_ledger WHERE reason = 'STORE_PURCHASE'").all() as { paid: number; reference_id: string }[];
    expect(debits.map((d) => d.paid).sort()).toEqual(ok.map((r) => r.body.purchase.price).sort());
    expect((await call(token, 'GET', '/wallet')).body.wallet.balance).toBe(1000 - debits.reduce((x, d) => x + d.paid, 0));
    // Whatever won, the bundle is still sold without the shell afterwards (420 × 250/500 = 210), or is already bought.
    const pack = await catalogOffer(token, 'pack_mage_glacial_control');
    if (pack.availability.purchasable) expect(pack.price).toBe(210);
  });
});

describe('cosmetics: ownership ≠ equipped, server-checked', () => {
  it('buy a frame, equip it, persist it, unequip it', async () => {
    const { token } = await player();
    grant('tactics_qa_a', 600);
    const bought = await call(token, 'POST', '/store/purchase', { offerId: 'cosmetic_frame_arcane_gilt', idempotencyKey: 'frame-key-001' });
    expect(bought.body.purchase).toMatchObject({ price: 300, granted: { cards: [], cosmetics: [{ cosmeticId: 'frame_arcane_gilt', kind: 'PROFILE_FRAME' }] } });
    expect((await call(token, 'GET', '/cosmetics')).body).toEqual({
      owned: [{ cosmeticId: 'frame_arcane_gilt', kind: 'PROFILE_FRAME', acquiredAt: NOW }],
      equipped: { PROFILE_FRAME: null, RANKED_CREST: null, VICTORY_BADGE: null, CARD_ART: null, CARD_BACK: null },
    });
    expect((await call(token, 'PUT', '/cosmetics/equip', { slot: 'PROFILE_FRAME', cosmeticId: 'frame_arcane_gilt' })).body.equipped).toMatchObject({ PROFILE_FRAME: 'frame_arcane_gilt' });
    expect((await call(token, 'GET', '/store/catalog')).body.cosmetics.equipped.PROFILE_FRAME).toBe('frame_arcane_gilt');
    expect((await catalogOffer(token, 'cosmetic_frame_arcane_gilt')).availability).toEqual({ purchasable: false, reason: { code: 'PURCHASE_LIMIT', limit: 1 } });
    expect((await call(token, 'PUT', '/cosmetics/equip', { slot: 'PROFILE_FRAME', cosmeticId: null })).body.equipped).toEqual({ PROFILE_FRAME: null, RANKED_CREST: null, VICTORY_BADGE: null, CARD_ART: null, CARD_BACK: null });
  });

  it('cannot equip what you do not own, an unknown id, or into the wrong / an unrendered slot', async () => {
    const { token, id } = await player();
    const other = await player('tactics_qa_b');
    db.sql.prepare("INSERT INTO tactics_player_cosmetics VALUES (?, 'frame_pact_grove', 'PROFILE_FRAME', 'STORE_PURCHASE', 'x', 0)").run(other.id);
    const equip = (body: unknown) => call(token, 'PUT', '/cosmetics/equip', body);
    expect((await equip({ slot: 'PROFILE_FRAME', cosmeticId: 'frame_pact_grove' })).status).toBe(403); // B owns it, not A
    expect((await equip({ slot: 'PROFILE_FRAME', cosmeticId: 'frame_unknown' })).status).toBe(404);
    expect((await equip({ slot: 'SUMMON_SKIN:chicken', cosmeticId: 'frame_pact_grove' })).status).toBe(400);
    expect((await equip({ slot: 'PROFILE_FRAME', cosmeticId: 42 })).status).toBe(400);
    expect((await call(token, 'GET', '/cosmetics')).body).toEqual({ owned: [], equipped: { PROFILE_FRAME: null, RANKED_CREST: null, VICTORY_BADGE: null, CARD_ART: null, CARD_BACK: null } });
    // The database refuses an equipped row without ownership even if code forgot to check.
    expect(() => db.sql.prepare("INSERT INTO tactics_equipped_cosmetics VALUES (?, 'PROFILE_FRAME', 'frame_pact_grove', 0)").run(id)).toThrow(/FOREIGN KEY/);
  });

  it('cosmetic grants are unique and never touch gameplay data', async () => {
    const { token } = await player();
    grant('tactics_qa_a', 600);
    const before = (await call(token, 'GET', '/state')).body.profile;
    await call(token, 'POST', '/store/purchase', { offerId: 'cosmetic_frame_pact_grove', idempotencyKey: 'frame-key-002' });
    expect((await call(token, 'POST', '/store/purchase', { offerId: 'cosmetic_frame_pact_grove', idempotencyKey: 'frame-key-003' })).status).toBe(409);
    expect((await call(token, 'GET', '/state')).body.profile).toEqual(before);
    expect((await call(token, 'GET', '/wallet')).body.wallet.balance).toBe(300);
  });
});

describe('payments boundary (model only, no provider)', () => {
  const receipt = (patch: Partial<VerifiedReceipt> = {}): VerifiedReceipt => ({
    provider: 'WEB',
    transactionId: 'cs_test_0001',
    productId: 'web_crystals_m',
    status: 'PURCHASED',
    environment: 'SANDBOX',
    accountRef: 'acct_1',
    purchasedAt: NOW,
    ...patch,
  });
  const mapped: CurrencyPackage[] = CURRENCY_PACKAGES.map((pkg) => ({ ...pkg, platformSkus: { WEB: `web_${pkg.internalSku}`, APPLE: null, GOOGLE: `play.${pkg.internalSku}` } }));

  it('packages: 500 / 1100+100 / 2500+300 / 4300+700, no provider product id committed yet', () => {
    expect(CURRENCY_PACKAGES.map((x) => [x.internalSku, x.currencyAmount, x.bonusAmount, packageTotal(x)])).toEqual([
      ['crystals_s', 500, 0, 500],
      ['crystals_m', 1100, 100, 1200],
      ['crystals_l', 2500, 300, 2800],
      ['crystals_xl', 4300, 700, 5000],
    ]);
    for (const x of CURRENCY_PACKAGES) {
      expect(x.currencyId).toBe(PREMIUM_CURRENCY_ID);
      expect(x.platformSkus).toEqual({ WEB: null, APPLE: null, GOOGLE: null });
    }
    expect(packageBySku('crystals_l')?.bonusAmount).toBe(300);
    expect(packageBySku('crystals_free')).toBeNull();
  });

  it('SKU lookup is per provider; an unlisted product never maps', () => {
    expect(packageForProduct('WEB', 'web_crystals_m')).toBeNull(); // real catalog: nothing listed
    expect(packageForProduct('WEB', 'web_crystals_m', mapped)?.internalSku).toBe('crystals_m');
    expect(packageForProduct('GOOGLE', 'web_crystals_m', mapped)).toBeNull();
    expect(packageForProduct('APPLE', '', mapped)).toBeNull();
  });

  it('decideCredit: credits the package total under a namespaced reference, rejects the rest', () => {
    expect(decideCredit(receipt(), 'SANDBOX', mapped)).toEqual({
      ok: true,
      credit: { internalSku: 'crystals_m', currencyId: PREMIUM_CURRENCY_ID, amount: 1200, referenceId: 'WEB:cs_test_0001' },
    });
    expect(decideCredit(receipt(), 'SANDBOX')).toEqual({ ok: false, code: 'UNKNOWN_PRODUCT' });
    expect(decideCredit(receipt({ provider: 'PAYPAL' as never }), 'SANDBOX', mapped)).toEqual({ ok: false, code: 'UNKNOWN_PROVIDER' });
    expect(decideCredit(receipt({ transactionId: "x'; DROP" }), 'SANDBOX', mapped)).toEqual({ ok: false, code: 'BAD_TRANSACTION_ID' });
    expect(decideCredit(receipt(), 'PRODUCTION', mapped)).toEqual({ ok: false, code: 'WRONG_ENVIRONMENT' });
    for (const status of ['PENDING', 'REFUNDED', 'REVOKED'] as const) expect(decideCredit(receipt({ status }), 'SANDBOX', mapped)).toEqual({ ok: false, code: 'NOT_PURCHASED' });
    expect(paymentReference('WEB', 'abc')).not.toBe(paymentReference('GOOGLE', 'abc'));
  });

  it('transaction dedupe: the same provider transaction can credit the ledger only once', async () => {
    const { token, id } = await player();
    const credit = () =>
      db.batch([ledgerStatement(db, { transactionId: `txn_${++n}`, userId: id, currencyId: PREMIUM_CURRENCY_ID, delta: 1200, reason: 'PURCHASE_CURRENCY', referenceId: 'WEB:cs_test_0001', now: NOW })]);
    await credit();
    await expect(credit()).rejects.toThrow(/UNIQUE/);
    expect((await call(token, 'GET', '/wallet')).body.wallet.balance).toBe(1200);
  });

  it('no payment or currency-purchase endpoint exists', async () => {
    const { token } = await player();
    for (const [method, path] of [
      ['POST', '/payments/webhook'],
      ['POST', '/payments/verify'],
      ['POST', '/store/currency'],
      ['GET', '/store/packages'],
      ['POST', '/wallet/purchase'],
    ] as const)
      expect((await call(token, method, path, method === 'GET' ? undefined : { sku: 'crystals_xl', amount: 5000 })).status).toBe(404);
    expect((await call(token, 'GET', '/wallet')).body.wallet.balance).toBe(0);
  });
});
