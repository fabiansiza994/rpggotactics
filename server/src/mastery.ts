import {
  MASTERY_CHAMPIONS,
  MASTERY_LIMITS,
  MASTERY_REWARDS,
  MASTERY_TITLES,
  MASTERY_XP,
  masteryFor,
  masteryLevelXp,
  masteryPublicConfig,
  titleById,
} from '../../src/game/mastery/mastery';
import type { D1Database, D1PreparedStatement, Env } from './db';
import { rewardDay } from './economy';
import { rankedTitleById } from '../../src/game/ranked/rewardTrack';
import { ownsRankedTitle } from './rankedTrack';
import { error, json } from './http';

/**
 * Champion Mastery v0.1 (migration 0024). XP is granted ONLY here, from events the server already
 * verified (replayed PvE victories, PvP results decided by the room), as rows of the append-only
 * tactics_mastery_ledger keyed (user, hero, source, reference) — retries insert nothing. The
 * statements run inside the caller's existing D1 batch, so XP lands atomically with the victory.
 * No route accepts XP, a level or a reward; the only write route equips an already-unlocked title.
 */

const QA_USERS = ['tactics_qa_a', 'tactics_qa_b'];
/** MASTERY_ENABLED="1" opens it; MASTERY_QA="1" only for the QA accounts. Unset = no grants, no UI. */
export const masteryAllowed = (env: Env, username: string) =>
  env.MASTERY_ENABLED === '1' || (env.MASTERY_QA === '1' && QA_USERS.includes(username));

const isChampion = (heroId: string) => (MASTERY_CHAMPIONS as readonly string[]).includes(heroId);

interface Grant {
  source: 'PVE_VICTORY' | 'FIRST_CLEAR' | 'STORY_FIRST_CLEAR' | 'DAILY_FIRST_WIN' | 'PVP';
  referenceId: string;
  xp: number;
  /** Extra SQL condition (AND …) + its binds. */
  guard?: { sql: string; binds: unknown[] };
}

function grantStatements(db: D1Database, userId: number, heroId: string, now: number, grants: Grant[]): D1PreparedStatement[] {
  const day = rewardDay(now);
  return [
    ...grants
      .filter((g) => g.xp > 0)
      .map((g) =>
        db
          .prepare(
            `INSERT INTO tactics_mastery_ledger (user_id, hero_id, source, reference_id, xp, day, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)${g.guard ? ' AND ' + g.guard.sql : ''}
             ON CONFLICT (user_id, hero_id, source, reference_id) DO NOTHING`,
          )
          .bind(userId, heroId, g.source, g.referenceId, g.xp, day, now, userId, ...(g.guard?.binds ?? [])),
      ),
    rewardsStatement(db, userId, heroId, now),
  ];
}

/**
 * Every level reward the champion's XP now reaches, inserted once (the trigger pays crystals).
 * The reward table is bound as JSON (json_each): D1 caps compound SELECTs, so no UNION ALL list.
 */
function rewardsStatement(db: D1Database, userId: number, heroId: string, now: number): D1PreparedStatement {
  const table = JSON.stringify(MASTERY_REWARDS.map((r) => ({ level: r.level, minXp: masteryLevelXp(r.level), crystals: r.crystals })));
  return db
    .prepare(
      `INSERT INTO tactics_mastery_rewards (user_id, hero_id, level, crystals, reached_at)
       SELECT ?, ?, json_extract(r.value, '$.level'), json_extract(r.value, '$.crystals'), ? FROM json_each(?) r
       WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
         AND COALESCE((SELECT xp FROM tactics_champion_mastery WHERE user_id = ? AND hero_id = ?), 0) >= json_extract(r.value, '$.minXp')
       ON CONFLICT (user_id, hero_id, level) DO NOTHING`,
    )
    .bind(userId, heroId, now, table, userId, userId, heroId);
}

export interface PveVictory {
  heroId: string;
  campaignId: string;
  /** Champion Story campaigns add the story bonus to first clears. */
  story: boolean;
  encounterId: string;
  tier: 'NORMAL' | 'ELITE' | 'BOSS';
  /** Unique per run (campaign: run seed; skirmish: battle id). */
  runRef: string;
  /** Skirmishes give the repeatable victory XP only. */
  skirmish?: boolean;
  /** transactionId of this victory's DAILY_FIRST_WIN crystal reward (economy.ts), if offered. */
  dailyFirstWinTransactionId?: string;
}

