import type { D1Database, D1PreparedStatement, Env } from './db';
import { error, json } from './http';
import { normalizeUsername } from './social';

/**
 * PvP match history + player stats (migration 0019). Reads only the caller's own
 * tactics_pvp_match_players rows: a player sees their history, the detail of matches they played
 * and the aggregate against one rival, never another account's history. Rivals are named by their
 * CURRENT username (resolved at read time); ids, emails, decks, hands and chat never leave here.
 */

export const HISTORY_PAGE_SIZE = 20;

export type PvpResult = 'WIN' | 'LOSS' | 'DRAW';

/** What the PvPMatchRoom knows when a match ends (all server-side state, nothing from a client). */
export interface FinishedMatch {
  matchId: string;
  mode: string;
  players: [{ id: number; champion: string }, { id: number; champion: string }];
  /** Winner/loser user ids; 0 = nobody won (both disconnected, match expired). */
  winner: number;
  loser: number;
  reason: string;
  rounds: number;
  startedAt: number | null;
  finishedAt: number;
}

export const resultFor = (userId: number, winner: number): PvpResult =>
  winner === 0 ? 'DRAW' : winner === userId ? 'WIN' : 'LOSS';

export const durationSeconds = (startedAt: number | null, finishedAt: number): number | null =>
  startedAt === null || finishedAt < startedAt ? null : Math.round((finishedAt - startedAt) / 1000);

/** One idempotent row per participant; batched by the room together with the match row. */
export function matchPlayerStatements(db: D1Database, m: FinishedMatch): D1PreparedStatement[] {
  return [0, 1].map((seat) => {
    const me = m.players[seat]!,
      rival = m.players[1 - seat]!;
    return db
      .prepare(
        `INSERT INTO tactics_pvp_match_players
          (match_id,user_id,opponent_id,seat,champion,opponent_champion,mode,result,reason,rounds,duration_seconds,started_at,finished_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(match_id,user_id) DO NOTHING`,
      )
      .bind(
        m.matchId,
        me.id,
        rival.id,
        seat,
        me.champion,
        rival.champion,
        m.mode,
        resultFor(me.id, m.winner),
        m.reason,
        m.rounds,
        durationSeconds(m.startedAt, m.finishedAt),
        m.startedAt,
        m.finishedAt,
      );
  });
}

interface PlayerRow {
  match_id: string;
  opponent_id: number;
  opponent_name: string | null;
  champion: string;
  opponent_champion: string;
  mode: string;
  result: PvpResult;
  reason: string;
  rounds: number;
  duration_seconds: number | null;
  finished_at: number;
  /** Ranked Preseason projection (migration 0023); null on casual matches. */
  rp_before: number | null;
  rp_after: number | null;
  rp_delta: number | null;
  rp_capped: number | null;
}

const opponentOf = (r: PlayerRow) => ({
  // null + deleted: the account no longer exists (UI: "Jugador eliminado").
  username: r.opponent_name,
  deleted: r.opponent_name === null,
  champion: r.opponent_champion,
});

const item = (r: PlayerRow) => ({
  matchId: r.match_id,
  playedAt: r.finished_at,
  mode: r.mode,
  result: r.result,
  reason: r.reason,
  opponent: opponentOf(r),
  myChampion: r.champion,
  rounds: r.rounds,
  durationSeconds: r.duration_seconds,
  // Queue type, not game mode (mode stays DUEL/DOMINION). Rank is derived from RP client-side.
  queue: r.rp_after === null ? 'CASUAL' : 'RANKED',
  ranked:
    r.rp_after === null
      ? null
      : { rpBefore: r.rp_before!, rpAfter: r.rp_after, rpDelta: r.rp_delta!, capped: r.rp_capped === 1 },
});

const ROW_COLUMNS = `p.match_id, p.opponent_id, u.username AS opponent_name, p.champion, p.opponent_champion, p.mode,
  p.result, p.reason, p.rounds, p.duration_seconds, p.finished_at,
  rr.rp_before, rr.rp_after, rr.rp_delta, rr.capped AS rp_capped`;
