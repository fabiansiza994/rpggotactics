import type { CardDefinition } from '../domain/cards/card';
import type { GameContent } from '../domain/content';

export type CardRarity = NonNullable<CardDefinition['rarity']>;

/** One line of a deck list. Draw order is shuffled in battle, so lists are unordered. */
export interface DeckEntry {
  cardId: string;
  count: number;
}

export interface DeckRules {
  /** Every playable deck holds exactly this many cards (no minimum/maximum range). */
  requiredSize: number;
  /**
   * Size decks had under the previous rules. A saved deck of exactly this size that passes
   * every other rule is LEGACY: kept untouched, shown as incomplete, never refilled for the
   * player. Campaign/skirmish still accept it during the transition; PvP and saving do not.
   */
  legacySize?: number;
  /** Most copies of one card a deck may hold, by card rarity (missing rarity = COMMON). */
  maxCopiesByRarity: Readonly<Record<CardRarity, number>>;
  /**
   * Most neutral cards (no `heroId`, every copy counts) one deck may hold, so a champion's deck
   * stays mostly its own. Absent = no limit.
   */
  maxNeutralCards?: number;
  /** Most ULTRA copies one deck may hold, all Ultras together (free catalog). Absent = no limit. */
  maxUltraCards?: number;
}

/**
 * Why a deck (or adding one card to it) is not allowed. Codes only: the UI words them.
 * Every check the Deck Builder shows is the same one battle deck resolution runs.
 */
export type DeckIssue =
  | { code: 'DECK_INCOMPLETE'; current: number; required: number }
  | { code: 'DECK_TOO_LARGE'; current: number; required: number }
  | { code: 'UNKNOWN_CARD'; cardId: string }
  | { code: 'WRONG_HERO'; cardId: string; heroId: string }
  | { code: 'LOCKED'; cardId: string }
  | { code: 'NOT_ENOUGH_COPIES'; cardId: string; count: number; owned: number }
  | { code: 'COPY_LIMIT'; cardId: string; count: number; limit: number }
  | { code: 'NEUTRAL_LIMIT'; count: number; limit: number }
  | { code: 'ULTRA_LIMIT'; count: number; limit: number }
  | { code: 'MALFORMED_ENTRY'; cardId: string };

export type DeckIssueCode = DeckIssue['code'];

/** Copies of each card the player owns for this hero (0 = locked). */
export type OwnedCopies = (cardId: string) => number;

export const deckSize = (deck: readonly DeckEntry[]): number => deck.reduce((n, e) => n + e.count, 0);

export const countInDeck = (deck: readonly DeckEntry[], cardId: string): number =>
  deck.reduce((n, e) => (e.cardId === cardId ? n + e.count : n), 0);

export const rarityOf = (card: CardDefinition): CardRarity => card.rarity ?? 'COMMON';

/** Única is always 1 copy; else the per-card override (`CardDefinition.maxCopies`), else the rarity limit. */
export const copyLimit = (card: CardDefinition, rules: DeckRules): number =>
  card.unique ? 1 : (card.maxCopies ?? rules.maxCopiesByRarity[rarityOf(card)] ?? 1);

/** Neutral copies in a deck (unknown ids are not neutral: they are reported as UNKNOWN_CARD). */
export const neutralCount = (deck: readonly DeckEntry[], content: GameContent): number =>
  deck.reduce((n, e) => (content.cards[e.cardId] && content.cards[e.cardId]!.heroId === undefined ? n + e.count : n), 0);

/** Ultra copies in a deck (every Ultra counts, whatever its champion). */
export const ultraCount = (deck: readonly DeckEntry[], content: GameContent): number =>
  deck.reduce((n, e) => (content.cards[e.cardId]?.rarity === 'ULTRA' ? n + e.count : n), 0);

const ultraIssue = (count: number, rules: DeckRules): DeckIssue | null =>
  rules.maxUltraCards !== undefined && count > rules.maxUltraCards ? { code: 'ULTRA_LIMIT', count, limit: rules.maxUltraCards } : null;

/** The neutral-limit issue for a deck holding `count` neutral copies, if any. */
const neutralIssue = (count: number, rules: DeckRules): DeckIssue | null =>
  rules.maxNeutralCards !== undefined && count > rules.maxNeutralCards
    ? { code: 'NEUTRAL_LIMIT', count, limit: rules.maxNeutralCards }
    : null;

/** Neutral cards (no `heroId`) belong to every hero's collection. */
export const isCardForHero = (card: CardDefinition, heroId: string): boolean =>
  card.heroId === undefined || card.heroId === heroId;

/** The hero's whole card pool, locked or not, in authored order. */
export function cardsForHero(content: GameContent, heroId: string): CardDefinition[] {
  return Object.values(content.cards).filter((c) => isCardForHero(c, heroId));
}

