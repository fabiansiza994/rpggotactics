import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addCard,
  addCardIssue,
  ASCENT_CAMPAIGN,
  battleDeck,
  cardsForHero,
  createProfile,
  createRun,
  DECK_RULES,
  deckSize,
  DEFAULT_CONTENT,
  TACTICAL_EXPANSION,
  rollReward,
  grantCard,
  heroProfile,
  ownedCard,
  ownedFor,
  parseProfileSave,
  parseRunSave,
  removeCard,
  saveActiveDeck,
  serializeProfile,
  starterDeck,
  validateDeck,
  type CardDefinition,
  type DeckEntry,
  type GameContent,
  type PlayerProfile,
} from '../src/game';
import { browseCollection, EMPTY_QUERY } from '../src/presentation/react/deckbuilder/collectionView';

const mage = DEFAULT_CONTENT.heroes.mage!;
const base = DEFAULT_CONTENT.cards.magic_missile!;
const extra = (over: Partial<CardDefinition>): CardDefinition => ({ ...base, ...over }) as CardDefinition;

/** Default content plus a Mage card nobody starts with, a Warrior card and a neutral rare. */
const CONTENT: GameContent = {
  ...DEFAULT_CONTENT,
  cards: {
    ...DEFAULT_CONTENT.cards,
    meteor: extra({ id: 'meteor', name: 'Meteoro', cost: 3, rarity: 'RARE', heroId: 'mage' }),
    cleave: extra({ id: 'cleave', name: 'Tajo', heroId: 'warrior' }),
    relic: extra({ id: 'relic', name: 'Reliquia', rarity: 'RARE', heroId: undefined }),
  },
};

const profileOf = (content = CONTENT) => createProfile(content);
const owned = (p: PlayerProfile, content = CONTENT) => ownedFor(p, 'mage', content);
const validate = (deck: DeckEntry[], p = profileOf()) => validateDeck(deck, 'mage', owned(p), CONTENT, DECK_RULES);
const codes = (deck: DeckEntry[], p = profileOf()) => validate(deck, p).map((i) => i.code);
const grant = (p: PlayerProfile, cardId: string) => {
  const r = grantCard(p, 'mage', cardId, CONTENT);
  if (!r.ok) throw new Error(r.error);
  return r.profile;
};

