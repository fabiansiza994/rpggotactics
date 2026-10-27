import { ownedFor } from '../src/game/collection/profile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  campaignRoute,
  chooseReward,
  createRun,
  DEFAULT_CONTENT,
  encounterOrder,
  nextEncounterId,
  parseRunSave,
  createProfile,
  DECK_RULES,
  PITY_THRESHOLD,
  settleVictory,
  withPity,
  RUN_SAVE_VERSION,
  serializeRun,
  type RunState,
} from '../src/game';
import { seedForFirstDrop } from './support/drops';

const order = encounterOrder(ASCENT_CAMPAIGN).map((e) => e.id);
/** Pity at the threshold: every win offers cards, so save/route tests do not depend on drops. */
const LUCKY = withPity(createProfile(DEFAULT_CONTENT), 'mage', PITY_THRESHOLD, DEFAULT_CONTENT);
const win = (run: RunState): RunState => {
  const r = settleVictory(ASCENT_CAMPAIGN, DEFAULT_CONTENT, LUCKY, run, run.currentEncounterId, DECK_RULES);
  if (!r.ok) throw new Error(r.error);
  return r.run;
};
const take = (run: RunState, i = 0): RunState => {
  const r = chooseReward(ASCENT_CAMPAIGN, run, run.rewardOptions[i]!.id);
  if (!r.ok) throw new Error(r.error);
  return r.run;
};
const advance = (run: RunState, n: number) => Array.from({ length: n }).reduce<RunState>((r) => take(win(r)), run);
const fresh = () => createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 3);
const reload = (run: RunState) => parseRunSave(serializeRun(run), ASCENT_CAMPAIGN, DEFAULT_CONTENT);
/** One letter per node: C(ompleted/urrent) is ambiguous, so use the first two letters. */
const progress = (run: RunState | null) => campaignRoute(ASCENT_CAMPAIGN, run).map((n) => n.progress.slice(0, 2)).join(' ');

describe('campaign route (derived from the run)', () => {
  it('no campaign: the first encounter is next, everything else locked', () => {
    expect(progress(null)).toBe('CU LO LO LO LO LO LO LO LO LO');
    expect(nextEncounterId(ASCENT_CAMPAIGN, null)).toBe(order[0]);
  });

  it('completed / current / locked follow victories and rewards', () => {
    expect(progress(fresh())).toBe('CU LO LO LO LO LO LO LO LO LO');
    const midRun = advance(fresh(), 3);
    expect(campaignRoute(ASCENT_CAMPAIGN, midRun).map((n) => n.progress)).toEqual([
      'COMPLETED', 'COMPLETED', 'COMPLETED', 'CURRENT', 'LOCKED', 'LOCKED', 'LOCKED', 'LOCKED', 'LOCKED', 'LOCKED',
    ]);
  });

  it('a pending reward shows the won encounter completed and the following one as next', () => {
    const pending = win(advance(fresh(), 2));
    const route = campaignRoute(ASCENT_CAMPAIGN, pending);
    expect(route.slice(0, 4).map((n) => n.progress)).toEqual(['COMPLETED', 'COMPLETED', 'COMPLETED', 'CURRENT']);
    expect(route.slice(4).every((n) => n.progress === 'LOCKED')).toBe(true);
  });

  it('tier is independent of progress (an elite can be locked, current or completed)', () => {
    const atElite = advance(fresh(), 4);
    const elite = campaignRoute(ASCENT_CAMPAIGN, atElite)[4]!;
    expect([elite.encounter.tier, elite.progress]).toEqual(['ELITE', 'CURRENT']);
    expect(campaignRoute(ASCENT_CAMPAIGN, fresh())[4]!.progress).toBe('LOCKED');
    expect(campaignRoute(ASCENT_CAMPAIGN, advance(atElite, 1))[4]!.progress).toBe('COMPLETED');
  });

  it('a finished campaign shows every encounter completed and nothing next', () => {
    const done = advance(fresh(), 10);
    expect(done.status).toBe('COMPLETED');
    expect(progress(done)).toBe('CO CO CO CO CO CO CO CO CO CO');
    expect(campaignRoute(ASCENT_CAMPAIGN, done).every((n) => n.progress === 'COMPLETED')).toBe(true);
    expect(nextEncounterId(ASCENT_CAMPAIGN, done)).toBeNull();
  });
});

