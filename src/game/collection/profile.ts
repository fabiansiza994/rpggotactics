import type { CardDefinition } from '../domain/cards/card';
import type { ChampionProgress } from './champion-unlocks';
import { requireDef, type GameContent, type HeroDef } from '../domain/content';
import {
  isCardForHero,
  isLegacyDeck,
  validateDeck,
  type DeckEntry,
  type DeckIssue,
  type DeckRules,
  type OwnedCopies,
} from './deck-rules';

/**
 * Player progression that outlives a campaign run: what each hero has collected and the
 * decks built from it. COLLECTION (owned copies) and DECK (what enters battle) are separate:
 * unlocking a card never equips it. Plain serialisable data; persisted by the presentation.
 */
export interface OwnedCard {
  copies: number;
  /** Order of the latest acquisition (starter cards = 0). Drives "recently unlocked". */
  acquired: number;
}

/** A named deck list. A hero holds up to DEFAULT_DECK_SLOTS_PER_CHAMPION of them (decks.ts). */
export interface SavedDeck {
  id: string;
  name: string;
  cards: DeckEntry[];
  /** Epoch ms. Absent on a starter deck that was never saved (and on pre-multi-deck saves). */
  createdAt?: number;
  updatedAt?: number;
}

export interface HeroProfile {
  heroId: string;
  collection: Record<string, OwnedCard>;
  /** Last `acquired` value handed out. */
  acquisitions: number;
  decks: SavedDeck[];
  activeDeckId: string;
  /** Wins in a row without a card reward (see PITY_THRESHOLD). Authoritative on the server. */
  rewardPity: number;
}

/**
 * Neutral cards (no `heroId`) are owned once per account, whichever champion earned them, and
 * every compatible champion can equip them in its own decks. Class cards never live here.
 */
export interface SharedCollection {
  collection: Record<string, OwnedCard>;
  /** Last `acquired` value handed out for neutral cards (its own counter). */
  acquisitions: number;
}

/** Storage id of the shared pool where a per-champion id is expected (D1 `hero_id`). */
export const SHARED_POOL_ID = '*';

export interface PlayerProfile {
  heroes: Record<string, HeroProfile>;
  /** Neutral cards. Missing in saves from before neutral cards existed (= starter neutrals only). */
  shared?: SharedCollection;
  /**
   * The champion the player chose for selectable modes (Skirmish, future PvP). Modes with a
   * fixed hero (the Mage campaign) ignore it. Champion = who you play; the deck lives in `heroes`.
   */
  selectedChampionId: string;
  /**
   * Which champions the player owns (onboarding + milestones). Missing = a profile from before
   * champion unlocks: every released champion stays unlocked (see champion-unlocks.ts).
   */
  champions?: ChampionProgress;
}

export const STARTER_DECK_ID = 'main';
/** Name of a brand-new champion's starter deck. Decks saved before multi-deck keep "Mazo principal". */
export const STARTER_DECK_NAME = 'Mazo inicial';

export type ProfileResult = { ok: true; profile: PlayerProfile } | { ok: false; issues: DeckIssue[] };

const cloneDeck = (cards: readonly DeckEntry[]): DeckEntry[] => cards.map((e) => ({ ...e }));

/** The hero definition's deck: always owned and always legal (enforced by tests). */
export const starterDeck = (hero: HeroDef): DeckEntry[] => cloneDeck(hero.deck);

export const isNeutral = (card: CardDefinition): boolean => card.heroId === undefined;

/** Starter copies per card of one hero's deck. */
function starterCopies(hero: HeroDef): Map<string, number> {
  const copies = new Map<string, number>();
  for (const e of hero.deck) copies.set(e.cardId, (copies.get(e.cardId) ?? 0) + e.count);
  return copies;
}

/**
 * Fresh progress for a hero: the starter deck's class copies are its collection. Starter
 * neutral copies are owned by the account instead (see `starterShared`).
 */
