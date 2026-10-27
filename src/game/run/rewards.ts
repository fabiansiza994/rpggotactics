import { isExclusiveCard } from '../domain/cards/card';
import type { CardDefinition } from '../domain/cards/card';
import type { GameContent } from '../domain/content';
import { nextRandom, type RngHolder } from '../domain/core/rng';
import { copyLimit, isCardForHero, type DeckRules, type OwnedCopies } from '../collection/deck-rules';

export type CardRarity = NonNullable<CardDefinition['rarity']>;

/**
 * What the player can take after a victory (choose exactly one):
 * - ADD_CARD: one copy of a card joins the champion's collection (never auto-equipped).
 *   `isNew` = the player did not own it when the offer was made.
 * - MAX_HP:   permanent max HP for the rest of the run (elite/boss pools only).
 */
export type RewardOption =
  | { id: string; kind: 'ADD_CARD'; cardId: string; rarity: CardRarity; isNew?: boolean }
  | { id: string; kind: 'MAX_HP'; amount: number };

export type RewardPoolId = 'NORMAL' | 'ELITE' | 'BOSS';

export interface RewardPoolDef {
  /** Chance (0..1) that a win offers cards at all; 1 = guaranteed (boss). */
  cardChance: number;
  /** Relative pick weight per card rarity (0 = excluded while other rarities remain). */
  rarityWeights: Record<CardRarity, number>;
  /** At least one card offer of this rarity or better, when such cards are available. */
  guaranteeAtLeast?: CardRarity;
  /** Add a MAX_HP option of this size (also the fallback when no card can be offered). */
  maxHpOffer?: number;
  /** Pity added by a win of this tier that ends without a card. */
  pityGain: number;
}

/**
 * The whole drop economy in one place (balance data, read by client and server alike).
 * Pity = wins in a row that ended without a card; at `PITY_THRESHOLD` the next win always
 * offers cards. Claiming any card resets it.
 */
export const REWARD_POOLS: Readonly<Record<RewardPoolId, RewardPoolDef>> = {
  NORMAL: { cardChance: 0.4, rarityWeights: { COMMON: 3, UNCOMMON: 1, RARE: 0, LEGENDARY: 0, ULTRA: 0 }, pityGain: 1 },
  ELITE: { cardChance: 0.85, rarityWeights: { COMMON: 1, UNCOMMON: 3, RARE: 1, LEGENDARY: 0, ULTRA: 0 }, guaranteeAtLeast: 'UNCOMMON', maxHpOffer: 3, pityGain: 2 },
  BOSS: { cardChance: 1, rarityWeights: { COMMON: 0, UNCOMMON: 2, RARE: 4, LEGENDARY: 0, ULTRA: 0 }, guaranteeAtLeast: 'RARE', maxHpOffer: 5, pityGain: 2 },
};
export const PITY_THRESHOLD = 4;
/** Weight multiplier for cards sharing a tag with the encounter's `favorTags` (themed pools). */
export const THEME_WEIGHT = 3;

const RARITY_ORDER: readonly CardRarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY', 'ULTRA'];
const rarityOf = (card: CardDefinition): CardRarity => card.rarity ?? 'COMMON';
const atLeast = (r: CardRarity, min: CardRarity) => RARITY_ORDER.indexOf(r) >= RARITY_ORDER.indexOf(min);

function weightedPick(rng: RngHolder, cards: CardDefinition[], pool: RewardPoolDef, favorTags: readonly string[]): CardDefinition | undefined {
  if (!cards.length) return undefined;
  const weighted = cards.map((c) => ({ c, w: pool.rarityWeights[rarityOf(c)] * (c.tags.some((t) => favorTags.includes(t)) ? THEME_WEIGHT : 1) }));
  const usable = weighted.some((x) => x.w > 0) ? weighted.filter((x) => x.w > 0) : weighted.map((x) => ({ ...x, w: 1 }));
  const total = usable.reduce((n, x) => n + x.w, 0);
  let roll = nextRandom(rng) * total;
  for (const x of usable) {
    roll -= x.w;
    if (roll < 0) return x.c;
  }
  return usable.at(-1)?.c;
}

