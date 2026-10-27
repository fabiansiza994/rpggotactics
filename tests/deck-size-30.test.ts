import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeDeck,
  ASCENT_CAMPAIGN,
  battleDeck,
  campaignBattleContent,
  collectionCardStatus,
  countInDeck,
  createProfile,
  createRun,
  currentEncounter,
  DECK_RULES,
  deckBuilderView,
  deckSize,
  deckStatus,
  DEFAULT_CONTENT,
  editDeck,
  GameEngine,
  heroProfile,
  loadoutDeck,
  loadoutFor,
  ownedFor,
  parseProfileSave,
  replayBattle,
  saveActiveDeck,
  serializeProfile,
  starterDeck,
  validateDeck,
  verifyVictory,
  withHeroDeck,
  type DeckEntry,
  type PlayerProfile,
} from '../src/game';
import { validateLoadout } from '../src/game/pvp/duel';
import { handle } from '../server/src/index';
import { sanitizeLocalImport } from '../server/src/importLocal';
import { pvpRoute } from '../server/src/pvp';
import { createPlayer, loadPlayer } from '../server/src/repo';
import { playBattle } from './support/bot';
import { addAccount, memoryD1 } from './support/d1';

const C = DEFAULT_CONTENT;
const deck = (o: Record<string, number>): DeckEntry[] => Object.entries(o).map(([cardId, count]) => ({ cardId, count }));
const sorted = (d: readonly DeckEntry[]) => [...d].sort((a, b) => a.cardId.localeCompare(b.cardId));

/** The 20-card Mage starter every existing player was given before decks became 30 cards. */
const LEGACY_MAGE_20 = deck({ magic_missile: 3, fireball: 2, arcane_burst: 3, blink: 2, barrier: 3, force_push: 3, ice_wall: 2, phase_step: 2 });
const LEGACY_SUMMONER_20 = deck({ summon_chicken: 3, nurture: 3, summoner_ward: 3, summoner_push: 3, summoner_step: 3, summon_fox: 3, summoner_dispel: 2 });

/** A profile as an existing player's save holds it: old collection (= old starter copies) and old deck. */
function legacySave(): string {
  const fresh = createProfile(C);
  const mage = fresh.heroes.mage!;
  const oldCollection = Object.fromEntries(LEGACY_MAGE_20.map((e) => [e.cardId, { copies: e.count, acquired: 0 }]));
  const profile: PlayerProfile = {
    ...fresh,
    heroes: {
      ...fresh.heroes,
      mage: { ...mage, collection: oldCollection, decks: [{ id: 'main', name: 'Mi mazo de fuego', cards: LEGACY_MAGE_20 }] },
    },
  };
  return serializeProfile(profile);
}

function loadLegacy(): PlayerProfile {
  const load = parseProfileSave(legacySave(), C);
  if (load.status !== 'OK') throw new Error(load.status);
  return load.profile;
}

const owned = (p: PlayerProfile, heroId = 'mage') => ownedFor(p, heroId, C);
const mageStarter = () => starterDeck(C.heroes.mage!);

describe('exactly 30 cards', () => {
  it('DECK_RULES: one required size, no range', () => {
    expect(DECK_RULES.requiredSize).toBe(30);
    expect(DECK_RULES).not.toHaveProperty('minSize');
    expect(DECK_RULES).not.toHaveProperty('maxSize');
  });

  it('30 is valid, 29 is incomplete, 31 is too large', () => {
    const p = createProfile(C);
    const full = mageStarter();
    expect(deckSize(full)).toBe(30);
    expect(validateDeck(full, 'mage', owned(p), C, DECK_RULES)).toEqual([]);

    const short = editDeck(full, { type: 'REMOVE_CARD', cardId: 'barrier' }, 'mage', owned(p), C, DECK_RULES);
    if (!short.ok) throw new Error('remove failed');
    expect(validateDeck(short.deck, 'mage', owned(p), C, DECK_RULES)).toEqual([{ code: 'DECK_INCOMPLETE', current: 29, required: 30 }]);

    // 31 can only come from tampered data: the editor refuses the 31st card.
    const over = [...full, { cardId: 'frost_nova', count: 1 }];
    const owns = (id: string) => (id === 'frost_nova' ? 2 : owned(p)(id));
    expect(validateDeck(over, 'mage', owns, C, DECK_RULES)).toEqual([{ code: 'DECK_TOO_LARGE', current: 31, required: 30 }]);
    expect(editDeck(full, { type: 'ADD_CARD', cardId: 'frost_nova' }, 'mage', owns, C, DECK_RULES)).toEqual({
      ok: false,
      issue: { code: 'DECK_TOO_LARGE', current: 31, required: 30 },
    });
  });

  it('deckStatus reports totalCards / requiredCards / valid / missingCount', () => {
    const p = createProfile(C);
    expect(deckStatus(mageStarter(), 'mage', owned(p), C, DECK_RULES)).toMatchObject({
      totalCards: 30,
      requiredCards: 30,
      valid: true,
      missingCount: 0,
      excessCount: 0,
      legacy: false,
    });
    const minus3 = mageStarter().map((e) => (e.cardId === 'barrier' ? { ...e, count: 0 } : e)).filter((e) => e.count);
    expect(deckStatus(minus3, 'mage', owned(p), C, DECK_RULES)).toMatchObject({ totalCards: 27, valid: false, missingCount: 3, legacy: false });
  });
});