describe('deck rules (shared by the Deck Builder and battle resolution)', () => {
  it('the starter deck of every hero is legal and owned', () => {
    for (const hero of Object.values(DEFAULT_CONTENT.heroes)) {
      const p = createProfile(DEFAULT_CONTENT);
      expect(validateDeck(starterDeck(hero), hero.id, ownedFor(p, hero.id, DEFAULT_CONTENT), DEFAULT_CONTENT, DECK_RULES)).toEqual([]);
      expect(deckSize(starterDeck(hero))).toBe(DECK_RULES.requiredSize);
    }
  });

  it('a full deck rejects one more card; after removing one, an unlocked card can be added', () => {
    let p = grant(profileOf(), 'repulse'); // 3rd Repulse copy owned (the starter holds 2)
    const deck = starterDeck(mage);
    expect(addCardIssue(deck, 'repulse', 'mage', owned(p), CONTENT, DECK_RULES)).toMatchObject({ code: 'DECK_TOO_LARGE' });
    const trimmed = removeCard(deck, 'barrier');
    expect(deckSize(trimmed)).toBe(29);
    expect(trimmed.find((e) => e.cardId === 'barrier')!.count).toBe(2);
    expect(addCardIssue(trimmed, 'repulse', 'mage', owned(p), CONTENT, DECK_RULES)).toBeNull();
    const next = addCard(trimmed, 'repulse');
    expect(next.find((e) => e.cardId === 'repulse')!.count).toBe(3);
    expect(validate(next, p)).toEqual([]);
    p = grant(p, 'meteor');
    expect(validate(addCard(removeCard(next, 'blink'), 'meteor'), p)).toEqual([]);
  });

  it('removing the last copy drops the line', () => {
    expect(removeCard([{ cardId: 'blink', count: 1 }], 'blink')).toEqual([]);
  });

  it('locked cards (0 copies owned) are rejected', () => {
    const deck = removeCard(starterDeck(mage), 'blink');
    expect(addCardIssue(deck, 'meteor', 'mage', owned(profileOf()), CONTENT, DECK_RULES)).toEqual({ code: 'LOCKED', cardId: 'meteor' });
    expect(codes(addCard(deck, 'meteor'))).toEqual(['LOCKED']);
  });

  it("another hero's cards are rejected; neutral cards are allowed", () => {
    const deck = removeCard(starterDeck(mage), 'blink');
    expect(codes(addCard(deck, 'cleave'))).toEqual(['WRONG_HERO']);
    expect(cardsForHero(CONTENT, 'mage').map((c) => c.id)).toContain('relic');
    expect(cardsForHero(CONTENT, 'mage').map((c) => c.id)).not.toContain('cleave');
    expect(grantCard(profileOf(), 'mage', 'cleave', CONTENT).ok).toBe(false);
    expect(codes(addCard(deck, 'relic'), grant(profileOf(), 'relic'))).toEqual([]);
  });

  it('deck size comes from DECK_RULES (exactly requiredSize)', () => {
    expect(codes(removeCard(starterDeck(mage), 'blink'))).toEqual(['DECK_INCOMPLETE']);
    const p = grant(profileOf(), 'repulse');
    expect(codes(addCard(starterDeck(mage), 'repulse'), p)).toEqual(['DECK_TOO_LARGE']);
    expect(codes([])).toEqual(['DECK_INCOMPLETE']);
  });

  it('copies are capped by rarity and by copies owned', () => {
    let p = profileOf();
    for (let i = 0; i < 3; i++) p = grant(p, 'magic_missile'); // 6 owned
    const deck = addCard(removeCard(starterDeck(mage), 'blink'), 'magic_missile'); // 4 copies
    expect(validate(deck, p)).toEqual([{ code: 'COPY_LIMIT', cardId: 'magic_missile', count: 4, limit: 3 }]);
    // Owns 2 Repulses: a third is not available yet even though the limit is 3.
    const greedy = addCard(removeCard(starterDeck(mage), 'blink'), 'repulse');
    expect(validate(greedy)).toEqual([{ code: 'NOT_ENOUGH_COPIES', cardId: 'repulse', count: 3, owned: 2 }]);
    // UNCOMMON limit is 2, RARE is 1.
    p = grant(grant(grant(p, 'frost_nova'), 'frost_nova'), 'meteor');
    p = grant(p, 'meteor');
    expect(addCardIssue([{ cardId: 'frost_nova', count: 2 }], 'frost_nova', 'mage', owned(p), CONTENT, DECK_RULES)).toMatchObject({
      code: 'COPY_LIMIT',
      limit: 2,
    });
    expect(addCardIssue([{ cardId: 'meteor', count: 1 }], 'meteor', 'mage', owned(p), CONTENT, DECK_RULES)).toMatchObject({
      code: 'COPY_LIMIT',
      limit: 1,
    });
  });

  it('saving refuses an invalid deck and never trims it', () => {
    const p = profileOf();
    const short = removeCard(starterDeck(mage), 'blink');
    const r = saveActiveDeck(p, 'mage', short, CONTENT, DECK_RULES);
    expect(r.ok).toBe(false);
    expect(heroProfile(p, 'mage', CONTENT).decks[0]!.cards).toEqual(starterDeck(mage));
  });
});

