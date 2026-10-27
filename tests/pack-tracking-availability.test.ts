import { beforeEach, describe, expect, it } from 'vitest';
import {
  DECK_RULES,
  DEFAULT_CONTENT,
  addCard,
  createProfile,
  deckStatus,
  ownedFor,
  parseProfileSave,
  removeCard,
  saveActiveDeck,
  serializeProfile,
  starterDeck,
  starterHeroProfile,
  validateDeck,
  type DeckEntry,
  type GameContent,
  type PlayerProfile,
} from '../src/game';
import { FINAL_CARD_ART } from '../src/presentation/assets/paintedAssets';
import { handle } from '../server/src/index';
import { addAccount, memoryD1 } from './support/d1';

/**
 * «Rastreo de la Manada» is available to the Summoner by default (decision 2026-10-15): owned from
 * the start through `HeroDef.starterCollection`, NOT part of the 30-card starter deck, never
 * needing a reward/purchase. Ownership stays server-validated (`ownedFor`).
 */
const CARD = 'pack_tracking';
const summoner = DEFAULT_CONTENT.heroes.summoner!;
const total = (deck: readonly DeckEntry[]) => deck.reduce((n, c) => n + c.count, 0);
/** Content as it was before this change (no owned-by-default card): "existing" players. */
const OLD: GameContent = {
  ...DEFAULT_CONTENT,
  heroes: { ...DEFAULT_CONTENT.heroes, summoner: { ...summoner, starterCollection: undefined } },
};
/** Swap `n` starter copies (from different cards) for `n` Rastreo copies: still 30 cards. */
function withRastreo(n: number): DeckEntry[] {
  let deck = starterDeck(summoner);
  for (const id of ['summoner_push', 'summoner_step', 'summoner_blink', 'summoner_dispel'].slice(0, n))
    deck = addCard(removeCard(deck, id), CARD);
  return deck;
}

describe('Rastreo de la Manada: default availability (rules)', () => {
  it('the Summoner owns 3 copies from the start; the 30-card starter is unchanged', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    expect(ownedFor(profile, 'summoner', DEFAULT_CONTENT)(CARD)).toBe(3);
    expect(total(summoner.deck)).toBe(30);
    expect(summoner.deck.some((c) => c.cardId === CARD)).toBe(false);
    expect(profile.heroes.summoner!.decks[0]!.cards.some((c) => c.cardId === CARD)).toBe(false);
  });

  it('grants nothing else: the default collection is the starter deck plus Rastreo only', () => {
    const extra = Object.keys(starterHeroProfile(summoner, DEFAULT_CONTENT).collection).filter(
      (id) => !summoner.deck.some((c) => c.cardId === id),
    );
    expect(extra).toEqual([CARD]);
    for (const hero of ['mage', 'warrior']) {
      const def = DEFAULT_CONTENT.heroes[hero]!;
      expect(Object.keys(starterHeroProfile(def, DEFAULT_CONTENT).collection).sort()).toEqual(
        [...new Set(def.deck.map((c) => c.cardId))].filter((id) => DEFAULT_CONTENT.cards[id]!.heroId).sort(),
      );
      expect(ownedFor(createProfile(DEFAULT_CONTENT), hero, DEFAULT_CONTENT)(CARD)).toBe(0);
    }
  });

  it('is a plain Summoner card: own id, final art, no QA set, no exclusive source', () => {
    const card = DEFAULT_CONTENT.cards[CARD]!;
    expect(card).toMatchObject({ id: CARD, heroId: 'summoner', cost: 1, rarity: 'COMMON', deckSearch: 'SUMMON' });
    expect(card.expansion).toBeUndefined();
    expect(card.acquisition).toBeUndefined();
    expect(FINAL_CARD_ART[CARD]).toBe('/art/summoner-cards/pack_tracking.webp');
  });

  it('existing guest saves (written before the change) own it on load', () => {
    const old = createProfile(OLD);
    expect(ownedFor(old, 'summoner', OLD)(CARD)).toBe(0);
    const loaded = parseProfileSave(serializeProfile(old), DEFAULT_CONTENT);
    expect(loaded.status).toBe('OK');
    if (loaded.status !== 'OK') return;
    expect(ownedFor(loaded.profile, 'summoner', DEFAULT_CONTENT)(CARD)).toBe(3);
  });

  it('add / remove within copy and size limits; other champions cannot use it', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    const owned = ownedFor(profile, 'summoner', DEFAULT_CONTENT);
    for (const n of [1, 2, 3]) expect(validateDeck(withRastreo(n), 'summoner', owned, DEFAULT_CONTENT, DECK_RULES), `x${n}`).toEqual([]);
    const four = addCard(removeCard(withRastreo(3), 'nurture'), CARD);
    expect(validateDeck(four, 'summoner', owned, DEFAULT_CONTENT, DECK_RULES).length).toBeGreaterThan(0);
    const thirtyOne = addCard(starterDeck(summoner), CARD);
    expect(validateDeck(thirtyOne, 'summoner', owned, DEFAULT_CONTENT, DECK_RULES).length).toBeGreaterThan(0);
    const saved = saveActiveDeck(profile, 'summoner', withRastreo(2), DEFAULT_CONTENT, DECK_RULES);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    // Removing it again is just another legal 30-card list.
    expect(saveActiveDeck(saved.profile, 'summoner', starterDeck(summoner), DEFAULT_CONTENT, DECK_RULES).ok).toBe(true);
    const mage = addCard(removeCard(starterDeck(DEFAULT_CONTENT.heroes.mage!), 'blink'), CARD);
    expect(validateDeck(mage, 'mage', ownedFor(profile, 'mage', DEFAULT_CONTENT), DEFAULT_CONTENT, DECK_RULES).length).toBeGreaterThan(0);
  });

  it('PvP deck status accepts a deck with it (same check the PvP Worker runs)', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    const status = deckStatus(withRastreo(3), 'summoner', ownedFor(profile, 'summoner', DEFAULT_CONTENT), DEFAULT_CONTENT, DECK_RULES);
    expect(JSON.stringify(status)).not.toMatch(/NOT_ENOUGH_COPIES|WRONG_HERO|NOT_OWNED/);
    expect(status).toMatchObject({ valid: true, totalCards: 30 });
  });
});

