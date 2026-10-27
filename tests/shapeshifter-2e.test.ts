import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONTENT,
  ASCENT_CAMPAIGN,
  createProfile,
  createRun,
  parseProfileSave,
  serializeProfile,
  validateDeck,
  DECK_RULES,
  ownedFor,
  heroProfile,
  activeDeck,
} from '../src/game';
import { localShapeshifterQa } from '../src/presentation/qa/shapeshifter/access';
import { realFlowQaContent } from '../src/presentation/qa/shapeshifter/runtime';
import { championAllowed } from '../server/src/warriorRelease';
import type { Env } from '../server/src/db';
import { readFileSync } from 'node:fs';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe('Phase 2E real flow, isolated QA', () => {
  it('requires DEV, exact mode AND loopback; URL parameters cannot release a champion', () => {
    expect(localShapeshifterQa(true, 'shapeshifterqa', '127.0.0.1')).toBe(true);
    expect(localShapeshifterQa(false, 'shapeshifterqa', 'localhost')).toBe(false);
    expect(localShapeshifterQa(true, 'production', 'localhost')).toBe(false);
    expect(localShapeshifterQa(true, 'shapeshifterqa', 'rpggo-tactics.pages.dev')).toBe(false);
  });
  it('keeps public content, campaigns and server PvP policy closed, regardless of QA username', () => {
    expect(DEFAULT_CONTENT.heroes.shapeshifter).toBeUndefined();
    for (const username of ['tactics_qa_a', 'tactics_qa_b', 'player'])
      expect(championAllowed('shapeshifter', {} as Env, username)).toBe(false);
    expect(championAllowed('mage', {} as Env, 'player')).toBe(true);
    const content = realFlowQaContent(DEFAULT_CONTENT);
    expect(() => createRun(ASCENT_CAMPAIGN, content, 1, 'shapeshifter')).toThrow();
    for (const id of ['mage', 'summoner', 'warrior'])
      expect(content.heroes[id]).toEqual(DEFAULT_CONTENT.heroes[id]);
  });
  it('keeps six transformations, charge movement and original step cost; upgrades old profiles without loss', () => {
    const content = realFlowQaContent(DEFAULT_CONTENT),
      old = createProfile(DEFAULT_CONTENT);
    const migrated = parseProfileSave(serializeProfile(old), content);
    expect(migrated.status).toBe('OK');
    if (migrated.status !== 'OK') return;
    for (const id of Object.keys(old.heroes))
      expect(migrated.profile.heroes[id]).toEqual(old.heroes[id]);
    const deck = activeDeck(heroProfile(migrated.profile, 'shapeshifter', content)).cards;
    expect(
      validateDeck(
        deck,
        'shapeshifter',
        ownedFor(migrated.profile, 'shapeshifter', content),
        content,
        DECK_RULES,
      ),
    ).toEqual([]);
    expect(
      deck
        .filter((e) => ['qa_bear_form', 'qa_minotaur_form'].includes(e.cardId))
        .reduce((n, c) => n + c.count, 0),
    ).toBe(6);
    expect(content.cards.qa_hunter_step!.cost).toBe(1);
    expect(content.cards.qa_brutal_charge!.effects).toContainEqual({
      type: 'GAIN_MOVE_POINTS',
      amount: 1,
    });
    expect(content.cards.qa_protective_roar!.effects.some((e) => e.type === 'CLEANSE')).toBe(false);
  });
  it('uses the normal selector/store/deck flow and reconstructs a real-scenario QA battle', async () => {
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
    const { useBattleStore, championUsableIn, campaignChampionsIn } =
      await import('../src/presentation/store/battleStore');
    const { championsIn } = await import('../src/presentation/assets/champions');
    const {
      PRESENTATION_CONTENT: content,
      realFlow2eContent,
      withQaCatalogCopies,
    } = await import('../src/presentation/qa/shapeshifter/runtime');
    const { encodeRealQaBattle, decodeRealQaBattle, setQaOpening, realQaEngine } =
      await import('../src/presentation/qa/shapeshifter/realBattle');
    const { cloudEnabled } = await import('../src/presentation/cloud/config');
    const oldContent = realFlow2eContent(DEFAULT_CONTENT);
    const oldProfile = createProfile(oldContent);
    const upgraded = withQaCatalogCopies(oldProfile);
    expect(upgraded.heroes.shapeshifter!.collection.qa_mend_spirit!.copies).toBe(3);
    expect(upgraded.heroes.shapeshifter!.collection.qa_bear_form!.copies).toBe(6);
    expect(upgraded.heroes.shapeshifter!.decks).toEqual(oldProfile.heroes.shapeshifter!.decks);
    const { SCENARIOS_BY_ID } = await import('../src/game');
    const baseScenario = SCENARIOS_BY_ID.first_blood!;
    const legacyScenario = {
      ...baseScenario,
      hero: { ...baseScenario.hero, heroId: 'shapeshifter' },
    };
    const oldEngine = realQaEngine(legacyScenario, oldContent, 101, 'guaranteed');
    const legacy = JSON.parse(encodeRealQaBattle(oldEngine));
    legacy.version = 1;
    const recovered = decodeRealQaBattle(JSON.stringify(legacy));
    expect(recovered.state).toEqual(oldEngine.state);
    expect(decodeRealQaBattle(encodeRealQaBattle(recovered)).state).toEqual(oldEngine.state);
    expect(cloudEnabled()).toBe(false);
    expect(championsIn(content).some((c) => c.heroId === 'shapeshifter')).toBe(true);
    expect(championUsableIn(useBattleStore.getState(), 'shapeshifter')).toBe(true);
    expect(campaignChampionsIn(useBattleStore.getState())).toContain('shapeshifter');
    useBattleStore.getState().selectChampion('shapeshifter');
    useBattleStore.getState().openDeckBuilder('shapeshifter');
    expect(useBattleStore.getState().screen).toBe('DECK');
    const deck = activeDeck(
      heroProfile(useBattleStore.getState().profile, 'shapeshifter', content),
    ).cards;
    expect((await useBattleStore.getState().saveDeck('shapeshifter', deck)).ok).toBe(true);
    expect([...data.keys()].some((k) => k === 'shapeshifter-2e:rpg-go-tactics:profile')).toBe(true);
    expect(data.has('rpg-go-tactics:profile')).toBe(false);
    setQaOpening('guaranteed');
    expect(await useBattleStore.getState().startScenario('first_blood', 1, 'shapeshifter')).toBe(
      true,
    );
    const engine = useBattleStore.getState().engine!;
    expect(engine.state.player.hand).toHaveLength(5);
    expect(engine.initialEvents.some((e) => e.type === 'BATTLE_STARTED')).toBe(true);
    expect(
      engine.initialEvents
        .filter((e) => e.type === 'CARD_DRAWN')
        .map((e) => (e.type === 'CARD_DRAWN' ? e.cardUid : '')),
    ).toEqual(engine.state.player.hand.map((c) => c.uid));
    const card = engine.state.player.hand.find((c) =>
      content.cards[c.cardId]!.effects.some((e) => e.type === 'TRANSFORM'),
    )!;
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: card.uid, target: null }).ok).toBe(true);
    const restored = decodeRealQaBattle(encodeRealQaBattle(engine));
    expect(restored.state).toEqual(engine.state);
    expect(restored.seed).toBe(1);
    expect(useBattleStore.getState().resumeQaBattle()).toBe(true);
    expect(useBattleStore.getState().state).toEqual(engine.state);
  });
  it('maps board forms and card art through the existing form registry, without public registrations', () => {
    const board = readFileSync('src/presentation/pixi/BattleCanvas.ts', 'utf8');
    expect(board).toContain('formVisual(unit.activeForm)');
    const paintings = readFileSync('src/presentation/assets/paintedAssets.ts', 'utf8');
    expect(paintings).toContain('if (shapeshifterQaEnabled)');
    expect(paintings).toContain('Object.entries(QA_TRANSFORM_ART)');
  });
});
