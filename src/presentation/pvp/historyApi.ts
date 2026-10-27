import { CLOUD_CONFIG } from '../cloud/config';
import { request } from '../cloud/http';

/** Shapes returned by GET /api/tactics/pvp/{history,stats,head-to-head} (server/src/pvpHistory.ts). */
export type PvpResult = 'WIN' | 'LOSS' | 'DRAW';

export interface PvpOpponent {
  /** null when the account no longer exists (`deleted`). */
  username: string | null;
  deleted: boolean;
  champion: string;
}

export interface PvpHistoryItem {
  matchId: string;
  /** ms epoch of the end of the match. */
  playedAt: number;
  mode: string;
  result: PvpResult;
  reason: string;
  opponent: PvpOpponent;
  myChampion: string;
  rounds: number;
  durationSeconds: number | null;
  /** Queue type (absent on servers before Ranked Preseason = casual). */
  queue?: 'CASUAL' | 'RANKED';
  ranked?: { rpBefore: number; rpAfter: number; rpDelta: number; capped: boolean } | null;
}

export interface PvpHistoryPage {
  matches: PvpHistoryItem[];
  nextCursor: string | null;
}

export interface PvpMatchDetail extends PvpHistoryItem {
  startedAt: number | null;
  mapId: string;
  me: { username: string; champion: string };
  firstTurn: 'ME' | 'OPPONENT' | null;
  score: { mine: number; theirs: number } | null;
}

export interface PvpTally {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** wins / matches, whole percent. */
  winRate: number;
}

export interface PvpStats {
  overall: PvpTally;
  byChampion: (PvpTally & { champion: string })[];
  byMode: (PvpTally & { mode: string })[];
}

/** Friends contract: "Hacker994 · 12 partidas · 7 victorias · 5 derrotas". */
export interface PvpHeadToHead {
  opponent: { username: string };
  matchesPlayed: number;
  myWins: number;
  theirWins: number;
  draws: number;
  winRate: number;
  lastPlayedAt: number | null;
  byChampion: (PvpTally & { champion: string })[];
  byMode: (PvpTally & { mode: string })[];
}

const base = '/api/tactics/pvp';
const opts = (token: string) => ({ token, timeoutMs: CLOUD_CONFIG.timeoutMs });

export const pvpHistoryApi = {
  history: (token: string, cursor?: string | null, opponent?:string, limit?:number) =>
    request<PvpHistoryPage>(
      CLOUD_CONFIG.apiUrl,
      `${base}/history?${new URLSearchParams({...cursor?{cursor}:{},...opponent?{opponent}:{},...limit?{limit:String(limit)}:{}})}`,
      opts(token),
    ),
  detail: (token: string, matchId: string) =>
    request<PvpMatchDetail>(CLOUD_CONFIG.apiUrl, `${base}/history/${encodeURIComponent(matchId)}`, opts(token)),
  stats: (token: string) => request<PvpStats>(CLOUD_CONFIG.apiUrl, `${base}/stats`, opts(token)),
  headToHead: (token: string, username: string) =>
    request<PvpHeadToHead>(CLOUD_CONFIG.apiUrl, `${base}/head-to-head/${encodeURIComponent(username)}`, opts(token)),
};

export const MODE_LABEL: Record<string, string> = { DUEL: 'Duelo', DOMINION: 'Dominio Arcano' };
export const RESULT_LABEL: Record<PvpResult, string> = { WIN: 'Victoria', LOSS: 'Derrota', DRAW: 'Sin ganador' };
export const REASON_LABEL: Record<string, string> = {
  CHAMPION_DEFEATED: 'Campeón derrotado',
  DOMINION_SCORE: 'Victoria por objetivos',
  SURRENDER: 'Rendición',
  OPPONENT_DISCONNECTED: 'Desconexión',
  BOTH_DISCONNECTED: 'Ambos desconectados',
  MATCH_EXPIRED: 'Partida vencida',
  ABANDONED: 'Abandono',
};
export const DELETED_PLAYER = 'Jugador eliminado';

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const m = Math.floor(seconds / 60),
    s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** One-line friend summary from a head-to-head response. */
export function headToHeadLine(h: PvpHeadToHead): string {
  return `${h.matchesPlayed} ${h.matchesPlayed === 1 ? 'partida' : 'partidas'} · ${h.myWins} ${h.myWins === 1 ? 'victoria' : 'victorias'} · ${h.theirWins} ${h.theirWins === 1 ? 'derrota' : 'derrotas'}`;
}
