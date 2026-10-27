import { PREMIUM_CURRENCY_ID } from '../../src/game';
import {
  RANKED_RULES,
  RANKED_SEASON,
  RANKED_TIERS,
  rankedOutcome,
  tierFloorRp,
  type RankedOutcome,
} from '../../src/game/ranked/ranked';
import type { D1Database, D1PreparedStatement } from './db';
import { rankedMatchRewards } from './rankedTrack';

/**
 * Ranked result application (migration 0023). Runs inside PvPMatchRoom.recordResult, in the SAME
 * D1 batch as the match/history rows, from server state only (winner, reason, ids) — no client
 * value reaches these statements. Idempotent on (match_id, user_id): replays insert nothing, the
 * RP trigger does not fire again and every milestone/ledger insert is guarded by NOT EXISTS.
 */

export interface RankedFinish {
  matchId: string;
  players: [number, number];
  /** Winner user id; 0 = nobody won. */
  winner: number;
  reason: string;
  finishedAt: number;
}

export interface RankedSeatOutcome {
  outcome: RankedOutcome;
  rpBefore: number;
  rpAfter: number;
  rpDelta: number;
  capped: boolean;
  /** Tiers first reached in THIS match, with the Cristales paid. */
  milestones: { tierId: string; crystals: number }[];
  /** Reward Track items granted by THIS match (0025): cards, titles, cosmetics. */
  rewards: { rewardId: string; type: 'CARD' | 'TITLE' | 'COSMETIC'; itemId: string; heroId: string | null; granted: number }[];
}

const MILESTONES = RANKED_TIERS.map((t, i) => ({ tierId: t.id, name: t.name, crystals: t.milestoneCrystals, minRp: tierFloorRp(i) })).filter(
  (t) => t.crystals > 0,
);

export function rankedResultStatements(
  db: D1Database,
  m: RankedFinish,
  newId: () => string = () => crypto.randomUUID(),
): D1PreparedStatement[] {
  const season = RANKED_SEASON.id;
  const out: D1PreparedStatement[] = [];
  for (const seat of [0, 1]) {
    const me = m.players[seat]!,
      rival = m.players[1 - seat]!,
      outcome = rankedOutcome(me, m.winner, m.reason),
      delta = RANKED_RULES.delta[outcome];
    // rp_before is read in the same statement; the cap counts earlier rated games vs this rival.
    out.push(
      db
        .prepare(
          `INSERT INTO tactics_ranked_results (match_id,user_id,opponent_id,season_id,outcome,rp_before,rp_after,rp_delta,capped,finished_at)
           SELECT ?, ?, ?, ?, ?, b, MAX(0, b + d), MAX(0, b + d) - b, c, ?
           FROM (SELECT b, CASE WHEN c = 1 THEN 0 ELSE ? END AS d, c FROM (SELECT
             COALESCE((SELECT rp FROM tactics_ranked_players WHERE user_id = ? AND season_id = ?), 0) AS b,
             CASE WHEN ? <> 0 AND (SELECT count(*) FROM tactics_ranked_results WHERE user_id = ? AND opponent_id = ? AND season_id = ? AND capped = 0 AND finished_at > ?) >= ? THEN 1 ELSE 0 END AS c))
           WHERE 1
           ON CONFLICT (match_id, user_id) DO NOTHING`,
        )
        .bind(
          m.matchId, me, rival, season, outcome, m.finishedAt,
          delta,
          me, season,
          delta, me, rival, season, m.finishedAt - RANKED_RULES.pairWindowMs, RANKED_RULES.pairRatedLimit,
        ),
    );
    for (const t of MILESTONES) {
      // Claimed by the first match whose rp_after reaches the tier floor (never again this season).
      out.push(
        db
          .prepare(
            `INSERT INTO tactics_ranked_milestones (user_id,season_id,tier_id,match_id,crystals,reached_at)
             SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
               AND EXISTS (SELECT 1 FROM tactics_ranked_results WHERE match_id = ? AND user_id = ? AND rp_after >= ?)
             ON CONFLICT (user_id, season_id, tier_id) DO NOTHING`,
          )
          .bind(me, season, t.tierId, m.matchId, t.crystals, m.finishedAt, me, m.matchId, me, t.minRp),
      );
      // Paid only for the match that claimed it; the ledger's own UNIQUE key is the last guard.
      out.push(
        db
          .prepare(
            `INSERT INTO tactics_wallet_ledger (transaction_id,user_id,currency_id,amount_delta,balance_before,balance_after,reason,reference_id,note,created_at)
             SELECT ?,?,?,?,b,b+?,'RANKED_MILESTONE',?,?,? FROM (SELECT COALESCE((SELECT balance FROM tactics_wallets WHERE user_id=? AND currency_id=?),0) AS b)
             WHERE EXISTS (SELECT 1 FROM tactics_ranked_milestones WHERE user_id=? AND season_id=? AND tier_id=? AND match_id=?)
               AND NOT EXISTS (SELECT 1 FROM tactics_wallet_ledger WHERE user_id=? AND currency_id=? AND reason='RANKED_MILESTONE' AND reference_id=?)`,
          )
          .bind(
            newId(), me, PREMIUM_CURRENCY_ID, t.crystals, t.crystals, `${season}:${t.tierId}`,
            `${RANKED_SEASON.name}: primer ascenso a ${t.name}`, m.finishedAt,
            me, PREMIUM_CURRENCY_ID,
            me, season, t.tierId, m.matchId,
            me, PREMIUM_CURRENCY_ID, `${season}:${t.tierId}`,
          ),
      );
    }
  }
  return out;
}

/** What was applied for this match, per seat (read back after the batch; null = not applied). */
export async function rankedOutcomes(db: D1Database, matchId: string, players: [number, number]): Promise<(RankedSeatOutcome | null)[]> {
  const { results } = await db
    .prepare('SELECT user_id, outcome, rp_before, rp_after, rp_delta, capped FROM tactics_ranked_results WHERE match_id = ?')
    .bind(matchId)
    .all<{ user_id: number; outcome: RankedOutcome; rp_before: number; rp_after: number; rp_delta: number; capped: number }>();
  const { results: reached } = await db
    .prepare('SELECT user_id, tier_id, crystals FROM tactics_ranked_milestones WHERE match_id = ? ORDER BY crystals')
    .bind(matchId)
    .all<{ user_id: number; tier_id: string; crystals: number }>();
  const granted = await rankedMatchRewards(db, matchId);
  return players.map((id) => {
    const r = results.find((x) => x.user_id === id);
    return r
      ? {
          outcome: r.outcome,
          rpBefore: r.rp_before,
          rpAfter: r.rp_after,
          rpDelta: r.rp_delta,
          capped: r.capped === 1,
          milestones: reached.filter((x) => x.user_id === id).map((x) => ({ tierId: x.tier_id, crystals: x.crystals })),
          rewards: granted
            .filter((g) => g.user_id === id)
            .map((g) => ({ rewardId: g.reward_id, type: g.reward_type, itemId: g.item_id, heroId: g.hero_id, granted: g.granted })),
        }
      : null;
  });
}

/** Current RP (0 for an account that never played ranked this season). */
export async function currentRp(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare('SELECT rp FROM tactics_ranked_players WHERE user_id = ? AND season_id = ?')
    .bind(userId, RANKED_SEASON.id)
    .first<{ rp: number }>();
  return row?.rp ?? 0;
}