export function starterHeroProfile(hero: HeroDef, content: GameContent): HeroProfile {
  const collection: Record<string, OwnedCard> = {};
  for (const [cardId, copies] of starterCopies(hero)) {
    const card = content.cards[cardId];
    if (card && isNeutral(card)) continue;
    collection[cardId] = { copies, acquired: 0 };
  }
  // Owned-by-default class cards outside the starter deck (never neutral: those are shared).
  for (const { cardId, count } of hero.starterCollection ?? []) {
    const card = content.cards[cardId];
    if (!card || isNeutral(card) || !isCardForHero(card, hero.id)) continue;
    collection[cardId] = { copies: Math.max(count, collection[cardId]?.copies ?? 0), acquired: 0 };
  }
  return {
    heroId: hero.id,
    collection,
    acquisitions: 0,
    decks: [{ id: STARTER_DECK_ID, name: STARTER_DECK_NAME, cards: starterDeck(hero) }],
    activeDeckId: STARTER_DECK_ID,
    rewardPity: 0,
  };
}

/** The content's default champion when it exists, otherwise its first hero. */
export function defaultChampionId(content: GameContent): string {
  const id = content.defaultHeroId;
  return id && content.heroes[id] ? id : Object.keys(content.heroes)[0]!;
}

/** Neutral starter copies: always owned, as many as the most generous starter deck holds. */
export function starterShared(content: GameContent): SharedCollection {
  const collection: Record<string, OwnedCard> = {};
  for (const hero of Object.values(content.heroes))
    for (const [cardId, copies] of starterCopies(hero)) {
      const card = content.cards[cardId];
      if (!card || !isNeutral(card)) continue;
      collection[cardId] = { copies: Math.max(copies, collection[cardId]?.copies ?? 0), acquired: 0 };
    }
  return { collection, acquisitions: 0 };
}

export function createProfile(content: GameContent): PlayerProfile {
  return {
    heroes: Object.fromEntries(Object.values(content.heroes).map((h) => [h.id, starterHeroProfile(h, content)])),
    shared: starterShared(content),
    selectedChampionId: defaultChampionId(content),
  };
}

/** The hero's progress; a hero added to the content after the save starts from its starter set. */
export function heroProfile(profile: PlayerProfile, heroId: string, content: GameContent): HeroProfile {
  return profile.heroes[heroId] ?? starterHeroProfile(requireDef(content.heroes, heroId, 'hero'), content);
}

/** Where a granted copy of `cardId` is stored: the shared pool for neutral cards, else `heroId`. */
export function collectionOwner(content: GameContent, heroId: string, cardId: string): string {
  const card = content.cards[cardId];
  return card && isNeutral(card) ? SHARED_POOL_ID : heroId;
}

/** The account's neutral cards (a save without the pool owns the starter neutrals). */
export const sharedPool = (profile: PlayerProfile, content: GameContent): SharedCollection =>
  profile.shared ?? starterShared(content);

/**
 * The owned entry `heroId` can use for `cardId`: the shared pool for neutral cards, the hero's
 * own collection for class cards, nothing for another class's card.
 */
export function ownedCard(profile: PlayerProfile, heroId: string, cardId: string, content: GameContent): OwnedCard | undefined {
  const card = content.cards[cardId];
  if (!card || !isCardForHero(card, heroId)) return undefined;
  return isNeutral(card) ? sharedPool(profile, content).collection[cardId] : heroProfile(profile, heroId, content).collection[cardId];
}

/** Copies of each card `heroId` may equip (class collection + shared neutral pool). */
export const ownedFor =
  (profile: PlayerProfile, heroId: string, content: GameContent): OwnedCopies =>
  (cardId) =>
    ownedCard(profile, heroId, cardId, content)?.copies ?? 0;

export const isUnlocked = (profile: PlayerProfile, heroId: string, cardId: string, content: GameContent): boolean =>
  ownedFor(profile, heroId, content)(cardId) > 0;

export function activeDeck(hero: HeroProfile): SavedDeck {
  return hero.decks.find((d) => d.id === hero.activeDeckId) ?? hero.decks[0]!;
}

const withHero = (profile: PlayerProfile, hero: HeroProfile): PlayerProfile => ({
  ...profile,
  heroes: { ...profile.heroes, [hero.heroId]: hero },
});

/** Same profile with one champion's pity replaced. */
export function withPity(profile: PlayerProfile, heroId: string, pity: number, content: GameContent): PlayerProfile {
  const hero = heroProfile(profile, heroId, content);
  return withHero(profile, { ...hero, rewardPity: Math.max(0, Math.floor(pity)) });
}

