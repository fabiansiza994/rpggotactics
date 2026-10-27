import { CLOUD_CONFIG } from '../cloud/config';
import { request, type CloudResult } from '../cloud/http';
import { loadSession } from '../cloud/session';
import type { RankedOutcome } from '../../game/ranked/ranked';
import type { PremiumTrackView } from '../../game/ranked/premiumTrack';
import type { RankedTrackView } from '../../game/ranked/rewardTrack';

/** Shapes of /api/tactics/ranked/* (server/src/ranked.ts). The client never sends RP or results. */
export type RankedQueueState =
  | { state: 'IDLE' }
  | { state: 'SEARCHING'; heroId: string; deckId?: string | null; since: number }
  | { state: 'MATCHED'; code: string };

export type RankedProfile =
  | { enabled: false }
  | {
      enabled: true;
      rp: number;
      wins: number;
      losses: number;
      draws: number;
      /** Tier ids whose one-time milestone was reached this season. */
      milestones: string[];
      queue: RankedQueueState;
    };

/** Per-seat ranked block of a PvP room snapshot (server/src/pvp.ts view). */
export interface RankedSnapshot {
  /** RP of seat 0 / seat 1 when the match was created. */
  rp: [number, number];
  /** The viewer's applied result, once the server recorded it. */
  outcome: {
    outcome: RankedOutcome;
    rpBefore: number;
    rpAfter: number;
    rpDelta: number;
    capped: boolean;
    milestones: { tierId: string; crystals: number }[];
    /** Reward Track items this match granted (absent on servers older than the track). */
    rewards?: {
      rewardId: string;
      type: 'CARD' | 'TITLE' | 'COSMETIC';
      itemId: string;
      heroId: string | null;
      granted: number;
    }[];
  } | null;
}

const base = '/api/tactics/ranked';
const call = <T>(path: string, method = 'GET', body?: unknown): Promise<CloudResult<T> | null> => {
  const s = loadSession();
  return s
    ? request<T>(CLOUD_CONFIG.apiUrl, base + path, {
        method,
        body,
        token: s.token,
        timeoutMs: CLOUD_CONFIG.timeoutMs,
      })
    : Promise.resolve(null);
};

export const rankedApi = {
  purchasePremium: (seasonId: string, idempotencyKey: string) =>
    call<{
      status: string;
      balance: number;
      granted: { rewardId: string }[];
      premium: PremiumTrackView;
    }>('/premium/purchase', 'POST', { seasonId, idempotencyKey }),
  chooseShowcase: (cardId: string) =>
    call<{ chosenCardId: string; premium: PremiumTrackView }>('/premium/showcase', 'POST', {
      cardId,
    }),
  me: () => call<RankedProfile>('/me'),
  /** `deckId` = one of the caller's decks for that champion; omitted = its default deck. */
  join: (heroId: string, deckId?: string) =>
    call<{ queue: RankedQueueState }>('/queue', 'POST', deckId === undefined ? { heroId } : { heroId, deckId }),
  poll: () => call<{ queue: RankedQueueState }>('/queue'),
  cancel: () => call<{ queue: RankedQueueState }>('/cancel', 'POST', {}),
  track: () =>
    call<
      { enabled: false } | { enabled: true; track: RankedTrackView; premium?: PremiumTrackView }
    >('/track'),
};