describe('collection', () => {
  it('a granted card appears in the collection and is not equipped', () => {
    const p = grant(profileOf(), 'meteor');
    const hero = heroProfile(p, 'mage', CONTENT);
    expect(hero.collection.meteor).toEqual({ copies: 1, acquired: 1 });
    expect(hero.decks[0]!.cards).toEqual(starterDeck(mage));
    expect(battleDeck(p, 'mage', CONTENT, DECK_RULES).cards).toEqual(starterDeck(mage));
  });

  it('campaign rewards only offer cards the hero can collect', () => {
    const owned = ownedFor(profileOf(), 'mage', CONTENT);
    for (let seed = 0; seed < 40; seed++) {
      for (const o of rollReward({ content: CONTENT, heroId: 'mage', owned, pity: 0, rules: DECK_RULES, poolId: 'BOSS', seed, count: 3 }).options)
        if (o.kind === 'ADD_CARD') expect(o.cardId).not.toBe('cleave');
    }
  });

  it('browsing: accent-insensitive search, filters and locked cards last', () => {
    const profile = profileOf();
    // Without the «Recursos tácticos» neutrals (their origin filter: tests/neutral-cards.test.ts)
    // and the Act III temple rewards (exclusive sources: tests/act3-completion.test.ts).
    // Also without the free catalog's new cards (exclusive milestone grants: free-catalog-phase-a).
    const pool = cardsForHero(CONTENT, 'mage').filter((c) => c.expansion !== TACTICAL_EXPANSION && !c.tags.includes('temple-reward') && !c.tags.includes('free-catalog') && !c.tags.includes('mage-elements'));
    const lookup = (id: string) => ownedCard(profile, 'mage', id, CONTENT);
    const ids = (q: Partial<typeof EMPTY_QUERY>) => browseCollection(pool, lookup, { ...EMPTY_QUERY, ...q }).map((c) => c.id);
    expect(ids({ text: 'METEÓRO' })).toEqual(['meteor']);
    // Locked: the Mage cards earned through drops (not in the starter), the World 2 reward card
    // and the fixture cards.
    // Includes the «Arsenal I» Mage + neutral cards and «Vitrina I»'s Cometa de Escarcha (QA-gated,
    // never owned on a fresh profile).
    // + the two Mage Ranked Reward Track cards (Intercambio Arcano, Runa de Ignición)
    // + the Ranked Premium Track's Eclipse de Ceniza (pass only).
    expect(ids({ ownership: 'LOCKED' })).toEqual([
      'arcane_surge', 'dispel', 'grappling_hook', 'glacial_shell', 'arcane_exchange', 'mirror_step', 'field_ration', 'relic',
      'arcane_burst_ii', 'blink_ii', 'smoke_bomb', 'arcane_chain', 'frost_nova', 'ignition_rune', 'silence_seal', 'frost_comet', 'magma_fissure', 'meteor',
      'ash_eclipse',
    ]);
    expect(ids({ costs: ['0'] })).toEqual(['phase_step']);
    expect(ids({ categories: ['DEFENSE'] })).toEqual(['barrier', 'glacial_shell', 'field_ration', 'smoke_bomb']);
    expect(ids({}).slice(-19).sort()).toEqual(
      ['arcane_surge', 'dispel', 'glacial_shell', 'relic', 'arcane_burst_ii', 'blink_ii', 'frost_nova', 'magma_fissure', 'meteor',
        'grappling_hook', 'mirror_step', 'field_ration', 'smoke_bomb', 'arcane_chain', 'silence_seal', 'frost_comet', 'arcane_exchange', 'ignition_rune', 'ash_eclipse'].sort(),
    );
    expect(ids({ rarities: ['RARE'], ownership: 'UNLOCKED' })).toEqual([]);
  });
});

describe('profile persistence', () => {
  it('round-trips collection and deck', () => {
    let p = grant(profileOf(), 'meteor');
    const deck = addCard(removeCard(starterDeck(mage), 'blink'), 'meteor');
    const saved = saveActiveDeck(p, 'mage', deck, CONTENT, DECK_RULES);
    if (!saved.ok) throw new Error('expected a legal deck');
    p = saved.profile;
    const loaded = parseProfileSave(serializeProfile(p), CONTENT);
    expect(loaded).toEqual({ status: 'OK', profile: p, notes: [] });
    if (loaded.status !== 'OK') return;
    const resolved = battleDeck(loaded.profile, 'mage', CONTENT, DECK_RULES);
    expect(resolved.source).toBe('SAVED');
    expect(resolved.cards).toEqual(deck);
  });

  it('garbage and unknown versions are INVALID; empty is EMPTY', () => {
    expect(parseProfileSave(null, CONTENT).status).toBe('EMPTY');
    expect(parseProfileSave('{oops', CONTENT).status).toBe('INVALID');
    expect(parseProfileSave(JSON.stringify({ version: 9, profile: profileOf() }), CONTENT).status).toBe('INVALID');
    expect(parseProfileSave(JSON.stringify({ version: 1, profile: { heroes: { mage: { decks: 'x' } } } }), CONTENT).status).toBe('INVALID');
  });

  it('an illegal or stale saved deck loads (to be fixed in the builder) but battles use the starter deck', () => {
    const p = profileOf();
    const mageProfile = p.heroes.mage!;
    const tampered: PlayerProfile = {
      selectedChampionId: 'mage',
      heroes: {
        mage: {
          ...mageProfile,
          collection: { ...mageProfile.collection, deleted_card: { copies: 2, acquired: 3 } },
          decks: [{ id: 'main', name: 'Mazo principal', cards: [{ cardId: 'magic_missile', count: 9 }, { cardId: 'deleted_card', count: 2 }] }],
        },
      },
    };
    const loaded = parseProfileSave(serializeProfile(tampered), CONTENT);
    expect(loaded.status).toBe('OK');
    if (loaded.status !== 'OK') return;
    expect(loaded.notes).toHaveLength(2);
    expect(loaded.profile.heroes.mage!.collection.deleted_card).toBeUndefined();
    expect(loaded.profile.heroes.mage!.decks[0]!.cards).toEqual([{ cardId: 'magic_missile', count: 9 }]);
    const resolved = battleDeck(loaded.profile, 'mage', CONTENT, DECK_RULES);
    expect(resolved.source).toBe('STARTER');
    expect(resolved.cards).toEqual(starterDeck(mage));
    expect(resolved.issues.map((i) => i.code)).toEqual(['COPY_LIMIT', 'NOT_ENOUGH_COPIES', 'DECK_INCOMPLETE']);
  });

  it('starter copies are always owned even if the saved collection lost them', () => {
    const p = profileOf();
    const loaded = parseProfileSave(
      serializeProfile({ ...p, heroes: { mage: { ...p.heroes.mage!, collection: {} } } }),
      CONTENT,
    );
    expect(loaded.status === 'OK' && loaded.profile.heroes.mage!.collection.magic_missile?.copies).toBe(3);
  });

  it('a v1 campaign save (with its run deck) still loads', () => {
    const run = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 3);
    const v1 = JSON.stringify({ version: 1, run: { ...run, deck: starterDeck(mage) } });
    expect(parseRunSave(v1, ASCENT_CAMPAIGN, DEFAULT_CONTENT)).toEqual({ status: 'OK', run });
  });
});