/**
 * Called ONLY after replay verification, appended AFTER the economy statements and BEFORE the
 * victory log row in the same batch (saveCampaignStep beforeLog): the first-clear guard then sees
 * only earlier clears, and the daily bonus only fires if this batch paid the daily first win.
 */
export function pveVictoryMastery(db: D1Database, userId: number, now: number, v: PveVictory): D1PreparedStatement[] {
  if (!isChampion(v.heroId)) return [];
  const day = rewardDay(now);
  // Legacy guard (no backfill): a clear verified before this version never pays a first-clear bonus later.
  const neverCleared = {
    sql: `NOT EXISTS (SELECT 1 FROM tactics_reward_log WHERE user_id = ? AND COALESCE(hero_id, 'mage') = ? AND campaign_id = ? AND encounter_id = ? AND event IN ('OFFERED','NO_DROP','CLAIMED'))`,
    binds: [userId, v.heroId, v.campaignId, v.encounterId],
  };
  const firstClearRef = `${v.campaignId}:${v.encounterId}`;
  const grants: Grant[] = [
    {
      source: 'PVE_VICTORY',
      referenceId: `${v.skirmish ? 'skirmish' : v.campaignId}:${v.runRef}:${v.encounterId}`,
      xp: MASTERY_XP.PVE_VICTORY,
      guard: {
        sql: `(SELECT count(*) FROM tactics_mastery_ledger WHERE user_id = ? AND hero_id = ? AND source = 'PVE_VICTORY' AND day = ?) < ?`,
        binds: [userId, v.heroId, day, MASTERY_LIMITS.pveRepeatPerDay],
      },
    },
  ];
  if (!v.skirmish) {
    grants.push({ source: 'FIRST_CLEAR', referenceId: firstClearRef, xp: MASTERY_XP.FIRST_CLEAR[v.tier], guard: neverCleared });
    if (v.story) grants.push({ source: 'STORY_FIRST_CLEAR', referenceId: firstClearRef, xp: MASTERY_XP.STORY_FIRST_CLEAR, guard: neverCleared });
  }
  if (v.dailyFirstWinTransactionId)
    grants.push({
      source: 'DAILY_FIRST_WIN',
      referenceId: day,
      xp: MASTERY_XP.DAILY_FIRST_WIN,
      guard: { sql: `EXISTS (SELECT 1 FROM tactics_wallet_ledger WHERE user_id = ? AND transaction_id = ?)`, binds: [userId, v.dailyFirstWinTransactionId] },
    });
  return grantStatements(db, userId, v.heroId, now, grants);
}

export interface PvpFinishForMastery {
  matchId: string;
  ranked: boolean;
  players: [{ id: number; heroId: string }, { id: number; heroId: string }];
  /** Winner user id; 0 = nobody won. */
  winner: number;
  reason: string;
  rounds: number;
  finishedAt: number;
}

/** No XP: draws, matches that never reached round 2, and the side that abandoned. */
export function pvpMastery(db: D1Database, m: PvpFinishForMastery): D1PreparedStatement[] {
  if (m.winner === 0 || m.rounds < MASTERY_LIMITS.pvpMinRounds) return [];
  const table = m.ranked ? MASTERY_XP.PVP.RANKED : MASTERY_XP.PVP.CASUAL;
  return [0, 1].flatMap((seat) => {
    const me = m.players[seat]!,
      rival = m.players[1 - seat]!,
      won = me.id === m.winner;
    if (!isChampion(me.heroId) || (!won && ['OPPONENT_DISCONNECTED', 'ABANDONED'].includes(m.reason))) return [];
    // Same-rival cap shared by Casual and Ranked (history rows of this batch are already written).
    return grantStatements(db, me.id, me.heroId, m.finishedAt, [
      {
        source: 'PVP',
        referenceId: m.matchId,
        xp: won ? table.WIN : table.LOSS,
        guard: {
          sql: `(SELECT count(*) FROM tactics_mastery_ledger l WHERE l.user_id = ? AND l.source = 'PVP' AND l.created_at > ?
                 AND l.reference_id IN (SELECT match_id FROM tactics_pvp_match_players WHERE user_id = ? AND opponent_id = ?)) < ?`,
          binds: [me.id, m.finishedAt - MASTERY_LIMITS.pvpPairWindowMs, me.id, rival.id, MASTERY_LIMITS.pvpPairLimit],
        },
      },
    ]);
  });
}

