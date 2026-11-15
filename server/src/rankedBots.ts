import { DEFAULT_CONTENT, type GameContent } from "../../src/game";
import { playableBotChampions, selectBotChampion } from "./botChampions";
import { rewardsStatement } from "./mastery";
import {
  BOT_POLICY,
  botIdentity,
  botReward,
  type BotIdentity,
  type BotOutcome,
} from "../../src/game/ai/ranked-bot-policy";
import { RANKED_SEASON } from "../../src/game/ranked/ranked";
import type { Env, D1Database, D1PreparedStatement } from "./db";
export const botsEnabled = (env: Env) => env.RANKED_BOTS_ENABLED === "1";
export const botPolicy = (env: Env) => ({
  ...BOT_POLICY,
  maxDailyXpMatches: Math.max(
    0,
    Math.min(20, Number(env.RANKED_BOTS_XP_MATCHES_PER_DAY ?? 6) || 0),
  ),
});
export async function botRewardPreview(
  db: D1Database,
  userId: number,
  rp: number,
  now: number,
  policy = BOT_POLICY,
) {
  const day = new Date(now).toISOString().slice(0, 10);
  const row = await db
    .prepare(
      "SELECT SUM(CASE WHEN outcome='WIN' AND rp_delta>0 THEN 1 ELSE 0 END) AS wins,COALESCE(SUM(MAX(0,rp_delta)),0) AS positive,SUM(CASE WHEN xp>0 THEN 1 ELSE 0 END) AS xpMatches FROM tactics_ranked_bot_results WHERE user_id=? AND day=?",
    )
    .bind(userId, day)
    .first<{ wins: number; positive: number; xpMatches: number }>();
  const win = botReward(
    {
      rp,
      outcome: "WIN",
      dailyWins: row?.wins ?? 0,
      dailyPositive: row?.positive ?? 0,
      dailyXpMatches: row?.xpMatches ?? 0,
      valid: true,
    },
    policy,
  );
  return {
    ...win,
    lossRp: Math.max(-rp, policy.lossRp),
    abandonRp: Math.max(-rp, policy.abandonRp),
    lossXp:
      (row?.xpMatches ?? 0) < policy.maxDailyXpMatches ? policy.lossXp : 0,
  };
}
export function makeBot(
  userId: number,
  since: number,
  rp: number,
  seed: number,
  env: Env,
  content: GameContent = DEFAULT_CONTENT,
  recent: readonly unknown[] = [],
) {
  const identity = botIdentity(
    `ranked:${userId}:${since}`,
    rp,
    seed,
    env.RANKED_BOTS_HIGHER_LEVEL_BPS === undefined
      ? undefined
      : Number(env.RANKED_BOTS_HIGHER_LEVEL_BPS),
  );
  identity.heroId = selectBotChampion(
    seed,
    playableBotChampions(env, content),
    recent,
  );
  return identity;
}
export interface BotFinish {
  matchId: string;
  userId: number;
  heroId: string;
  bot: BotIdentity;
  outcome: BotOutcome;
  now: number;
  valid: boolean;
  policy: typeof BOT_POLICY;
}
/** One INSERT reads latest RP and daily counters and its trigger adds the delta in the SAME transaction. */
export function botSettlementStatements(
  db: D1Database,
  m: BotFinish,
): D1PreparedStatement[] {
  const p = m.policy,
    day = new Date(m.now).toISOString().slice(0, 10),
    win = m.outcome === "WIN" && m.valid;
  return [
    db
      .prepare(
        `INSERT INTO tactics_ranked_bot_results(match_id,user_id,season_id,outcome,day,rp_before,rp_delta,rp_after,xp,valid,finished_at)
 SELECT ?,?,?,?,?,rp,delta,MAX(0,rp+delta),xp,?,? FROM (
 SELECT rp,CASE WHEN ? THEN CASE WHEN wins>=? OR positive>=? THEN 0 ELSE MIN(?,?-positive,CASE WHEN rp<1500 THEN MAX(0,((rp/300)+1)*300-1-rp) ELSE ? END) END
 WHEN ?='LOSS' THEN MAX(-rp,?) WHEN ?='ABANDON' THEN MAX(-rp,?) ELSE 0 END AS delta,
 CASE WHEN ? AND xp_matches<? THEN CASE WHEN ?='WIN' THEN ? WHEN ?='LOSS' THEN ? ELSE 0 END ELSE 0 END AS xp
 FROM (SELECT COALESCE((SELECT rp FROM tactics_ranked_players WHERE user_id=? AND season_id=?),0) AS rp,
 (SELECT COUNT(*) FROM tactics_ranked_bot_results WHERE user_id=? AND day=? AND outcome='WIN' AND rp_delta>0) AS wins,
 COALESCE((SELECT SUM(MAX(0,rp_delta)) FROM tactics_ranked_bot_results WHERE user_id=? AND day=?),0) AS positive,
 (SELECT COUNT(*) FROM tactics_ranked_bot_results WHERE user_id=? AND day=? AND xp>0) AS xp_matches))
 WHERE EXISTS(SELECT 1 FROM tactics_ranked_bot_encounters WHERE match_id=? AND user_id=?) ON CONFLICT(match_id) DO NOTHING`,
      )
      .bind(
        m.matchId,
        m.userId,
        RANKED_SEASON.id,
        m.outcome,
        day,
        m.valid ? 1 : 0,
        m.now,
        win ? 1 : 0,
        p.maxDailyWins,
        p.maxDailyPositiveRp,
        p.winRp,
        p.maxDailyPositiveRp,
        p.winRp,
        m.outcome,
        p.lossRp,
        m.outcome,
        p.abandonRp,
        m.valid ? 1 : 0,
        p.maxDailyXpMatches,
        m.outcome,
        p.winXp,
        m.outcome,
        p.lossXp,
        m.userId,
        RANKED_SEASON.id,
        m.userId,
        day,
        m.userId,
        day,
        m.userId,
        day,
        m.matchId,
        m.userId,
      ),
    db
      .prepare(
        `INSERT INTO tactics_mastery_ledger(user_id,hero_id,source,reference_id,xp,day,created_at) SELECT ?,?,'RANKED_BOT',match_id,xp,day,finished_at FROM tactics_ranked_bot_results WHERE match_id=? AND xp>0 ON CONFLICT(user_id,hero_id,source,reference_id) DO NOTHING`,
      )
      .bind(m.userId, m.heroId, m.matchId),
    rewardsStatement(db, m.userId, m.heroId, m.now),
    db
      .prepare(
        "UPDATE tactics_ranked_bot_encounters SET finished_at=? WHERE match_id=?",
      )
      .bind(m.now, m.matchId),
    db
      .prepare(
        "DELETE FROM tactics_match_reservations WHERE room_code=(SELECT room_code FROM tactics_ranked_bot_encounters WHERE match_id=?)",
      )
      .bind(m.matchId),
  ];
}
export async function botResult(db: D1Database, matchId: string) {
  const row = await db
    .prepare(
      "SELECT outcome,rp_before AS rpBefore,rp_after AS rpAfter,rp_delta AS rpDelta,xp,valid FROM tactics_ranked_bot_results WHERE match_id=?",
    )
    .bind(matchId)
    .first<{
      outcome: BotOutcome;
      rpBefore: number;
      rpAfter: number;
      rpDelta: number;
      xp: number;
      valid: number;
    }>();
  if (!row) return null;
  const restrictions: string[] = [];
  if (row.outcome === "SERVER_ERROR")
    restrictions.push("Incidencia del servidor: sin penalización");
  if (!row.valid && (row.outcome === "WIN" || row.outcome === "LOSS"))
    restrictions.push(
      "Partida demasiado breve para recompensas positivas o maestría",
    );
  if (row.outcome === "WIN" && row.valid && row.rpDelta < 10) {
    const remaining =
      row.rpBefore < 1500
        ? (Math.floor(row.rpBefore / 300) + 1) * 300 - 1 - row.rpBefore
        : 10;
    if (remaining < 10 && row.rpDelta === remaining)
      restrictions.push("El ascenso de rango requiere victoria humana");
    if (row.rpDelta < Math.min(10, remaining))
      restrictions.push("Límite diario de RP positivo contra IA");
  }
  if (
    row.valid &&
    row.xp === 0 &&
    (row.outcome === "WIN" || row.outcome === "LOSS")
  )
    restrictions.push("Límite diario de maestría contra IA");
  return { ...row, restrictions };
}