describe('ADD_CARD / REMOVE_CARD are explicit (no auto-fill)', () => {
  it('removing a card leaves a gap: nothing else changes, nothing is added', () => {
    const p = createProfile(C);
    const before = mageStarter();
    const r = editDeck(before, { type: 'REMOVE_CARD', cardId: 'fireball' }, 'mage', owned(p), C, DECK_RULES);
    if (!r.ok) throw new Error('remove failed');
    expect(deckSize(r.deck)).toBe(29);
    expect(countInDeck(r.deck, 'fireball')).toBe(countInDeck(before, 'fireball') - 1);
    // Every other line is untouched and no new card id appeared.
    for (const e of before) if (e.cardId !== 'fireball') expect(countInDeck(r.deck, e.cardId)).toBe(e.count);
    expect(r.deck.every((e) => before.some((b) => b.cardId === e.cardId))).toBe(true);
    // Removing again keeps shrinking; the deck stays incomplete until the player adds.
    const r2 = editDeck(r.deck, { type: 'REMOVE_CARD', cardId: 'barrier' }, 'mage', owned(p), C, DECK_RULES);
    expect(r2.ok && deckSize(r2.deck)).toBe(28);
  });

  it('removing a card that is not in the deck is refused (never a silent swap)', () => {
    const p = createProfile(C);
    expect(editDeck(mageStarter(), { type: 'REMOVE_CARD', cardId: 'frost_nova' }, 'mage', owned(p), C, DECK_RULES)).toEqual({
      ok: false,
      issue: { code: 'NOT_IN_DECK', cardId: 'frost_nova' },
    });
  });

  it('adding puts in exactly the chosen card: 30 → 29 → 30 with the player’s pick', () => {
    const p = createProfile(C);
    const owns = (id: string) => (id === 'frost_nova' ? 1 : owned(p)(id));
    const r = editDeck(mageStarter(), { type: 'REMOVE_CARD', cardId: 'barrier' }, 'mage', owns, C, DECK_RULES);
    if (!r.ok) throw new Error('remove failed');
    const a = editDeck(r.deck, { type: 'ADD_CARD', cardId: 'frost_nova' }, 'mage', owns, C, DECK_RULES);
    if (!a.ok) throw new Error('add failed');
    expect(deckSize(a.deck)).toBe(30);
    expect(countInDeck(a.deck, 'frost_nova')).toBe(1);
    expect(countInDeck(a.deck, 'barrier')).toBe(countInDeck(mageStarter(), 'barrier') - 1);
    expect(validateDeck(a.deck, 'mage', owns, C, DECK_RULES)).toEqual([]);
    // Saving re-checks against the profile's real collection (no Frost Nova owned there).
    expect(saveActiveDeck(p, 'mage', a.deck, C, DECK_RULES)).toMatchObject({ ok: false, issues: [{ code: 'LOCKED' }] });
  });

  it('copy caps hold: rarity limit and owned copies', () => {
    const p = createProfile(C);
    const r = editDeck(mageStarter(), { type: 'REMOVE_CARD', cardId: 'barrier' }, 'mage', owned(p), C, DECK_RULES);
    if (!r.ok) throw new Error('remove failed');
    // magic_missile is already at its COMMON limit of 3.
    expect(editDeck(r.deck, { type: 'ADD_CARD', cardId: 'magic_missile' }, 'mage', () => 9, C, DECK_RULES)).toMatchObject({
      ok: false,
      issue: { code: 'COPY_LIMIT', limit: 3 },
    });
    // Not owned at all.
    expect(editDeck(r.deck, { type: 'ADD_CARD', cardId: 'frost_nova' }, 'mage', owned(p), C, DECK_RULES)).toMatchObject({
      ok: false,
      issue: { code: 'LOCKED' },
    });
  });
});

