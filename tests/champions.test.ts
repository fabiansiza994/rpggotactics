import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  defaultCampaignHero,
  createProfile,
  DECK_RULES,
  DEFAULT_CONTENT,
  loadoutDeck,
  loadoutFor,
  parseProfileSave,
  selectChampion,
  selectedLoadout,
  serializeProfile,
  starterDeck,
} from '../src/game';
import { CHAMPIONS, championOf, championsIn, RATING_ORDER } from '../src/presentation/assets/champions';

const heroes = DEFAULT_CONTENT.heroes;
const cardHero = (cardId: string) => DEFAULT_CONTENT.cards[cardId]?.heroId;

describe('champion presentation', () => {
  it('lists the playable champions (Mage, Summoner, QA-only Warrior), each backed by a real hero', () => {
    const ids = championsIn(DEFAULT_CONTENT).map((c) => c.heroId);
    expect(ids).toEqual(['mage', 'summoner', 'warrior']);
    // A release filter hides the QA-only Warrior from public lists.
    expect(championsIn(DEFAULT_CONTENT, (id) => id !== 'warrior').map((c) => c.heroId)).toEqual(['mage', 'summoner']);
    expect(championOf('warrior')?.temporaryArt).toBe(false);
    for (const c of CHAMPIONS) {
      expect(heroes[c.heroId], c.heroId).toBeDefined();
      expect(c.strengths.length).toBeGreaterThan(0);
      expect(c.weaknesses.length).toBeGreaterThan(0);
      for (const k of RATING_ORDER) expect(c.ratings[k]).toBeGreaterThanOrEqual(1);
      for (const k of RATING_ORDER) expect(c.ratings[k]).toBeLessThanOrEqual(5);
    }
  });

  it('mechanic facts read the authoritative hero / summon data (no copied numbers)', () => {
    const summoner = CHAMPIONS.find((c) => c.heroId === 'summoner')!;
    const facts = summoner.mechanic.facts(heroes.summoner!, DEFAULT_CONTENT).join(' | ');
    expect(facts).toContain(`Capacidad de invocación: ${heroes.summoner!.summonCapacity}`);
    const chicken = DEFAULT_CONTENT.summons!.chicken!;
    expect(facts).toContain(`${chicken.name}: ${chicken.maxHp} de vida`);
    // Same text follows a data change.
    const tweaked = { ...heroes.summoner!, summonCapacity: 9 };
    expect(summoner.mechanic.facts(tweaked, DEFAULT_CONTENT)[0]).toBe('Capacidad de invocación: 9');
  });
});

