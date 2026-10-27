/**
 * Ranked Preseason v0.1 — the ONE place where tiers, division size, RP deltas and milestone
 * rewards live. Pure and integer-only: the Worker binds these numbers into its SQL (server is the
 * source of truth for every applied result) and the client only derives labels from RP the
 * server sent. Rank is never stored: it is always derived from RP with `rankFor`.
 */

export const RANKED_SEASON = {
  id: 'preseason_0',
  name: 'Pretemporada',
  notice:
    'El sistema competitivo está en pretemporada. Rangos y puntuación pueden ajustarse antes de la Temporada 1.',
} as const;

export type RankedTierId = 'IRON' | 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND';

export interface RankedTier {
  id: RankedTierId;
  name: string;
  /** One-time Cristales the first time an account reaches this tier during the season (0 = none). */
  milestoneCrystals: number;
}

/** Lowest first. Adding a tier (e.g. MASTER) = one more row; thresholds follow automatically. */
export const RANKED_TIERS: readonly RankedTier[] = [
  { id: 'IRON', name: 'Hierro', milestoneCrystals: 0 },
  { id: 'BRONZE', name: 'Bronce', milestoneCrystals: 50 },
  { id: 'SILVER', name: 'Plata', milestoneCrystals: 100 },
  { id: 'GOLD', name: 'Oro', milestoneCrystals: 150 },
  { id: 'PLATINUM', name: 'Platino', milestoneCrystals: 200 },
  { id: 'DIAMOND', name: 'Diamante', milestoneCrystals: 300 },
];

/** Divisions inside a tier, lowest first (III → II → I). */
export const RANKED_DIVISIONS = ['III', 'II', 'I'] as const;
export type RankedDivision = (typeof RANKED_DIVISIONS)[number];

export type RankedOutcome = 'WIN' | 'LOSS' | 'ABANDON' | 'DRAW';

export const RANKED_RULES = {
  divisionRp: 100,
  delta: { WIN: 20, LOSS: -12, ABANDON: -20, DRAW: 0 } satisfies Record<RankedOutcome, number>,
  /** Anti-farm: after this many rated matches against the same rival in the window, RP delta is 0. */
  pairRatedLimit: 3,
  pairWindowMs: 24 * 3600_000,
  /** A queue ticket dies if the client stops polling for this long. */
  queueHeartbeatMs: 20_000,
  /** Client poll period while searching (well under the heartbeat). */
  queuePollMs: 3_000,
  /** Matched players must both be ready within this window, or the room expires without RP. */
  lobbyMs: 120_000,
} as const;

/** Match end reasons (server/src/pvp.ts) → ranked outcome for the LOSING side. */
export const ABANDON_REASONS: readonly string[] = ['OPPONENT_DISCONNECTED', 'ABANDONED'];

export interface RankView {
  rp: number;
  tierId: RankedTierId;
  tierName: string;
  tierIndex: number;
  division: RankedDivision;
  /** "Oro II". */
  label: string;
  /** RP where this division starts. */
  floorRp: number;
  /** RP that reaches the next division; null at the top division of the top tier. */
  nextRp: number | null;
  /** 0–100 inside the division (100 at the top, which has no ceiling). */
  progress: number;
}

const toRp = (rp: number) => (Number.isSafeInteger(rp) && rp > 0 ? rp : 0);
const divisionsPerTier = RANKED_DIVISIONS.length;
const topStep = RANKED_TIERS.length * divisionsPerTier - 1;

/** RP where a tier's lowest division (III) starts. */
export const tierFloorRp = (tierIndex: number) => tierIndex * divisionsPerTier * RANKED_RULES.divisionRp;

export function rankFor(rawRp: number): RankView {
  const rp = toRp(rawRp);
  const step = Math.min(Math.floor(rp / RANKED_RULES.divisionRp), topStep);
  const tierIndex = Math.floor(step / divisionsPerTier);
  const tier = RANKED_TIERS[tierIndex]!;
  const division = RANKED_DIVISIONS[step % divisionsPerTier]!;
  const floorRp = step * RANKED_RULES.divisionRp;
  const nextRp = step === topStep ? null : floorRp + RANKED_RULES.divisionRp;
  return {
    rp,
    tierId: tier.id,
    tierName: tier.name,
    tierIndex,
    division,
    label: `${tier.name} ${division}`,
    floorRp,
    nextRp,
    progress: nextRp === null ? 100 : Math.floor(((rp - floorRp) * 100) / RANKED_RULES.divisionRp),
  };
}

/** Never below 0 RP. */
export const applyRp = (before: number, delta: number) => Math.max(0, toRp(before) + delta);

/** Outcome for one seat. winnerId 0 = nobody won (both disconnected / expired). */
export function rankedOutcome(userId: number, winnerId: number, reason: string): RankedOutcome {
  if (winnerId === 0) return 'DRAW';
  if (winnerId === userId) return 'WIN';
  return ABANDON_REASONS.includes(reason) ? 'ABANDON' : 'LOSS';
}

export type RankChange = 'TIER_UP' | 'DIVISION_UP' | 'DIVISION_DOWN' | 'TIER_DOWN' | 'SAME';

export function rankChange(beforeRp: number, afterRp: number): RankChange {
  const a = rankFor(beforeRp),
    b = rankFor(afterRp);
  if (b.tierIndex > a.tierIndex) return 'TIER_UP';
  if (b.tierIndex < a.tierIndex) return 'TIER_DOWN';
  const da = RANKED_DIVISIONS.indexOf(a.division),
    db = RANKED_DIVISIONS.indexOf(b.division);
  return db > da ? 'DIVISION_UP' : db < da ? 'DIVISION_DOWN' : 'SAME';
}

/** Tiers whose one-time milestone `afterRp` reaches (the server re-checks against claims). */
export const milestoneTiers = (afterRp: number) =>
  RANKED_TIERS.map((tier, i) => ({ ...tier, minRp: tierFloorRp(i) })).filter(
    (t) => t.milestoneCrystals > 0 && toRp(afterRp) >= t.minRp,
  );

/** "1.460 RP" — Spanish thousands separator, no locale dependency. */
export const formatRp = (rp: number) => `${String(toRp(rp)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} RP`;

/** Safe public config (what GET /ranked/me echoes so the client never hardcodes numbers). */
export const rankedPublicConfig = () => ({
  season: RANKED_SEASON,
  tiers: RANKED_TIERS.map((t, i) => ({ ...t, minRp: tierFloorRp(i) })),
  divisions: RANKED_DIVISIONS,
  divisionRp: RANKED_RULES.divisionRp,
  delta: RANKED_RULES.delta,
});