describe('collection card contract: availableCopies = ownedCopies − deckCopies', () => {
  it('owned 3, deck 2 → 1 available; owned = deck → 0 and cannot add', () => {
    const owns = (id: string) => (id === 'fireball' ? 3 : 0);
    const two = deck({ fireball: 2 });
    expect(collectionCardStatus(two, 'fireball', 'mage', owns, C, DECK_RULES)).toEqual({
      cardId: 'fireball',
      ownedCopies: 3,
      deckCopies: 2,
      availableCopies: 1,
      maxCopies: 3,
      neutral: false,
      canAdd: true,
      addIssue: null,
    });
    const three = deck({ fireball: 3 });
    expect(collectionCardStatus(three, 'fireball', 'mage', owns, C, DECK_RULES)).toMatchObject({ availableCopies: 0, canAdd: false });
    // Owning more than the rarity cap: copies are "available" but the cap still blocks.
    const rare = collectionCardStatus(deck({ glacial_shell: 1 }), 'glacial_shell', 'mage', () => 4, C, DECK_RULES);
    expect(rare).toMatchObject({ ownedCopies: 4, deckCopies: 1, availableCopies: 3, maxCopies: 1, canAdd: false, addIssue: { code: 'COPY_LIMIT' } });
  });
});

describe('deck builder data contract (for the MI MAZO / COLECCIÓN DISPONIBLE UI)', () => {
  it('one view: deck totals + every collection card with owned / in deck / available / max', () => {
    const p = loadLegacy();
    const view = deckBuilderView(p, 'mage', LEGACY_MAGE_20, C, DECK_RULES);
    expect(view.deck).toMatchObject({ totalCards: 20, requiredCards: 30, valid: false, missingCount: 10, legacy: true });
    expect(view.collection).toHaveLength(Object.values(C.cards).filter((c) => c.heroId === 'mage' || c.heroId === undefined).length);
    // Legacy collection floored to the 30-card starter: 3 Fireballs owned, 2 in the old deck.
    expect(view.collection.find((c) => c.cardId === 'fireball')).toEqual({
      cardId: 'fireball',
      ownedCopies: 3,
      deckCopies: 2,
      availableCopies: 1,
      maxCopies: 3,
      neutral: false,
      canAdd: true,
      addIssue: null,
    });
    expect(view.collection.find((c) => c.cardId === 'frost_nova')).toMatchObject({ ownedCopies: 0, canAdd: false, addIssue: { code: 'LOCKED' } });
    // Sum of deckCopies is the deck size.
    expect(view.collection.reduce((n, c) => n + c.deckCopies, 0)).toBe(20);
  });
});

describe('starter decks', () => {
  for (const heroId of ['mage', 'summoner', 'warrior']) {
    it(`${heroId}: exactly 30 legal cards, owned by a fresh profile`, () => {
      const hero = C.heroes[heroId]!;
      const p = createProfile(C);
      expect(deckSize(hero.deck)).toBe(30);
      expect(validateDeck(hero.deck, heroId, owned(p, heroId), C, DECK_RULES)).toEqual([]);
      expect(activeDeck(heroProfile(p, heroId, C)).cards).toEqual(hero.deck);
      // Starters stay pure class identity: no ritual pieces or advanced summons (no expansion cards).
      for (const e of hero.deck) expect(C.cards[e.cardId]!.expansion).toBeUndefined();
    });
  }
});

