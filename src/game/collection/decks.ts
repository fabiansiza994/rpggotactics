import { requireDef, type GameContent } from '../domain/content';
import { deckSize, deckStatus, validateDeck, type DeckEntry, type DeckIssue, type DeckRules } from './deck-rules';
import { heroProfile, ownedFor, starterDeck, type HeroProfile, type PlayerProfile, type SavedDeck } from './profile';

export { STARTER_DECK_NAME } from './profile';

/**
 * Several saved decks per champion (Bestiario, Rituales, Defensivo…), exactly one of them the
 * champion's DEFAULT (`HeroProfile.activeDeckId`): the deck every mode without a deck picker
 * fights with (campaign, champion stories). Decks never move between champions or accounts.
 *
 * Guest profiles use these pure operations; the Worker enforces the same rules in SQL
 * (server/src/decks.ts) so that limits hold under concurrent requests.
 */

/** Saved decks a champion may hold. Raising it needs no schema change (the limit lives in code). */
export const DEFAULT_DECK_SLOTS_PER_CHAMPION = 3;

export const DECK_NAME_MAX = 32;
export const NEW_DECK_NAME = 'Nuevo mazo';

/** Server deck ids and client-chosen request ids share this alphabet (also the URL segment). */
export const DECK_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;

/** UI contract: one card in "Mis Mazos". */
export interface ChampionDeckSummary {
  deckId: string;
  name: string;
  championId: string;
  cardCount: number;
  maxCards: number;
  /** Legal right now (size, ownership, Única/Ultra/neutral limits). PvP and Ranked require it. */
  valid: boolean;
  isDefault: boolean;
  /** Epoch ms; absent for a starter deck that was never stored. */
  createdAt?: number;
  updatedAt?: number;
}

export type DeckOpError =
  | 'UNKNOWN_DECK'
  | 'DECK_LIMIT'
  | 'LAST_DECK'
  | 'INVALID_NAME'
  | 'INVALID_DECK'
  | 'DUPLICATE_ID';

export type DeckOpResult =
  | { ok: true; profile: PlayerProfile; deckId: string }
  | { ok: false; error: DeckOpError; issues?: DeckIssue[] };

/** Trimmed, single-spaced, printable, 1..DECK_NAME_MAX characters; anything else is refused. */
export function normalizeDeckName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return name.length >= 1 && [...name].length <= DECK_NAME_MAX ? name : null;
}

/** "Bestiario" → "Copia de Bestiario", cut to the name limit. */
export const copyName = (name: string): string => [...`Copia de ${name}`].slice(0, DECK_NAME_MAX).join('').trim();

/** Decks in their stable order: creation time, then id (starter decks without a time first). */
export const orderedDecks = (decks: readonly SavedDeck[]): SavedDeck[] =>
  decks
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (a.d.createdAt ?? 0) - (b.d.createdAt ?? 0) || a.i - b.i)
    .map((x) => x.d);

/** The default after the current one is deleted: the oldest remaining deck (deterministic). */
export const fallbackDefault = (decks: readonly SavedDeck[]): SavedDeck | undefined => orderedDecks(decks)[0];

export const findDeck = (hero: HeroProfile, deckId: unknown): SavedDeck | undefined =>
  typeof deckId === 'string' ? hero.decks.find((d) => d.id === deckId) : undefined;

export function deckSummaries(profile: PlayerProfile, heroId: string, content: GameContent, rules: DeckRules): ChampionDeckSummary[] {
  const hero = heroProfile(profile, heroId, content);
  const owned = ownedFor(profile, heroId, content);
  const defaultId = hero.decks.some((d) => d.id === hero.activeDeckId) ? hero.activeDeckId : hero.decks[0]?.id;
  return orderedDecks(hero.decks).map((d) => ({
    deckId: d.id,
    name: d.name,
    championId: heroId,
    cardCount: deckSize(d.cards),
    maxCards: rules.requiredSize,
    valid: deckStatus(d.cards, heroId, owned, content, rules).valid,
    isDefault: d.id === defaultId,
    ...(d.createdAt !== undefined ? { createdAt: d.createdAt } : {}),
    ...(d.updatedAt !== undefined ? { updatedAt: d.updatedAt } : {}),
  }));
}

const withHero = (profile: PlayerProfile, hero: HeroProfile): PlayerProfile => ({
  ...profile,
  heroes: { ...profile.heroes, [hero.heroId]: hero },
});
const clone = (cards: readonly DeckEntry[]): DeckEntry[] => cards.map((e) => ({ ...e }));
/** Local id: unique within the champion, never reusing a deleted deck's id in the same call. */
const localId = (hero: HeroProfile, now: number): string => {
  for (let n = 0; ; n++) {
    const id = `d${now.toString(36)}${n ? `-${n}` : ''}`;
    if (!hero.decks.some((d) => d.id === id)) return id;
  }
};

/**
 * A new deck for `heroId`. Without `cards` it starts as the champion's starter list (always
 * owned and legal); with `cards` they must pass the Deck Builder rules. The first deck of a
 * champion becomes its default.
 */
