import {RANKED_SEASON} from '../../src/game/ranked/ranked';
import {ensureProfileAvatar} from './profileAvatar';
import { knownTitle } from './mastery';
import { pvpMap } from '../../src/game/pvp/maps';
import { equippableCosmetics } from '../../src/game/ranked/rankedCosmetics';
import type { D1Database, Env } from './db';
import { error, json } from './http';
import { pvpRoute } from './pvp';

/**
 * Social phase: friends, blocks, private 1:1 chat, PvP invites between friends, reports and
 * approximate presence.
 *
 * Identity is users(id) from the Bearer token. Other players are named by username only at this
 * boundary (search, "send a request to <username>") and resolved to their id here; no id is
 * accepted from the client and none is returned for other players. Conversations are addressed
 * by a random id, and every access checks the caller is one of its two members.
 *
 * Real-time delivery goes through one SocialHub Durable Object per user (its own sockets),
 * completely separate from the PvP rooms: a failing chat socket never touches a battle, and chat
 * never reaches the battle command stream. Every push is best effort; the REST state is the truth.
 */

export const SOCIAL_LIMITS = {
  messageMaxChars: 500,
  /** Retention: the newest N messages per conversation are kept (older ones pruned on insert). */
  messagesPerConversation: 200,
  pageSize: 50,
  searchMin: 3,
  searchResults: 10,
  inviteTtlMs: 3 * 60_000,
  /** A socket heartbeat older than this means OFFLINE. */
  presenceStaleMs: 120_000,
  bodyMaxBytes: 4096,
};

/** Sliding windows per action: [window ms, max events]. */
export const RATE_LIMITS: Record<string, [number, number][]> = {
  search: [[60_000, 20]],
  request: [[3_600_000, 20]],
  message: [
    [5_000, 5],
    [60_000, 40],
  ],
  invite: [[300_000, 6]],
  report: [[3_600_000, 10]],
  action: [[60_000, 60]],
};

export const REPORT_REASONS = ['SPAM', 'HARASSMENT', 'OFFENSIVE_CONTENT', 'OTHER'] as const;

export interface HubNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export type Presence = 'ONLINE' | 'IN_PVP' | 'OFFLINE';

export interface FriendEntry {
  avatarId?: string;
  username: string;
  heroId: string | null;
  frameId: string | null;
  /** Equipped mastery title id (catalog id; the client resolves the name). */
  titleId: string | null;
  /** Equipped Ranked crest id (Reward Track cosmetic). */
  crestId: string | null;
  presence: Presence;
  unread: number;
  conversationId: string | null;
  lastMessageAt: number | null;
  since: number;
}

interface Caller {
  userId: number;
  username: string;
}

const pair = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);
const newId = () => crypto.randomUUID();

/** Same normalization as the RPG-GO auth Worker: usernames are stored lowercase. */
export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return value.length >= 1 && value.length <= 64 ? value : null;
}

/** Control characters (newline kept), zero-width and bidi-override characters. */
const STRIPPED_CHARS = new RegExp(
  '[' +
    [
      [0x00, 0x09],
      [0x0b, 0x1f],
      [0x7f, 0x7f],
      [0x200b, 0x200f],
      [0x2028, 0x202e],
      [0x2066, 0x2069],
      [0xfeff, 0xfeff],
    ]
      .map(
        ([a, b]) =>
          `${String.fromCharCode(92)}u${a!.toString(16).padStart(4, '0')}-${String.fromCharCode(92)}u${b!.toString(16).padStart(4, '0')}`,
      )
      .join('') +
    ']',
  'g',
);

/** Plain text only: drop control characters (except newlines), collapse blank runs, trim. */
export function cleanMessage(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > SOCIAL_LIMITS.messageMaxChars * 4) return null;
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(STRIPPED_CHARS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text || [...text].length > SOCIAL_LIMITS.messageMaxChars) return null;
  return text;
}

/** Counts the caller's recent events for `action`; records one and returns true when allowed. */
export async function rateLimit(
  db: D1Database,
  userId: number,
  action: string,
  now: number,
  /** Windows for an action defined outside this module (e.g. gifts); ≤ 1 h (rows are pruned after that). */
  custom?: [number, number][],
): Promise<boolean> {
  const windows = custom ?? RATE_LIMITS[action] ?? RATE_LIMITS.action!;
  const longest = Math.max(...windows.map(([ms]) => ms));
  const { results } = await db
    .prepare(
      'SELECT created_at FROM tactics_social_rate_events WHERE user_id = ? AND action = ? AND created_at > ?',
    )
    .bind(userId, action, now - longest)
    .all<{ created_at: number }>();
  for (const [ms, max] of windows)
    if (results.filter((r) => r.created_at > now - ms).length >= max) return false;
  await db.batch([
    db
      .prepare(
        'INSERT INTO tactics_social_rate_events (user_id, action, created_at) VALUES (?, ?, ?)',
      )
      .bind(userId, action, now),
    db
      .prepare('DELETE FROM tactics_social_rate_events WHERE user_id = ? AND created_at < ?')
      .bind(userId, now - 3_600_000),
  ]);
  return true;
}

/** Best-effort push to every open social socket of `userId`. Never throws. */
export async function notify(
  env: Env,
  userId: number,
  event: Record<string, unknown>,
): Promise<void> {
  const hubs = env.SOCIAL_HUBS;
  if (!hubs) return;
  try {
    await hubs
      .get(hubs.idFromName('user:' + userId))
      .fetch(
        new Request('https://hub/push', {
          method: 'POST',
          body: JSON.stringify({ type: 'social', ...event }),
        }),
      );
  } catch {
    /* the client refreshes over REST */
  }
}

