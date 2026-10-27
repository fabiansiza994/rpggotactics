/**
 * Ranked Premium Track v0.1 — the ONE catalog of the paid line (qa/ranked-premium-track/REPORT.md).
 * A second row UNDER the free Reward Track: same 18 nodes, same thresholds (each node is the free
 * track's node, never a parallel progression). Pure data + pure view: the Worker grants from it
 * (server/src/rankedPremium.ts binds the grant table into SQL), the client only renders the view.
 *
 * Rules:
 * - The pass costs 600 Cristales Arcanos, once per account and season, bought with in-game
 *   currency only (no real money). Additive: the free track is untouched.
 * - Unlocks follow the season's PEAK RP (as the free track): demotion removes nothing.
 * - Buying late grants every premium reward the peak already reached, at once (retroactive),
 *   in the same transaction as the payment.
 * - Rewards are granted automatically once per (account, season, rewardId); the only manual step
 *   is the Diamante I Showcase choice (one of the five premium cards, once).
 * - Crystal return: 560 in total (< 600): the pass can never pay for itself.
 * - Cards are early access (acquisition RANKED_PREMIUM, exclusive until `exclusiveUntilSeason`);
 *   avatars, frames, title, card back and Showcase are permanent pass exclusives.
 */
import { RANKED_PREMIUM_AVATARS } from '../../shared/profileAvatars';
import { RANKED_PREMIUM_CARDS, RANKED_PREMIUM_CARD_REWARD_ID, RANKED_PREMIUM_EXCLUSIVE_UNTIL, RANKED_PREMIUM_SEASON_ID, type RankedPremiumCardId } from '../data/ranked-premium-cards';
import type { CardDefinition } from '../domain/cards/card';
import { RANKED_SEASON, RANKED_TIERS, rankFor, type RankedDivision, type RankedTierId } from './ranked';
import { RANKED_PREMIUM_COSMETICS, RANKED_PREMIUM_SHOWCASES, RANKED_PREMIUM_SHOWCASE_CHOICES, RANKED_PREMIUM_TITLES, showcaseCosmeticId } from './premiumCosmetics';
import { RANKED_TRACK } from './rewardTrack';

export const RANKED_PREMIUM = {
  seasonId: RANKED_PREMIUM_SEASON_ID,
  price: 600,
  currencyId: 'arcane_crystals',
  /** Sum of every CRYSTALS item below (asserted by tests). */
  crystalReturn: 560,
  /** Ledger reasons (tactics_wallet_ledger), referenced by migration 0027. */
  ledger: { purchase: 'RANKED_PREMIUM_PASS', reward: 'RANKED_PREMIUM_REWARD' },
} as const;

export type PremiumRewardType = 'CARD' | 'CRYSTALS' | 'TITLE' | 'COSMETIC' | 'AVATAR' | 'SHOWCASE_CHOICE';

export interface PremiumRewardItem {
  seasonId: string;
  /** Stable, never renamed: the idempotency key of the grant. */
  rewardId: string;
  type: PremiumRewardType;
  /** CARD: copies (1: every premium card is Única). CRYSTALS: amount. Otherwise 1. */
  quantity: number;
  cardId?: string;
  heroId?: string;
  titleId?: string;
  cosmeticId?: string;
  /** COSMETIC: PROFILE_FRAME / CARD_BACK. AVATAR: PROFILE_AVATAR. */
  cosmeticKind?: string;
  avatarId?: string;
  /** SHOWCASE_CHOICE: the card ids the player may pick from (exactly one is granted). */
  choices?: readonly string[];
  /** EARLY_ACCESS: gameplay card, free route after `exclusiveUntilSeason`. PERMANENT_EXCLUSIVE: cosmetic, pass only, forever. */
  availability: 'EARLY_ACCESS' | 'PERMANENT_EXCLUSIVE' | 'CURRENCY';
  exclusiveUntilSeason?: string;
  /** Art handle for the UI: card visualKey, cosmetic id, avatar asset path. */
  art: string;
}

export interface PremiumTrackNode {
  seasonId: string;
  nodeId: string;
  tierId: RankedTierId;
  division: RankedDivision;
  requiredRp: number;
  items: PremiumRewardItem[];
}

const SEASON = RANKED_PREMIUM_SEASON_ID;
const rid = (nodeId: string, slot: string) => `rp.${SEASON}.${nodeId}.${slot}`;