/**
 * One more copy of a card joins the collection (campaign/skirmish reward, store). A class card
 * goes to that hero; a neutral card goes to the account's shared pool, whichever champion
 * earned it. It is NOT added to any deck: the player equips it in the Deck Builder.
 */
export function grantCard(
  profile: PlayerProfile,
  heroId: string,
  cardId: string,
  content: GameContent,
): { ok: true; profile: PlayerProfile } | { ok: false; error: string } {
  const card = content.cards[cardId];
  if (!card) return { ok: false, error: `unknown card "${cardId}"` };
  if (!isCardForHero(card, heroId)) return { ok: false, error: `"${cardId}" is not a ${heroId} card` };
  if (isNeutral(card)) {
    const shared = sharedPool(profile, content);
    const acquisitions = shared.acquisitions + 1;
    const copies = (shared.collection[cardId]?.copies ?? 0) + 1;
    return {
      ok: true,
      profile: { ...profile, shared: { acquisitions, collection: { ...shared.collection, [cardId]: { copies, acquired: acquisitions } } } },
    };
  }
  const hero = heroProfile(profile, heroId, content);
  const acquisitions = hero.acquisitions + 1;
  const copies = (hero.collection[cardId]?.copies ?? 0) + 1;
  return {
    ok: true,
    profile: withHero(profile, {
      ...hero,
      acquisitions,
      collection: { ...hero.collection, [cardId]: { copies, acquired: acquisitions } },
    }),
  };
}

/** Replace the active deck after validating it with the shared rules. Invalid decks are refused, never trimmed. */
export function saveActiveDeck(
  profile: PlayerProfile,
  heroId: string,
  cards: readonly DeckEntry[],
  content: GameContent,
  rules: DeckRules,
): ProfileResult {
  const hero = heroProfile(profile, heroId, content);
  const issues = validateDeck(cards, heroId, ownedFor(profile, heroId, content), content, rules);
  if (issues.length) return { ok: false, issues };
  const current = activeDeck(hero);
  const decks = hero.decks.map((d) => (d.id === current.id ? { ...d, cards: cloneDeck(cards) } : d));
  return { ok: true, profile: withHero(profile, { ...hero, decks }) };
}

export interface BattleDeck {
  cards: DeckEntry[];
  /**
   * SAVED: the active deck, fully legal. LEGACY: the active deck saved under the old size
   * (20), otherwise legal, used exactly as saved during the transition. STARTER: the saved
   * deck is broken in another way (e.g. content changed), so the always-legal starter fights.
   */
  source: 'SAVED' | 'LEGACY' | 'STARTER';
  issues: DeckIssue[];
}

/**
 * The deck a campaign or skirmish battle uses (`deckId`, else the default): the saved deck when it passes the same
 * validation as the Deck Builder, or when it is a LEGACY deck (transition: an existing
 * 20-card deck keeps working until its owner completes it; it is never refilled for them).
 * Anything else falls back to the starter deck. PvP is stricter (exactly 30, see duel.ts).
 */
export function battleDeck(profile: PlayerProfile, heroId: string, content: GameContent, rules: DeckRules, deckId?: string): BattleDeck {
  const hero = heroProfile(profile, heroId, content);
  const chosen = deckId === undefined ? activeDeck(hero) : hero.decks.find((d) => d.id === deckId);
  if (!chosen) throw new Error(`deck "${deckId}" does not belong to champion "${heroId}"`);
  const saved = chosen.cards;
  const issues = validateDeck(saved, heroId, ownedFor(profile, heroId, content), content, rules);
  if (issues.length === 0) return { cards: cloneDeck(saved), source: 'SAVED', issues };
  if (isLegacyDeck(saved, issues, rules)) return { cards: cloneDeck(saved), source: 'LEGACY', issues };
  return { cards: starterDeck(requireDef(content.heroes, heroId, 'hero')), source: 'STARTER', issues };
}

/** Content whose hero fights with `cards`. The engine receives it like any injected content. */
export function withHeroDeck(content: GameContent, heroId: string, cards: readonly DeckEntry[]): GameContent {
  const hero = requireDef(content.heroes, heroId, 'hero');
  return { ...content, heroes: { ...content.heroes, [hero.id]: { ...hero, deck: cloneDeck(cards) } } };
}