async function userByName(db: D1Database, username: string) {
  // Only accounts that play Tactics (have a profile) can be found or befriended.
  return db
    .prepare(
      'SELECT u.id AS id, u.username AS username FROM users u JOIN tactics_profiles p ON p.user_id = u.id WHERE u.username = ?',
    )
    .bind(username)
    .first<{ id: number; username: string }>();
}

async function relationship(db: D1Database, a: number, b: number) {
  const [low, high] = pair(a, b);
  return db
    .prepare(
      'SELECT status, requested_by FROM tactics_social_relationships WHERE user_low = ? AND user_high = ?',
    )
    .bind(low, high)
    .first<{ status: 'PENDING' | 'ACCEPTED'; requested_by: number }>();
}

/** Who blocks whom between a and b. */
async function blocks(db: D1Database, a: number, b: number) {
  const { results } = await db
    .prepare(
      'SELECT blocker_id FROM tactics_social_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    )
    .bind(a, b, b, a)
    .all<{ blocker_id: number }>();
  return {
    byA: results.some((r) => r.blocker_id === a),
    byB: results.some((r) => r.blocker_id === b),
  };
}

/** Friends with no block in either direction: the condition for chat and PvP invites. */
export async function canInteract(db: D1Database, a: number, b: number): Promise<boolean> {
  const rel = await relationship(db, a, b);
  if (rel?.status !== 'ACCEPTED') return false;
  const b2 = await blocks(db, a, b);
  return !b2.byA && !b2.byB;
}

function ensureConversation(db: D1Database, a: number, b: number, now: number) {
  const [low, high] = pair(a, b);
  return db
    .prepare(
      'INSERT INTO tactics_conversations (conversation_id, user_low, user_high, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_low, user_high) DO NOTHING',
    )
    .bind(newId(), low, high, now);
}

/** A match, or a lobby that already has two players: a new invite would overlap it. */
const BUSY_SQL =
  'SELECT 1 FROM tactics_pvp_rooms pv WHERE (pv.player_a = ? OR pv.player_b = ?) AND pv.player_b IS NOT NULL AND pv.finished_at IS NULL AND pv.expires_at > ?';

async function busy(db: D1Database, userId: number, now: number) {
  return !!(await db.prepare(BUSY_SQL).bind(userId, userId, now).first());
}

function presenceOf(
  row: { online: number | null; lastSeen: number | null; inPvp: number },
  now: number,
): Presence {
  if (row.inPvp) return 'IN_PVP';
  if (row.online === 1 && (row.lastSeen ?? 0) > now - SOCIAL_LIMITS.presenceStaleMs)
    return 'ONLINE';
  return 'OFFLINE';
}

const knownFrame = (id: string | null) =>
  id && equippableCosmetics()[id]?.kind === 'PROFILE_FRAME' ? id : null;
/** Ranked Reward Track crest shown beside a friend's name (profile/friend card). */
const knownCrest = (id: string | null | undefined) =>
  id && equippableCosmetics()[id]?.kind === 'RANKED_CREST' ? id : null;

interface RelationRow {
  id: number;
  avatarId?: string;
  username: string;
  heroId: string | null;
  frameId: string | null;
  titleId: string | null;
  crestId: string | null;
  online: number | null;
  lastSeen: number | null;
  conversationId: string | null;
  lastMessageAt: number | null;
  unread: number;
  inPvp: number;
  status: 'PENDING' | 'ACCEPTED';
  requestedBy: number;
  updatedAt: number;
}

async function relationRows(db: D1Database, me: number, now: number, other?: number) {
  const { results } = await db
    .prepare(
      `SELECT u.id AS id, u.username AS username, p.selected_champion_id AS heroId, e.cosmetic_id AS frameId, ti.title_id AS titleId, ec.cosmetic_id AS crestId,
        pr.online AS online, pr.last_seen AS lastSeen, c.conversation_id AS conversationId, c.last_message_at AS lastMessageAt,
        (SELECT COUNT(*) FROM tactics_messages m WHERE m.conversation_id = c.conversation_id AND m.sender_user_id = u.id AND m.read_at IS NULL) AS unread,
        EXISTS (SELECT 1 FROM tactics_pvp_rooms pv WHERE (pv.player_a = u.id OR pv.player_b = u.id)
          AND pv.started_at IS NOT NULL AND pv.finished_at IS NULL AND pv.expires_at > ?) AS inPvp,
        r.status AS status, r.requested_by AS requestedBy, r.updated_at AS updatedAt
      FROM tactics_social_relationships r
      JOIN users u ON u.id = CASE WHEN r.user_low = ? THEN r.user_high ELSE r.user_low END
      LEFT JOIN tactics_profiles p ON p.user_id = u.id
      LEFT JOIN tactics_equipped_cosmetics e ON e.user_id = u.id AND e.slot = 'PROFILE_FRAME'
      LEFT JOIN tactics_equipped_cosmetics ec ON ec.user_id = u.id AND ec.slot = 'RANKED_CREST'
      LEFT JOIN tactics_social_presence pr ON pr.user_id = u.id
      LEFT JOIN tactics_profile_titles ti ON ti.user_id = u.id
      LEFT JOIN tactics_conversations c ON c.user_low = r.user_low AND c.user_high = r.user_high
      WHERE (r.user_low = ? OR r.user_high = ?)${other ? ' AND u.id = ?' : ''}
      ORDER BY u.username`,
    )
    .bind(now, me, me, me, ...(other ? [other] : []))
    .all<RelationRow>();
  await Promise.all(results.map(async row=>{row.avatarId=await ensureProfileAvatar(db,row.id,now);}));
  return results;
}

function friendEntry(row: RelationRow, now: number): FriendEntry {
  return {
    avatarId: row.avatarId,
    username: row.username,
    heroId: row.heroId,
    frameId: knownFrame(row.frameId),
    titleId: knownTitle(row.titleId),
    crestId: knownCrest(row.crestId),
    presence: presenceOf(row, now),
    unread: row.unread,
    conversationId: row.conversationId,
    lastMessageAt: row.lastMessageAt,
    since: row.updatedAt,
  };
}

const publicCard = (row: { avatarId?:string; username: string; heroId: string | null; frameId: string | null; titleId?: string | null }) => ({
  avatarId:row.avatarId,
  username: row.username,
  heroId: row.heroId,
  frameId: knownFrame(row.frameId),
  titleId: knownTitle(row.titleId ?? null),
});

async function expireInvites(db: D1Database, now: number) {
  await db.batch([
    db
      .prepare(
        "UPDATE tactics_pvp_invites SET status = 'EXPIRED', responded_at = expires_at WHERE status = 'PENDING' AND expires_at <= ?",
      )
      .bind(now),
    db
      .prepare("DELETE FROM tactics_pvp_invites WHERE status <> 'PENDING' AND created_at < ?")
      .bind(now - 86_400_000),
  ]);
}

interface InviteRow {
  invite_id: string;
  from_user_id: number;
  to_user_id: number;
  mode: 'DUEL' | 'DOMINION';
  map_id: string;
  status: string;
  room_code: string | null;
  created_at: number;
  expires_at: number;
  from_name: string;
  to_name: string;
}

const INVITE_SELECT =
  'SELECT i.*, fu.username AS from_name, tu.username AS to_name FROM tactics_pvp_invites i JOIN users fu ON fu.id = i.from_user_id JOIN users tu ON tu.id = i.to_user_id';

const inviteView = (row: InviteRow) => ({
  inviteId: row.invite_id,
  from: row.from_name,
  to: row.to_name,
  mode: row.mode,
  mapId: row.map_id,
  status: row.status,
  code: row.room_code,
  expiresAt: row.expires_at,
});

async function overview(db: D1Database, caller: Caller, now: number) {
  await expireInvites(db, now);
  const rows = await relationRows(db, caller.userId, now);
  const friends = rows.filter((r) => r.status === 'ACCEPTED').map((r) => friendEntry(r, now));
  const incoming = rows
    .filter((r) => r.status === 'PENDING' && r.requestedBy !== caller.userId)
    .map((r) => ({ ...publicCard(r), sentAt: r.updatedAt }));
  const outgoing = rows
    .filter((r) => r.status === 'PENDING' && r.requestedBy === caller.userId)
    .map((r) => ({ ...publicCard(r), sentAt: r.updatedAt }));
  const { results: blocked } = await db
    .prepare(
      'SELECT u.username AS username FROM tactics_social_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY u.username',
    )
    .bind(caller.userId)
    .all<{ username: string }>();
  const { results: invites } = await db
    .prepare(
      `${INVITE_SELECT} WHERE i.status = 'PENDING' AND i.expires_at > ? AND (i.from_user_id = ? OR i.to_user_id = ?) ORDER BY i.created_at DESC`,
    )
    .bind(now, caller.userId, caller.userId)
    .all<InviteRow>();
  const incomingInvites = invites.filter((i) => i.to_user_id === caller.userId).map(inviteView);
  return {
    serverTime: now,
    me: { username: caller.username },
    friends,
    incoming,
    outgoing,
    blocked: blocked.map((b) => b.username),
    invites: {
      incoming: incomingInvites,
      outgoing: invites.filter((i) => i.from_user_id === caller.userId).map(inviteView),
    },
    counts: {
      unread: friends.reduce((n, f) => n + f.unread, 0),
      requests: incoming.length,
      invites: incomingInvites.length,
      gifts: (await pendingGifts(db, caller.userId)).gifts,
    },
  };
}

/** Unclaimed store gifts waiting for the user (badge only; 0 before migration 0015 exists). */
async function pendingGifts(db: D1Database, userId: number): Promise<{ gifts: number }> {
  try {
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM tactics_gifts WHERE recipient_user_id = ? AND status = 'PENDING'")
      .bind(userId)
      .first<{ n: number }>();
    return { gifts: row?.n ?? 0 };
  } catch {
    return { gifts: 0 };
  }
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (request.method === 'GET') return {};
  const text = await request.text();
  if (text.length > SOCIAL_LIMITS.bodyMaxBytes) return null;
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const NOT_ALLOWED = () => error(403, 'NOT_ALLOWED', 'No se pudo completar la acción.');
const RATE_LIMITED = () =>
  error(429, 'RATE_LIMITED', 'Demasiadas acciones seguidas. Espera un momento.');

async function conversationFor(db: D1Database, conversationId: string, me: number) {
  if (!/^[0-9a-f-]{36}$/.test(conversationId)) return null;
  return db
    .prepare(
      'SELECT conversation_id, user_low, user_high FROM tactics_conversations WHERE conversation_id = ? AND (user_low = ? OR user_high = ?)',
    )
    .bind(conversationId, me, me)
    .first<{ conversation_id: string; user_low: number; user_high: number }>();
}

/** Opens the ordinary private room for an accepted invite (same validation as the lobby). */
async function openInviteRoom(
  env: Env,
  invite: InviteRow,
  accepter: Caller,
): Promise<{ ok: true; code: string } | { ok: false; status: number; message: string }> {
  const db = env.DB;
  const heroOf = async (userId: number) =>
    (
      await db
        .prepare('SELECT selected_champion_id AS heroId FROM tactics_profiles WHERE user_id = ?')
        .bind(userId)
        .first<{ heroId: string }>()
    )?.heroId ?? 'mage';
  const inviter = { userId: invite.from_user_id, username: invite.from_name };
  const call = async (caller: Caller, path: string, body: Record<string, unknown>) => {
    const res = await pvpRoute(
      new Request('https://internal/api/tactics/pvp/' + path, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      env,
      caller,
    );
    return {
      status: res.status,
      body: (await res.json()) as { code?: string; error?: { message?: string } },
    };
  };
  const created = await call(inviter, 'create', {
    mode: invite.mode,
    mapId: invite.map_id,
    heroId: await heroOf(inviter.userId),
  });
  if (created.status !== 200 || !created.body.code)
    return {
      ok: false,
      status: created.status === 429 ? 409 : created.status,
      message: 'Tu rival no puede abrir una sala ahora.',
    };
  const joined = await call(accepter, 'join', {
    code: created.body.code,
    heroId: await heroOf(accepter.userId),
  });
  if (joined.status !== 200) {
    await call(inviter, 'leave', { code: created.body.code });
    return {
      ok: false,
      status: joined.status,
      message: joined.body.error?.message ?? 'No se pudo entrar a la sala.',
    };
  }
  return { ok: true, code: created.body.code };
}

/**
 * /api/tactics/social/* (caller already authenticated). Returns null for paths it does not own.
 */
export async function socialRoute(
  request: Request,
  env: Env,
  caller: Caller,
  now: number,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.startsWith('/api/tactics/social/')) return null;
  const sub = path.slice('/api/tactics/social/'.length);
  const db = env.DB;
  const me = caller.userId;
  const body = await readBody(request);
  if (!body) return error(400, 'BAD_REQUEST', 'Cuerpo inválido.');
  const route = `${request.method} ${sub}`;

  if(request.method==='GET' && sub.startsWith('profile/')){
    let username:string;try{username=decodeURIComponent(sub.slice(8));}catch{return error(400,'BAD_QUERY','Usuario inválido.');}
    const target=await userByName(db,username);
    if(!target || !(await canInteract(db,me,target.id)))return NOT_ALLOWED();
    const friend=(await relationRows(db,me,now,target.id))[0];
    const presence=await db.prepare('SELECT last_seen FROM tactics_social_presence WHERE user_id = ?').bind(target.id).first<{last_seen:number}>();
    const ranked=await db.prepare('SELECT rp FROM tactics_ranked_players WHERE user_id = ? AND season_id = ?').bind(target.id,RANKED_SEASON.id).first<{rp:number}>();
    const mostUsed=await db.prepare('SELECT champion, COUNT(*) AS matches FROM tactics_pvp_match_players WHERE user_id = ? GROUP BY champion ORDER BY matches DESC, champion LIMIT 1').bind(target.id).first<{champion:string;matches:number}>();
    const mastery=await db.prepare('SELECT hero_id AS champion, xp FROM tactics_champion_mastery WHERE user_id = ? ORDER BY xp DESC, hero_id LIMIT 1').bind(target.id).first<{champion:string;xp:number}>();
    const lastMatch=await db.prepare('SELECT champion, mode, result, finished_at AS playedAt FROM tactics_pvp_match_players WHERE user_id = ? ORDER BY finished_at DESC, match_id DESC LIMIT 1').bind(target.id).first<{champion:string;mode:string;result:string;playedAt:number}>();
    return json({lastSeen:presence?.last_seen??null,inMatch:friend?.inPvp===1,ranked:ranked?{rp:ranked.rp,seasonId:RANKED_SEASON.id}:null,mostUsed,mastery,lastMatch});
  }

  if (route === 'GET overview') return json(await overview(db, caller, now));

  // ── Real-time: a short-lived ticket for this user's own hub socket ─────────────────────
  if (route === 'POST connect') {
    if (!env.SOCIAL_HUBS) return error(503, 'UNAVAILABLE', 'Tiempo real no disponible.');
    const hub = env.SOCIAL_HUBS.get(env.SOCIAL_HUBS.idFromName('user:' + me));
    const res = await hub.fetch(
      new Request('https://hub/ticket', {
        method: 'POST',
        headers: { 'X-Social-User': String(me) },
      }),
    );
    const data = (await res.json()) as { ticket: string };
    return json({ ticket: data.ticket, hub: String(me) });
  }

  if (route === 'GET search') {
    const q = normalizeUsername(url.searchParams.get('q'));
    if (!q || q.length > 32) return error(400, 'BAD_QUERY', 'Escribe un nombre de usuario.');
    if (!(await rateLimit(db, me, 'search', now))) return RATE_LIMITED();
    // Exact match for short queries, prefix match from 3 characters. Never the whole table.
    const like = q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const { results } = await db
      .prepare(
        `SELECT u.id AS id, u.username AS username, p.selected_champion_id AS heroId, e.cosmetic_id AS frameId, ti.title_id AS titleId
         FROM users u JOIN tactics_profiles p ON p.user_id = u.id
         LEFT JOIN tactics_equipped_cosmetics e ON e.user_id = u.id AND e.slot = 'PROFILE_FRAME'
         LEFT JOIN tactics_profile_titles ti ON ti.user_id = u.id
         WHERE u.id <> ? AND ${q.length >= SOCIAL_LIMITS.searchMin ? "u.username LIKE ? ESCAPE '\\'" : 'u.username = ?'}
         ORDER BY (u.username = ?) DESC, length(u.username), u.username LIMIT ?`,
      )
      .bind(me, q.length >= SOCIAL_LIMITS.searchMin ? like : q, q, SOCIAL_LIMITS.searchResults)
      .all<{ id: number; avatarId?:string; username: string; heroId: string | null; frameId: string | null; titleId: string | null }>();
    await Promise.all(results.map(async row=>{row.avatarId=await ensureProfileAvatar(db,row.id,now);}));
    const rels = await relationRows(db, me, now);
    const { results: mine } = await db
      .prepare('SELECT blocked_id FROM tactics_social_blocks WHERE blocker_id = ?')
      .bind(me)
      .all<{ blocked_id: number }>();
    return json({
      results: results.map((r) => {
        const rel = rels.find((x) => x.id === r.id);
        // Only the caller's own view: a block BY the other player is never revealed.
        const relation = mine.some((b) => b.blocked_id === r.id)
          ? 'BLOCKED'
          : rel?.status === 'ACCEPTED'
            ? 'FRIEND'
            : rel
              ? rel.requestedBy === me
                ? 'OUTGOING'
                : 'INCOMING'
              : 'NONE';
        return { ...publicCard(r), relation };
      }),
    });
  }

  // ── Friend requests and relationship changes (target named by username) ───────────────
  const relationActions = [
    'requests',
    'requests/accept',
    'requests/reject',
    'requests/cancel',
    'friends/remove',
    'block',
    'unblock',
  ];
  if (request.method === 'POST' && relationActions.includes(sub)) {
    const username = normalizeUsername(body.username);
    if (!username) return error(400, 'BAD_REQUEST', 'Falta el jugador.');
    if (!(await rateLimit(db, me, sub === 'requests' ? 'request' : 'action', now)))
      return RATE_LIMITED();
    const target = await userByName(db, username);
    if (!target) return error(404, 'PLAYER_NOT_FOUND', 'Jugador no encontrado.');
    if (target.id === me) return error(422, 'SELF', 'No puedes hacer eso contigo mismo.');
    const [low, high] = pair(me, target.id);
    const rel = await relationship(db, me, target.id);
    const done = async () => json(await overview(db, caller, now));
    const cancelInvites = db
      .prepare(
        "UPDATE tactics_pvp_invites SET status = 'CANCELLED', responded_at = ? WHERE status = 'PENDING' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))",
      )
      .bind(now, me, target.id, target.id, me);

    if (sub === 'requests') {
      const b = await blocks(db, me, target.id);
      if (b.byA) return error(409, 'YOU_BLOCKED', 'Desbloquea a este jugador primero.');
      if (b.byB) return error(403, 'NOT_ALLOWED', 'No se pudo enviar la solicitud.');
      if (rel?.status === 'ACCEPTED') return error(409, 'ALREADY_FRIENDS', 'Ya sois amigos.');
      if (rel && rel.requested_by === me)
        return error(409, 'DUPLICATE_REQUEST', 'Ya enviaste una solicitud.');
      if (rel) {
        // Reciprocal: they already asked — this resolves into a friendship.
        await db.batch([
          db
            .prepare(
              "UPDATE tactics_social_relationships SET status = 'ACCEPTED', updated_at = ? WHERE user_low = ? AND user_high = ? AND status = 'PENDING'",
            )
            .bind(now, low, high),
          ensureConversation(db, me, target.id, now),
        ]);
        await notify(env, target.id, { event: 'FRIEND_ACCEPTED', username: caller.username });
        return done();
      }
      try {
        await db
          .prepare(
            "INSERT INTO tactics_social_relationships (user_low, user_high, status, requested_by, created_at, updated_at) VALUES (?, ?, 'PENDING', ?, ?, ?)",
          )
          .bind(low, high, me, now, now)
          .run();
      } catch {
        return error(409, 'DUPLICATE_REQUEST', 'Ya existe una solicitud.');
      }
      await notify(env, target.id, { event: 'FRIEND_REQUEST', username: caller.username });
      return done();
    }
    if (sub === 'requests/accept') {
      if (rel?.status !== 'PENDING' || rel.requested_by === me)
        return error(404, 'NO_REQUEST', 'No hay solicitud pendiente.');
      await db.batch([
        db
          .prepare(
            "UPDATE tactics_social_relationships SET status = 'ACCEPTED', updated_at = ? WHERE user_low = ? AND user_high = ? AND status = 'PENDING'",
          )
          .bind(now, low, high),
        ensureConversation(db, me, target.id, now),
      ]);
      await notify(env, target.id, { event: 'FRIEND_ACCEPTED', username: caller.username });
      return done();
    }
    if (sub === 'requests/reject' || sub === 'requests/cancel') {
      const mine = sub === 'requests/cancel';
      if (rel?.status !== 'PENDING' || (rel.requested_by === me) !== mine)
        return error(404, 'NO_REQUEST', 'No hay solicitud pendiente.');
      await db
        .prepare(
          "DELETE FROM tactics_social_relationships WHERE user_low = ? AND user_high = ? AND status = 'PENDING'",
        )
        .bind(low, high)
        .run();
      await notify(env, target.id, { event: 'FRIENDS_CHANGED' });
      return done();
    }
    if (sub === 'friends/remove') {
      if (rel?.status !== 'ACCEPTED') return error(404, 'NOT_FRIENDS', 'No sois amigos.');
      // History stays (retention policy); sending needs the friendship back.
      await db.batch([
        db
          .prepare('DELETE FROM tactics_social_relationships WHERE user_low = ? AND user_high = ?')
          .bind(low, high),
        cancelInvites,
      ]);
      await notify(env, target.id, { event: 'FRIENDS_CHANGED' });
      return done();
    }
    if (sub === 'block') {
      await db.batch([
        db
          .prepare(
            'INSERT INTO tactics_social_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
          )
          .bind(me, target.id, now),
        db
          .prepare('DELETE FROM tactics_social_relationships WHERE user_low = ? AND user_high = ?')
          .bind(low, high),
        cancelInvites,
      ]);
      // The blocked player only sees the friendship/request disappear (no reason given).
      await notify(env, target.id, { event: 'FRIENDS_CHANGED' });
      return done();
    }
    // unblock: does not restore a friendship.
    await db
      .prepare('DELETE FROM tactics_social_blocks WHERE blocker_id = ? AND blocked_id = ?')
      .bind(me, target.id)
      .run();
    return done();
  }

  // ── Conversations (one per pair; addressed by random id; membership checked) ───────────
  const conv = sub.match(/^conversations\/([^/]+)\/(messages|read)$/);
  if (conv) {
    const [, conversationId] = conv as unknown as [string, string];
    const c = await conversationFor(db, conversationId, me);
    if (!c) return error(404, 'NOT_FOUND', 'Conversación no encontrada.');
    const other = c.user_low === me ? c.user_high : c.user_low;
    if (route === `GET conversations/${conversationId}/messages`) {
      const before = Number(url.searchParams.get('before') ?? 0);
      const { results } = await db
        .prepare(
          `SELECT id, sender_user_id, body, created_at, read_at FROM tactics_messages WHERE conversation_id = ?${Number.isSafeInteger(before) && before > 0 ? ' AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
        )
        .bind(
          conversationId,
          ...(Number.isSafeInteger(before) && before > 0 ? [before] : []),
          SOCIAL_LIMITS.pageSize,
        )
        .all<{
          id: number;
          sender_user_id: number;
          body: string;
          created_at: number;
          read_at: number | null;
        }>();
      const friend = (await relationRows(db, me, now, other))[0];
      const otherUser = await db
        .prepare('SELECT username FROM users WHERE id = ?')
        .bind(other)
        .first<{ username: string }>();
      return json({
        conversationId,
        with: otherUser?.username ?? null,
        friend: friend?.status === 'ACCEPTED' ? friendEntry(friend, now) : null,
        canSend: await canInteract(db, me, other),
        messages: results
          .reverse()
          .map((m) => ({
            id: m.id,
            mine: m.sender_user_id === me,
            body: m.body,
            createdAt: m.created_at,
            readAt: m.read_at,
          })),
      });
    }
    if (route === `POST conversations/${conversationId}/read`) {
      await db
        .prepare(
          'UPDATE tactics_messages SET read_at = ? WHERE conversation_id = ? AND sender_user_id <> ? AND read_at IS NULL',
        )
        .bind(now, conversationId, me)
        .run();
      await notify(env, me, { event: 'UNREAD_CHANGED', conversationId });
      return json({ ok: true });
    }
    if (route === `POST conversations/${conversationId}/messages`) {
      const text = cleanMessage(body.body);
      if (!text)
        return error(
          422,
          'INVALID_MESSAGE',
          `El mensaje debe tener entre 1 y ${SOCIAL_LIMITS.messageMaxChars} caracteres.`,
        );
      // Authorization before rate accounting: a non-friend learns nothing more than "not allowed".
      if (!(await canInteract(db, me, other)))
        return error(403, 'CHAT_DISABLED', 'No puedes enviar mensajes a este jugador.');
      if (!(await rateLimit(db, me, 'message', now))) return RATE_LIMITED();
      const row = await db
        .prepare(
          'INSERT INTO tactics_messages (conversation_id, sender_user_id, body, created_at) VALUES (?, ?, ?, ?) RETURNING id',
        )
        .bind(conversationId, me, text, now)
        .first<{ id: number }>();
      const keep = SOCIAL_LIMITS.messagesPerConversation;
      await db.batch([
        db
          .prepare('UPDATE tactics_conversations SET last_message_at = ? WHERE conversation_id = ?')
          .bind(now, conversationId),
        db
          .prepare(
            `DELETE FROM tactics_messages WHERE conversation_id = ? AND id < (SELECT id FROM tactics_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1 OFFSET ${keep - 1})`,
          )
          .bind(conversationId, conversationId),
      ]);
      const message = { id: row!.id, body: text, createdAt: now, readAt: null };
      await Promise.all([
        notify(env, other, {
          event: 'MESSAGE',
          conversationId,
          from: caller.username,
          message: { ...message, mine: false },
        }),
        notify(env, me, {
          event: 'MESSAGE',
          conversationId,
          from: caller.username,
          message: { ...message, mine: true },
        }),
      ]);
      return json({ message: { ...message, mine: true } });
    }
    return error(405, 'BAD_METHOD', 'Método no permitido.');
  }

  // ── In-match chat: the same friend conversation, only when the rival is a friend ───────
  if (route === 'GET match') {
    const code = (url.searchParams.get('code') ?? '').toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(code)) return error(400, 'BAD_REQUEST', 'Código inválido.');
    const room = await db
      .prepare('SELECT player_a, player_b FROM tactics_pvp_rooms WHERE code = ?')
      .bind(code)
      .first<{ player_a: number; player_b: number | null }>();
    if (!room || (room.player_a !== me && room.player_b !== me))
      return error(404, 'NOT_FOUND', 'Sala no encontrada.');
    const other = room.player_a === me ? room.player_b : room.player_a;
    if (!other || !(await canInteract(db, me, other))) return json({ friend: null });
    const row = (await relationRows(db, me, now, other))[0];
    return json({ friend: row ? friendEntry(row, now) : null });
  }

  // ── PvP invites ───────────────────────────────────────────────────────────────────────
  if (route === 'POST invites') {
    const username = normalizeUsername(body.username);
    const mode =
      body.mode === 'DOMINION'
        ? 'DOMINION'
        : body.mode === 'DUEL' || body.mode === undefined
          ? 'DUEL'
          : null;
    if (!username || !mode) return error(400, 'BAD_REQUEST', 'Invitación inválida.');
    let mapId: string;
    try {
      mapId = pvpMap(body.mapId ?? 'classic', mode).id;
    } catch {
      return error(400, 'BAD_MAP', 'Mapa incompatible.');
    }
    const target = await userByName(db, username);
    if (!target || target.id === me) return NOT_ALLOWED();
    if (!(await canInteract(db, me, target.id))) return NOT_ALLOWED();
    if (!(await db.prepare('SELECT 1 FROM tactics_profiles WHERE user_id = ?').bind(me).first()))
      return error(404, 'NO_PROFILE', 'Crea tu perfil primero.');
    await expireInvites(db, now);
    const pending = await db
      .prepare(
        "SELECT from_user_id FROM tactics_pvp_invites WHERE status = 'PENDING' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))",
      )
      .bind(me, target.id, target.id, me)
      .first<{ from_user_id: number }>();
    if (pending?.from_user_id === me)
      return error(409, 'DUPLICATE_INVITE', 'Ya enviaste un desafío a este amigo.');
    if (pending)
      return error(409, 'INVITE_FROM_TARGET', 'Este amigo ya te desafió. Acepta su invitación.');
    if (await busy(db, me, now))
      return error(409, 'YOU_ARE_BUSY', 'Termina tu partida actual primero.');
    if (await busy(db, target.id, now))
      return error(409, 'TARGET_BUSY', 'Tu amigo está en otra partida.');
    if (!(await rateLimit(db, me, 'invite', now))) return RATE_LIMITED();
    const inviteId = newId();
    try {
      await db
        .prepare(
          "INSERT INTO tactics_pvp_invites (invite_id, from_user_id, to_user_id, mode, map_id, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)",
        )
        .bind(inviteId, me, target.id, mode, mapId, now, now + SOCIAL_LIMITS.inviteTtlMs)
        .run();
    } catch {
      return error(409, 'DUPLICATE_INVITE', 'Ya enviaste un desafío a este amigo.');
    }
    const invite = (await db
      .prepare(`${INVITE_SELECT} WHERE i.invite_id = ?`)
      .bind(inviteId)
      .first<InviteRow>())!;
    await notify(env, target.id, { event: 'INVITE', invite: inviteView(invite) });
    return json({ invite: inviteView(invite) });
  }
  const inv = sub.match(/^invites\/([0-9a-f-]{36})\/(accept|reject|cancel)$/);
  if (inv && request.method === 'POST') {
    const [, inviteId, action] = inv as unknown as [string, string, 'accept' | 'reject' | 'cancel'];
    const invite = await db
      .prepare(`${INVITE_SELECT} WHERE i.invite_id = ?`)
      .bind(inviteId)
      .first<InviteRow>();
    // The invite must be addressed to (accept/reject) or sent by (cancel) the caller.
    if (!invite || (action === 'cancel' ? invite.from_user_id !== me : invite.to_user_id !== me))
      return error(404, 'NOT_FOUND', 'Invitación no encontrada.');
    const other = action === 'cancel' ? invite.to_user_id : invite.from_user_id;
    if (invite.status === 'ACCEPTED' && action === 'accept')
      return json({ invite: inviteView(invite), code: invite.room_code });
    if (invite.status === 'EXPIRED' || (invite.status === 'PENDING' && invite.expires_at <= now)) {
      await expireInvites(db, now);
      return error(410, 'INVITE_EXPIRED', 'La invitación venció.');
    }
    if (invite.status !== 'PENDING')
      return error(409, 'INVITE_CLOSED', 'La invitación ya no está activa.');
    if (action !== 'accept') {
      const status = action === 'reject' ? 'REJECTED' : 'CANCELLED';
      await db
        .prepare(
          "UPDATE tactics_pvp_invites SET status = ?, responded_at = ? WHERE invite_id = ? AND status = 'PENDING'",
        )
        .bind(status, now, inviteId)
        .run();
      await notify(env, other, {
        event: 'INVITE_UPDATE',
        invite: { ...inviteView(invite), status },
      });
      return json({ invite: { ...inviteView(invite), status } });
    }
    if (!(await canInteract(db, me, other))) return NOT_ALLOWED();
    if (await busy(db, me, now))
      return error(409, 'YOU_ARE_BUSY', 'Termina tu partida actual primero.');
    if (await busy(db, other, now))
      return error(409, 'TARGET_BUSY', 'Tu amigo está en otra partida.');
    // Claim first (only one accept can win), then open the room through the normal PvP flow.
    const claimed = await db
      .prepare(
        "UPDATE tactics_pvp_invites SET status = 'ACCEPTED', responded_at = ? WHERE invite_id = ? AND status = 'PENDING' AND expires_at > ? RETURNING invite_id",
      )
      .bind(now, inviteId, now)
      .first();
    if (!claimed) return error(409, 'INVITE_CLOSED', 'La invitación ya no está activa.');
    const room = await openInviteRoom(env, invite, caller);
    if (!room.ok) {
      await db
        .prepare("UPDATE tactics_pvp_invites SET status = 'CANCELLED' WHERE invite_id = ?")
        .bind(inviteId)
        .run();
      await notify(env, other, {
        event: 'INVITE_UPDATE',
        invite: { ...inviteView(invite), status: 'CANCELLED' },
      });
      return error(room.status >= 400 ? room.status : 409, 'ROOM_FAILED', room.message);
    }
    await db
      .prepare('UPDATE tactics_pvp_invites SET room_code = ? WHERE invite_id = ?')
      .bind(room.code, inviteId)
      .run();
    const view = { ...inviteView(invite), status: 'ACCEPTED', code: room.code };
    await notify(env, other, { event: 'INVITE_UPDATE', invite: view });
    return json({ invite: view, code: room.code });
  }

  // ── Reports (moderation MVP: stored, nothing automatic) ────────────────────────────────
  if (route === 'POST report') {
    const username = normalizeUsername(body.username);
    const reason = REPORT_REASONS.find((r) => r === body.reason);
    if (!username || !reason) return error(400, 'BAD_REQUEST', 'Reporte inválido.');
    const target = await userByName(db, username);
    if (!target || target.id === me)
      return error(404, 'PLAYER_NOT_FOUND', 'Jugador no encontrado.');
    let messageId: number | null = null;
    let snapshot: string | null = null;
    if (body.messageId !== undefined && body.messageId !== null) {
      const id = Number(body.messageId);
      // Only a message the target sent in one of the caller's own conversations.
      const m = Number.isSafeInteger(id)
        ? await db
            .prepare(
              'SELECT m.id AS id, m.body AS body FROM tactics_messages m JOIN tactics_conversations c ON c.conversation_id = m.conversation_id WHERE m.id = ? AND m.sender_user_id = ? AND (c.user_low = ? OR c.user_high = ?)',
            )
            .bind(id, target.id, me, me)
            .first<{ id: number; body: string }>()
        : null;
      if (!m) return error(404, 'NOT_FOUND', 'Mensaje no encontrado.');
      messageId = m.id;
      snapshot = m.body;
    }
    if (!(await rateLimit(db, me, 'report', now))) return RATE_LIMITED();
    await db
      .prepare(
        'INSERT INTO tactics_social_reports (report_id, reporter_id, target_user_id, message_id, message_body, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(newId(), me, target.id, messageId, snapshot, reason, now)
      .run();
    return json({ ok: true });
  }

  return error(404, 'NOT_FOUND', 'Not found');
}

// ── SocialHub Durable Object: one per user, only that user's sockets ─────────────────────

interface HubStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}
interface HubSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): { userId: number } | null;
}
interface HubContext {
  storage: HubStorage;
  acceptWebSocket(ws: HubSocket, tags?: string[]): void;
  getWebSockets(tag?: string): HubSocket[];
}

/**
 * Holds the open social sockets of ONE user (hibernatable). The Worker pushes events here after
 * a D1 write; the hub fans them out. It also keeps that user's approximate presence row. It has
 * no public route other than the ticketed socket, and never talks to a PvP room.
 */
export class SocialHub {
  constructor(
    private ctx: HubContext,
    private env: Env,
  ) {}

  private async presence(userId: number, online: boolean) {
    const now = Date.now();
    await this.ctx.storage.put('presenceAt', now);
    try {
      await this.env.DB.prepare(
        'INSERT INTO tactics_social_presence (user_id, online, last_seen) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET online = excluded.online, last_seen = excluded.last_seen',
      )
        .bind(userId, online ? 1 : 0, now)
        .run();
    } catch {
      /* presence is approximate */
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ticket') {
      const userId = Number(request.headers.get('X-Social-User'));
      if (!Number.isSafeInteger(userId) || userId <= 0) return json({}, 401);
      const ticket = crypto.randomUUID();
      const now = Date.now();
      const tickets = Object.fromEntries(
        Object.entries(
          (await this.ctx.storage.get<Record<string, number>>('tickets')) ?? {},
        ).filter(([, exp]) => exp > now),
      );
      tickets[ticket] = now + 30_000;
      await this.ctx.storage.put('tickets', tickets);
      await this.ctx.storage.put('userId', userId);
      return json({ ticket });
    }
    if (url.pathname === '/push') {
      const text = await request.text();
      for (const ws of this.ctx.getWebSockets())
        try {
          ws.send(text);
        } catch {
          /* closed socket */
        }
      return json({ ok: true });
    }
    if (url.pathname === '/socket') {
      const ticket = url.searchParams.get('ticket') ?? '';
      const tickets = (await this.ctx.storage.get<Record<string, number>>('tickets')) ?? {};
      const userId = await this.ctx.storage.get<number>('userId');
      if (
        !userId ||
        !tickets[ticket] ||
        tickets[ticket]! < Date.now() ||
        request.headers.get('Upgrade') !== 'websocket'
      )
        return json({}, 401);
      delete tickets[ticket];
      await this.ctx.storage.put('tickets', tickets);
      if (this.ctx.getWebSockets().length >= 8)
        for (const old of this.ctx.getWebSockets().slice(0, 1)) old.close(1000, 'Too many tabs');
      const pairCtor = (
        globalThis as unknown as { WebSocketPair: new () => { 0: HubSocket; 1: HubSocket } }
      ).WebSocketPair;
      const sockets = new pairCtor();
      this.ctx.acceptWebSocket(sockets[1]);
      sockets[1].serializeAttachment({ userId });
      await this.presence(userId, true);
      return new Response(null, { status: 101, webSocket: sockets[0] } as ResponseInit);
    }
    return json({}, 404);
  }

  async webSocketMessage(ws: HubSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > 256) return;
    if (message === 'ping' || message.includes('"ping"')) {
      try {
        ws.send(JSON.stringify({ type: 'pong' }));
      } catch {
        /* closed */
      }
      // Heartbeat → presence, throttled to one D1 write a minute.
      const userId = ws.deserializeAttachment()?.userId;
      const last = (await this.ctx.storage.get<number>('presenceAt')) ?? 0;
      if (userId && Date.now() - last > 60_000) await this.presence(userId, true);
    }
  }

  async webSocketClose(ws: HubSocket): Promise<void> {
    const userId = ws.deserializeAttachment()?.userId;
    if (userId && !this.ctx.getWebSockets().some((s) => s !== ws))
      await this.presence(userId, false);
  }

  async webSocketError(ws: HubSocket): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      /* already closed */
    }
    await this.webSocketClose(ws);
  }
}