function cardItem(cardId: RankedPremiumCardId): PremiumRewardItem {
  const card = RANKED_PREMIUM_CARDS.find((c) => c.id === cardId)!;
  return {
    seasonId: SEASON,
    rewardId: RANKED_PREMIUM_CARD_REWARD_ID[cardId],
    type: 'CARD',
    quantity: 1,
    cardId,
    heroId: card.heroId,
    availability: 'EARLY_ACCESS',
    exclusiveUntilSeason: RANKED_PREMIUM_EXCLUSIVE_UNTIL,
    art: card.presentation.visualKey,
  };
}
const crystalItem = (nodeId: string, amount: number): PremiumRewardItem => ({
  seasonId: SEASON,
  rewardId: rid(nodeId, 'crystals'),
  type: 'CRYSTALS',
  quantity: amount,
  availability: 'CURRENCY',
  art: 'arcane_crystals',
});
const avatarItem = (nodeId: string, avatarId: string): PremiumRewardItem => {
  const avatar = RANKED_PREMIUM_AVATARS.find((a) => a.id === avatarId)!;
  return { seasonId: SEASON, rewardId: rid(nodeId, 'avatar'), type: 'AVATAR', quantity: 1, avatarId, cosmeticKind: 'PROFILE_AVATAR', availability: 'PERMANENT_EXCLUSIVE', art: avatar.asset };
};
const cosmeticItem = (nodeId: string, slot: string, cosmeticId: string): PremiumRewardItem => ({
  seasonId: SEASON,
  rewardId: rid(nodeId, slot),
  type: 'COSMETIC',
  quantity: 1,
  cosmeticId,
  cosmeticKind: RANKED_PREMIUM_COSMETICS[cosmeticId]!.kind,
  availability: 'PERMANENT_EXCLUSIVE',
  art: cosmeticId,
});
const titleItem = (nodeId: string): PremiumRewardItem => {
  const t = RANKED_PREMIUM_TITLES.find((x) => x.nodeId === nodeId)!;
  return { seasonId: SEASON, rewardId: rid(nodeId, 'title'), type: 'TITLE', quantity: 1, titleId: t.id, availability: 'PERMANENT_EXCLUSIVE', art: t.id };
};
const showcaseItem = (nodeId: string): PremiumRewardItem => ({
  seasonId: SEASON,
  rewardId: rid(nodeId, 'showcase'),
  type: 'SHOWCASE_CHOICE',
  quantity: 1,
  choices: RANKED_PREMIUM_SHOWCASE_CHOICES,
  availability: 'PERMANENT_EXCLUSIVE',
  art: 'showcase_choice',
});

const ITEMS: Readonly<Record<string, PremiumRewardItem[]>> = {
  IRON_III: [avatarItem('IRON_III', 'premium_arcane_emblem')],
  IRON_II: [crystalItem('IRON_II', 50)],
  IRON_I: [cardItem('double_moon_pact')],
  BRONZE_III: [avatarItem('BRONZE_III', 'premium_celestial_fox')],
  BRONZE_II: [crystalItem('BRONZE_II', 60)],
  BRONZE_I: [cardItem('fallen_king_wall')],
  SILVER_III: [cosmeticItem('SILVER_III', 'frame', 'frame_premium_circle_bronze')],
  SILVER_II: [crystalItem('SILVER_II', 80)],
  SILVER_I: [cardItem('stalker_heart')],
  GOLD_III: [avatarItem('GOLD_III', 'premium_golden_circle_sorcerer')],
  GOLD_II: [crystalItem('GOLD_II', 100)],
  GOLD_I: [cardItem('ash_eclipse')],
  PLATINUM_III: [cosmeticItem('PLATINUM_III', 'cardback', 'cardback_premium_arcane_circle')],
  PLATINUM_II: [crystalItem('PLATINUM_II', 120)],
  PLATINUM_I: [cardItem('primal_ascent')],
  DIAMOND_III: [titleItem('DIAMOND_III')],
  DIAMOND_II: [cosmeticItem('DIAMOND_II', 'frame', 'frame_premium_threshold_crown')],
  DIAMOND_I: [showcaseItem('DIAMOND_I'), crystalItem('DIAMOND_I', 150)],
};

/** The free track's 18 nodes, same ids and thresholds, with the premium items. */
export const RANKED_PREMIUM_TRACK: readonly PremiumTrackNode[] = RANKED_TRACK.map((n) => ({
  seasonId: SEASON,
  nodeId: n.nodeId,
  tierId: n.tierId,
  division: n.division,
  requiredRp: n.requiredRp,
  items: ITEMS[n.nodeId] ?? [],
}));

export const RANKED_PREMIUM_ITEMS: readonly PremiumRewardItem[] = RANKED_PREMIUM_TRACK.flatMap((n) => n.items);

/** Node of the Showcase choice (Diamante I) and its threshold. */
export const PREMIUM_SHOWCASE_NODE = RANKED_PREMIUM_TRACK.find((n) => n.items.some((i) => i.type === 'SHOWCASE_CHOICE'))!;