describe('champion selection (profile)', () => {
  it('a new profile selects the content default champion (Mage)', () => {
    expect(createProfile(DEFAULT_CONTENT).selectedChampionId).toBe('mage');
  });

  it('selecting updates the active champion; unknown champions are refused', () => {
    const p = createProfile(DEFAULT_CONTENT);
    const r = selectChampion(p, 'summoner', DEFAULT_CONTENT);
    expect(r.ok && r.profile.selectedChampionId).toBe('summoner');
    expect(selectChampion(p, 'paladin', DEFAULT_CONTENT).ok).toBe(false);
  });

  it('the selection persists; old saves and unknown champions fall back to the default', () => {
    const r = selectChampion(createProfile(DEFAULT_CONTENT), 'summoner', DEFAULT_CONTENT);
    if (!r.ok) throw new Error(r.error);
    const loaded = parseProfileSave(serializeProfile(r.profile), DEFAULT_CONTENT);
    expect(loaded.status === 'OK' && loaded.profile.selectedChampionId).toBe('summoner');
    const { selectedChampionId: _drop, ...legacy } = r.profile;
    void _drop;
    const old = parseProfileSave(JSON.stringify({ version: 1, profile: legacy }), DEFAULT_CONTENT);
    expect(old.status === 'OK' && old.profile.selectedChampionId).toBe('mage');
    const bad = parseProfileSave(JSON.stringify({ version: 1, profile: { ...r.profile, selectedChampionId: 'paladin' } }), DEFAULT_CONTENT);
    expect(bad.status === 'OK' && bad.profile.selectedChampionId).toBe('mage');
  });

  it("each champion's loadout resolves to its own deck — never the other's", () => {
    const p = createProfile(DEFAULT_CONTENT);
    for (const id of ['mage', 'summoner']) {
      const loadout = loadoutFor(p, id, DEFAULT_CONTENT);
      const deck = loadoutDeck(p, loadout, DEFAULT_CONTENT, DECK_RULES);
      expect(deck.source).toBe('SAVED');
      expect(deck.cards).toEqual(starterDeck(heroes[id]!));
      for (const e of deck.cards) expect([id, undefined]).toContain(cardHero(e.cardId));
    }
    // A Summoner deck pasted onto the Mage is illegal: battles fall back to the Mage starter deck.
    const crossed = structuredClone(p);
    crossed.heroes.mage!.decks[0]!.cards = starterDeck(heroes.summoner!);
    const mageDeck = loadoutDeck(crossed, loadoutFor(crossed, 'mage', DEFAULT_CONTENT), DEFAULT_CONTENT, DECK_RULES);
    expect(mageDeck.source).toBe('STARTER');
    expect(mageDeck.issues.some((i) => i.code === 'WRONG_HERO')).toBe(true);
    expect(mageDeck.cards).toEqual(starterDeck(heroes.mage!));
    expect(() => loadoutDeck(p, { championId: 'mage', deckId: 'not-a-mage-deck' }, DEFAULT_CONTENT, DECK_RULES)).toThrow();
  });

  it('selectedLoadout follows the selection', () => {
    const r = selectChampion(createProfile(DEFAULT_CONTENT), 'summoner', DEFAULT_CONTENT);
    if (!r.ok) throw new Error(r.error);
    expect(selectedLoadout(r.profile, DEFAULT_CONTENT)).toEqual({ championId: 'summoner', deckId: 'main' });
  });
});

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

async function bootStore() {
  vi.resetModules();
  const { useBattleStore } = await import('../src/presentation/store/battleStore');
  useBattleStore.subscribe((s) => {
    if (s.introLocked) s.introBeat('unlock');
  });
  return useBattleStore;
}

const battleCardHeroes = (store: Awaited<ReturnType<typeof bootStore>>) => {
  const p = store.getState().state!.player;
  return new Set([...p.deck, ...p.hand, ...p.discard].map((c) => cardHero(c.cardId)));
};

describe('champion selection through the app store', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('select → persists across reload → Skirmish fights with that champion and its deck', async () => {
    let store = await bootStore();
    expect(store.getState().profile.selectedChampionId).toBe('mage');
    store.getState().openChampions();
    expect(store.getState().screen).toBe('CHAMPIONS');
    store.getState().selectChampion('summoner');
    expect(JSON.parse(storage.data.get('rpg-go-tactics:profile')!).profile.selectedChampionId).toBe('summoner');

    store = await bootStore(); // reload
    expect(store.getState().profile.selectedChampionId).toBe('summoner');
    store.getState().startScenario('first_blood');
    expect(store.getState().engine!.scenario.hero.heroId).toBe('summoner');
    expect(battleCardHeroes(store)).toEqual(new Set(['summoner']));
  });

  it('the Mage campaign ignores the selected champion', async () => {
    const store = await bootStore();
    store.getState().selectChampion('summoner');
    store.getState().startRun(1);
    expect(store.getState().engine!.scenario.hero.heroId).toBe(defaultCampaignHero(ASCENT_CAMPAIGN));
    expect(battleCardHeroes(store)).toEqual(new Set(['mage']));
    expect(store.getState().profile.selectedChampionId).toBe('summoner');
  });

  it('the deck builder opens for the chosen champion and returns to where it came from', async () => {
    const store = await bootStore();
    store.getState().openChampions();
    store.getState().openDeckBuilder('summoner');
    expect(store.getState()).toMatchObject({ screen: 'DECK', deckHeroId: 'summoner' });
    store.getState().closeDeckBuilder();
    expect(store.getState().screen).toBe('CHAMPIONS');
    store.getState().closeChampions();
    store.getState().openDeckBuilder();
    expect(store.getState()).toMatchObject({ screen: 'DECK', deckHeroId: 'mage' }); // default = selected champion
    store.getState().closeDeckBuilder();
    expect(store.getState().screen).toBe('MENU');
  });
});