/** Most copies of `cardId` this player may put in a deck: owned copies capped by the rarity limit. */
export function usableCopies(cardId: string, owned: OwnedCopies, content: GameContent, rules: DeckRules): number {
  const card = content.cards[cardId];
  return card ? Math.min(owned(cardId), copyLimit(card, rules)) : 0;
}

/** Problems with holding `count` copies of one card (size rules aside). */
function entryIssues(
  cardId: string,
  count: number,
  heroId: string,
  owned: OwnedCopies,
  content: GameContent,
  rules: DeckRules,
): DeckIssue[] {
  const card = content.cards[cardId];
  if (!card) return [{ code: 'UNKNOWN_CARD', cardId }];
  if (!isCardForHero(card, heroId)) return [{ code: 'WRONG_HERO', cardId, heroId }];
  const have = owned(cardId);
  if (have <= 0) return [{ code: 'LOCKED', cardId }];
  const issues: DeckIssue[] = [];
  const limit = copyLimit(card, rules);
  if (count > limit) issues.push({ code: 'COPY_LIMIT', cardId, count, limit });
  if (count > have) issues.push({ code: 'NOT_ENOUGH_COPIES', cardId, count, owned: have });
  return issues;
}

/**
 * Full deck validation. Empty array = legal deck. Never alters the deck: callers decide what
 * to do (the builder shows the issues, battle resolution falls back to the starter deck).
 */
export function validateDeck(
  deck: readonly DeckEntry[],
  heroId: string,
  owned: OwnedCopies,
  content: GameContent,
  rules: DeckRules,
): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const counts = new Map<string, number>();
  for (const e of deck) {
    if (typeof e.cardId !== 'string' || !Number.isInteger(e.count) || e.count <= 0) {
      issues.push({ code: 'MALFORMED_ENTRY', cardId: String(e.cardId) });
      continue;
    }
    counts.set(e.cardId, (counts.get(e.cardId) ?? 0) + e.count);
  }
  for (const [cardId, count] of counts) issues.push(...entryIssues(cardId, count, heroId, owned, content, rules));
  const entries = [...counts].map(([cardId, count]) => ({ cardId, count }));
  const neutral = neutralIssue(neutralCount(entries, content), rules);
  if (neutral) issues.push(neutral);
  const ultra = ultraIssue(ultraCount(entries, content), rules);
  if (ultra) issues.push(ultra);
  const current = [...counts.values()].reduce((n, c) => n + c, 0);
  if (current < rules.requiredSize) issues.push({ code: 'DECK_INCOMPLETE', current, required: rules.requiredSize });
  if (current > rules.requiredSize) issues.push({ code: 'DECK_TOO_LARGE', current, required: rules.requiredSize });
  return issues;
}

/**
 * Whether one more copy of `cardId` may join the deck being edited. Incomplete decks are
 * fine while editing (that is only a save/battle issue); everything else matches validateDeck.
 */
export function addCardIssue(
  deck: readonly DeckEntry[],
  cardId: string,
  heroId: string,
  owned: OwnedCopies,
  content: GameContent,
  rules: DeckRules,
): DeckIssue | null {
  const issue = entryIssues(cardId, countInDeck(deck, cardId) + 1, heroId, owned, content, rules)[0];
  if (issue) return issue;
  const neutral = content.cards[cardId]!.heroId === undefined && neutralIssue(neutralCount(deck, content) + 1, rules);
  if (neutral) return neutral;
  const ultra = content.cards[cardId]!.rarity === 'ULTRA' && ultraIssue(ultraCount(deck, content) + 1, rules);
  if (ultra) return ultra;
  const current = deckSize(deck) + 1;
  return current > rules.requiredSize ? { code: 'DECK_TOO_LARGE', current, required: rules.requiredSize } : null;
}

/** Deck with one more copy of `cardId` (no validation: call addCardIssue first, or use editDeck). */
export function addCard(deck: readonly DeckEntry[], cardId: string): DeckEntry[] {
  const next = deck.map((e) => ({ ...e }));
  const entry = next.find((e) => e.cardId === cardId);
  if (entry) entry.count++;
  else next.push({ cardId, count: 1 });
  return next;
}

/** Deck with one copy of `cardId` fewer (the line disappears at 0). Never adds anything back. */
export function removeCard(deck: readonly DeckEntry[], cardId: string): DeckEntry[] {
  return deck
    .map((e) => (e.cardId === cardId ? { ...e, count: e.count - 1 } : { ...e }))
    .filter((e) => e.count > 0);
}