/**
 * Rows the server grants by itself (everything but the Showcase choice). Bound into SQL as JSON
 * (json_each), never as a UNION list. Crystals ARE paid here (the pass's own ledger rows).
 */
export const rankedPremiumGrantTable = () =>
  RANKED_PREMIUM_TRACK.flatMap((n) =>
    n.items
      .filter((i) => i.type !== 'SHOWCASE_CHOICE')
      .map((i) => ({
        rewardId: i.rewardId,
        nodeId: n.nodeId,
        type: i.type,
        itemId: i.cardId ?? i.titleId ?? i.cosmeticId ?? i.avatarId ?? RANKED_PREMIUM.currencyId,
        heroId: i.heroId ?? null,
        itemKind: i.cosmeticKind ?? null,
        quantity: i.quantity,
        requiredRp: n.requiredRp,
      })),
  );

// ── Release policy (manual; nothing schedules it) ───────────────────────────────────────────

/**
 * The five cards are early access, not permanent exclusives:
 * - preseason_0 (this season) + season_1: the pass is their only source (`exclusiveUntilSeason`).
 * - from season_2: delete `acquisition` (or switch it to a free source) in
 *   src/game/data/ranked-premium-cards.ts so they reach a free route — collection pools,
 *   campaign, Mastery or a future crafting source. Not built yet; this is the contract.
 * - Copies already owned never change. Cosmetics, avatars, title, card back and Showcase stay
 *   pass-exclusive forever.
 */
export const RANKED_PREMIUM_RELEASE_POLICY = {
  cards: RANKED_PREMIUM_CARDS.map((c) => c.id),
  seasonExclusiveUntil: RANKED_PREMIUM_EXCLUSIVE_UNTIL,
  freeRouteFromSeason: 'season_2',
  freeRoutes: ['COLLECTION', 'CAMPAIGN', 'MASTERY', 'CRAFTING'] as const,
  permanentExclusives: ['AVATAR', 'PROFILE_FRAME', 'TITLE', 'CARD_BACK', 'SHOWCASE'] as const,
  realMoney: false,
} as const;

// ── View (server computes it; the client renders the PREMIUM row) ───────────────────────────

/**
 * - LOCKED:    the peak has not reached the node.
 * - UNLOCKED:  reached, but the pass is not owned (buying grants it at once).
 * - CLAIMABLE: reached + owned, waiting for the player (only the Showcase choice) or for the
 *              server's catch-up (transient; the next read grants it).
 * - CLAIMED:   granted.
 */
export type PremiumItemStatus = 'LOCKED' | 'UNLOCKED' | 'CLAIMABLE' | 'CLAIMED';

export interface PremiumTrackInput {
  rp: number;
  peakRp: number;
  /** The pass row of this season, or null. */
  pass: { purchasedAt: number } | null;
  granted: Readonly<Record<string, { grantedAt: number; copies: number }>>;
  showcase: { cardId: string; chosenAt: number } | null;
}

export interface PremiumItemView extends PremiumRewardItem {
  status: PremiumItemStatus;
  grantedAt?: number;
  /** CARD: copies actually added (0 = already owned). */
  grantedCopies?: number;
  /** SHOWCASE_CHOICE: the card chosen. */
  chosenCardId?: string;
}

export interface PremiumNodeView {
  nodeId: string;
  tierId: RankedTierId;
  division: RankedDivision;
  label: string;
  requiredRp: number;
  /** Peak RP reached the node (independent of the pass). */
  reached: boolean;
  status: PremiumItemStatus;
  locked: boolean;
  unlocked: boolean;
  claimable: boolean;
  claimed: boolean;
  /** Every premium node needs the pass. */
  premiumRequired: true;
  requirement: { rp: number; label: string; premium: true };
  items: PremiumItemView[];
}

export interface PremiumTrackView {
  seasonId: string;
  seasonName: string;
  price: number;
  currencyId: string;
  crystalReturn: number;
  purchased: boolean;
  purchasedAt: number | null;
  rp: number;
  peakRp: number;
  nodes: PremiumNodeView[];
  /** What buying NOW grants at once (retroactive). Empty once purchased. */
  onPurchase: { nodes: number; crystals: number; cards: string[]; rewardIds: string[] };
  showcase: { nodeId: string; requiredRp: number; choices: readonly string[]; chosenCardId: string | null; claimable: boolean };
}

const toRp = (n: number) => (Number.isSafeInteger(n) && n > 0 ? n : 0);

