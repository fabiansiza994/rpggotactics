import { RANKED_SEASON } from '../../src/game/ranked/ranked';
import {
  FIRST_VALID_RANKED_MIN_ROUNDS,
  rankedTrackGrantTable,
  rankedTrackView,
  type RankedTrackInput,
} from '../../src/game/ranked/rewardTrack';
import { RANKED_PREMIUM_TITLES } from '../../src/game/ranked/premiumCosmetics';
import type { D1Database, D1PreparedStatement } from './db';

/**
 * Ranked Reward Track grants (migration 0025). ONE statement per account inserts every reward the
 * season's PEAK RP (MAX(rp_after) of tactics_ranked_results) reaches — never the current rank —
 * guarded by the (user, season, reward) PRIMARY KEY; the AFTER INSERT triggers add the cards /
 * cosmetics exactly once. The same statement runs:
 *   - inside PvPMatchRoom.recordResult's batch, right after the RP rows (matchId = that match);
 *   - as an idempotent reconcile ('RECONCILE') on GET /ranked/me, /ranked/track and /state, which
 *     is also the one-time backfill for accounts whose peak predates the track.
 * Crystals are never paid here (the 0023 milestones already are the crystal nodes).
 * The grant table is bound as JSON (json_each): D1 rejects long compound SELECTs.
 */
const GRANT_TABLE = JSON.stringify(rankedTrackGrantTable());

export function rankedTrackStatement(db: D1Database, userId: number, matchId: string, now: number): D1PreparedStatement {
  const season = RANKED_SEASON.id;
  return db
    .prepare(
      `INSERT INTO tactics_ranked_rewards (user_id, season_id, reward_id, node_id, reward_type, item_id, hero_id, item_kind, quantity, granted, required_rp, match_id, granted_at)
       SELECT ?, ?, json_extract(r.value, '$.rewardId'), json_extract(r.value, '$.nodeId'), json_extract(r.value, '$.type'),
              json_extract(r.value, '$.itemId'), json_extract(r.value, '$.heroId'), json_extract(r.value, '$.itemKind'),
              json_extract(r.value, '$.quantity'),
              CASE WHEN json_extract(r.value, '$.type') = 'CARD'
                   THEN MAX(0, json_extract(r.value, '$.quantity') - COALESCE((SELECT copies FROM tactics_player_cards
                          WHERE user_id = ? AND hero_id = json_extract(r.value, '$.heroId') AND card_id = json_extract(r.value, '$.itemId')), 0))
                   ELSE json_extract(r.value, '$.quantity') END,
              json_extract(r.value, '$.requiredRp'), ?, ?
       FROM json_each(?) r
       WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
         AND COALESCE((SELECT MAX(rp_after) FROM tactics_ranked_results WHERE user_id = ? AND season_id = ?), -1) >= json_extract(r.value, '$.requiredRp')
         AND (json_extract(r.value, '$.condition') IS NULL OR EXISTS (
               SELECT 1 FROM tactics_ranked_results rr JOIN tactics_pvp_matches m ON m.match_id = rr.match_id
               WHERE rr.user_id = ? AND rr.season_id = ? AND rr.outcome IN ('WIN', 'LOSS') AND m.rounds >= ?))
       ON CONFLICT (user_id, season_id, reward_id) DO NOTHING`,
    )
    .bind(userId, season, userId, matchId, now, GRANT_TABLE, userId, userId, season, userId, season, FIRST_VALID_RANKED_MIN_ROUNDS);
}

/** Both seats of a finished ranked match (appended to the result batch AFTER the RP rows). */
export const rankedTrackResultStatements = (db: D1Database, players: [number, number], matchId: string, finishedAt: number) =>
  players.map((id) => rankedTrackStatement(db, id, matchId, finishedAt));

/** Idempotent catch-up for one account (legacy peak, a failed batch…). Safe to call on every read. */
export async function reconcileRankedTrack(db: D1Database, userId: number, now: number): Promise<void> {
  await rankedTrackStatement(db, userId, 'RECONCILE', now).run();
}

export async function rankedTrackInput(db: D1Database, userId: number): Promise<RankedTrackInput> {
  const season = RANKED_SEASON.id;
  const [player, peak, valid, granted, milestones] = await Promise.all([
    db.prepare('SELECT rp FROM tactics_ranked_players WHERE user_id = ? AND season_id = ?').bind(userId, season).first<{ rp: number }>(),
    db
      .prepare('SELECT MAX(rp_after) AS peak FROM tactics_ranked_results WHERE user_id = ? AND season_id = ?')
      .bind(userId, season)
      .first<{ peak: number | null }>(),
    db
      .prepare(
        `SELECT 1 AS ok FROM tactics_ranked_results rr JOIN tactics_pvp_matches m ON m.match_id = rr.match_id
         WHERE rr.user_id = ? AND rr.season_id = ? AND rr.outcome IN ('WIN', 'LOSS') AND m.rounds >= ? LIMIT 1`,
      )
      .bind(userId, season, FIRST_VALID_RANKED_MIN_ROUNDS)
      .first(),
    db
      .prepare('SELECT reward_id, granted, granted_at FROM tactics_ranked_rewards WHERE user_id = ? AND season_id = ?')
      .bind(userId, season)
      .all<{ reward_id: string; granted: number; granted_at: number }>(),
    db
      .prepare('SELECT tier_id FROM tactics_ranked_milestones WHERE user_id = ? AND season_id = ?')
      .bind(userId, season)
      .all<{ tier_id: string }>(),
  ]);
  return {
    rp: player?.rp ?? 0,
    peakRp: peak?.peak ?? 0,
    firstValidRanked: !!valid,
    granted: Object.fromEntries(granted.results.map((g) => [g.reward_id, { grantedAt: g.granted_at, copies: g.granted }])),
    milestones: milestones.results.map((m) => m.tier_id),
  };
}

/** GET /api/tactics/ranked/track body (reconciles first). Only the caller's own data. */
export async function rankedTrackBody(db: D1Database, userId: number, now: number) {
  await reconcileRankedTrack(db, userId, now);
  return { enabled: true as const, track: rankedTrackView(await rankedTrackInput(db, userId)) };
}

/** Owned ranked title? (ownership = its TITLE reward row; demotion never removes it). */
export async function ownsRankedTitle(db: D1Database, userId: number, titleId: string): Promise<boolean> {
  // Premium-track titles live in the pass grants (0027); only their ids ever read that table.
  const table = RANKED_PREMIUM_TITLES.some((t) => t.id === titleId) ? 'tactics_ranked_premium_rewards' : 'tactics_ranked_rewards';
  const row = await db
    .prepare(`SELECT 1 AS ok FROM ${table} WHERE user_id = ? AND reward_type = 'TITLE' AND item_id = ? LIMIT 1`)
    .bind(userId, titleId)
    .first();
  return !!row;
}

/** Rewards granted by one match (result screen reveal), per seat. */
export async function rankedMatchRewards(db: D1Database, matchId: string) {
  const { results } = await db
    .prepare('SELECT user_id, reward_id, reward_type, item_id, hero_id, granted FROM tactics_ranked_rewards WHERE match_id = ? ORDER BY required_rp, reward_id')
    .bind(matchId)
    .all<{ user_id: number; reward_id: string; reward_type: 'CARD' | 'TITLE' | 'COSMETIC'; item_id: string; hero_id: string | null; granted: number }>();
  return results;
}