const RANKED_JOIN = 'LEFT JOIN tactics_ranked_results rr ON rr.match_id = p.match_id AND rr.user_id = p.user_id';

/** ?queue=RANKED|CASUAL narrows stats/head-to-head; anything else = all matches. */
function queueFilter(request: Request): string {
  const q = new URL(request.url).searchParams.get('queue');
  const ranked =
    'EXISTS (SELECT 1 FROM tactics_ranked_results rr WHERE rr.match_id = tactics_pvp_match_players.match_id AND rr.user_id = tactics_pvp_match_players.user_id)';
  return q === 'RANKED' ? ` AND ${ranked}` : q === 'CASUAL' ? ` AND NOT ${ranked}` : '';
}

interface Tally {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}
/** winRate = wins / matches in whole percent (draws count as played, not won). */
const tally = (r: { matches: number; wins: number; losses: number }): Tally => ({
  matches: r.matches,
  wins: r.wins,
  losses: r.losses,
  draws: r.matches - r.wins - r.losses,
  winRate: r.matches ? Math.round((r.wins / r.matches) * 100) : 0,
});
const TALLY_COLUMNS = `count(*) AS matches, sum(result = 'WIN') AS wins, sum(result = 'LOSS') AS losses`;

async function grouped(db: D1Database, where: string, binds: unknown[], column: 'champion' | 'mode') {
  const { results } = await db
    .prepare(
      `SELECT ${column} AS key, ${TALLY_COLUMNS} FROM tactics_pvp_match_players WHERE ${where} GROUP BY ${column} ORDER BY matches DESC, ${column}`,
    )
    .bind(...binds)
    .all<{ key: string; matches: number; wins: number; losses: number }>();
  return results.map((r) => ({ [column]: r.key, ...tally(r) }));
}

async function totals(db: D1Database, where: string, binds: unknown[]) {
  const row = await db
    .prepare(`SELECT ${TALLY_COLUMNS}, max(finished_at) AS last FROM tactics_pvp_match_players WHERE ${where}`)
    .bind(...binds)
    .first<{ matches: number; wins: number | null; losses: number | null; last: number | null }>();
  return {
    tally: tally({ matches: row?.matches ?? 0, wins: row?.wins ?? 0, losses: row?.losses ?? 0 }),
    last: row?.last ?? null,
  };
}

const MATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURSOR = /^([0-9]{1,15})\.([0-9a-f-]{36})$/;

