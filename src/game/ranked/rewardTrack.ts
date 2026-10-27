/**
 * Ranked Reward Track v0.1 — the ONE catalog of the timeline (qa/ranked-reward-track/REPORT.md).
 * Pure data + pure view: the Worker grants from it (server/src/rankedTrack.ts binds the grant
 * table into SQL), the client only renders the view the server computed with `rankedTrackView`.
 *
 * Rules (approved design):
 * - Unlocks follow the season's PEAK RP (max rp_after ever applied), never the current rank:
 *   demotion removes nothing.
 * - Every reward is granted automatically, once per (account, season, rewardId).
 * - Crystal nodes ARE the existing 0023 tier milestones (RANKED_TIERS.milestoneCrystals): the
 *   track only displays them; it never pays crystals of its own (0 new crystals, 800 total).
 * - Cards are early access (CardDefinition.acquisition RANKED_TRACK), full playset, permanent.
 * - Cosmetics and the apex title are Preseason-exclusive; tier titles are permanent.
 */
import { copyLimit, rarityOf } from '../collection/deck-rules';
import { DECK_RULES } from '../data/rules';
import { RANKED_CARD_REWARD_ID, RANKED_TRACK_CARDS, RANKED_TRACK_SEASON_ID } from '../data/ranked-cards';
import type { CardDefinition } from '../domain/cards/card';
import { RANKED_DIVISIONS, RANKED_RULES, RANKED_SEASON, RANKED_TIERS, rankFor, type RankView, type RankedDivision, type RankedTierId } from './ranked';
import { RANKED_PREMIUM_TITLES } from './premiumCosmetics';

export type RankedRewardType = 'CARD' | 'CRYSTALS' | 'TITLE' | 'COSMETIC';
/** EARLY_ACCESS: gameplay card, later released to the normal pools. SEASON_EXCLUSIVE: never again after the season. */
export type RankedRewardAvailability = 'EARLY_ACCESS' | 'SEASON_EXCLUSIVE' | 'PERMANENT';
export type RankedCosmeticKind = 'RANKED_CREST' | 'PROFILE_FRAME' | 'VICTORY_BADGE';
/** Extra unlock condition besides the RP threshold. */
export type RankedRewardCondition = 'FIRST_VALID_RANKED';

export interface RankedRewardItem {
  seasonId: string;
  /** Stable, never renamed: the idempotency key of the grant. */
  rewardId: string;
  type: RankedRewardType;
  /** CARD: copies granted (the card's normal copy limit = the full playset). Otherwise 1 / amount. */
  quantity: number;
  cardId?: string;
  heroId?: string;
  titleId?: string;
  cosmeticId?: string;
  cosmeticKind?: RankedCosmeticKind;
  /** CRYSTALS: the 0023 milestone tier that pays it (the track never pays crystals itself). */
  tierId?: RankedTierId;
  permanent: boolean;
  exclusive: boolean;
  availability: RankedRewardAvailability;
  condition?: RankedRewardCondition;
}

export interface RankedTrackNode {
  seasonId: string;
  /** "GOLD_II". */
  nodeId: string;
  tierId: RankedTierId;
  division: RankedDivision;
  requiredRp: number;
  items: RankedRewardItem[];
}

// ── Titles ──────────────────────────────────────────────────────────────────────────────

export interface RankedTitle {
  id: string;
  name: string;
  /** Node that unlocks it. */
  nodeId: string;
  exclusive: boolean;
}

/** Tier titles are season-agnostic (`ranked.tier.<TIER>`); the apex title belongs to its season. */
export const RANKED_TITLES: readonly RankedTitle[] = [
  { id: 'ranked.tier.BRONZE', name: 'Retador de la Arena', nodeId: 'BRONZE_III', exclusive: false },
  { id: 'ranked.tier.SILVER', name: 'Duelista de Plata', nodeId: 'SILVER_III', exclusive: false },
  { id: 'ranked.tier.GOLD', name: 'Estratega Dorado', nodeId: 'GOLD_III', exclusive: false },
  { id: 'ranked.tier.PLATINUM', name: 'Táctico de Platino', nodeId: 'PLATINUM_III', exclusive: false },
  { id: 'ranked.tier.DIAMOND', name: 'Filo de Diamante', nodeId: 'DIAMOND_III', exclusive: false },
  { id: 'ranked.preseason_0.apex', name: 'Cima de la Pretemporada', nodeId: 'DIAMOND_I', exclusive: true },
];

/** Free-track or Premium-track title (one equipped slot; ownership = its grant row). */
export const rankedTitleById = (id: unknown): RankedTitle | undefined =>
  typeof id === 'string' ? (RANKED_TITLES.find((t) => t.id === id) ?? RANKED_PREMIUM_TITLES.find((t) => t.id === id)) : undefined;