describe('legacy 20-card decks', () => {
  it('load intact: same cards, counts and name; flagged legacy with 10 missing', () => {
    const p = loadLegacy();
    const d = activeDeck(heroProfile(p, 'mage', C));
    expect(d.name).toBe('Mi mazo de fuego');
    expect(sorted(d.cards)).toEqual(sorted(LEGACY_MAGE_20));
    expect(deckStatus(d.cards, 'mage', owned(p), C, DECK_RULES)).toMatchObject({
      totalCards: 20,
      requiredCards: 30,
      valid: false,
      legacy: true,
      missingCount: 10,
      issues: [{ code: 'DECK_INCOMPLETE', current: 20, required: 30 }],
    });
  });

  it('are never auto-migrated with cards (load, save round trip, battle resolution)', () => {
    const p = loadLegacy();
    const again = parseProfileSave(serializeProfile(p), C);
    expect(again.status === 'OK' && sorted(activeDeck(again.profile.heroes.mage!).cards)).toEqual(sorted(LEGACY_MAGE_20));
    const battle = battleDeck(p, 'mage', C, DECK_RULES);
    expect(battle.source).toBe('LEGACY');
    expect(sorted(battle.cards)).toEqual(sorted(LEGACY_MAGE_20));
    // The profile itself is unchanged by resolving the battle deck.
    expect(sorted(activeDeck(p.heroes.mage!).cards)).toEqual(sorted(LEGACY_MAGE_20));
  });

  it('cannot be saved again as 20; the player completes it by hand to 30 and saves', () => {
    const p = loadLegacy();
    expect(saveActiveDeck(p, 'mage', LEGACY_MAGE_20, C, DECK_RULES)).toMatchObject({ ok: false, issues: [{ code: 'DECK_INCOMPLETE' }] });
    // Starter copies are always owned, so the new starter cards are available to finish the deck.
    let cards: DeckEntry[] = LEGACY_MAGE_20;
    for (const cardId of ['fireball', 'blink', 'ice_wall', 'phase_step', 'repulse', 'repulse', 'glacial_field', 'glacial_field', 'flame_tile', 'flame_tile']) {
      const r = editDeck(cards, { type: 'ADD_CARD', cardId }, 'mage', owned(p), C, DECK_RULES);
      if (!r.ok) throw new Error(`${cardId}: ${r.issue.code}`);
      cards = r.deck;
    }
    const saved = saveActiveDeck(p, 'mage', cards, C, DECK_RULES);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const d = activeDeck(saved.profile.heroes.mage!);
    expect(d.name).toBe('Mi mazo de fuego');
    expect(deckSize(d.cards)).toBe(30);
    expect(battleDeck(saved.profile, 'mage', C, DECK_RULES).source).toBe('SAVED');
  });

  it('a non-legacy broken deck still falls back to the starter (only exact old-size decks are LEGACY)', () => {
    const p = createProfile(C);
    const p29 = { ...p, heroes: { ...p.heroes, mage: { ...p.heroes.mage!, decks: [{ id: 'main', name: 'x', cards: mageStarter().slice(1) }] } } };
    expect(battleDeck(p29, 'mage', C, DECK_RULES).source).toBe('STARTER');
    // 20 cards but including a card the player does not own: not legacy either.
    const bad = LEGACY_MAGE_20.map((e) => (e.cardId === 'barrier' ? { cardId: 'frost_nova', count: 3 } : e));
    const pBad = { ...p, heroes: { ...p.heroes, mage: { ...p.heroes.mage!, decks: [{ id: 'main', name: 'x', cards: bad }] } } };
    expect(battleDeck(pBad, 'mage', C, DECK_RULES).source).toBe('STARTER');
  });
});

describe('campaign + replay with the transition', () => {
  it('a legacy deck fights as saved and its victory proof verifies deterministically', () => {
    const p = loadLegacy();
    const run = createRun(ASCENT_CAMPAIGN, C, 1, 'mage');
    const content = campaignBattleContent(C, p, run, DECK_RULES);
    expect(sorted(content.heroes.mage!.deck)).toEqual(sorted(LEGACY_MAGE_20));
    const encounter = currentEncounter(ASCENT_CAMPAIGN, run);
    let proof = null;
    for (let seed = 1; seed < 40 && !proof; seed++) {
      const e = new GameEngine(encounter, content, seed);
      playBattle(e);
      if (e.state.outcome?.result === 'WON') proof = { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(e.history)) };
    }
    expect(proof).not.toBeNull();
    const a = replayBattle(encounter, content, proof!.seed, proof!.commands);
    const b = replayBattle(encounter, content, proof!.seed, proof!.commands);
    expect(a.state).toEqual(b.state);
    expect(verifyVictory(ASCENT_CAMPAIGN, C, p, run, proof!, DECK_RULES).ok).toBe(true);
  });

  it('a 30-card starter campaign battle verifies too', () => {
    const p = createProfile(C);
    const run = createRun(ASCENT_CAMPAIGN, C, 1, 'mage');
    const content = campaignBattleContent(C, p, run, DECK_RULES);
    expect(deckSize(content.heroes.mage!.deck)).toBe(30);
    const encounter = currentEncounter(ASCENT_CAMPAIGN, run);
    for (let seed = 1; seed < 40; seed++) {
      const e = new GameEngine(encounter, content, seed);
      playBattle(e);
      if (e.state.outcome?.result !== 'WON') continue;
      const proof = { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(e.history)) };
      expect(verifyVictory(ASCENT_CAMPAIGN, C, p, run, proof, DECK_RULES).ok).toBe(true);
      return;
    }
    throw new Error('bot could not win');
  });
});