/** In-memory localStorage shared by successive app boots. */
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

const battleCards = (store: Awaited<ReturnType<typeof bootStore>>) => {
  const p = store.getState().state!.player;
  return [...p.deck, ...p.hand, ...p.discard].map((c) => c.cardId);
};

describe('deck through the app store', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a saved deck persists across reloads and is used by skirmish and campaign battles', async () => {
    let store = await bootStore();
    // Dropping a Blink leaves 29 cards: refused, nothing written.
    const short = removeCard(starterDeck(mage), 'blink');
    expect(await store.getState().saveDeck('mage', short)).toEqual({ ok: false, issues: [expect.objectContaining({ code: 'DECK_INCOMPLETE' })] });
    expect(storage.data.has('rpg-go-tactics:profile')).toBe(false);

    // Earn a Repulse through the collection, then equip it instead of a Blink.
    const granted = grantCard(store.getState().profile, 'mage', 'repulse', DEFAULT_CONTENT);
    if (!granted.ok) throw new Error(granted.error);
    store.setState({ profile: granted.profile });
    const deck = addCard(short, 'repulse');
    expect(await store.getState().saveDeck('mage', deck)).toEqual({ ok: true });

    store = await bootStore(); // reload
    expect(store.getState().profile.heroes.mage!.decks[0]!.cards).toEqual(deck);
    store.getState().startScenario('first_blood');
    expect(battleCards(store).filter((id) => id === 'repulse')).toHaveLength(3);
    expect(battleCards(store).filter((id) => id === 'blink')).toHaveLength(2);
    store.getState().backToMenu();
    store.getState().startRun(2);
    expect(battleCards(store)).toHaveLength(30);
    expect(battleCards(store).filter((id) => id === 'repulse')).toHaveLength(3);
  });

  it('a corrupt profile falls back to the starter deck and is kept as a backup', async () => {
    storage.data.set('rpg-go-tactics:profile', '{corrupt');
    const store = await bootStore();
    expect(storage.data.get('rpg-go-tactics:profile:unreadable')).toBe('{corrupt');
    store.getState().startScenario('first_blood');
    expect(battleCards(store)).toHaveLength(30);
  });

  it('a profile created next to an old campaign save receives the cards that campaign earned', async () => {
    const run = { ...createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 3), deck: starterDeck(mage) };
    const reward = { id: 'reward-0-blink', kind: 'ADD_CARD', cardId: 'blink', rarity: 'COMMON' };
    const v1 = {
      ...run,
      currentEncounterId: 'ascent_02_watchtower',
      completedEncounterIds: ['ascent_01_outpost'],
      chosenRewards: [{ encounterId: 'ascent_01_outpost', reward }],
    };
    storage.data.set('rpg-go-tactics:campaign', JSON.stringify({ version: 1, run: v1 }));
    const store = await bootStore();
    expect(store.getState().run?.currentEncounterId).toBe('ascent_02_watchtower');
    // 3 starter Blinks + the one that campaign earned (collection copies may exceed the deck cap).
    expect(store.getState().profile.heroes.mage!.collection.blink?.copies).toBe(4);
    expect(store.getState().profile.heroes.mage!.decks[0]!.cards).toEqual(starterDeck(mage));
    expect(storage.data.has('rpg-go-tactics:profile')).toBe(true);
  });

  it('the deck builder opens only from the menu', async () => {
    const store = await bootStore();
    store.getState().openDeckBuilder();
    expect(store.getState().screen).toBe('DECK');
    store.getState().closeDeckBuilder();
    expect(store.getState().screen).toBe('MENU');
    store.getState().startScenario('first_blood');
    store.getState().openDeckBuilder();
    expect(store.getState().screen).toBe('BATTLE');
  });
});