export const rankedTitleName = (id: string | null | undefined): string | null => rankedTitleById(id)?.name ?? null;

// ── Cosmetics (ids + intent; art comes in the visual pass) ──────────────────────────────────

export interface RankedCosmetic {
  id: string;
  kind: RankedCosmeticKind;
  name: string;
  /** Visual intent for Codex (qa/ranked-reward-track/CODEX_HANDOFF.md). */
  intent: string;
}

export const RANKED_COSMETICS: Readonly<Record<string, RankedCosmetic>> = {
  ranked_emblem_preseason_0: {
    id: 'ranked_emblem_preseason_0',
    kind: 'RANKED_CREST',
    name: 'Emblema de Pretemporada',
    intent: 'Hierro sobrio con la runa de la pretemporada, junto al nombre (lobby, VS, perfil).',
  },
  frame_ranked_gold_duelist: {
    id: 'frame_ranked_gold_duelist',
    kind: 'PROFILE_FRAME',
    name: 'Marco del Duelista Dorado',
    intent: 'Oro batido con espadas cruzadas discretas alrededor del retrato.',
  },
  crest_ranked_platinum: {
    id: 'crest_ranked_platinum',
    kind: 'RANKED_CREST',
    name: 'Cresta de Platino',
    intent: 'Variante de la cresta: platino frío con filo luminoso.',
  },
  frame_ranked_diamond_facet: {
    id: 'frame_ranked_diamond_facet',
    kind: 'PROFILE_FRAME',
    name: 'Marco de Diamante Facetado',
    intent: 'Facetas de cristal con brillo sutil alrededor del retrato.',
  },
  badge_ranked_diamond_victory: {
    id: 'badge_ranked_diamond_victory',
    kind: 'VICTORY_BADGE',
    name: 'Sello de Victoria de Diamante',
    intent: 'Sello que se estampa en la pantalla de resultado al ganar.',
  },
  crest_ranked_apex_preseason_0: {
    id: 'crest_ranked_apex_preseason_0',
    kind: 'RANKED_CREST',
    name: 'Cresta viva de la Cima',
    intent: 'Diamante con pulso lento (respeta reduced-motion). Prestigio máximo de la Pretemporada.',
  },
};

// ── Catalog ─────────────────────────────────────────────────────────────────────────────

const SEASON = RANKED_TRACK_SEASON_ID;
const rid = (nodeId: string, slot: string) => `rt.${SEASON}.${nodeId}.${slot}`;

function cardItem(cardId: keyof typeof RANKED_CARD_REWARD_ID): RankedRewardItem {
  const card = RANKED_TRACK_CARDS.find((c) => c.id === cardId)!;
  return {
    seasonId: SEASON,
    rewardId: RANKED_CARD_REWARD_ID[cardId],
    type: 'CARD',
    quantity: copyLimit(card, DECK_RULES),
    cardId,
    heroId: card.heroId,
    permanent: true,
    exclusive: false,
    availability: 'EARLY_ACCESS',
  };
}
const crystalItem = (nodeId: string, tierId: RankedTierId): RankedRewardItem => ({
  seasonId: SEASON,
  rewardId: rid(nodeId, 'crystals'),
  type: 'CRYSTALS',
  quantity: RANKED_TIERS.find((t) => t.id === tierId)!.milestoneCrystals,
  tierId,
  permanent: true,
  exclusive: false,
  availability: 'PERMANENT',
});
const titleItem = (nodeId: string): RankedRewardItem => {
  const t = RANKED_TITLES.find((x) => x.nodeId === nodeId)!;
  return {
    seasonId: SEASON,
    rewardId: rid(nodeId, 'title'),
    type: 'TITLE',
    quantity: 1,
    titleId: t.id,
    permanent: true,
    exclusive: t.exclusive,
    availability: t.exclusive ? 'SEASON_EXCLUSIVE' : 'PERMANENT',
  };
};
const cosmeticItem = (nodeId: string, slot: string, cosmeticId: string, condition?: RankedRewardCondition): RankedRewardItem => ({
  seasonId: SEASON,
  rewardId: rid(nodeId, slot),
  type: 'COSMETIC',
  quantity: 1,
  cosmeticId,
  cosmeticKind: RANKED_COSMETICS[cosmeticId]!.kind,
  permanent: true,
  exclusive: true,
  availability: 'SEASON_EXCLUSIVE',
  ...(condition ? { condition } : {}),
});

