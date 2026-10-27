import { afterEach, expect, it, vi } from 'vitest';
import {
  ASCENT_CAMPAIGN as PUBLIC_ASCENT,
  DEFAULT_CONTENT,
  createRun,
  createProfile,
  currentEncounter,
  campaignBattleContent,
  DECK_RULES,
  settleVictory,
  claimReward,
  serializeRun,
} from '../src/game';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
async function setup() {
  vi.stubEnv('MODE', 'shapeshifterqa');
  vi.stubEnv('DEV', true);
  vi.stubGlobal('location', { hostname: '127.0.0.1' });
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage });
  vi.resetModules();
  const campaigns = await import('../src/presentation/qa/shapeshifter/campaigns');
  const { PRESENTATION_CONTENT: content } =
    await import('../src/presentation/qa/shapeshifter/runtime');
  const battle = await import('../src/presentation/qa/shapeshifter/realBattle');
  const saves = await import('../src/presentation/store/campaignStorage');
  return { ...campaigns, content, battle, saves, data, storage };
}
it('registers both authored campaigns privately without altering public heroes, encounters or content', async () => {
  const qa = await setup();
  expect(PUBLIC_ASCENT.heroIds).toContain('shapeshifter'); // Routing metadata; release/ownership remain server-gated.
  expect(DEFAULT_CONTENT.heroes.shapeshifter).toBeUndefined();
  // A champion's own act (the Archer's «Sendero del Cazador») stays that champion's.
  for (const campaign of Object.values(qa.WORLD_CAMPAIGNS).filter((c) => !c.heroIds.includes('archer'))) {
    expect(campaign.heroIds).toContain('shapeshifter');
    const run = createRun(campaign, qa.content, 71, 'shapeshifter');
    expect(currentEncounter(campaign, run).hero.heroId).toBe('shapeshifter');
  }
  expect(qa.ASCENT_CAMPAIGN.encounters).toEqual(PUBLIC_ASCENT.encounters);
});
it('replays campaign transformations, pins HP bonus once, and preserves independent save slots', async () => {
  const qa = await setup(),
    profile = createProfile(qa.content);
  const run = { ...createRun(qa.ASCENT_CAMPAIGN, qa.content, 41, 'shapeshifter'), maxHpBonus: 2 };
  const engine = qa.battle.bindQaCampaign(
    qa.battle.realQaEngine(
      currentEncounter(qa.ASCENT_CAMPAIGN, run),
      campaignBattleContent(qa.content, profile, run, DECK_RULES),
      13,
      'guaranteed',
    ),
    run,
  );
  const card = engine.state.player.hand.find((c) =>
    qa.content.cards[c.cardId]!.effects.some((e) => e.type === 'TRANSFORM'),
  )!;
  expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: card.uid, target: null }).ok).toBe(true);
  const restored = qa.battle.decodeRealQaBattle(qa.battle.encodeRealQaBattle(engine));
  expect(restored.state).toEqual(engine.state);
  expect(restored.state.units.find((u) => u.defId === 'shapeshifter')!.activeForm).toBeTruthy();
  expect(qa.battle.qaBattleMatches(restored, run)).toBe(true);
  expect(qa.battle.qaBattleMatches(restored, { ...run, seed: 42 })).toBe(false);
  const mage = createRun(qa.ASCENT_CAMPAIGN, qa.content, 9, 'mage');
  qa.saves.saveCampaign(mage);
  expect(qa.saves.saveQaCampaignTransition(run, profile)).toBe(true);
  expect(qa.saves.loadCampaigns().shapeshifter).toEqual(run);
  expect(qa.saves.loadCampaigns().mage).toEqual(mage);
  expect([...qa.data.keys()].every((k) => k.startsWith('shapeshifter-2e:'))).toBe(true);
});
it('normal campaign selector starts QA battles, resumes active form and rejects forged local victories', async () => {
  const qa = await setup();
  const { useBattleStore: store, campaignChampionsIn } =
    await import('../src/presentation/store/battleStore');
  expect(campaignChampionsIn(store.getState())).toContain('shapeshifter');
  store.getState().selectCampaignHero('shapeshifter');
  store.getState().startRun(79);
  const engine = store.getState().engine!;
  expect(engine.scenario.hero.heroId).toBe('shapeshifter');
  const card = engine.state.player.hand.find((c) =>
    qa.content.cards[c.cardId]!.effects.some((e) => e.type === 'TRANSFORM'),
  )!;
  engine.dispatch({ type: 'PLAY_CARD', cardUid: card.uid, target: null });
  store.getState().backToMenu();
  store.getState().continueRun();
  expect(store.getState().state).toEqual(engine.state);
  const restored = store.getState().engine!;
  const fake = JSON.parse(qa.battle.encodeRealQaBattle(restored));
  fake.commands.push({ type: 'PLAY_CARD', cardUid: 'fake', target: null });
  expect(() => qa.battle.decodeRealQaBattle(JSON.stringify(fake))).toThrow();
  expect(store.getState().run!.completedEncounterIds).toEqual([]);
});
it('reward transitions are idempotent and an interrupted paired save recovers before loading progress', async () => {
  const qa = await setup(),
    profile = createProfile(qa.content);
  const run = createRun(qa.ASCENT_CAMPAIGN, qa.content, 17, 'shapeshifter');
  // Core settlement fixture: proof validation is tested separately, not bypassed in the store.
  const result = settleVictory(
    qa.ASCENT_CAMPAIGN,
    qa.content,
    profile,
    run,
    run.currentEncounterId,
    DECK_RULES,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(
    settleVictory(
      qa.ASCENT_CAMPAIGN,
      qa.content,
      result.profile,
      result.run,
      run.currentEncounterId,
      DECK_RULES,
    ).ok,
  ).toBe(false);
  if (result.run.status === 'CHOOSING_REWARD') {
    const claimed = claimReward(
      qa.ASCENT_CAMPAIGN,
      qa.content,
      result.profile,
      result.run,
      result.run.rewardOptions[0]!.id,
    );
    expect(claimed.ok).toBe(true);
    if (claimed.ok)
      expect(
        claimReward(
          qa.ASCENT_CAMPAIGN,
          qa.content,
          claimed.profile,
          claimed.run,
          result.run.rewardOptions[0]!.id,
        ).ok,
      ).toBe(false);
  }
  const original = qa.storage.setItem;
  let fail = true;
  qa.storage.setItem = (k, v) => {
    if (fail && k.includes(':campaign:hero:shapeshifter')) throw Error('interrupted');
    original(k, v);
  };
  expect(qa.saves.saveQaCampaignTransition(result.run, result.profile)).toBe(false);
  fail = false;
  expect(qa.saves.loadCampaigns().shapeshifter).toEqual(result.run);
  expect(qa.saves.loadProfile()).toEqual(result.profile);
  expect(qa.saves.loadCampaigns().shapeshifter).toEqual(result.run);
  expect(serializeRun(run)).not.toBe(serializeRun(result.run));
});

it('retains real world unlock restrictions independently for each champion', async () => {
  await setup();
  const { useBattleStore: store, worldsIn } = await import('../src/presentation/store/battleStore');
  expect(worldsIn(store.getState(), 'shapeshifter').find((w) => w.id === 'world_2')?.unlocked).toBe(
    false,
  );
  store.setState({
    worldHistory: { shapeshifter: { world_1: { completedAt: 1, rewardGrantedAt: null } } },
  });
  expect(worldsIn(store.getState(), 'shapeshifter').find((w) => w.id === 'world_2')?.unlocked).toBe(
    true,
  );
  expect(worldsIn(store.getState(), 'mage').find((w) => w.id === 'world_2')?.unlocked).not.toBe(
    true,
  );
  store.getState().selectCampaignHero('shapeshifter');
  store.getState().selectWorld('world_2');
  store.getState().startRun(67);
  expect(store.getState().engine!.scenario.id).toBe('w2_e01');
  expect(store.getState().run!.campaignId).toBe('infernal');
});
it('accepts an actual deterministic encounter victory once and preserves it on reload', async () => {
  const qa = await setup();
  const { useBattleStore: store } = await import('../src/presentation/store/battleStore');
  const { playBattle } = await import('./support/bot');
  const { setBattleSeedSource } = await import('../src/presentation/store/battleSeed');
  setBattleSeedSource(() => 13);
  store.getState().selectCampaignHero('shapeshifter');
  store.getState().startRun(19);
  const engine = store.getState().engine!;
  const transform = engine.state.player.hand.find((c) =>
    qa.content.cards[c.cardId]!.effects.some((e) => e.type === 'TRANSFORM'),
  )!;
  engine.dispatch({ type: 'PLAY_CARD', cardUid: transform.uid, target: null });
  playBattle(engine, 20, undefined, { antiStall: true });
  expect(engine.state.outcome?.result).toBe('WON');
  expect(qa.battle.decodeRealQaBattle(qa.battle.encodeRealQaBattle(engine)).state).toEqual(
    engine.state,
  );
  expect(store.getState().run!.completedEncounterIds).toContain(engine.scenario.id);
  const completed = structuredClone(store.getState().run!);
  expect(qa.saves.loadCampaigns().shapeshifter).toEqual(completed);
  expect(store.getState().resumeQaBattle()).toBe(false);
});
it('reloads the saved form and never advances or grants rewards on defeat', async () => {
  const qa = await setup();
  // Keep this legacy campaign regression under its original rules; depth has its own tests.
  qa.battle.setQaDepth('off');
  const { useBattleStore: store } = await import('../src/presentation/store/battleStore');
  store.getState().selectCampaignHero('shapeshifter');
  store.getState().startRun(92);
  const engine = store.getState().engine!;
  const card = engine.state.player.hand.find((c) =>
    qa.content.cards[c.cardId]!.effects.some((e) => e.type === 'TRANSFORM'),
  )!;
  engine.dispatch({ type: 'PLAY_CARD', cardUid: card.uid, target: null });
  const before = structuredClone(engine.state);
  store.getState().backToMenu();
  vi.resetModules();
  const { useBattleStore: reloaded } = await import('../src/presentation/store/battleStore');
  expect(reloaded.getState().campaignHeroId).toBe('shapeshifter');
  reloaded.getState().continueRun();
  expect(reloaded.getState().state).toEqual(before);
  const live = reloaded.getState().engine!,
    profile = structuredClone(reloaded.getState().profile);
  for (let i = 0; i < 30 && !live.state.outcome; i++) {
    const discardUid =
      live.state.player.hand.length > 5 ? live.state.player.hand[0]!.uid : undefined;
    expect(live.dispatch({ type: 'END_TURN', ...(discardUid ? { discardUid } : {}) }).ok).toBe(
      true,
    );
  }
  expect(live.state.outcome?.result).toBe('LOST');
  expect(reloaded.getState().profile).toEqual(profile);
  expect(reloaded.getState().run!.completedEncounterIds).toEqual([]);
  expect(reloaded.getState().run!.status).toBe('IN_BATTLE');
});
