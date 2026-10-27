import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  createProfile,
  createRun,
  DEFAULT_CONTENT,
  encounterOrder,
  parseRunSave,
  PITY_THRESHOLD,
  serializeProfile,
  serializeRun,
  withPity,
} from '../src/game';

const order = encounterOrder(ASCENT_CAMPAIGN).map((e) => e.id);
const LEGACY_KEY = 'rpg-go-tactics:campaign';
const slot = (heroId: string) => `rpg-go-tactics:campaign:hero:${heroId}`;

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
  useBattleStore.subscribe((s) => {
    if (s.introLocked) s.introBeat('unlock');
  });
  return useBattleStore;
}
type Store = Awaited<ReturnType<typeof bootStore>>;

const winBattle = (store: Store) => {
  const state = store.getState().engine!.state as { units: { faction: string }[]; pendingWaves: unknown[] };
  state.units = state.units.filter((u) => u.faction !== 'ENEMY');
  state.pendingWaves = [];
  store.getState().endTurn();
};

describe('per-champion campaign slots (guest)', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('a pre-multi-champion save becomes the Mage run; the old slot is kept untouched', async () => {
    const legacy = { ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 11), currentEncounterId: order[2]!, completedEncounterIds: order.slice(0, 2) };
    const raw = JSON.stringify({ version: 1, run: { ...legacy, deck: [] } });
    storage.setItem(LEGACY_KEY, raw);
    const store = await bootStore();
    expect(store.getState().runs.mage).toEqual(legacy);
    expect(store.getState().runs.summoner).toBeNull();
    expect(store.getState().run).toEqual(legacy);
    expect(storage.getItem(LEGACY_KEY)).toBe(raw);
    const copied = parseRunSave(storage.getItem(slot('mage')), ASCENT_CAMPAIGN, DEFAULT_CONTENT);
    expect(copied.status === 'OK' && copied.run).toEqual(legacy);
  });

  it('the Summoner campaign stays hidden unless released', async () => {
    const store = await bootStore();
    store.getState().selectCampaignHero('summoner');
    expect(store.getState().campaignHeroId).toBe('mage');
  });

  it('Mage and Summoner progress independently: each run, slot and reward stays with its champion', async () => {
    vi.stubEnv('VITE_SUMMONER_CAMPAIGN', '1');
    // Pity at the threshold for both: every win offers cards.
    const lucky = withPity(withPity(createProfile(DEFAULT_CONTENT), 'mage', PITY_THRESHOLD, DEFAULT_CONTENT), 'summoner', PITY_THRESHOLD, DEFAULT_CONTENT);
    storage.setItem('rpg-go-tactics:profile', serializeProfile(lucky));
    const mageRun = { ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 3), currentEncounterId: order[4]!, completedEncounterIds: order.slice(0, 4) };
    storage.setItem(slot('mage'), serializeRun(mageRun));

    let store = await bootStore();
    store.getState().selectCampaignHero('summoner');
    expect(store.getState().campaignHeroId).toBe('summoner');
    expect(store.getState().run).toBeNull();
    await store.getState().startRun(5);
    expect(store.getState().state!.units.find((u) => u.kind === 'HERO')!.defId).toBe('summoner');
    winBattle(store);
    const offered = store.getState().run!;
    expect(offered).toMatchObject({ heroId: 'summoner', status: 'CHOOSING_REWARD', completedEncounterIds: [order[0]] });
    const card = offered.rewardOptions.find((o) => o.kind === 'ADD_CARD')!;
    expect(card.kind === 'ADD_CARD' && DEFAULT_CONTENT.cards[card.cardId]!.heroId).toBe('summoner');
    store.getState().chooseReward(card.id);
    expect(store.getState().run).toMatchObject({ heroId: 'summoner', status: 'IN_BATTLE', currentEncounterId: order[1] });
    // The Mage run and collection are exactly as they were.
    expect(store.getState().runs.mage).toEqual(mageRun);
    expect(store.getState().profile.heroes.mage).toEqual(lucky.heroes.mage);
    expect(parseRunSave(storage.getItem(slot('mage')), ASCENT_CAMPAIGN, DEFAULT_CONTENT)).toEqual({ status: 'OK', run: mageRun });

    store = await bootStore(); // reload: both champions resume where they were
    expect(store.getState().campaignHeroId).toBe('summoner');
    expect(store.getState().runs.summoner).toMatchObject({ currentEncounterId: order[1], completedEncounterIds: [order[0]] });
    expect(store.getState().runs.mage).toEqual(mageRun);
    store.getState().continueRun();
    expect(store.getState().state?.scenarioId).toBe(order[1]);
    expect(store.getState().state!.units.find((u) => u.kind === 'HERO')!.defId).toBe('summoner');

    store.getState().backToMenu();
    store.getState().selectCampaignHero('mage');
    expect(store.getState().run).toEqual(mageRun);
    store.getState().continueRun();
    expect(store.getState().state?.scenarioId).toBe(order[4]);
    expect(store.getState().state!.units.find((u) => u.kind === 'HERO')!.defId).toBe('mage');
  });

  it('a new Summoner campaign never overwrites the Mage slot', async () => {
    vi.stubEnv('VITE_SUMMONER_CAMPAIGN', '1');
    const mageRun = { ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 3), currentEncounterId: order[6]!, completedEncounterIds: order.slice(0, 6) };
    storage.setItem(slot('mage'), serializeRun(mageRun));
    const store = await bootStore();
    store.getState().selectCampaignHero('summoner');
    await store.getState().startRun(1);
    expect(storage.getItem(slot('mage'))).toBe(serializeRun(mageRun));
    expect(parseRunSave(storage.getItem(slot('summoner')), ASCENT_CAMPAIGN, DEFAULT_CONTENT).status).toBe('OK');
  });

  it('switching champion is refused during a battle', async () => {
    vi.stubEnv('VITE_SUMMONER_CAMPAIGN', '1');
    const store = await bootStore();
    await store.getState().startRun(1);
    store.getState().selectCampaignHero('summoner');
    expect(store.getState().campaignHeroId).toBe('mage');
    expect(store.getState().run?.heroId).toBe('mage');
  });
});

describe('pending victory journal', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('records the champion; journals from before it are Mage runs', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    const { keepVictory, pendingVictory } = await import('../src/presentation/store/pendingVictory');
    const proof = { encounterId: order[0]!, seed: 4, commands: [{ type: 'END_TURN' as const }] };
    storage.setItem('rpg-go-tactics:pending-victory:old', JSON.stringify({ runSeed: 9, proof }));
    expect(pendingVictory('old')?.heroId).toBe('mage');
    keepVictory('ana', createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 2, 'summoner'), proof);
    expect(JSON.parse(storage.getItem('rpg-go-tactics:pending-victory:ana')!)).toMatchObject({ heroId: 'summoner', runSeed: 2 });
  });
});