export function createDeck(
  profile: PlayerProfile,
  heroId: string,
  input: { name?: unknown; cards?: readonly DeckEntry[]; id?: string },
  content: GameContent,
  rules: DeckRules,
  now: number,
  slots = DEFAULT_DECK_SLOTS_PER_CHAMPION,
): DeckOpResult {
  const hero = heroProfile(profile, heroId, content);
  if (input.id !== undefined && hero.decks.some((d) => d.id === input.id)) return { ok: false, error: 'DUPLICATE_ID' };
  if (hero.decks.length >= slots) return { ok: false, error: 'DECK_LIMIT' };
  const name = input.name === undefined ? NEW_DECK_NAME : normalizeDeckName(input.name);
  if (!name) return { ok: false, error: 'INVALID_NAME' };
  const cards = input.cards ? clone(input.cards) : starterDeck(requireDef(content.heroes, heroId, 'hero'));
  if (input.cards) {
    const issues = validateDeck(cards, heroId, ownedFor(profile, heroId, content), content, rules);
    if (issues.length) return { ok: false, error: 'INVALID_DECK', issues };
  }
  const id = input.id ?? localId(hero, now);
  const decks = [...hero.decks, { id, name, cards, createdAt: now, updatedAt: now }];
  const activeDeckId = hero.decks.length ? hero.activeDeckId : id;
  return { ok: true, deckId: id, profile: withHero(profile, { ...hero, decks, activeDeckId }) };
}

export function renameDeck(profile: PlayerProfile, heroId: string, deckId: string, rawName: unknown, content: GameContent, now: number): DeckOpResult {
  const hero = heroProfile(profile, heroId, content);
  if (!findDeck(hero, deckId)) return { ok: false, error: 'UNKNOWN_DECK' };
  const name = normalizeDeckName(rawName);
  if (!name) return { ok: false, error: 'INVALID_NAME' };
  const decks = hero.decks.map((d) => (d.id === deckId ? { ...d, name, updatedAt: now } : d));
  return { ok: true, deckId, profile: withHero(profile, { ...hero, decks }) };
}

/** Replaces one deck's cards after the Deck Builder validation. Invalid decks are refused, never trimmed. */
export function updateDeck(
  profile: PlayerProfile,
  heroId: string,
  deckId: string,
  cards: readonly DeckEntry[],
  content: GameContent,
  rules: DeckRules,
  now: number,
): DeckOpResult {
  const hero = heroProfile(profile, heroId, content);
  if (!findDeck(hero, deckId)) return { ok: false, error: 'UNKNOWN_DECK' };
  const issues = validateDeck(cards, heroId, ownedFor(profile, heroId, content), content, rules);
  if (issues.length) return { ok: false, error: 'INVALID_DECK', issues };
  const decks = hero.decks.map((d) => (d.id === deckId ? { ...d, cards: clone(cards), updatedAt: now } : d));
  return { ok: true, deckId, profile: withHero(profile, { ...hero, decks }) };
}

/** "Copia de X": same cards, new id, counts against the slot limit. Never becomes the default. */
export function duplicateDeck(
  profile: PlayerProfile,
  heroId: string,
  deckId: string,
  content: GameContent,
  now: number,
  slots = DEFAULT_DECK_SLOTS_PER_CHAMPION,
  id?: string,
): DeckOpResult {
  const hero = heroProfile(profile, heroId, content);
  const source = findDeck(hero, deckId);
  if (!source) return { ok: false, error: 'UNKNOWN_DECK' };
  if (id !== undefined && hero.decks.some((d) => d.id === id)) return { ok: false, error: 'DUPLICATE_ID' };
  if (hero.decks.length >= slots) return { ok: false, error: 'DECK_LIMIT' };
  const copy = { id: id ?? localId(hero, now), name: copyName(source.name), cards: clone(source.cards), createdAt: now, updatedAt: now };
  return { ok: true, deckId: copy.id, profile: withHero(profile, { ...hero, decks: [...hero.decks, copy] }) };
}

/** Deleting the default promotes the oldest remaining deck. A champion always keeps one deck. */
export function deleteDeck(profile: PlayerProfile, heroId: string, deckId: string, content: GameContent): DeckOpResult {
  const hero = heroProfile(profile, heroId, content);
  if (!findDeck(hero, deckId)) return { ok: false, error: 'UNKNOWN_DECK' };
  if (hero.decks.length <= 1) return { ok: false, error: 'LAST_DECK' };
  const decks = hero.decks.filter((d) => d.id !== deckId);
  const activeDeckId = hero.activeDeckId === deckId || !decks.some((d) => d.id === hero.activeDeckId) ? fallbackDefault(decks)!.id : hero.activeDeckId;
  return { ok: true, deckId: activeDeckId, profile: withHero(profile, { ...hero, decks, activeDeckId }) };
}

export function setDefaultDeck(profile: PlayerProfile, heroId: string, deckId: string, content: GameContent): DeckOpResult {
  const hero = heroProfile(profile, heroId, content);
  if (!findDeck(hero, deckId)) return { ok: false, error: 'UNKNOWN_DECK' };
  return { ok: true, deckId, profile: withHero(profile, { ...hero, activeDeckId: deckId }) };
}
