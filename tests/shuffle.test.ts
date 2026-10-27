import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game/data';
import { createDrawPile } from '../src/game/domain/cards/deck';
import { GameEngine } from '../src/game/engine/GameEngine';
import { makeEngine, p, scenario, endTurn } from './helpers';

const summoner = DEFAULT_CONTENT.heroes.summoner!;
const mage = DEFAULT_CONTENT.heroes.mage!;
const deckSize = (entries: readonly { count: number }[]) => entries.reduce((n, e) => n + e.count, 0);
const pile = (seed: number, entries = summoner.deck) => {
  let id = 0;
  return createDrawPile({ rngState: seed }, entries, () => `c${id++}`).map((c) => c.cardId);
};
const summonerBattle = (seed: number) => makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) } }, DEFAULT_CONTENT, seed);
/** Hand followed by the draw pile = the full shuffled order of the battle. */
const battleOrder = (engine: GameEngine) => [...engine.state.player.hand, ...engine.state.player.deck].map((c) => c.cardId);

describe('battle draw pile', () => {
  it('is a deterministic, unbiased-shuffle permutation of the deck list (same seed → same order)', () => {
    expect(pile(7)).toEqual(pile(7));
    expect([...pile(7)].sort()).toEqual(summoner.deck.flatMap((e) => Array(e.count).fill(e.cardId)).sort());
  });

  it('different seeds give different orders', () => {
    expect(pile(1)).not.toEqual(pile(2));
    expect(pile(1).slice(0, 4)).not.toEqual(pile(3).slice(0, 4));
  });

  it('keeps every duplicate copy (composition drives draw odds)', () => {
    const order = pile(5);
    expect(order).toHaveLength(deckSize(summoner.deck));
    for (const e of summoner.deck) expect(order.filter((id) => id === e.cardId)).toHaveLength(e.count);
  });

  it('never mutates the saved deck list', () => {
    const entries = structuredClone(summoner.deck);
    const before = structuredClone(entries);
    pile(9, entries);
    summonerBattle(9);
    expect(entries).toEqual(before);
    expect(DEFAULT_CONTENT.heroes.summoner!.deck).toEqual(before);
  });
});

describe('opening hand', () => {
  it('Summoner draws 5 from the shuffled pile (same hand rule as everyone); the rest stays in shuffled order', () => {
    const engine = summonerBattle(1234);
    const { hand, deck, discard } = engine.state.player;
    expect(hand).toHaveLength(5);
    expect(deck).toHaveLength(deckSize(summoner.deck) - 5);
    expect(discard).toEqual([]);
    // Same seed through the same shuffle: hand = top 4, draw pile = the remaining 16 in order.
    expect(battleOrder(engine)).toEqual(pile(1234));
  });

  it('other classes keep their configured opening hand (Mage: 5)', () => {
    const engine = makeEngine({}, DEFAULT_CONTENT, 1234);
    expect(engine.state.player.hand).toHaveLength(mage.startingHandSize);
    expect(engine.state.player.maxHandSize).toBe(mage.maxHandSize);
    expect(battleOrder(engine)).toEqual(pile(1234, mage.deck));
  });

  it('different seeds can produce different opening hands', () => {
    const hand = (seed: number) => summonerBattle(seed).state.player.hand.map((c) => c.cardId);
    expect(hand(1)).not.toEqual(hand(2));
  });

  it('later draws continue from the same pile (no reshuffle per draw)', () => {
    const engine = new GameEngine(scenario({ hero: { heroId: 'summoner', pos: p(0, 2) } }), DEFAULT_CONTENT, 77);
    const pileBefore = engine.state.player.deck.map((c) => c.uid);
    engine.dispatch(endTurn(engine));
    const { hand, deck, discard } = engine.state.player;
    // One card drawn at the next turn start: the old top of the pile (hand full → discarded).
    const drawn = [...hand, ...discard].map((c) => c.uid);
    expect(drawn).toContain(pileBefore[0]);
    expect(deck.map((c) => c.uid)).toEqual(pileBefore.slice(1));
  });
});

describe('restart', () => {
  it('with a new seed builds a fresh battle deck: new order, empty discard, full opening hand', () => {
    const engine = summonerBattle(1);
    const first = battleOrder(engine);
    engine.dispatch(endTurn(engine));
    engine.restart(2);
    expect(engine.seed).toBe(2);
    expect(engine.state.player.hand).toHaveLength(5);
    expect(engine.state.player.discard).toEqual([]);
    expect(engine.history).toHaveLength(0);
    expect(battleOrder(engine)).toEqual(pile(2));
    expect(battleOrder(engine)).not.toEqual(first);
  });

  it('without a seed replays the same battle (deterministic replay)', () => {
    const engine = summonerBattle(5);
    const initial = structuredClone(engine.state);
    engine.dispatch(endTurn(engine));
    engine.restart();
    expect(engine.state).toEqual(initial);
  });
});

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

/** Fresh app modules; the seed source is replaced by a fixed sequence (no real randomness in tests). */
async function bootStore(seeds: number[]) {
  vi.resetModules();
  const { setBattleSeedSource } = await import('../src/presentation/store/battleSeed');
  let i = 0;
  setBattleSeedSource(() => seeds[i++ % seeds.length]!);
  const { useBattleStore } = await import('../src/presentation/store/battleStore');
  useBattleStore.subscribe((s) => {
    if (s.introLocked) s.introBeat('unlock');
  });
  return useBattleStore;
}

describe('every battle start reshuffles (skirmish, campaign, restart share one path)', () => {
  beforeEach(() => vi.stubGlobal('window', { localStorage: memoryStorage() }));
  afterEach(() => vi.unstubAllGlobals());

  it('each start and restart takes a fresh seed from the injected source', async () => {
    const store = await bootStore([101, 202, 303, 404]);
    store.getState().startScenario('first_blood', undefined, 'summoner');
    expect(store.getState().engine!.seed).toBe(101);
    expect(store.getState().state!.player.hand).toHaveLength(5);
    const firstHand = store.getState().state!.player.hand.map((c) => c.cardId);

    store.getState().restart();
    expect(store.getState().engine!.seed).toBe(202);
    expect(store.getState().state!.player.hand.map((c) => c.cardId)).not.toEqual(firstHand);

    store.getState().backToMenu();
    store.getState().startRun(1);
    expect(store.getState().engine!.seed).toBe(303);
    store.getState().restart();
    expect(store.getState().engine!.seed).toBe(404);
  });

  it('an explicit seed (QA / replay) is honoured', async () => {
    const store = await bootStore([1]);
    store.getState().startScenario('first_blood', 42);
    expect(store.getState().engine!.seed).toBe(42);
  });
});