describe('skirmish loadout', () => {
  it('uses the saved 30-card deck, or the legacy deck as saved', () => {
    const fresh = createProfile(C);
    expect(loadoutDeck(fresh, loadoutFor(fresh, 'mage', C), C, DECK_RULES)).toMatchObject({ source: 'SAVED' });
    const legacy = loadLegacy();
    const d = loadoutDeck(legacy, loadoutFor(legacy, 'mage', C), C, DECK_RULES);
    expect(d.source).toBe('LEGACY');
    expect(deckSize(d.cards)).toBe(20);
  });
});

describe('ritual decks at 30', () => {
  it('a 30-card ritual deck is legal and a ritual completes and activates', () => {
    const cards = deck({
      summon_fox: 3, summon_chicken: 2, summon_turtle: 2, summon_raven: 1, nurture: 2, summoner_ward: 2, recall_familiar: 1,
      rune_stone: 2, rune_shell: 2, mark_moon: 1, mark_fang: 1, mark_blood: 1,
      summoner_step: 3, summoner_blink: 3, entangle: 2, summoner_dispel: 2,
    });
    expect(deckSize(cards)).toBe(30);
    expect(validateDeck(cards, 'summoner', () => 9, C, DECK_RULES)).toEqual([]);
    // Pieces still occupy normal slots, at most 2 copies each (UNCOMMON), even with room in the deck.
    const room = cards.map((e) => (e.cardId === 'entangle' ? { ...e, count: 1 } : e));
    expect(editDeck(room, { type: 'ADD_CARD', cardId: 'rune_stone' }, 'summoner', () => 9, C, DECK_RULES)).toMatchObject({
      ok: false,
      issue: { code: 'COPY_LIMIT', limit: 2 },
    });

    // Play it: seal both runes over two turns and activate the minor ritual.
    const content = withHeroDeck(C, 'summoner', cards);
    let activated = false;
    for (let seed = 1; seed <= 25 && !activated; seed++) {
      const e = new GameEngine(currentEncounter(ASCENT_CAMPAIGN, createRun(ASCENT_CAMPAIGN, C, 1, 'summoner')), content, seed * 977);
      e.subscribe((events) => {
        if (events.some((ev) => ev.type === 'RITUAL_ACTIVATED')) activated = true;
      });
      playBattle(e, 20, undefined, { summonAware: true, rituals: true });
    }
    expect(activated).toBe(true);
  });
});

describe('PvP validates exactly 30 server-side', () => {
  it('validateLoadout: 30 accepted; 20 (legacy), 29 and 31 rejected', () => {
    const p = createProfile(C);
    expect(deckSize(validateLoadout(p, 'mage').cards)).toBe(30);
    const withDeck = (cards: DeckEntry[]): PlayerProfile => ({
      ...p,
      heroes: { ...p.heroes, mage: { ...p.heroes.mage!, decks: [{ id: 'main', name: 'x', cards }] } },
    });
    expect(() => validateLoadout(loadLegacy(), 'mage')).toThrow('INVALID_DECK');
    expect(() => validateLoadout(withDeck(mageStarter().slice(1)), 'mage')).toThrow('INVALID_DECK');
    const rich = { ...p, heroes: { ...p.heroes, mage: { ...p.heroes.mage!, collection: { ...p.heroes.mage!.collection, frost_nova: { copies: 2, acquired: 1 } } } } };
    const over = { ...rich, heroes: { ...rich.heroes, mage: { ...rich.heroes.mage, decks: [{ id: 'main', name: 'x', cards: [...mageStarter(), { cardId: 'frost_nova', count: 1 }] }] } } };
    expect(() => validateLoadout(over, 'mage')).toThrow('INVALID_DECK');
  });

  it('the Worker route refuses a manipulated (legacy 20) deck with the size in the message', async () => {
    const db = memoryD1();
    const { id } = addAccount(db, 'pvp_legacy');
    await createPlayer(db, id, 'pvp_legacy', loadLegacy(), [], { source: 'STARTER', importedAt: null, now: 0 });
    let forwarded = 0;
    const env = { DB: db, PVP_ROOMS: { idFromName: () => 'x', get: () => ({ fetch: async () => (forwarded++, new Response('{}')) }) } };
    const req = (heroId: string) =>
      new Request('https://api.test/api/tactics/pvp/join', { method: 'POST', body: JSON.stringify({ code: 'ABCDEFGH', heroId }) });
    const res = await pvpRoute(req('mage'), env as never, { userId: id, username: 'pvp_legacy' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string; totalCards: number } };
    expect(body.error).toMatchObject({ code: 'INVALID_DECK', totalCards: 20, requiredCards: 30 });
    expect(body.error.message).toContain('20/30');
    expect(forwarded).toBe(0);
    // A 30-card deck (the Summoner's untouched starter in that save) reaches the room.
    const ok = await pvpRoute(req('summoner'), env as never, { userId: id, username: 'pvp_legacy' });
    expect(ok.status).toBe(200);
    expect(forwarded).toBe(1);
  });
});

