import { beforeEach, describe, expect, it } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  campaignBattleContent,
  cardSource,
  checkPromoReward,
  COSMETICS,
  copyLimit,
  createProfile,
  createRun,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  encounterOrder,
  GameEngine,
  grantCard,
  INFERNAL_CAMPAIGN,
  isExclusiveCard,
  ownedFor,
  parseProfileSave,
  replayBattle,
  rollReward,
  saveActiveDeck,
  serializeProfile,
  serializeRun,
  STORE_CATALOG,
  validateCatalog,
  validateDeck,
  validateWorlds,
  worldContext,
  WORLD_2,
  type DeckEntry,
  type GameContent,
  type PlayerProfile,
  type RunState,
  type VictoryProof,
  type WorldView,
} from '../src/game';
import { createDuel, validateLoadout } from '../src/game/pvp/duel';
import { handle } from '../server/src/index';
import { sanitizeLocalImport } from '../server/src/importLocal';
import { addAccount, memoryD1 } from './support/d1';
import { playBattle } from './support/bot';
import { makeEngine, mutable, ofType, p, setHand, unit } from './helpers';

const REWARD = { mage: 'magma_fissure', summoner: 'summon_ash_hound', warrior: 'forge_strike' } as const;
const tileAt = (engine: GameEngine, x: number, y: number) => engine.state.board.tiles[y * engine.state.board.width + x]!;

describe('World 2 reward cards: data + exclusivity', () => {
  it('one RARE exclusive card per champion, declared as World 2 completion rewards', () => {
    expect(WORLD_2.completionReward).toMatchObject({ crystals: 250, championCards: REWARD });
    expect(validateWorlds(worldContext(() => true), DEFAULT_CONTENT)).toEqual([]);
    for (const [heroId, cardId] of Object.entries(REWARD)) {
      const card = DEFAULT_CONTENT.cards[cardId]!;
      expect(card).toMatchObject({ heroId, rarity: 'RARE', acquisition: { source: 'WORLD_COMPLETION', worldId: 'world_2' } });
      expect(isExclusiveCard(card)).toBe(true);
      // Client badge without hardcoding names.
      expect(cardSource(card)).toEqual({ kind: 'WORLD_REWARD', worldId: 'world_2', worldName: 'Reino Infernal', label: 'Recompensa de mundo' });
      // Not in any starter.
      expect(DEFAULT_CONTENT.heroes[heroId]!.deck.some((e) => e.cardId === cardId)).toBe(false);
      expect(ownedFor(createProfile(DEFAULT_CONTENT), heroId, DEFAULT_CONTENT)(cardId)).toBe(0);
    }
    expect(cardSource(DEFAULT_CONTENT.cards.fireball!)).toBeNull();
  });

  it('never drops from any reward pool, even with nothing else left to offer', () => {
    for (const [heroId, cardId] of Object.entries(REWARD))
      for (const poolId of ['NORMAL', 'ELITE', 'BOSS'] as const)
        for (let seed = 1; seed <= 200; seed++) {
          const roll = rollReward({ content: DEFAULT_CONTENT, heroId, owned: (id) => (id === cardId ? 0 : 9), pity: 4, rules: DECK_RULES, poolId, seed, count: 3, favorTags: ['fire', 'world-reward'] });
          expect(roll.options.some((o) => o.kind === 'ADD_CARD' && o.cardId === cardId)).toBe(false);
        }
  });

  it('cannot be sold, given by a promo code, or imported from a guest save', () => {
    expect(STORE_CATALOG.some((o) => o.contents.some((c) => c.kind === 'CARD' && Object.values(REWARD).includes(c.cardId as never)))).toBe(false);
    const forged = { ...STORE_CATALOG[0]!, id: 'forged', heroId: 'mage', contents: [{ kind: 'CARD' as const, cardId: 'magma_fissure', copies: 1 }] };
    expect(validateCatalog([forged], { content: DEFAULT_CONTENT, rules: DECK_RULES, cosmetics: COSMETICS } as never)).toContainEqual({ code: 'EXCLUSIVE_CARD', offerId: 'forged', cardId: 'magma_fissure' });
    expect(checkPromoReward({ type: 'CARD', cardId: 'forge_strike', copies: 1 }, { content: DEFAULT_CONTENT, rules: DECK_RULES, cosmetics: COSMETICS })).toBe(false);
    // A crafted local save "owning" the card: dropped at import, the rest kept.
    const local = grantCard(createProfile(DEFAULT_CONTENT), 'mage', 'magma_fissure', DEFAULT_CONTENT);
    expect(local.ok).toBe(true);
    const imported = sanitizeLocalImport(serializeProfile((local as { profile: PlayerProfile }).profile), {}, DEFAULT_CONTENT, DECK_RULES, ['mage', 'summoner']);
    expect(imported.profile.heroes.mage!.collection.magma_fissure).toBeUndefined();
    expect(imported.notes.some((n) => n.includes('magma_fissure'))).toBe(true);
  });

  it('once owned: the Deck Builder can add it, PvP accepts the deck, the profile save keeps it', () => {
    for (const [heroId, cardId] of Object.entries(REWARD)) {
      const granted = grantCard(createProfile(DEFAULT_CONTENT), heroId, cardId, DEFAULT_CONTENT);
      if (!granted.ok) throw new Error(granted.error);
      const starter = DEFAULT_CONTENT.heroes[heroId]!.deck;
      // Swap one copy of the first starter card for the reward card (still 30 cards).
      const deck: DeckEntry[] = [{ ...starter[0]!, count: starter[0]!.count - 1 }, ...starter.slice(1), { cardId, count: 1 }];
      expect(validateDeck(deck, heroId, ownedFor(granted.profile, heroId, DEFAULT_CONTENT), DEFAULT_CONTENT, DECK_RULES)).toEqual([]);
      // Unowned → refused; owned → saved as the active deck.
      expect(saveActiveDeck(createProfile(DEFAULT_CONTENT), heroId, deck, DEFAULT_CONTENT, DECK_RULES).ok).toBe(false);
      const saved = saveActiveDeck(granted.profile, heroId, deck, DEFAULT_CONTENT, DECK_RULES);
      if (!saved.ok) throw new Error('deck refused');
      const loadout = validateLoadout(saved.profile, heroId);
      expect(loadout.cards).toContainEqual({ cardId, count: 1 });
      const other = heroId === 'mage' ? 'summoner' : 'mage';
      expect(() => createDuel([loadout, validateLoadout(saved.profile, other)], 9)).not.toThrow();
      const reloaded = parseProfileSave(serializeProfile(saved.profile), DEFAULT_CONTENT);
      expect(reloaded.status).toBe('OK');
      if (reloaded.status === 'OK') expect(reloaded.profile.heroes[heroId]!.collection[cardId]?.copies).toBe(1);
      // RARE: one copy per deck at most, whatever the collection says.
      expect(copyLimit(DEFAULT_CONTENT.cards[cardId]!, DECK_RULES)).toBe(1);
    }
  });
});

