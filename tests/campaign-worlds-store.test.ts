import { withArcher } from '../src/game/data/archer';
import { ARCHER_HUNT_CAMPAIGN } from '../src/game/data/archer-hunt-encounters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASCENT_CAMPAIGN, createRun, DEFAULT_CONTENT, encounterOrder, INFERNAL_CAMPAIGN, serializeRun, type RunState } from '../src/game';

const ascent = encounterOrder(ASCENT_CAMPAIGN).map((e) => e.id);
const infernal = encounterOrder(INFERNAL_CAMPAIGN).map((e) => e.id);
const slot = (heroId: string) => `rpg-go-tactics:campaign:hero:${heroId}`;
const worldSlot = (heroId: string) => `rpg-go-tactics:campaign:infernal:hero:${heroId}`;

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

async function bootStore() {
  vi.resetModules();
  const mod = await import('../src/presentation/store/battleStore');
  mod.useBattleStore.subscribe((s) => {
    if (s.introLocked) s.introBeat('unlock');
  });
  return mod;
}

const completed = (heroId: string): RunState => ({ ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 3, heroId), status: 'COMPLETED', currentEncounterId: ascent.at(-1)!, completedEncounterIds: [...ascent] });

describe('campaign worlds in the client store (guest)', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('performance', { now: () => Date.now() });
    vi.stubEnv('VITE_WORLD_2_ENABLED', '1');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('World 2 is hidden without the build flag, locked before World 1, and cannot be selected or started', async () => {
    vi.stubEnv('VITE_WORLD_2_ENABLED', '0');
    let { useBattleStore, worldsIn } = await bootStore();
    expect(worldsIn(useBattleStore.getState(), 'mage').map((w) => w.id)).toEqual(['world_1']);
    vi.stubEnv('VITE_WORLD_2_ENABLED', '1');
    ({ useBattleStore, worldsIn } = await bootStore());
    expect(worldsIn(useBattleStore.getState(), 'mage').map((w) => [w.id, w.status])).toEqual([['world_1', 'UNLOCKED'], ['world_2', 'LOCKED']]);
    useBattleStore.getState().selectWorld('world_2');
    expect(useBattleStore.getState().campaignWorldId).toBe('world_1');
  });

  it('a legacy guest with World 1 completed selects World 2, starts it at XI, and its run is saved in its own slot', async () => {
    storage.setItem(slot('mage'), serializeRun(completed('mage')));
    const { useBattleStore, worldsIn, selectedCampaign } = await bootStore();
    expect(worldsIn(useBattleStore.getState(), 'mage').map((w) => [w.id, w.status, w.completedEncounters])).toEqual([['world_1', 'COMPLETED', 10], ['world_2', 'UNLOCKED', 0]]);
    useBattleStore.getState().selectWorld('world_2');
    expect(useBattleStore.getState().campaignWorldId).toBe('world_2');
    expect(selectedCampaign(useBattleStore.getState()).id).toBe('infernal');
    expect(await useBattleStore.getState().startRun(7)).toBe(true);
    const s = useBattleStore.getState();
    expect(s.state?.scenarioId).toBe('w2_e01');
    expect(s.run).toMatchObject({ campaignId: 'infernal', heroId: 'mage', currentEncounterId: 'w2_e01' });
    expect(s.runs.mage).toEqual(completed('mage')); // World 1 untouched
    expect(JSON.parse(storage.getItem(worldSlot('mage'))!).run.campaignId).toBe('infernal');
  });

  it('replaying World 1 keeps World 2 unlocked (guest history) and never touches the World 2 run', async () => {
    storage.setItem(slot('mage'), serializeRun(completed('mage')));
    const w2 = { ...createRun(INFERNAL_CAMPAIGN, DEFAULT_CONTENT, 2, 'mage'), currentEncounterId: infernal[2]!, completedEncounterIds: infernal.slice(0, 2) };
    storage.setItem(worldSlot('mage'), serializeRun(w2));
    const { useBattleStore, worldsIn } = await bootStore();
    expect(await useBattleStore.getState().startRun(5)).toBe(true); // World 1 selected: «Rejugar»
    useBattleStore.getState().backToMenu();
    const s = useBattleStore.getState();
    expect(s.runs.mage).toMatchObject({ currentEncounterId: ascent[0], completedEncounterIds: [] });
    expect(worldsIn(s, 'mage').map((w) => [w.id, w.status])).toEqual([['world_1', 'COMPLETED'], ['world_2', 'IN_PROGRESS']]);
    expect(JSON.parse(storage.getItem('rpg-go-tactics:worlds')!)).toMatchObject({ mage: { world_1: { rewardGrantedAt: null } } });
    expect(s.worldRuns.infernal!.mage).toEqual(w2);
    // A reload sees the same thing.
    const again = await bootStore();
    expect(again.worldsIn(again.useBattleStore.getState(), 'mage').map((w) => w.status)).toEqual(['COMPLETED', 'IN_PROGRESS']);
  });

  it('a guest who beats the Forge King gets the champion card once (collection only), even after a replay', async () => {
    storage.setItem(slot('mage'), serializeRun(completed('mage')));
    storage.setItem(worldSlot('mage'), serializeRun({ ...createRun(INFERNAL_CAMPAIGN, DEFAULT_CONTENT, 2, 'mage'), currentEncounterId: 'w2_e10', completedEncounterIds: infernal.slice(0, 9) }));
    const { useBattleStore, worldsIn } = await bootStore();
    useBattleStore.getState().selectWorld('world_2');
    useBattleStore.getState().continueRun();
    const win = () => {
      const state = useBattleStore.getState().engine!.state as { units: { faction: string }[]; pendingWaves: unknown[] };
      state.units = state.units.filter((u) => u.faction !== 'ENEMY');
      state.pendingWaves = [];
      useBattleStore.getState().endTurn();
    };
    win();
    let s = useBattleStore.getState();
    expect(s.profile.heroes.mage!.collection.magma_fissure?.copies).toBe(1);
    expect(s.profile.heroes.mage!.decks.every((d) => d.cards.every((e) => e.cardId !== 'magma_fissure'))).toBe(true);
    expect(worldsIn(s, 'mage')[1]).toMatchObject({ status: 'COMPLETED', completionReward: { cardId: 'magma_fissure', granted: true } });
    // Replay World 2 to the boss again: no second copy.
    useBattleStore.getState().backToMenu();
    storage.setItem(worldSlot('mage'), serializeRun({ ...createRun(INFERNAL_CAMPAIGN, DEFAULT_CONTENT, 3, 'mage'), currentEncounterId: 'w2_e10', completedEncounterIds: infernal.slice(0, 9) }));
    const again = await bootStore();
    again.useBattleStore.getState().selectWorld('world_2');
    again.useBattleStore.getState().continueRun();
    const state = again.useBattleStore.getState().engine!.state as { units: { faction: string }[]; pendingWaves: unknown[] };
    state.units = state.units.filter((u) => u.faction !== 'ENEMY');
    state.pendingWaves = [];
    again.useBattleStore.getState().endTurn();
    s = again.useBattleStore.getState();
    expect(s.profile.heroes.mage!.collection.magma_fissure?.copies).toBe(1);
  });

  it('a World 2 victory advances only the World 2 run and never the World 1 milestone counter', async () => {
    storage.setItem(slot('mage'), serializeRun(completed('mage')));
    const { useBattleStore } = await bootStore();
    useBattleStore.getState().selectWorld('world_2');
    await useBattleStore.getState().startRun(7);
    const before = useBattleStore.getState().profile.champions?.campaignBest;
    const state = useBattleStore.getState().engine!.state as { units: { faction: string }[]; pendingWaves: unknown[] };
    state.units = state.units.filter((u) => u.faction !== 'ENEMY');
    state.pendingWaves = [];
    useBattleStore.getState().endTurn();
    const s = useBattleStore.getState();
    expect(s.worldRuns.infernal!.mage!.completedEncounterIds).toEqual(['w2_e01']);
    expect(s.runs.mage).toEqual(completed('mage'));
    expect(s.profile.champions?.campaignBest).toBe(before);
  });
  it('restores legacy Archer story separately from its main-act slots without overwriting either', async () => {
    vi.stubEnv('VITE_ARCHER_ENABLED','1'); vi.stubEnv('VITE_ARCHER_CAMPAIGN','1');
    const content=withArcher(DEFAULT_CONTENT);
    const main={...createRun(ASCENT_CAMPAIGN,content,3,'archer'),currentEncounterId:ascent[1]!,completedEncounterIds:[ascent[0]!]};
    const story={...createRun(ARCHER_HUNT_CAMPAIGN,content,4,'archer'),currentEncounterId:ARCHER_HUNT_CAMPAIGN.encounters[1]!.id,completedEncounterIds:[ARCHER_HUNT_CAMPAIGN.start]};
    storage.setItem(slot('archer'),serializeRun(main));
    storage.setItem('rpg-go-tactics:campaign:archer_hunt:hero:archer',serializeRun(story));
    let {useBattleStore}=await bootStore();
    useBattleStore.getState().selectCampaignHero('archer');
    useBattleStore.getState().selectWorld('world_1');expect(useBattleStore.getState().run).toEqual(main);
    useBattleStore.getState().selectWorld('archer_act_1');expect(useBattleStore.getState().run).toEqual(story);
    ({useBattleStore}=await bootStore());
    expect(useBattleStore.getState().runs.archer).toEqual(main);
    expect(useBattleStore.getState().worldRuns.archer_hunt!.archer).toEqual(story);
  });

});