/** Order-insensitive equality (deck lists are unordered). */
export function sameDeck(a: readonly DeckEntry[], b: readonly DeckEntry[]): boolean {
  const key = (d: readonly DeckEntry[]) =>
    d
      .filter((e) => e.count > 0)
      .map((e) => `${e.cardId}:${e.count}`)
      .sort()
      .join('|');
  return key(a) === key(b);
}

/**
 * The two Deck Builder edits. Each changes exactly the chosen card by one copy: removing a
 * card leaves a gap (29/30) for the player to fill, nothing is ever picked for them.
 */
export type DeckEdit = { type: 'ADD_CARD'; cardId: string } | { type: 'REMOVE_CARD'; cardId: string };

export type DeckEditIssue = DeckIssue | { code: 'NOT_IN_DECK'; cardId: string };

export type DeckEditResult = { ok: true; deck: DeckEntry[] } | { ok: false; issue: DeckEditIssue };

export function editDeck(
  deck: readonly DeckEntry[],
  edit: DeckEdit,
  heroId: string,
  owned: OwnedCopies,
  content: GameContent,
  rules: DeckRules,
): DeckEditResult {
  if (edit.type === 'REMOVE_CARD') {
    if (countInDeck(deck, edit.cardId) === 0) return { ok: false, issue: { code: 'NOT_IN_DECK', cardId: edit.cardId } };
    return { ok: true, deck: removeCard(deck, edit.cardId) };
  }
  const issue = addCardIssue(deck, edit.cardId, heroId, owned, content, rules);
  return issue ? { ok: false, issue } : { ok: true, deck: addCard(deck, edit.cardId) };
}

/** Size/validity summary of a deck (the data contract the Deck Builder UI reads). */
export interface DeckStatus {
  totalCards: number;
  requiredCards: number;
  /** Exactly `requiredCards` and no other issue: may be saved and used everywhere. */
  valid: boolean;
  /** Cards still to add (0 when complete or over). */
  missingCount: number;
  /** Cards over the required size (only possible for tampered data). */
  excessCount: number;
  /** A deck saved under the old size that only lacks cards (see `DeckRules.legacySize`). */
  legacy: boolean;
  /** Neutral copies in the deck, and the most allowed (null = no limit). */
  neutralCards: number;
  maxNeutralCards: number | null;
  issues: DeckIssue[];
}

/** True when the only problem is the legacy size: every other rule passes. */
export const isLegacyDeck = (deck: readonly DeckEntry[], issues: readonly DeckIssue[], rules: DeckRules): boolean =>
  rules.legacySize !== undefined &&
  deckSize(deck) === rules.legacySize &&
  issues.length === 1 &&
  issues[0]!.code === 'DECK_INCOMPLETE';

export function deckStatus(
  deck: readonly DeckEntry[],
  heroId: string,
  owned: OwnedCopies,
  content: GameContent,
  rules: DeckRules,
): DeckStatus {
  const issues = validateDeck(deck, heroId, owned, content, rules);
  const totalCards = deckSize(deck);
  return {
    totalCards,
    requiredCards: rules.requiredSize,
    valid: issues.length === 0,
    missingCount: Math.max(0, rules.requiredSize - totalCards),
    excessCount: Math.max(0, totalCards - rules.requiredSize),
    legacy: isLegacyDeck(deck, issues, rules),
    neutralCards: neutralCount(deck, content),
    maxNeutralCards: rules.maxNeutralCards ?? null,
    issues,
  };
}

/** One collection card as the Deck Builder sees it (data contract for "COLECCIÓN DISPONIBLE"). */
export interface CollectionCardStatus {
  cardId: string;
  ownedCopies: number;
  deckCopies: number;
  /** ownedCopies − deckCopies (never negative): copies not yet in the deck. */
  availableCopies: number;
  /** Most copies one deck may hold (rarity limit). */
  maxCopies: number;
  /** Neutral card (any champion; counts toward `DeckRules.maxNeutralCards`). */
  neutral: boolean;
  /** Whether ADD_CARD would succeed right now, and why not otherwise. */
  canAdd: boolean;
  addIssue: DeckIssue | null;
}

export function collectionCardStatus(
  deck: readonly DeckEntry[],
  cardId: string,
  heroId: string,
  owned: OwnedCopies,
  content: GameContent,
  rules: DeckRules,
): CollectionCardStatus {
  const card = content.cards[cardId];
  const ownedCopies = owned(cardId);
  const deckCopies = countInDeck(deck, cardId);
  const addIssue = addCardIssue(deck, cardId, heroId, owned, content, rules);
  return {
    cardId,
    ownedCopies,
    deckCopies,
    availableCopies: Math.max(0, ownedCopies - deckCopies),
    maxCopies: card ? copyLimit(card, rules) : 0,
    neutral: !!card && card.heroId === undefined,
    canAdd: addIssue === null,
    addIssue,
  };
}