describe('World 2 reward cards: rules', () => {
  it('Fisura Magmática: 3-tile fissure, 1 FIRE to enemies, its EMPTY tiles burn 2 rounds; never over map terrain', () => {
    const engine = makeEngine({
      layout: ['.......', '.......', '.......', '...L...', '.......'],
      legend: { '.': {}, L: { terrain: 'LAVA' } },
      hero: { heroId: 'mage', pos: p(0, 2) },
      enemies: [{ id: 'a', enemyId: 'orc_warrior', pos: p(3, 1) }, { id: 'b', enemyId: 'orc_warrior', pos: p(3, 2) }, { id: 'c', enemyId: 'stone_brute', pos: p(5, 2) }],
    });
    const [uid] = setHand(engine, ['magma_fissure']);
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(3, 2) });
    expect(r.ok).toBe(true);
    // Wall perpendicular to the caster→target axis: (3,1) (3,2) (3,3).
    const hits = ofType(r.events, 'UNIT_DAMAGED').filter((e) => e.damageType === 'FIRE');
    expect(hits.map((h) => [h.unitId, h.hpLost])).toEqual([['a', 1], ['b', 1]]);
    expect(unit(engine, 'c').hp).toBe(8);
    // The orcs' tiles do not ignite (ground control, not damage under their feet).
    expect(tileAt(engine, 3, 1).terrain).toBe('NORMAL');
    expect(tileAt(engine, 3, 2).terrain).toBe('NORMAL');
    expect(tileAt(engine, 3, 3).terrain).toBe('LAVA'); // permanent map terrain is never painted over
    expect(engine.state.player.energy).toBe(2);
    // An empty tile of the line burns for 2 rounds.
    const [again] = setHand(engine, ['magma_fissure']);
    mutable(engine).player.energy = 5;
    unit(engine, 'a').pos = p(5, 0);
    unit(engine, 'b').pos = p(6, 1);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: again!, target: p(2, 1) }).ok).toBe(true);
    expect([tileAt(engine, 2, 0).terrain, tileAt(engine, 2, 1).terrain, tileAt(engine, 2, 2).terrain]).toEqual(['FIRE', 'FIRE', 'FIRE']);
    engine.dispatch({ type: 'END_TURN' });
    expect(tileAt(engine, 2, 0).terrain).toBe('FIRE');
    engine.dispatch({ type: 'END_TURN' });
    expect(tileAt(engine, 2, 0).terrain).toBe('NORMAL');
  });

  it('Sabueso de Ceniza: capacity 1, chases and bites for 2 FIRE + BURNING; never burns a structure', () => {
    const engine = makeEngine({
      hero: { heroId: 'summoner', pos: p(0, 2) },
      structures: [],
      enemies: [{ id: 'orc', enemyId: 'orc_warrior', pos: p(5, 2) }],
      objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 9 }],
    });
    const [uid] = setHand(engine, ['summon_ash_hound']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(1, 2) }).ok).toBe(true);
    const hound = engine.state.units.find((u) => u.defId === 'ash_hound')!;
    expect(hound).toMatchObject({ hp: 9, maxHp: 9, moveRange: 3, summon: { capacityCost: 1 } });
    let bitten = false;
    for (let i = 0; i < 4 && !bitten; i++) {
      const r = engine.dispatch({ type: 'END_TURN' });
      bitten = ofType(r.events, 'SUMMON_ATTACKED').some((e) => e.unitId === hound.id);
    }
    expect(bitten).toBe(true);
    expect(engine.state.units.find((u) => u.id === 'orc')?.statuses ?? []).toContainEqual({ id: 'BURNING', turnsLeft: expect.any(Number) });
    // PvP-style crystal/structure: a structure only takes the bite.
    const s = makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) }, objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 9 }] });
    mutable(s).units.push({ ...hound, id: 'h2', pos: p(2, 2), summon: { ...hound.summon!, readyRound: 0, lastActedRound: 0 } });
    mutable(s).units.push({ id: 'node', defId: 'crystal', name: 'X', faction: 'ENEMY', kind: 'STRUCTURE', pos: p(3, 2), hp: 10, maxHp: 10, shield: 0, armor: 0, moveRange: 0, statuses: [], targetPreference: 'HERO' });
    mutable(s).units = mutable(s).units.filter((u) => u.id !== 'orc-1');
    s.dispatch({ type: 'END_TURN' });
    expect(unit(s, 'node').statuses).toEqual([]);
  });

  it('Golpe de la Forja: 3 + push 1; with Impulso 2 it spends it for 4 + push 2; collisions hurt', () => {
    const engine = makeEngine({ hero: { heroId: 'warrior', pos: p(1, 2) }, enemies: [{ id: 'orc', enemyId: 'orc_warrior', pos: p(2, 2) }], objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 9 }] });
    let [uid] = setHand(engine, ['forge_strike']);
    let r = engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(2, 2) });
    expect(r.ok).toBe(true);
    expect(unit(engine, 'orc')).toMatchObject({ hp: 5, pos: p(3, 2) });
    // Empowered: momentum 2 → 4 damage, pushed 2 into the board edge? No: (3,2)→ needs adjacency first.
    unit(engine, 'orc').pos = p(5, 2);
    unit(engine, 'orc').hp = 8;
    unit(engine, 'warrior').pos = p(4, 2);
    unit(engine, 'warrior').momentum!.value = 2;
    mutable(engine).player.energy = 4;
    [uid] = setHand(engine, ['forge_strike']);
    r = engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(5, 2) });
    expect(r.ok).toBe(true);
    // 7-wide board: pushed from (5,2) two tiles stops at the edge (6,2) → collision 2.
    expect(unit(engine, 'orc').pos).toEqual(p(6, 2));
    expect(unit(engine, 'orc').hp).toBe(8 - 4 - 2);
    expect(unit(engine, 'warrior').momentum!.value).toBe(0);
  });

  it('replays deterministically with every reward card in the deck', () => {
    const encounter = currentEncounter(INFERNAL_CAMPAIGN, createRun(INFERNAL_CAMPAIGN, DEFAULT_CONTENT, 1, 'mage'));
    for (const [heroId, cardId] of Object.entries(REWARD)) {
      const deck = [...DEFAULT_CONTENT.heroes[heroId]!.deck.map((e) => ({ ...e }))];
      deck[0] = { ...deck[0]!, count: deck[0]!.count - 2 };
      const content: GameContent = { ...DEFAULT_CONTENT, heroes: { ...DEFAULT_CONTENT.heroes, [heroId]: { ...DEFAULT_CONTENT.heroes[heroId]!, deck: [...deck, { cardId, count: 2 }] } } };
      const e = new GameEngine({ ...encounter, hero: { ...encounter.hero, heroId } }, content, 31);
      playBattle(e, 10, undefined, { terrainAware: true, summonAware: true });
      const replay = replayBattle({ ...encounter, hero: { ...encounter.hero, heroId } }, content, 31, [...e.history]);
      expect(replay.rejectedAt).toBeNull();
      expect(replay.state).toEqual(e.state);
    }
  });
});