describe('Worker: deck saves, load and import keep the rules', () => {
  let db: ReturnType<typeof memoryD1>;
  const deps = { content: C, now: () => 1_000_000, seed: () => 7 };
  async function call(token: string, method: string, path: string, body?: unknown) {
    const res = await handle(
      new Request(`https://api.test/api/tactics${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { DB: db },
      deps,
    );
    return { status: res.status, body: (await res.json()) as { profile?: PlayerProfile; error?: { code: string; issues?: { code: string }[] } } };
  }
  beforeEach(() => {
    // Accounts from before champion unlocks: every released champion is playable.
    db = memoryD1({ legacyProfiles: true });
  });

  it('PUT deck: 30 saved; 20, 29 and 31 refused with the size issue', async () => {
    const { token } = addAccount(db, 'saver');
    await call(token, 'POST', '/profile', {});
    const full = mageStarter();
    const r29 = await call(token, 'PUT', '/decks/mage/main', { cards: full.slice(1) });
    expect(r29.status).toBe(422);
    expect(r29.body.error?.issues?.map((i) => i.code)).toContain('DECK_INCOMPLETE');
    expect((await call(token, 'PUT', '/decks/mage/main', { cards: LEGACY_MAGE_20 })).status).toBe(422);
    const r31 = await call(token, 'PUT', '/decks/mage/main', { cards: full.map((e) => (e.cardId === 'repulse' ? { ...e, count: 3 } : e)) });
    expect(r31.status).toBe(422);
    const ok = await call(token, 'PUT', '/decks/mage/main', { cards: full });
    expect(ok.status).toBe(200);
    expect(deckSize(activeDeck(ok.body.profile!.heroes.mage!).cards)).toBe(30);
  });

  it('a stored legacy deck reloads intact (reconnect) and the skirmish uses it as saved', async () => {
    const { id } = addAccount(db, 'legacy_cloud');
    await createPlayer(db, id, 'legacy_cloud', loadLegacy(), [], { source: 'STARTER', importedAt: null, now: 0 });
    const first = await loadPlayer(db, id, C);
    const second = await loadPlayer(db, id, C);
    for (const rec of [first!, second!]) {
      const d = activeDeck(rec.profile.heroes.mage!);
      expect(d.name).toBe('Mi mazo de fuego');
      expect(sorted(d.cards)).toEqual(sorted(LEGACY_MAGE_20));
    }
  });

  it('a summoner legacy deck goes into a cloud skirmish unchanged', async () => {
    const { id, token } = addAccount(db, 'legacy_skirmish');
    const p = loadLegacy();
    const legacy = { ...p, heroes: { ...p.heroes, summoner: { ...p.heroes.summoner!, decks: [{ id: 'main', name: 'Manada', cards: LEGACY_SUMMONER_20 }] } } };
    await createPlayer(db, id, 'legacy_skirmish', legacy, [], { source: 'STARTER', importedAt: null, now: 0 });
    const res = await call(token, 'POST', '/skirmish/start', { heroId: 'summoner', scenarioId: 'first_blood' });
    expect(res.status).toBe(200);
    const row = db.sql.prepare('SELECT deck_json FROM tactics_skirmishes WHERE user_id = ?').get(id) as { deck_json: string };
    expect(sorted(JSON.parse(row.deck_json))).toEqual(sorted(LEGACY_SUMMONER_20));
  });

  it('importing a local legacy save keeps the 20-card deck as it is', () => {
    const result = sanitizeLocalImport(legacySave(), null, C, DECK_RULES);
    if (!('profile' in result) || !result.profile) throw new Error('import failed');
    expect(sorted(activeDeck(result.profile.heroes.mage!).cards)).toEqual(sorted(LEGACY_MAGE_20));
  });
});