export function rankedPremiumView(input: PremiumTrackInput, track: readonly PremiumTrackNode[] = RANKED_PREMIUM_TRACK): PremiumTrackView {
  const rp = toRp(input.rp);
  const peakRp = Math.max(rp, toRp(input.peakRp));
  const owned = !!input.pass;
  const nodes = track.map((n): PremiumNodeView => {
    const reached = peakRp >= n.requiredRp;
    const items = n.items.map((i): PremiumItemView => {
      if (!reached) return { ...i, status: 'LOCKED' };
      if (!owned) return { ...i, status: 'UNLOCKED' };
      if (i.type === 'SHOWCASE_CHOICE')
        return input.showcase ? { ...i, status: 'CLAIMED', chosenCardId: input.showcase.cardId, grantedAt: input.showcase.chosenAt } : { ...i, status: 'CLAIMABLE' };
      const g = input.granted[i.rewardId];
      return g ? { ...i, status: 'CLAIMED', grantedAt: g.grantedAt, ...(i.type === 'CARD' ? { grantedCopies: g.copies } : {}) } : { ...i, status: 'CLAIMABLE' };
    });
    const status: PremiumItemStatus = items.some((i) => i.status === 'LOCKED')
      ? 'LOCKED'
      : items.some((i) => i.status === 'UNLOCKED')
        ? 'UNLOCKED'
        : items.some((i) => i.status === 'CLAIMABLE')
          ? 'CLAIMABLE'
          : 'CLAIMED';
    const label = `${RANKED_TIERS.find((t) => t.id === n.tierId)!.name} ${n.division}`;
    return {
      nodeId: n.nodeId,
      tierId: n.tierId,
      division: n.division,
      label,
      requiredRp: n.requiredRp,
      reached,
      status,
      locked: status === 'LOCKED',
      unlocked: status === 'UNLOCKED',
      claimable: status === 'CLAIMABLE',
      claimed: status === 'CLAIMED',
      premiumRequired: true,
      requirement: { rp: n.requiredRp, label: rankFor(n.requiredRp).label, premium: true },
      items,
    };
  });
  const pending = owned ? [] : nodes.filter((n) => n.reached).flatMap((n) => n.items.filter((i) => i.type !== 'SHOWCASE_CHOICE'));
  const showcaseNode = nodes.find((n) => n.nodeId === PREMIUM_SHOWCASE_NODE.nodeId)!;
  return {
    seasonId: RANKED_SEASON.id,
    seasonName: RANKED_SEASON.name,
    price: RANKED_PREMIUM.price,
    currencyId: RANKED_PREMIUM.currencyId,
    crystalReturn: RANKED_PREMIUM.crystalReturn,
    purchased: owned,
    purchasedAt: input.pass?.purchasedAt ?? null,
    rp,
    peakRp,
    nodes,
    onPurchase: {
      nodes: owned ? 0 : nodes.filter((n) => n.reached && n.items.length).length,
      crystals: pending.filter((i) => i.type === 'CRYSTALS').reduce((s, i) => s + i.quantity, 0),
      cards: pending.filter((i) => i.type === 'CARD').map((i) => i.cardId!),
      rewardIds: pending.map((i) => i.rewardId),
    },
    showcase: {
      nodeId: PREMIUM_SHOWCASE_NODE.nodeId,
      requiredRp: PREMIUM_SHOWCASE_NODE.requiredRp,
      choices: RANKED_PREMIUM_SHOWCASE_CHOICES,
      chosenCardId: input.showcase?.cardId ?? null,
      claimable: owned && showcaseNode.reached && !input.showcase,
    },
  };
}

/** Display name of any premium item (client + reports). */
export function premiumItemName(item: Pick<PremiumRewardItem, 'type' | 'cardId' | 'titleId' | 'cosmeticId' | 'avatarId' | 'quantity'>, cards: Readonly<Record<string, CardDefinition>>): string {
  switch (item.type) {
    case 'CARD':
      return cards[item.cardId!]?.name ?? item.cardId!;
    case 'CRYSTALS':
      return `${item.quantity} Cristales`;
    case 'TITLE':
      return RANKED_PREMIUM_TITLES.find((t) => t.id === item.titleId)?.name ?? item.titleId!;
    case 'COSMETIC':
      return RANKED_PREMIUM_COSMETICS[item.cosmeticId!]?.name ?? item.cosmeticId!;
    case 'AVATAR':
      return RANKED_PREMIUM_AVATARS.find((a) => a.id === item.avatarId)?.name ?? item.avatarId!;
    case 'SHOWCASE_CHOICE':
      return 'Showcase a elección';
  }
}

export const isPremiumShowcaseChoice = (cardId: unknown): cardId is RankedPremiumCardId =>
  typeof cardId === 'string' && (RANKED_PREMIUM_SHOWCASE_CHOICES as readonly string[]).includes(cardId);

export { RANKED_PREMIUM_SHOWCASES, showcaseCosmeticId };