describe('campaign save (versioned, validated)', () => {
  it('round-trips a run at every stage: new, mid-run, pending reward, completed', () => {
    for (const run of [fresh(), advance(fresh(), 3), win(advance(fresh(), 5)), advance(fresh(), 10)]) {
      expect(reload(run)).toEqual({ status: 'OK', run });
    }
    expect(JSON.parse(serializeRun(fresh())).version).toBe(RUN_SAVE_VERSION);
  });

  it('rewards persist: max HP bonus and the chosen list survive a reload', () => {
    // Take the MAX_HP offer on the first elite (last option) and a card elsewhere.
    let run = advance(fresh(), 4);
    run = win(run);
    run = take(run, run.rewardOptions.length - 1);
    const loaded = reload(run);
    expect(loaded.status).toBe('OK');
    if (loaded.status !== 'OK') return;
    expect(loaded.run.chosenRewards).toHaveLength(5);
    expect(loaded.run.maxHpBonus).toBeGreaterThan(0);
  });

  it('a pending reward offer survives a reload unchanged (no re-roll)', () => {
    const pending = win(advance(fresh(), 1));
    const loaded = reload(pending);
    expect(loaded.status === 'OK' && loaded.run.rewardOptions).toEqual(pending.rewardOptions);
  });

  it('empty storage is EMPTY; garbage, future versions and stale content are INVALID (never a crash)', () => {
    const parse = (raw: string | null) => parseRunSave(raw, ASCENT_CAMPAIGN, DEFAULT_CONTENT).status;
    expect(parse(null)).toBe('EMPTY');
    expect(parse('{not json')).toBe('INVALID');
    expect(parse('[]')).toBe('INVALID');
    expect(parse(JSON.stringify({ version: 99, run: fresh() }))).toBe('INVALID');
    const tamper = (patch: Partial<RunState> | Record<string, unknown>) =>
      parse(JSON.stringify({ version: RUN_SAVE_VERSION, run: { ...advance(fresh(), 2), ...patch } }));
    expect(tamper({ currentEncounterId: 'removed_encounter' })).toBe('INVALID');
    expect(tamper({ completedEncounterIds: [order[1]!, order[0]!] })).toBe('INVALID');
    expect(tamper({ completedEncounterIds: [] })).toBe('INVALID');
    expect(tamper({ chosenRewards: [{ encounterId: order[0], reward: { id: 'x', kind: 'ADD_CARD', cardId: 'deleted_card' } }] })).toBe('INVALID');
    expect(tamper({ status: 'WHATEVER' })).toBe('INVALID');
    expect(tamper({ campaignId: 'other' })).toBe('INVALID');
    expect(tamper({ maxHpBonus: -1 })).toBe('INVALID');
    expect(tamper({})).toBe('OK');
  });
});

/** In-memory localStorage; each `bootStore()` is a fresh app start reading the same storage. */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

async function bootStore() {
  vi.resetModules();
  const { useBattleStore } = await import('../src/presentation/store/battleStore');
  // No canvas here: play the intro's `unlock` beat ourselves whenever a battle begins.
  useBattleStore.subscribe((s) => {
    if (s.introLocked) s.introBeat('unlock');
  });
  return useBattleStore;
}