/** GET /api/tactics/pvp/{history,history/:matchId,stats,head-to-head/:username}. Null = not ours. */
export async function pvpHistoryRoute(
  request: Request,
  env: Env,
  caller: { userId: number; username: string },
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (!path.startsWith('/api/tactics/pvp/')) return null;
  const sub = path.slice('/api/tactics/pvp/'.length);
  const [head, arg, extra] = sub.split('/');
  if (!['history', 'stats', 'head-to-head'].includes(head!)) return null;
  if (request.method !== 'GET') return error(405, 'BAD_METHOD', 'Método no permitido.');
  if (extra !== undefined) return error(404, 'NOT_FOUND', 'Not found');
  const db = env.DB,
    me = caller.userId;

  if (head === 'history' && arg === undefined) {
    const params=new URL(request.url).searchParams;
    const opponent=params.get('opponent');
    const limit=params.get('limit')==='3'?3:HISTORY_PAGE_SIZE;
    const cursor = new URL(request.url).searchParams.get('cursor');
    const parsed = cursor ? CURSOR.exec(cursor) : null;
    if (cursor && !parsed) return error(400, 'BAD_CURSOR', 'Página inválida.');
    const { results } = await db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM tactics_pvp_match_players p LEFT JOIN users u ON u.id = p.opponent_id ${RANKED_JOIN}
         WHERE p.user_id = ? ${opponent?'AND u.username = ?':''} ${parsed ? 'AND (p.finished_at < ? OR (p.finished_at = ? AND p.match_id < ?))' : ''}
         ORDER BY p.finished_at DESC, p.match_id DESC LIMIT ?`,
      )
      .bind(
        me,
        ...(opponent?[opponent]:[]),
        ...(parsed ? [Number(parsed[1]), Number(parsed[1]), parsed[2]] : []),
        limit + 1,
      )
      .all<PlayerRow>();
    const page = results.slice(0, limit),
      last = page.at(-1);
    return json({
      matches: page.map(item),
      nextCursor: results.length > limit && last ? `${last.finished_at}.${last.match_id}` : null,
    });
  }

  if (head === 'history') {
    // Only participants: anyone else gets the same 404 as an unknown id (existence is not revealed).
    if (!MATCH_ID.test(arg!)) return error(404, 'NOT_FOUND', 'Partida no encontrada.');
    const row = await db
      .prepare(
        `SELECT ${ROW_COLUMNS}, p.seat, p.started_at, m.map_id, m.score_a, m.score_b, m.first_player
         FROM tactics_pvp_match_players p
         LEFT JOIN users u ON u.id = p.opponent_id
         LEFT JOIN tactics_pvp_matches m ON m.match_id = p.match_id
         ${RANKED_JOIN}
         WHERE p.match_id = ? AND p.user_id = ?`,
      )
      .bind(arg, me)
      .first<
        PlayerRow & {
          seat: number;
          started_at: number | null;
          map_id: string | null;
          score_a: number | null;
          score_b: number | null;
          first_player: number | null;
        }
      >();
    if (!row) return error(404, 'NOT_FOUND', 'Partida no encontrada.');
    const scores = [row.score_a, row.score_b];
    return json({
      ...item(row),
      startedAt: row.started_at,
      mapId: row.map_id ?? 'classic',
      me: { username: caller.username, champion: row.champion },
      firstTurn: row.first_player === null ? null : row.first_player === row.seat ? 'ME' : 'OPPONENT',
      // Dominion final points (the only per-match stat the server already stores reliably).
      score:
        scores[0] === null || scores[1] === null
          ? null
          : { mine: scores[row.seat]!, theirs: scores[1 - row.seat]! },
    });
  }

  if (head === 'stats') {
    if (arg !== undefined) return error(404, 'NOT_FOUND', 'Not found');
    const where = 'user_id = ?' + queueFilter(request);
    return json({
      overall: (await totals(db, where, [me])).tally,
      byChampion: await grouped(db, where, [me], 'champion'),
      byMode: await grouped(db, where, [me], 'mode'),
    });
  }

  // head-to-head/:username — the aggregate between the caller and one rival.
  let raw = '';
  try {
    raw = decodeURIComponent(arg ?? '');
  } catch {
    /* malformed escape → treated as unknown */
  }
  const username = normalizeUsername(raw);
  const rival = username
    ? await db.prepare('SELECT id, username FROM users WHERE username = ?').bind(username).first<{ id: number; username: string }>()
    : null;
  if (rival?.id === me) return error(400, 'SELF', 'Elige a otro jugador.');
  // A block in either direction looks exactly like an unknown player (same rule as social search:
  // a block BY the other player is never revealed).
  const blocked = rival
    ? await db
        .prepare(
          'SELECT 1 AS b FROM tactics_social_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1',
        )
        .bind(me, rival.id, rival.id, me)
        .first()
    : null;
  if (!rival || blocked) return error(404, 'NOT_FOUND', 'Jugador no encontrado.');
  const where = 'user_id = ? AND opponent_id = ?' + queueFilter(request),
    binds = [me, rival.id];
  const { tally: t, last } = await totals(db, where, binds);
  return json({
    opponent: { username: rival.username },
    matchesPlayed: t.matches,
    myWins: t.wins,
    theirWins: t.losses,
    draws: t.draws,
    winRate: t.winRate,
    lastPlayedAt: last,
    byChampion: await grouped(db, where, binds, 'champion'),
    byMode: await grouped(db, where, binds, 'mode'),
  });
}