const ITEMS: Readonly<Record<string, RankedRewardItem[]>> = {
  IRON_III: [cosmeticItem('IRON_III', 'emblem', 'ranked_emblem_preseason_0', 'FIRST_VALID_RANKED')],
  IRON_II: [cardItem('palisade')],
  IRON_I: [cardItem('wall_patience')],
  BRONZE_III: [crystalItem('BRONZE_III', 'BRONZE'), titleItem('BRONZE_III')],
  BRONZE_II: [cardItem('pact_relay')],
  BRONZE_I: [cardItem('wild_burst')],
  SILVER_III: [crystalItem('SILVER_III', 'SILVER'), titleItem('SILVER_III')],
  SILVER_II: [cardItem('ignition_rune')],
  SILVER_I: [cardItem('altar_echo')],
  GOLD_III: [crystalItem('GOLD_III', 'GOLD'), titleItem('GOLD_III'), cosmeticItem('GOLD_III', 'frame', 'frame_ranked_gold_duelist')],
  GOLD_II: [cardItem('siege_leap')],
  GOLD_I: [cardItem('tracking_arrow')],
  PLATINUM_III: [crystalItem('PLATINUM_III', 'PLATINUM'), titleItem('PLATINUM_III')],
  PLATINUM_II: [cardItem('arcane_exchange')],
  PLATINUM_I: [cosmeticItem('PLATINUM_I', 'crest', 'crest_ranked_platinum')],
  DIAMOND_III: [crystalItem('DIAMOND_III', 'DIAMOND'), titleItem('DIAMOND_III'), cosmeticItem('DIAMOND_III', 'frame', 'frame_ranked_diamond_facet')],
  DIAMOND_II: [cosmeticItem('DIAMOND_II', 'badge', 'badge_ranked_diamond_victory')],
  DIAMOND_I: [titleItem('DIAMOND_I'), cosmeticItem('DIAMOND_I', 'crest', 'crest_ranked_apex_preseason_0')],
};

/** One node per real division (18), thresholds derived from the live rank config. */
export const RANKED_TRACK: readonly RankedTrackNode[] = RANKED_TIERS.flatMap((tier, t) =>
  RANKED_DIVISIONS.map((division, d) => {
    const nodeId = `${tier.id}_${division}`;
    return {
      seasonId: SEASON,
      nodeId,
      tierId: tier.id,
      division,
      requiredRp: (t * RANKED_DIVISIONS.length + d) * RANKED_RULES.divisionRp,
      items: ITEMS[nodeId] ?? [],
    };
  }),
);

export const RANKED_TRACK_ITEMS: readonly RankedRewardItem[] = RANKED_TRACK.flatMap((n) => n.items);

/** Minimum rounds for the first ranked match to count (same as Champion Mastery's PvP minimum). */
export const FIRST_VALID_RANKED_MIN_ROUNDS = 2;

/**
 * Rows the server grants itself (cards, titles, cosmetics). Crystal items are NOT here: the 0023
 * milestone already pays them. Bound into SQL as JSON (json_each), never as a UNION list.
 */
export const rankedTrackGrantTable = () =>
  RANKED_TRACK.flatMap((n) =>
    n.items
      .filter((i) => i.type !== 'CRYSTALS')
      .map((i) => ({
        rewardId: i.rewardId,
        nodeId: n.nodeId,
        type: i.type,
        itemId: i.cardId ?? i.titleId ?? i.cosmeticId!,
        heroId: i.heroId ?? null,
        itemKind: i.cosmeticKind ?? null,
        quantity: i.quantity,
        requiredRp: n.requiredRp,
        condition: i.condition ?? null,
      })),
  );

// ── Release policy (manual; no scheduler in v0.1) ───────────────────────────────────────────

/**
 * Approved policy for the nine cards. Changing phase is a deliberate code change + deploy:
 * 1. Season 1 starts (or the window below ends): delete `acquisition` from the cards in
 *    src/game/data/ranked-cards.ts → they enter the normal reward pools of their champion.
 * 2. ~4 weeks later: add single-card offers to src/game/data/store-catalog.ts at PRICE_LADDER
 *    (UNCOMMON 150, RARE 250 Cristales), never in premium packs, never real money, not giftable.
 * Copies already granted by the track never change.
 */
export const RANKED_CARD_RELEASE_POLICY = {
  phase: 'PRESEASON_EARLY_ACCESS' as 'PRESEASON_EARLY_ACCESS' | 'NORMAL_POOLS' | 'POOLS_AND_STORE',
  normalPoolsAt: 'SEASON_1_START_OR_8_WEEKS',
  storeWeeksAfterPools: 4,
  storePrice: { UNCOMMON: 150, RARE: 250 },
  premiumPacks: false,
  realMoney: false,
  giftableInFirstRotation: false,
} as const;

// ── View (server computes it; the client renders it) ────────────────────────────────────────

export type RankedItemStatus = 'CLAIMED' | 'UNLOCKED' | 'LOCKED';