/** Public equipped title (catalog id) or null; used for PvP members and social cards. */
export async function equippedTitle(db: D1Database, userId: number): Promise<string | null> {
  const row = await db.prepare('SELECT title_id FROM tactics_profile_titles WHERE user_id = ?').bind(userId).first<{ title_id: string }>();
  return knownTitle(row?.title_id);
}
/** Any catalog title: Champion Mastery or Ranked (the same equipped slot). */
export const knownTitle = (id: unknown): string | null => titleById(id)?.id ?? rankedTitleById(id)?.id ?? null;

async function xpByChampion(db: D1Database, userId: number): Promise<Record<string, number>> {
  const { results } = await db
    .prepare('SELECT hero_id, xp FROM tactics_champion_mastery WHERE user_id = ?')
    .bind(userId)
    .all<{ hero_id: string; xp: number }>();
  return Object.fromEntries(MASTERY_CHAMPIONS.map((id) => [id, results.find((r) => r.hero_id === id)?.xp ?? 0]));
}

/** GET /api/tactics/mastery · PUT /api/tactics/mastery/title { titleId | null }. */
export async function masteryRoute(
  request: Request,
  env: Env,
  caller: { userId: number; username: string },
  now: number,
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path !== '/api/tactics/mastery' && path !== '/api/tactics/mastery/title') return null;
  const route = `${request.method} ${path.endsWith('/title') ? 'title' : 'mastery'}`;
  if (route !== 'GET mastery' && route !== 'PUT title') return error(405, 'BAD_METHOD', 'Método no permitido.');
  if (!masteryAllowed(env, caller.username)) {
    if (route === 'GET mastery') return json({ enabled: false });
    return error(403, 'MASTERY_DISABLED', 'La maestría todavía no está disponible.');
  }
  const db = env.DB;
  const xp = await xpByChampion(db, caller.userId);

  if (route === 'PUT title') {
    let body: { titleId?: unknown };
    try {
      const raw = await request.text();
      if (raw.length > 512) return error(413, 'TOO_LARGE', 'Solicitud demasiado grande.');
      body = JSON.parse(raw || '{}');
    } catch {
      return error(400, 'BAD_REQUEST', 'Cuerpo inválido.');
    }
    if (body.titleId === null) {
      await db.prepare('DELETE FROM tactics_profile_titles WHERE user_id = ?').bind(caller.userId).run();
    } else {
      const title = titleById(body.titleId);
      const ranked = title ? undefined : rankedTitleById(body.titleId);
      if (!title && !ranked) return error(422, 'UNKNOWN_TITLE', 'Título desconocido.');
      // Unlocked = the champion's level (derived from server XP) reaches the title. Nothing else.
      if (title && masteryFor(xp[title.championId] ?? 0).level < title.requiredMastery)
        return error(403, 'TITLE_LOCKED', 'Todavía no has desbloqueado este título.');
      // Ranked title: owned = its Reward Track row exists (granted from the server's peak RP).
      if (ranked && !(await ownsRankedTitle(db, caller.userId, ranked.id)))
        return error(403, 'TITLE_LOCKED', 'Todavía no has desbloqueado este título.');
      await db
        .prepare(
          'INSERT INTO tactics_profile_titles (user_id, title_id, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET title_id = excluded.title_id, updated_at = excluded.updated_at',
        )
        .bind(caller.userId, (title ?? ranked)!.id, now)
        .run();
    }
  }

  const equipped = await equippedTitle(db, caller.userId);
  const { results: rewards } = await db
    .prepare('SELECT hero_id, level, crystals, reached_at FROM tactics_mastery_rewards WHERE user_id = ? ORDER BY hero_id, level')
    .bind(caller.userId)
    .all<{ hero_id: string; level: number; crystals: number; reached_at: number }>();
  return json({
    enabled: true,
    config: masteryPublicConfig(),
    champions: Object.fromEntries(MASTERY_CHAMPIONS.map((id) => [id, { xp: xp[id]!, level: masteryFor(xp[id]!).level }])),
    // Display names are NOT sent: the client resolves them from the catalog by id (titleName).
    titles: MASTERY_TITLES.map((t) => ({
      ...t,
      unlocked: masteryFor(xp[t.championId] ?? 0).level >= t.requiredMastery,
      equipped: t.id === equipped,
    })),
    equippedTitleId: equipped,
    rewards: rewards.map((r) => ({ heroId: r.hero_id, level: r.level, crystals: r.crystals, reachedAt: r.reached_at })),
  });
}