describe('campaign persistence through the app store', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
  });
  afterEach(() => vi.unstubAllGlobals());

  const winBattle = (store: Awaited<ReturnType<typeof bootStore>>) => {
    const engine = store.getState().engine!;
    const state = engine.state as { units: { faction: string }[]; pendingWaves: unknown[] };
    // Arrange a decided battle through the real engine, as the e2e tests do.
    state.units = state.units.filter((u) => u.faction !== 'ENEMY');
    state.pendingWaves = [];
    store.getState().endTurn();
  };

  it('a win without a card drop advances the run and persists pity (no reward screen)', async () => {
    let store = await bootStore();
    store.getState().startRun(seedForFirstDrop(false));
    winBattle(store);
    expect(store.getState().run).toMatchObject({ status: 'IN_BATTLE', currentEncounterId: order[1], completedEncounterIds: [order[0]], chosenRewards: [] });
    expect(store.getState().profile.heroes.mage!.rewardPity).toBe(1);
    store = await bootStore(); // reload: pity survives
    expect(store.getState().profile.heroes.mage!.rewardPity).toBe(1);
  });

  it('new campaign → victory → reward → menu → reload → continue at the next encounter', async () => {
    let store = await bootStore();
    expect(store.getState().run).toBeNull();
    store.getState().startRun(seedForFirstDrop(true));
    expect(store.getState().run?.currentEncounterId).toBe(order[0]);
    expect(storage.data.size).toBe(1); // saved on start

    winBattle(store); // encounter I is ELIMINATE_ALL
    expect(store.getState().run?.status).toBe('CHOOSING_REWARD');
    const offered = store.getState().run!.rewardOptions[0]!;
    const copiesBefore = offered.kind === 'ADD_CARD' ? ownedFor(store.getState().profile, 'mage', DEFAULT_CONTENT)(offered.cardId) : 0;
    store.getState().chooseReward(offered.id);
    expect(store.getState().screen).toBe('BATTLE'); // confirmed reward → explicit Continue
    expect(store.getState().run).toMatchObject({ status: 'IN_BATTLE', currentEncounterId: order[1], completedEncounterIds: [order[0]] });

    store = await bootStore(); // page refresh
    const restored = store.getState().run!;
    expect(restored).toMatchObject({ currentEncounterId: order[1], completedEncounterIds: [order[0]] });
    expect(restored.chosenRewards.map((c) => c.reward)).toEqual([offered]);
    store.getState().continueRun();
    expect(store.getState().screen).toBe('BATTLE');
    expect(store.getState().state?.scenarioId).toBe(order[1]);
    // A card reward joins the collection, not the deck: the battle still fights with 30 cards.
    const p = store.getState().state!.player;
    expect(p.deck.length + p.hand.length + p.discard.length).toBe(30);
    if (offered.kind === 'ADD_CARD') {
      // Neutral rewards (including Arcane Surge) belong to the shared collection.
      expect(ownedFor(store.getState().profile, 'mage', DEFAULT_CONTENT)(offered.cardId)).toBe(copiesBefore + 1);
    }
  });

  it('leaving to the menu or playing a skirmish keeps the campaign; defeat + retry keeps progress', async () => {
    let store = await bootStore();
    store.getState().startRun(1, order[3]); // QA jump: I–III marked completed
    store.getState().backToMenu();
    expect(store.getState().run?.currentEncounterId).toBe(order[3]);
    store.getState().startScenario('first_blood');
    expect(store.getState().mode).toBe('SKIRMISH');
    store.getState().backToMenu();
    expect(store.getState().run?.currentEncounterId).toBe(order[3]);

    store.getState().continueRun();
    const engine = store.getState().engine!;
    (engine.state as { units: { kind: string }[] }).units = engine.state.units.filter((u) => u.kind !== 'HERO');
    store.getState().endTurn();
    expect(store.getState().state?.outcome?.result).toBe('LOST');
    store.getState().restart(); // "Reintentar encuentro"
    expect(store.getState().state?.outcome).toBeNull();
    expect(store.getState().run).toMatchObject({ status: 'IN_BATTLE', currentEncounterId: order[3] });

    store = await bootStore();
    expect(store.getState().run).toMatchObject({ currentEncounterId: order[3], completedEncounterIds: order.slice(0, 3) });
  });

  it('campaign completion is persisted and never cleared automatically', async () => {
    let store = await bootStore();
    store.getState().startRun(1, order[9]);
    const engine = store.getState().engine!;
    (engine.state as { units: { id: string }[] }).units = engine.state.units.filter((u) => u.id !== 'colossus');
    (engine.state as { pendingWaves: unknown[] }).pendingWaves = [];
    store.getState().endTurn();
    store.getState().chooseReward(store.getState().run!.rewardOptions[0]!.id);
    expect(store.getState().run?.status).toBe('COMPLETED');
    expect(store.getState().screen).toBe('BATTLE'); // the summary stays on screen

    store = await bootStore();
    expect(store.getState().run).toMatchObject({ status: 'COMPLETED', completedEncounterIds: order });
    store.getState().continueRun(); // nothing to continue
    expect(store.getState().screen).toBe('MENU');
  });

  it('unreadable saves are backed up, not crashed on, and only replaced by a new campaign', async () => {
    storage.setItem('rpg-go-tactics:campaign', '{"version":1,"run":{"campaignId":"ascent"');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = await bootStore();
    expect(store.getState().run).toBeNull();
    expect(storage.data.get('rpg-go-tactics:campaign:unreadable')).toContain('"campaignId":"ascent"');
    expect(warn).toHaveBeenCalled();
    store.getState().startRun();
    // The new run goes to the Mage's own slot; the unreadable legacy slot is left as it was.
    expect(parseRunSave(storage.getItem('rpg-go-tactics:campaign:hero:mage'), ASCENT_CAMPAIGN, DEFAULT_CONTENT).status).toBe('OK');
    expect(storage.getItem('rpg-go-tactics:campaign')).toBe('{"version":1,"run":{"campaignId":"ascent"');
    warn.mockRestore();
  });

  it('storage that throws (private mode) degrades to an in-memory campaign', async () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError');
      },
    });
    const store = await bootStore();
    expect(() => store.getState().startRun()).not.toThrow();
    expect(store.getState().run?.status).toBe('IN_BATTLE');
  });

describe('explicit campaign continuation', () => {
  it('no-drop victory continues directly once; double Continue does not restart the new fight', async () => {
    const store = await bootStore();
    store.getState().startRun(seedForFirstDrop(false));
    winBattle(store);
    expect(store.getState().run?.currentEncounterId).toBe(order[1]);
    expect(store.getState().screen).toBe('BATTLE');
    store.getState().continueRun();
    const next = store.getState().engine;
    expect(store.getState().state?.scenarioId).toBe(order[1]);
    store.getState().continueRun();
    expect(store.getState().engine).toBe(next);
  });
  it('cannot continue before the offered reward is claimed', async () => {
    const store = await bootStore();
    store.getState().startRun(seedForFirstDrop(true));
    winBattle(store);
    const before = store.getState().engine;
    store.getState().continueRun();
    expect(store.getState().engine).toBe(before);
    expect(store.getState().run?.status).toBe('CHOOSING_REWARD');
  });
});

});