export interface RankedTrackInput {
  rp: number;
  /** Season peak RP (max rp_after). Never below rp. */
  peakRp: number;
  /** The first valid ranked match is done (emblem condition). */
  firstValidRanked: boolean;
  /** Granted track rewards (cards/titles/cosmetics) by rewardId → copies actually added. */
  granted: Readonly<Record<string, { grantedAt: number; copies: number }>>;
  /** 0023 tier milestones claimed this season (tier ids). */
  milestones: readonly string[];
}

export interface RankedItemView extends RankedRewardItem {
  status: RankedItemStatus;
  /** CARD: copies this account received (0 = already at its copy limit; still "claimed"). */
  grantedCopies?: number;
  grantedAt?: number;
}

export interface RankedNodeView {
  nodeId: string;
  tierId: RankedTierId;
  division: RankedDivision;
  label: string;
  requiredRp: number;
  status: RankedItemStatus;
  current: boolean;
  items: RankedItemView[];
}

export interface RankedTrackView {
  seasonId: string;
  seasonName: string;
  rp: number;
  peakRp: number;
  rank: RankView;
  nodes: RankedNodeView[];
  /** Next division threshold from the CURRENT RP (null at the top). */
  nextDivision: { label: string; rp: number; distance: number } | null;
  /** First node with something still locked; distance is from the current RP. */
  nextReward: { nodeId: string; label: string; requiredRp: number; distance: number; items: RankedItemView[] } | null;
}

const toRp = (n: number) => (Number.isSafeInteger(n) && n > 0 ? n : 0);

export function rankedTrackView(input: RankedTrackInput, track: readonly RankedTrackNode[] = RANKED_TRACK): RankedTrackView {
  const rp = toRp(input.rp);
  const peakRp = Math.max(rp, toRp(input.peakRp));
  const rank = rankFor(rp);
  const nodes = track.map((n): RankedNodeView => {
    const reached = peakRp >= n.requiredRp;
    const items = n.items.map((i): RankedItemView => {
      if (i.type === 'CRYSTALS') {
        const claimed = input.milestones.includes(i.tierId!);
        return { ...i, status: claimed ? 'CLAIMED' : reached ? 'UNLOCKED' : 'LOCKED' };
      }
      const g = input.granted[i.rewardId];
      if (g) return { ...i, status: 'CLAIMED', grantedAt: g.grantedAt, ...(i.type === 'CARD' ? { grantedCopies: g.copies } : {}) };
      const conditionOk = i.condition !== 'FIRST_VALID_RANKED' || input.firstValidRanked;
      return { ...i, status: reached && conditionOk ? 'UNLOCKED' : 'LOCKED' };
    });
    const status: RankedItemStatus = items.some((i) => i.status === 'LOCKED')
      ? 'LOCKED'
      : items.every((i) => i.status === 'CLAIMED')
        ? 'CLAIMED'
        : 'UNLOCKED';
    const label = `${RANKED_TIERS.find((t) => t.id === n.tierId)!.name} ${n.division}`;
    return { nodeId: n.nodeId, tierId: n.tierId, division: n.division, label, requiredRp: n.requiredRp, status, current: n.requiredRp === rank.floorRp, items };
  });
  const locked = nodes.find((n) => n.status === 'LOCKED' && n.items.length);
  return {
    seasonId: RANKED_SEASON.id,
    seasonName: RANKED_SEASON.name,
    rp,
    peakRp,
    rank,
    nodes,
    nextDivision: rank.nextRp === null ? null : { label: rankFor(rank.nextRp).label, rp: rank.nextRp, distance: rank.nextRp - rp },
    nextReward: locked
      ? {
          nodeId: locked.nodeId,
          label: locked.label,
          requiredRp: locked.requiredRp,
          distance: Math.max(0, locked.requiredRp - rp),
          items: locked.items.filter((i) => i.status === 'LOCKED'),
        }
      : null,
  };
}

/** Display name of any reward item (client + reports). */
export function rankedItemName(item: Pick<RankedRewardItem, 'type' | 'cardId' | 'titleId' | 'cosmeticId' | 'quantity'>, cards: Readonly<Record<string, CardDefinition>>): string {
  switch (item.type) {
    case 'CARD':
      return cards[item.cardId!]?.name ?? item.cardId!;
    case 'CRYSTALS':
      return `${item.quantity} Cristales`;
    case 'TITLE':
      return rankedTitleName(item.titleId) ?? item.titleId!;
    case 'COSMETIC':
      return RANKED_COSMETICS[item.cosmeticId!]?.name ?? item.cosmeticId!;
  }
}

/** Rarity label source for card items (real ladder). */
export const rankedCardRarity = (cardId: string) => {
  const c = RANKED_TRACK_CARDS.find((x) => x.id === cardId);
  return c ? rarityOf(c) : null;
};