export interface RewardRollInput {
  content: GameContent;
  heroId: string;
  owned: OwnedCopies;
  pity: number;
  rules: DeckRules;
  poolId: RewardPoolId;
  /** Server-controlled seed (from the run): same input → same offer, never rerolled. */
  seed: number;
  count: number;
  favorTags?: readonly string[];
  /** Authored offer (`EncounterDef.rewards.cards`): replaces the roll while any is below its cap. */
  authored?: readonly string[];
}

export interface RewardRoll {
  options: RewardOption[];
  /** Cards were offered this time. */
  cardDrop: boolean;
  /** The drop was forced by pity (the chance roll alone would have missed). */
  pityTriggered: boolean;
}

/**
 * Deterministic reward offer for one victory. Pure: same input → same offer.
 * - Drop: `cardChance`, forced at `PITY_THRESHOLD`.
 * - Pool: the champion's cards (own + neutral) still below their copy limit — capped cards
 *   are never offered. Unowned cards fill the offer first (weighted by rarity/theme), then
 *   extra copies.
 * - Elite/boss always add a MAX_HP option; with nothing left to offer, that is the offer.
 */
export function rollReward(input: RewardRollInput): RewardRoll {
  // Authored offer: a fixed, guaranteed card (campaign progression), never random and never pity.
  const authored = (input.authored ?? [])
    .map((id) => input.content.cards[id])
    .filter((c): c is CardDefinition => !!c && isCardForHero(c, input.heroId) && input.owned(c.id) < copyLimit(c, input.rules));
  if (authored.length && input.count > 0)
    return {
      options: authored.map((c, i) => ({ id: `reward-${i}-${c.id}`, kind: 'ADD_CARD', cardId: c.id, rarity: rarityOf(c), isNew: input.owned(c.id) === 0 })),
      cardDrop: true,
      pityTriggered: false,
    };
  const pool = REWARD_POOLS[input.poolId];
  const rng: RngHolder = { rngState: input.seed >>> 0 };
  const chanceHit = nextRandom(rng) < pool.cardChance;
  const pityTriggered = !chanceHit && input.pity >= PITY_THRESHOLD;
  const cardDrop = chanceHit || pityTriggered;
  const favor = input.favorTags ?? [];

  // Content order is authored order; sort by id so the offer never depends on key order.
  const eligible = Object.values(input.content.cards)
    .filter((c) => isCardForHero(c, input.heroId) && input.owned(c.id) < copyLimit(c, input.rules))
    // QA-only sets (unreleased expansions) never drop.
    .filter((c) => !c.expansion || (input.content.releasedExpansions ?? []).includes(c.expansion))
    // Exclusive cards (world rewards…) only come from their own source.
    .filter((c) => !isExclusiveCard(c))
    .sort((a, b) => a.id.localeCompare(b.id));
  const unowned = eligible.filter((c) => input.owned(c.id) === 0);
  const copies = eligible.filter((c) => input.owned(c.id) > 0);

  const picks: CardDefinition[] = [];
  const slots = cardDrop ? Math.max(0, pool.maxHpOffer ? input.count - 1 : input.count) : 0;
  const take = (from: CardDefinition[], card: CardDefinition | undefined) => {
    if (!card) return;
    picks.push(card);
    from.splice(from.indexOf(card), 1);
  };
  const min = pool.guaranteeAtLeast;
  if (min && slots > 0) {
    // Guaranteed quality slot: the best rarity actually available, new cards first.
    const source = unowned.length ? unowned : copies;
    const qualifying = source.filter((c) => atLeast(rarityOf(c), min));
    const best = [...RARITY_ORDER].reverse().find((r) => source.some((c) => rarityOf(c) === r));
    take(source, weightedPick(rng, qualifying.length ? qualifying : source.filter((c) => rarityOf(c) === best), pool, favor));
  }
  while (picks.length < slots && unowned.length) take(unowned, weightedPick(rng, unowned, pool, favor));
  while (picks.length < slots && copies.length) take(copies, weightedPick(rng, copies, pool, favor));

  const options: RewardOption[] = picks.map((c, i) => ({
    id: `reward-${i}-${c.id}`,
    kind: 'ADD_CARD',
    cardId: c.id,
    rarity: rarityOf(c),
    isNew: input.owned(c.id) === 0,
  }));
  if (pool.maxHpOffer && input.count > 0) options.push({ id: `reward-${options.length}-max-hp`, kind: 'MAX_HP', amount: pool.maxHpOffer });
  return { options, cardDrop: picks.length > 0, pityTriggered: pityTriggered && picks.length > 0 };
}