describe('Rastreo de la Manada: Worker (D1) accounts', () => {
  let db: ReturnType<typeof memoryD1>;
  beforeEach(() => {
    db = memoryD1({ legacyProfiles: true });
  });
  const call = async (token: string, method: string, path: string, content: GameContent, body?: unknown) => {
    const req = new Request(`https://api.test/api/tactics${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await handle(req, { DB: db }, { content, now: () => 1_000_000, seed: () => 7 });
    return { status: res.status, body: (await res.json()) as { profile: PlayerProfile; error?: { issues?: { code: string }[] } } };
  };

  it('an account created before the change owns it on load and can save a deck with it', async () => {
    const { id, token } = addAccount(db, 'ana');
    await call(token, 'POST', '/profile', OLD, {});
    const rows = db.sql.prepare("SELECT copies FROM tactics_player_cards WHERE user_id = ? AND card_id = 'pack_tracking'").all(id);
    expect(rows).toEqual([]); // nothing stored: no migration needed
    const state = await call(token, 'GET', '/state', DEFAULT_CONTENT);
    expect(state.body.profile.heroes.summoner!.collection[CARD]?.copies).toBe(3);
    expect((await call(token, 'PUT', '/decks/summoner/main', DEFAULT_CONTENT, { cards: withRastreo(3) })).status).toBe(200);
  });

  it('a new account owns it; the server still rejects 4 copies and other champions', async () => {
    const { token } = addAccount(db, 'bruno');
    const created = await call(token, 'POST', '/profile', DEFAULT_CONTENT, {});
    expect(created.body.profile.heroes.summoner!.collection[CARD]?.copies).toBe(3);
    const four = addCard(removeCard(withRastreo(3), 'nurture'), CARD);
    const rejected = await call(token, 'PUT', '/decks/summoner/main', DEFAULT_CONTENT, { cards: four });
    expect(rejected.status).toBe(422);
    const mage = addCard(removeCard(starterDeck(DEFAULT_CONTENT.heroes.mage!), 'blink'), CARD);
    const wrong = await call(token, 'PUT', '/decks/mage/main', DEFAULT_CONTENT, { cards: mage });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error!.issues!.map((i) => i.code)).toContain('WRONG_HERO');
  });
});