// ── Server: the world completion grants the champion's card once ─────────────────────────────
type State = {
  profile: PlayerProfile | null;
  runs: Record<string, RunState | null> | null;
  worldRuns: Record<string, Record<string, RunState | null>> | null;
  worlds: Record<string, { worlds: WorldView[] }> | null;
};
let db: ReturnType<typeof memoryD1>;
let content: GameContent;
let ids = 0;
const ascent = encounterOrder(ASCENT_CAMPAIGN).map((e) => e.id);
const infernal = encounterOrder(INFERNAL_CAMPAIGN).map((e) => e.id);
const weak = (): GameContent => ({
  ...DEFAULT_CONTENT,
  enemies: Object.fromEntries(Object.entries(DEFAULT_CONTENT.enemies).map(([id, e]) => [id, WORLD_2.enemyPool.includes(id) ? { ...e, maxHp: 1, armor: 0 } : e])),
});
async function call(token: string, method: string, path: string, body?: unknown) {
  const req = new Request(`https://api.test/api/tactics${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handle(req, { DB: db, WARRIOR_ENABLED: '1' }, { content, now: () => 3_000_000, seed: () => 13, summonerCampaign: true, world2: true, store: { catalog: [], cosmetics: {}, newId: () => `tx-${++ids}` } });
  return { status: res.status, body: (await res.json()) as State };
}
function putRun(userId: number, run: RunState) {
  db.sql.prepare(`INSERT INTO tactics_hero_campaign_runs (user_id, campaign_id, hero_id, run_json, save_version, updated_at) VALUES (?, ?, ?, ?, 1, 1) ON CONFLICT (user_id, campaign_id, hero_id) DO UPDATE SET run_json = excluded.run_json`).run(userId, run.campaignId, run.heroId, serializeRun(run));
}
const completedW1 = (heroId: string): RunState => ({ ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 5, heroId), status: 'COMPLETED', currentEncounterId: ascent.at(-1)!, completedEncounterIds: [...ascent] });
const atBoss = (heroId: string): RunState => ({ ...createRun(INFERNAL_CAMPAIGN, DEFAULT_CONTENT, 13, heroId), currentEncounterId: 'w2_e10', completedEncounterIds: infernal.slice(0, 9) });
function bossProof(state: State, heroId: string): VictoryProof {
  const run = state.worldRuns!.infernal![heroId]!;
  const encounter = currentEncounter(INFERNAL_CAMPAIGN, run);
  for (let seed = 1; seed < 80; seed++) {
    const e = new GameEngine(encounter, campaignBattleContent(content, state.profile!, run, DECK_RULES), seed);
    playBattle(e, 30);
    if (e.state.outcome?.result === 'WON') return { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(e.history)) };
  }
  throw new Error('no boss win');
}
const copies = (userId: number, heroId: string, cardId: string) =>
  (db.sql.prepare('SELECT copies, source FROM tactics_player_cards WHERE user_id = ? AND hero_id = ? AND card_id = ?').get(userId, heroId, cardId) as { copies: number; source: string } | undefined) ?? null;
const crystals = (userId: number) => (db.sql.prepare("SELECT balance FROM tactics_wallets WHERE user_id = ?").get(userId) as { balance: number } | undefined)?.balance ?? 0;

describe('server: World 2 completion grants the champion card', () => {
  beforeEach(() => {
    db = memoryD1({ legacyProfiles: true });
    content = weak();
  });

  it('each champion gets its own card + 250 crystals once; retry, reload and replay never duplicate', async () => {
    const { id, token } = addAccount(db, 'hero');
    await call(token, 'POST', '/profile', {});
    for (const heroId of ['mage', 'summoner', 'warrior'] as const) {
      putRun(id, completedW1(heroId));
      await call(token, 'POST', '/campaign/start', { heroId, campaignId: 'infernal' });
      putRun(id, atBoss(heroId));
      let state = (await call(token, 'GET', '/state')).body;
      expect(state.worlds![heroId]!.worlds[1]!.completionReward).toMatchObject({ crystals: 250, cardId: REWARD[heroId], granted: false });
      const proof = bossProof(state, heroId);
      const won = await call(token, 'POST', '/campaign/victory', { heroId, campaignId: 'infernal', proof });
      expect(won.status).toBe(200);
      // Lost response retried + a reload.
      expect((await call(token, 'POST', '/campaign/victory', { heroId, campaignId: 'infernal', proof })).status).toBe(200);
      state = (await call(token, 'GET', '/state')).body;
      expect(copies(id, heroId, REWARD[heroId])).toEqual({ copies: 1, source: 'WORLD_REWARD' });
      expect(state.profile!.heroes[heroId]!.collection[REWARD[heroId]]?.copies).toBe(1);
      // Collection only: never equipped automatically.
      const active = state.profile!.heroes[heroId]!.decks.find((d) => d.id === state.profile!.heroes[heroId]!.activeDeckId)!;
      expect(active.cards.some((e) => e.cardId === REWARD[heroId])).toBe(false);
      expect(state.worlds![heroId]!.worlds[1]!.completionReward).toMatchObject({ granted: true, cardId: REWARD[heroId] });
      // Other champions' cards untouched.
      const order = ['mage', 'summoner', 'warrior'];
      for (const other of order.slice(order.indexOf(heroId) + 1)) expect(state.profile!.heroes[other]!.collection[REWARD[other as keyof typeof REWARD]]).toBeUndefined();
      // Clear the pending reward offer so the run is COMPLETED, then replay the boss.
      const run = state.worldRuns!.infernal![heroId]!;
      if (run.status === 'CHOOSING_REWARD') await call(token, 'POST', '/campaign/reward', { heroId, campaignId: 'infernal', optionId: run.rewardOptions[0]!.id, encounterId: run.currentEncounterId });
      await call(token, 'POST', '/campaign/start', { heroId, campaignId: 'infernal' });
      putRun(id, atBoss(heroId));
      const again = (await call(token, 'GET', '/state')).body;
      expect((await call(token, 'POST', '/campaign/victory', { heroId, campaignId: 'infernal', proof: bossProof(again, heroId) })).status).toBe(200);
      expect(copies(id, heroId, REWARD[heroId])!.copies).toBe(1);
      // Champions pay out independently: 250 per champion so far.
      expect(crystals(id)).toBe(250 * (order.indexOf(heroId) + 1));
      // Exactly one reward drop/log per world completion in the ledger.
      expect(db.sql.prepare("SELECT COUNT(*) AS n FROM tactics_wallet_ledger WHERE user_id = ? AND reference_id = ?").get(id, `world:world_2:${heroId}`)).toEqual({ n: 1 });
    }
  }, 180_000);

  it('a duplicate completion (ledger already paid) refuses the whole step: no card either', async () => {
    const { id, token } = addAccount(db, 'race');
    await call(token, 'POST', '/profile', {});
    putRun(id, completedW1('mage'));
    await call(token, 'POST', '/campaign/start', { heroId: 'mage', campaignId: 'infernal' });
    putRun(id, atBoss('mage'));
    const state = (await call(token, 'GET', '/state')).body;
    db.sql.prepare("INSERT INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, created_at) VALUES ('x', ?, 'arcane_crystals', 250, 0, 250, 'ACHIEVEMENT_REWARD', 'world:world_2:mage', 1)").run(id);
    expect((await call(token, 'POST', '/campaign/victory', { heroId: 'mage', campaignId: 'infernal', proof: bossProof(state, 'mage') })).status).toBe(409);
    expect(copies(id, 'mage', 'magma_fissure')).toBeNull();
  });
});
