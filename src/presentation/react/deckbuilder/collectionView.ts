import {
  CARD_FAMILIES,
  cardFamily,
  rarityOf,
  type CardFamily,
  type CardCategory,
  type CardDefinition,
  type CardRarity,
  type DeckEntry,
  type GameContent,
  type OwnedCard,
} from '../../../game';

/**
 * Deck Builder browsing: search, filters and sorting over the hero's card pool. Presentation
 * only — whether a card may be equipped is always decided by the core deck rules.
 */
export type SortKey = 'COST' | 'NAME' | 'RARITY' | 'RECENT';
export type OwnershipFilter = 'ALL' | 'UNLOCKED' | 'LOCKED';
export type CostBucket = '0' | '1' | '2' | '3+';
/** Champion cards vs neutral cards (no `heroId`, shared by every champion). */
export type OriginFilter = 'ALL' | 'CHAMPION' | 'NEUTRAL';

export interface CollectionQuery {
  text: string;
  categories: readonly CardCategory[];
  /** Deck-building families (Invocaciones / Rituales / Apoyo / Control). */
  families: readonly CardFamily[];
  costs: readonly CostBucket[];
  rarities: readonly CardRarity[];
  ownership: OwnershipFilter;
  origin: OriginFilter;
  sort: SortKey;
}

export const EMPTY_QUERY: CollectionQuery = {
  text: '',
  categories: [],
  families: [],
  costs: [],
  rarities: [],
  ownership: 'ALL',
  origin: 'ALL',
  sort: 'COST',
};

export const ORIGIN_LABEL: Record<OriginFilter, string> = {
  ALL: 'Todas',
  CHAMPION: 'Campeón',
  NEUTRAL: 'Neutrales',
};

const isNeutralCard = (c: CardDefinition) => c.heroId === undefined;

export const SORT_LABEL: Record<SortKey, string> = {
  COST: 'Coste',
  NAME: 'Nombre',
  RARITY: 'Rareza',
  RECENT: 'Recientes',
};

export const FAMILY_LABEL: Record<CardFamily, string> = {
  SUMMON: 'Invocaciones',
  RITUAL_PIECE: 'Rituales',
  SUPPORT: 'Apoyo',
  CONTROL: 'Control',
};

export const COST_BUCKETS: readonly CostBucket[] = ['0', '1', '2', '3+'];
const CATEGORY_ORDER: readonly CardCategory[] = ['ATTACK', 'DEFENSE', 'MOVEMENT', 'CONTROL', 'TERRAIN', 'UTILITY'];
const RARITY_ORDER: readonly CardRarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY', 'ULTRA'];

export const costBucket = (cost: number): CostBucket => (cost >= 3 ? '3+' : (String(cost) as CostBucket));

/** Case- and accent-insensitive ("bola" finds "Bóla"). */
export const normalize = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** What the champion owns of a card (class collection or shared neutral pool), see `ownedCard`. */
export type OwnedLookup = (cardId: string) => OwnedCard | undefined;

const owned = (lookup: OwnedLookup, id: string) => lookup(id)?.copies ?? 0;
const byCostThenName = (a: CardDefinition, b: CardDefinition) => a.cost - b.cost || a.name.localeCompare(b.name);

export function isFiltered(q: CollectionQuery): boolean {
  return Boolean(
    q.text.trim() || q.categories.length || q.families.length || q.costs.length || q.rarities.length || q.ownership !== 'ALL' || q.origin !== 'ALL',
  );
}

/** Only the filter values the data actually has, in a stable order (no empty chips). */
export function facets(cards: readonly CardDefinition[]) {
  return {
    categories: CATEGORY_ORDER.filter((c) => cards.some((d) => d.category === c)),
    // Families only matter where a pool mixes summons/rituals (the Summoner): hide a lone family.
    families: CARD_FAMILIES.filter((f) => cards.some((d) => cardFamily(d) === f)),
    costs: COST_BUCKETS.filter((b) => cards.some((d) => costBucket(d.cost) === b)),
    rarities: RARITY_ORDER.filter((r) => cards.some((d) => rarityOf(d) === r)),
    // Only when the pool mixes both (no chip row for a pool without neutral cards).
    origins: (cards.some(isNeutralCard) && cards.some((d) => !isNeutralCard(d)) ? ['ALL', 'CHAMPION', 'NEUTRAL'] : []) as OriginFilter[],
  };
}

export function browseCollection(cards: readonly CardDefinition[], hero: OwnedLookup, q: CollectionQuery): CardDefinition[] {
  const text = normalize(q.text);
  const result = cards.filter(
    (c) =>
      (!text || normalize(c.name).includes(text)) &&
      (!q.categories.length || q.categories.includes(c.category)) &&
      (!q.families.length || q.families.includes(cardFamily(c))) &&
      (!q.costs.length || q.costs.includes(costBucket(c.cost))) &&
      (!q.rarities.length || q.rarities.includes(rarityOf(c))) &&
      (q.ownership === 'ALL' || (q.ownership === 'UNLOCKED') === owned(hero, c.id) > 0) &&
      (q.origin === 'ALL' || (q.origin === 'NEUTRAL') === isNeutralCard(c)),
  );
  const sorters: Record<SortKey, (a: CardDefinition, b: CardDefinition) => number> = {
    COST: byCostThenName,
    NAME: (a, b) => a.name.localeCompare(b.name),
    RARITY: (a, b) => RARITY_ORDER.indexOf(rarityOf(b)) - RARITY_ORDER.indexOf(rarityOf(a)) || byCostThenName(a, b),
    RECENT: (a, b) =>
      (hero(b.id)?.acquired ?? -1) - (hero(a.id)?.acquired ?? -1) || byCostThenName(a, b),
  };
  // Unlocked cards first in every order: locked ones are a preview of what exists.
  return result.sort((a, b) => Number(owned(hero, a.id) === 0) - Number(owned(hero, b.id) === 0) || sorters[q.sort](a, b));
}

export interface DeckLine {
  card: CardDefinition;
  count: number;
}

/** Deck list for display: draw order is shuffled in battle, so lines are grouped by cost. */
export function deckLines(deck: readonly DeckEntry[], content: GameContent): DeckLine[] {
  return deck
    .flatMap((e) => {
      const card = content.cards[e.cardId];
      return card && e.count > 0 ? [{ card, count: e.count }] : [];
    })
    .sort((a, b) => byCostThenName(a.card, b.card));
}

export function costCurve(lines: readonly DeckLine[]): Record<CostBucket, number> {
  const curve: Record<CostBucket, number> = { '0': 0, '1': 0, '2': 0, '3+': 0 };
  for (const l of lines) curve[costBucket(l.card.cost)] += l.count;
  return curve;
}

export function categoryCounts(lines: readonly DeckLine[]): [CardCategory, number][] {
  return CATEGORY_ORDER.map((c) => [c, lines.reduce((n, l) => (l.card.category === c ? n + l.count : n), 0)] as [CardCategory, number]).filter(
    ([, n]) => n > 0,
  );
}
