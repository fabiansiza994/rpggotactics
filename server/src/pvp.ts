import { withArcher } from '../../src/game/data/archer';
import { pvpMap } from '../../src/game/pvp/maps';
import type { PvpMode } from '../../src/game/pvp/dominion';
import { activeDeck, DECK_ID_PATTERN, DECK_RULES, deckStatus, DEFAULT_CONTENT, fallbackDiscardUid, heroProfile, isChampionUnlocked, ownedFor, type GameState, type GameEvent, type Command } from '../../src/game';
import {
  applyDuel,
  createDuel,
  duelEvents,
  duelView,
  validateLoadout,
  type Loadout,
} from '../../src/game/pvp/duel';
import { loadPlayer } from './repo';
import { equippedPublic } from './store';
import { matchPlayerStatements } from './pvpHistory';
import { championAllowed } from './warriorRelease';
import { rankedOutcomes, rankedResultStatements, type RankedSeatOutcome } from './rankedResults';
import { rankedTrackResultStatements } from './rankedTrack';
import { premiumConfigured, premiumResultStatements } from './rankedPremium';
import { RANKED_RULES } from '../../src/game/ranked/ranked';
import { equippedTitle, masteryAllowed, pvpMastery } from './mastery';
import type { Env } from './db';

interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  transaction?<T>(callback: (storage: Storage) => Promise<T>): Promise<T>;
}
interface RoomContext {
  storage: Storage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
  acceptWebSocket(ws: Socket, tags?: string[]): void;
  getWebSockets(tag?: string): Socket[];
}
interface Socket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): { seat: number };
}
export interface RoomNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}
interface Member {
  id: number;
  name: string;
  loadout: Loadout;
  ready: boolean;
  offlineAt: number | null;
  /** Equipped profile frame (public cosmetic, resolved from D1 by the outer Worker). */
  frameId?: string | null;
  /** Equipped mastery title id (public, resolved from D1 by the outer Worker). */
  titleId?: string | null;
  /** Equipped Ranked crest / victory badge (public cosmetics, resolved from D1 by the outer Worker). */
  crestId?: string | null;
  badgeId?: string | null;
}
export interface Room {
  mode?: PvpMode;
  mapId?: string;
  matchId: string;
  firstPlayer: number;
  code: string;
  createdAt: number;
  /** When both players were ready and the game began (history duration). Absent on older rooms. */
  startedAt?: number | null;
  expiresAt: number;
  version: number;
  members: Member[];
  game: GameState | null;
  deadline: number | null;
  result: { winner: number; loser: number; reason: string; finishedAt: number } | null;
  commandCount: number;
  ticket: Record<string, { seat: number; expires: number }>;
  rematch: number[];
  /** Ranked Preseason room (created only by the queue): RP per seat at match start + applied result. */
  ranked?: { rp: [number, number]; outcome: (RankedSeatOutcome | null)[] | null };
}
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
export const randomCode = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32],
  ).join('');
const secret = () => crypto.randomUUID();

/** Outer Worker resolves identity and server-owned loadout. This DO has no public route. */
export async function pvpRoute(
  request: Request,
  env: Env,
  caller: { userId: number; username: string },
): Promise<Response> {
  if (!env.PVP_ROOMS) return response({ error: { message: 'PvP no disponible.' } }, 503);
  const path = new URL(request.url).pathname,
    db = env.DB;
  if (path.endsWith('/active')) {
    const row = await db
      .prepare(
        'SELECT code FROM tactics_pvp_rooms WHERE (player_a=? OR player_b=?) AND expires_at>? AND finished_at IS NULL ORDER BY created_at DESC LIMIT 1',
      )
      .bind(caller.userId, caller.userId, Date.now())
      .first();
    return response({ code: row?.code ?? null });
  }
  let body: Record<string, unknown> = {};
  if (request.method !== 'GET') {
    const raw = await request.text();
    if (raw.length > 8192)
      return response({ error: { message: 'Solicitud demasiado grande.' } }, 413);
    try {
      body = JSON.parse(raw);
    } catch {
      return response({ error: { message: 'Solicitud inválida.' } }, 400);
    }
  }
  let code = String(body.code ?? new URL(request.url).searchParams.get('code') ?? '')
    .trim()
    .toUpperCase();
  const create = path.endsWith('/create');
  if (create && body.mode !== undefined && body.mode !== 'DUEL' && body.mode !== 'DOMINION')
    return response({ error: { message: 'Modo inválido.' } }, 400);
  if (create) {
    try {
      pvpMap(body.mapId ?? 'classic', body.mode === 'DOMINION' ? 'DOMINION' : 'DUEL');
    } catch {
      return response({ error: { message: 'Mapa incompatible.' } }, 400);
    }
    const active = await db
      .prepare(
        'SELECT count(*) AS n FROM tactics_pvp_rooms WHERE player_a=? AND expires_at>? AND finished_at IS NULL',
      )
      .bind(caller.userId, Date.now())
      .first<{ n: number }>();
    if ((active?.n ?? 0) >= 3)
      return response({ error: { message: 'Cierra tus salas pendientes primero.' } }, 429);
    code = randomCode();
  }
  if (!/^[A-Z2-9]{8}$/.test(code)) return response({ error: { message: 'Código inválido.' } }, 400);
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Pvp-User': String(caller.userId),
    'X-Pvp-Name': encodeURIComponent(caller.username),
  });
  if (
    create ||
    path.endsWith('/join') ||
    path.endsWith('/loadout') ||
    path.endsWith('/ready') ||
    path.endsWith('/rematch')
  ) {
    const own = await serverLoadout(env, caller, body.heroId, body.deckId);
    if (own instanceof Response) return own;
    // Server-owned: whatever the client sent is overwritten (cards come from the stored deck).
    body.loadout = own.loadout;
    body.frameId = own.frameId;
    body.titleId = own.titleId;
    body.crestId = own.crestId;
    body.badgeId = own.badgeId;
  }
  const room = env.PVP_ROOMS.get(env.PVP_ROOMS.idFromName(code));
  return room.fetch(
    new Request('https://room/' + path.split('/').pop(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, code }),
    }),
  );
}

/**
 * The caller's legal PvP loadout + public frame, from the stored profile only (casual and ranked).
 * `deckId` names one of the caller's decks for that champion (default deck when omitted); the
 * cards are a snapshot of that deck right now, so later edits never reach a resolved loadout.
 */
export async function serverLoadout(
  env: Env,
  caller: { userId: number; username: string },
  heroId: unknown,
  deckId?: unknown,
): Promise<{ loadout: Loadout; frameId: string | null; titleId: string | null; crestId: string | null; badgeId: string | null } | Response> {
  const db = env.DB;
  const record = await loadPlayer(db, caller.userId, PVP_CONTENT);
  if (!record) return response({ error: { message: 'Crea tu perfil primero.' } }, 404);
  if (heroId === 'shapeshifter') return response({ error: { message: 'Cambiaformas: PvP pendiente de validación.' } }, 403);
  if (!championAllowed(heroId, env, caller.username))
    return response({ error: { message: 'Este campeón todavía no está disponible.' } }, 403);
  if (typeof heroId !== 'string' || !isChampionUnlocked(record.profile, heroId))
    return response({ error: { message: 'Todavía no has desbloqueado este campeón.' } }, 403);
  if (deckId !== undefined && deckId !== null && (typeof deckId !== 'string' || !DECK_ID_PATTERN.test(deckId)))
    return response({ error: { code: 'UNKNOWN_DECK', message: 'Ese mazo no existe.' } }, 404);
  let loadout: Loadout;
  try {
    loadout = validateLoadout(record.profile, heroId, PVP_CONTENT, deckId);
  } catch (e) {
    // Another account's or another champion's deck is not in this champion's list.
    if (e instanceof Error && e.message === 'UNKNOWN_DECK')
      return response({ error: { code: 'UNKNOWN_DECK', message: 'Ese mazo no existe.' } }, 404);
    // PvP takes no legacy transition: exactly 30 legal cards, checked against the stored profile.
    const hero = heroProfile(record.profile, heroId, PVP_CONTENT);
    const deck = ((typeof deckId === 'string' && hero.decks.find((d) => d.id === deckId)) || activeDeck(hero)).cards;
    const status = deckStatus(deck, heroId, ownedFor(record.profile, heroId, PVP_CONTENT), PVP_CONTENT, DECK_RULES);
    const message =
      status.totalCards !== status.requiredCards
        ? `Tu mazo tiene ${status.totalCards}/${status.requiredCards} cartas. Complétalo en el Constructor de mazos para jugar PvP.`
        : 'Campeón o mazo inválido.';
    return response({ error: { code: 'INVALID_DECK', message, totalCards: status.totalCards, requiredCards: status.requiredCards } }, 422);
  }
  return {
    loadout,
    ...(await equippedPublic(db, caller.userId)),
    titleId: masteryAllowed(env, caller.username) ? await equippedTitle(db, caller.userId) : null,
  };
}

/** A ranked room's two seats, resolved by the queue (outer Worker) from D1. */
export interface RankedSeat {
  id: number;
  name: string;
  loadout: Loadout;
  frameId: string | null;
  titleId: string | null;
  crestId: string | null;
  badgeId: string | null;
  rp: number;
}

export class PvPMatchRoom {
  private room: Room | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private ctx: RoomContext,
    private env: Env,
  ) {
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<Room>('room')) ?? null;
    });
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn).catch(async (error) => {
      this.room = (await this.ctx.storage.get<Room>('room')) ?? this.room;
      throw error;
    });
    this.queue = p.catch(() => {});
    return p;
  }
  private async save(extra: Record<string, unknown> = {}) {
    const persist = async (storage: Storage) => {
      await Promise.all(
        Object.entries({ room: this.room, ...extra }).map(([key, value]) =>
          storage.put(key, value),
        ),
      );
    };
    if (this.ctx.storage.transaction) await this.ctx.storage.transaction(persist);
    else await persist(this.ctx.storage);
    const r = this.room!;
    const times = [
      r.expiresAt,
      r.deadline,
      ...(r.game
        ? r.members.every((m) => m.offlineAt !== null)
          ? [Math.max(...r.members.map((m) => m.offlineAt! + 60000))]
          : r.members.map((m) => (m.offlineAt === null ? null : m.offlineAt + 60000))
        : []),
    ].filter((x): x is number => x !== null);
    if (!r.result) await this.ctx.storage.setAlarm(Math.min(...times));
  }
  private view(seat: number, events: GameEvent[] = []) {
    const r = this.room!;
    return {
      mode: r.mode ?? 'DUEL',
      mapId: r.mapId ?? 'classic',
      code: r.code,
      // Stable per match for both seats (cosmetic dialogue variant + "intro already shown").
      matchId: r.matchId,
      version: r.version,
      expiresAt: r.expiresAt,
      deadline: r.deadline,
      seat,
      members: r.members.map((m, memberSeat) => ({
        name: m.name,
        heroId: m.loadout.heroId,
        ...(memberSeat === seat ? { deckId: m.loadout.deckId } : {}),
        frameId: m.frameId ?? null,
        titleId: m.titleId ?? null,
        crestId: m.crestId ?? null,
        badgeId: m.badgeId ?? null,
        ready: m.ready,
        connected: m.offlineAt === null,
      })),
      result: r.result
        ? { winner: r.members.findIndex((m) => m.id === r.result!.winner), reason: r.result.reason }
        : null,
      // Public per seat: RP at match start (rank is derived client-side) + the applied delta.
      ranked: r.ranked
        ? {
            rp: r.ranked.rp,
            outcome: r.ranked.outcome ? (r.ranked.outcome[seat] ?? null) : null,
          }
        : null,
      game: r.game ? duelView(r.game, seat as 0 | 1, PVP_CONTENT) : null,
      events: r.game ? duelEvents(r.game, seat as 0 | 1, events) : [],
    };
  }
  private broadcast(events: GameEvent[] = []) {
    for (const ws of this.ctx.getWebSockets()) {
      const seat = ws.deserializeAttachment().seat;
      try {
        ws.send(JSON.stringify({ type: 'snapshot', ...this.view(seat, events) }));
      } catch {
        /* close event schedules reconnect */
      }
    }
  }
  private async finish(winner: number, reason: string, extra: Record<string, unknown> = {}) {
    const r = this.room!;
    if (r.result) return;
    r.result = {
      winner: winner < 0 ? 0 : r.members[winner]!.id,
      loser: winner < 0 ? 0 : r.members[1 - winner]!.id,
      reason,
      finishedAt: Date.now(),
    };
    r.deadline = null;
    r.version++;
    await this.save(extra);
    await this.ctx.storage.setAlarm(Date.now() + 5000);
    await this.recordResult();
    await this.ctx.storage.deleteAlarm();
  }
  private async recordResult() {
    const r = this.room!,
      result = r.result;
    if (!result) return;
    const db = this.env.DB,
      [a, b] = r.members as [Member, Member];
    // One transaction, every insert idempotent on match_id: a repeated finish (alarm retry,
    // rematch, reconnect, DO restart) never duplicates the match or its history rows.
    await db.batch([
      db.prepare('UPDATE tactics_pvp_rooms SET finished_at=? WHERE code=?').bind(result.finishedAt, r.code),
      db
        .prepare(
          'INSERT INTO tactics_pvp_matches (match_id,player_a,player_b,champion_a,champion_b,winner,loser,reason,created_at,finished_at,command_count,first_player,mode,score_a,score_b,rounds,map_id,started_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(match_id) DO NOTHING',
        )
        .bind(
          r.matchId,
          a.id,
          b.id,
          a.loadout.heroId,
          b.loadout.heroId,
          result.winner,
          result.loser,
          result.reason,
          r.createdAt,
          result.finishedAt,
          r.commandCount,
          r.firstPlayer,
          r.mode ?? 'DUEL',
          r.game?.dominion?.scores[0] ?? null,
          r.game?.dominion?.scores[1] ?? null,
          r.game?.round ?? 0,
          r.mapId ?? 'classic',
          r.startedAt ?? null,
        ),
      ...matchPlayerStatements(db, {
        matchId: r.matchId,
        mode: r.mode ?? 'DUEL',
        players: [
          { id: a.id, champion: a.loadout.heroId },
          { id: b.id, champion: b.loadout.heroId },
        ],
        winner: result.winner,
        loser: result.loser,
        reason: result.reason,
        rounds: r.game?.round ?? 0,
        startedAt: r.startedAt ?? null,
        finishedAt: result.finishedAt,
      }),
      // Champion Mastery XP for the champion each player used (separate from RP, same batch).
      ...(r.members.every((m) => masteryAllowed(this.env, m.name))
        ? pvpMastery(db, {
            matchId: r.matchId,
            ranked: !!r.ranked,
            players: [
              { id: a.id, heroId: a.loadout.heroId },
              { id: b.id, heroId: b.loadout.heroId },
            ],
            winner: result.winner,
            reason: result.reason,
            rounds: r.game?.round ?? 0,
            finishedAt: result.finishedAt,
          })
        : []),
      ...(r.ranked
        ? rankedResultStatements(db, {
            matchId: r.matchId,
            players: [a.id, b.id],
            winner: result.winner,
            reason: result.reason,
            finishedAt: result.finishedAt,
          })
        : []),
      // Reward Track: every reward the new peak reaches, once (0025; after the RP rows above).
      ...(r.ranked ? rankedTrackResultStatements(db, [a.id, b.id], r.matchId, result.finishedAt) : []),
      // Premium Track: same peak, pass holders only (0027; skipped while the pass is unconfigured).
      ...(r.ranked && premiumConfigured(this.env) ? premiumResultStatements(db, [a.id, b.id], r.matchId, result.finishedAt) : []),
    ]);
    if (r.ranked && !r.ranked.outcome) {
      r.ranked.outcome = await rankedOutcomes(db, r.matchId, [a.id, b.id]);
      await this.ctx.storage.put('room', this.room);
    }
  }
  fetch(request: Request): Promise<Response> {
    return this.serial(async () => {
      const path = new URL(request.url).pathname;
      if (path === '/socket') return this.socket(request);
      const id = Number(request.headers.get('X-Pvp-User'));
      if (!Number.isSafeInteger(id) || id <= 0)
        return response({ error: { message: 'No autorizado.' } }, 401);
      const body = (await request.json()) as Record<string, unknown>,
        now = Date.now();
      if (path === '/create' && !this.room) {
        this.room = {
          mode: body.mode === 'DOMINION' ? 'DOMINION' : 'DUEL',
          mapId: pvpMap(body.mapId ?? 'classic', body.mode === 'DOMINION' ? 'DOMINION' : 'DUEL').id,
          matchId: crypto.randomUUID(),
          firstPlayer: 0,
          code: String(body.code),
          createdAt: now,
          expiresAt: now + 30 * 60000,
          version: 1,
          members: [
            {
              id,
              name: decodeURIComponent(request.headers.get('X-Pvp-Name')!),
              loadout: body.loadout as Loadout,
              ready: false,
              offlineAt: now,
              frameId: (body.frameId as string | null) ?? null,
              titleId: (body.titleId as string | null) ?? null,
              crestId: (body.crestId as string | null) ?? null,
              badgeId: (body.badgeId as string | null) ?? null,
            },
          ],
          game: null,
          deadline: null,
          result: null,
          commandCount: 0,
          ticket: {},
          rematch: [],
        };
        await this.env.DB.prepare(
          'INSERT INTO tactics_pvp_rooms (code,player_a,created_at,expires_at) VALUES (?,?,?,?)',
        )
          .bind(this.room.code, id, now, this.room.expiresAt)
          .run();
        await this.save();
      }
      if (path === '/ranked-create') {
        // Internal only (the public route whitelist never forwards it): the queue already paired
        // both accounts and resolved their loadouts; nobody else can ever join this room.
        if (this.room) return response({ error: { message: 'Sala ocupada.' } }, 409);
        const seats = body.seats as [RankedSeat, RankedSeat];
        const mapId = pvpMap(body.mapId ?? 'classic', 'DUEL').id;
        this.room = {
          mode: 'DUEL',
          mapId,
          matchId: crypto.randomUUID(),
          firstPlayer: 0,
          code: String(body.code),
          createdAt: now,
          expiresAt: now + RANKED_RULES.lobbyMs,
          version: 1,
          members: seats.map((s) => ({ id: s.id, name: s.name, loadout: s.loadout, ready: false, offlineAt: now, frameId: s.frameId, titleId: s.titleId, crestId: s.crestId, badgeId: s.badgeId })),
          game: null,
          deadline: null,
          result: null,
          commandCount: 0,
          ticket: {},
          rematch: [],
          ranked: { rp: [seats[0].rp, seats[1].rp], outcome: null },
        };
        await this.env.DB.prepare('INSERT INTO tactics_pvp_rooms (code,player_a,player_b,created_at,expires_at) VALUES (?,?,?,?,?)')
          .bind(this.room.code, seats[0].id, seats[1].id, now, this.room.expiresAt)
          .run();
        await this.save();
        return response({ code: this.room.code, matchId: this.room.matchId });
      }
      const r = this.room;
      if (!r || r.expiresAt <= now)
        return response({ error: { message: 'Sala inexistente o vencida.' } }, 404);
      let seat = r.members.findIndex((m) => m.id === id);
      if (path === '/join' && seat < 0) {
        if (r.members.length === 2 || r.game || r.result)
          return response({ error: { message: 'Sala llena.' } }, 409);
        r.members.push({
          id,
          name: decodeURIComponent(request.headers.get('X-Pvp-Name')!),
          loadout: body.loadout as Loadout,
          ready: false,
          offlineAt: now,
          frameId: (body.frameId as string | null) ?? null,
          titleId: (body.titleId as string | null) ?? null,
          crestId: (body.crestId as string | null) ?? null,
          badgeId: (body.badgeId as string | null) ?? null,
        });
        seat = 1;
        r.version++;
        await this.env.DB.prepare('UPDATE tactics_pvp_rooms SET player_b=? WHERE code=?')
          .bind(id, r.code)
          .run();
        await this.save();
        this.broadcast();
      }
      if (seat < 0) return response({ error: { message: 'No perteneces a esta sala.' } }, 403);
      if (path === '/connect') {
        const ticket = secret();
        r.ticket = Object.fromEntries(Object.entries(r.ticket).filter(([, v]) => v.expires > now));
        r.ticket[ticket] = { seat, expires: now + 30000 };
        await this.save();
        return response({ ticket, code: r.code });
      }
      if (path === '/loadout' || path === '/ready') {
        if (r.game || r.result)
          return response({ error: { message: 'La partida ya comenzó.' } }, 409);
        const member = r.members[seat]!;
        const loadout = body.loadout as Loadout;
        // Ranked: the champion is fixed by the queue ticket (no counter-pick after seeing the rival).
        if (r.ranked && loadout.heroId !== member.loadout.heroId)
          return response({ error: { message: 'En clasificatoria el campeón queda fijado al buscar partida.' } }, 409);
        // …and so is the deck (rooms from older Workers have no deckId: nothing to compare).
        if (r.ranked && member.loadout.deckId !== undefined && loadout.deckId !== member.loadout.deckId)
          return response({ error: { message: 'En clasificatoria el mazo queda fijado al buscar partida.' } }, 409);
        member.frameId = (body.frameId as string | null) ?? null;
        member.titleId = (body.titleId as string | null) ?? null;
        member.crestId = (body.crestId as string | null) ?? null;
        member.badgeId = (body.badgeId as string | null) ?? null;
        if (JSON.stringify(member.loadout) !== JSON.stringify(loadout)) {
          member.loadout = loadout;
          for (const m of r.members) m.ready = false;
        }
        member.ready = path === '/ready';
        r.version++;
        if (r.members.length === 2 && r.members.every((m) => m.ready && m.offlineAt === null)) {
          r.game = createDuel(
            r.members.map((m) => m.loadout) as [Loadout, Loadout],
            crypto.getRandomValues(new Uint32Array(1))[0]!,
            r.mode ?? 'DUEL',
            r.mapId ?? 'classic',
            PVP_CONTENT,
            !!r.ranked,
          );
          r.expiresAt = now + 24 * 3600000;
          r.firstPlayer = r.game.duel!.active;
          r.startedAt = now;
          await this.ctx.storage.put('initial:' + r.matchId, structuredClone(r.game));
          r.deadline = now + 90000;
          // started_at: social presence (IN_PVP) and invite busy checks (migration 0010).
          await this.env.DB.prepare('UPDATE tactics_pvp_rooms SET expires_at=?, started_at=? WHERE code=?')
            .bind(r.expiresAt, now, r.code)
            .run();
        }
        await this.save();
        this.broadcast();
      }
      if (path === '/leave') {
        if (r.game && !r.result) {
          // Ranked: walking out of a live match is a confirmed abandon (bigger RP penalty).
          await this.finish(1 - seat, r.ranked ? 'ABANDONED' : 'SURRENDER');
          this.broadcast();
        } else if (!r.result) {
          r.expiresAt = now;
          r.version++;
          await this.save();
          await this.env.DB.prepare('UPDATE tactics_pvp_rooms SET expires_at=? WHERE code=?')
            .bind(now, r.code)
            .run();
          this.broadcast();
        }
        for (const ws of this.ctx.getWebSockets())
          if (ws.deserializeAttachment().seat === seat) ws.close(1000, 'Exit');
      }
      if (path === '/rematch') {
        if (!r.result) return response({ error: { message: 'La partida no terminó.' } }, 409);
        if (r.ranked)
          return response({ error: { message: 'Las clasificatorias no tienen revancha. Busca otra partida.' } }, 409);
        r.members[seat]!.loadout = body.loadout as Loadout;
        r.members[seat]!.frameId = (body.frameId as string | null) ?? null;
        r.members[seat]!.titleId = (body.titleId as string | null) ?? null;
        r.members[seat]!.crestId = (body.crestId as string | null) ?? null;
        r.members[seat]!.badgeId = (body.badgeId as string | null) ?? null;
        if (!r.rematch.includes(seat)) r.rematch.push(seat);
        if (r.rematch.length === 2) {
          await this.recordResult();
          r.matchId = crypto.randomUUID();
          r.createdAt = now;
          r.startedAt = null;
          r.expiresAt = now + 30 * 60000;
          r.game = null;
          r.result = null;
          r.commandCount = 0;
          r.rematch = [];
          for (const m of r.members) m.ready = false;
          await this.env.DB.prepare(
            'UPDATE tactics_pvp_rooms SET finished_at=NULL,started_at=NULL,created_at=?,expires_at=? WHERE code=?',
          )
            .bind(now, r.expiresAt, r.code)
            .run();
        }
        r.version++;
        await this.save();
        this.broadcast();
      }
      return response(this.view(seat));
    });
  }
  private async socket(request: Request): Promise<Response> {
    const r = this.room,
      token = new URL(request.url).searchParams.get('ticket') ?? '',
      t = r?.ticket[token];
    if (!r || !t || t.expires < Date.now() || r.expiresAt < Date.now()) return response({}, 401);
    if (
      r.game &&
      !r.result &&
      r.members[t.seat]!.offlineAt !== null &&
      r.members[t.seat]!.offlineAt! + 60000 <= Date.now()
    ) {
      const rival = r.members[1 - t.seat]!;
      if (rival.offlineAt === null) await this.finish(1 - t.seat, 'OPPONENT_DISCONNECTED');
      else if (rival.offlineAt + 60000 <= Date.now()) await this.finish(-1, 'BOTH_DISCONNECTED');
      else return response({ error: { message: 'Tu ventana de reconexión venció.' } }, 410);
    }
    delete r.ticket[token];
    const pair = new (
      globalThis as unknown as { WebSocketPair: new () => { 0: Socket; 1: Socket } }
    ).WebSocketPair();
    const ws = pair[1];
    this.ctx.acceptWebSocket(ws, [String(t.seat)]);
    ws.serializeAttachment({ seat: t.seat });
    r.members[t.seat]!.offlineAt = null;
    r.version++;
    await this.save();
    this.broadcast();
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
  }
  webSocketMessage(ws: Socket, message: string | ArrayBuffer): Promise<void> {
    return this.serial(async () => {
      const seat = ws.deserializeAttachment().seat;
      try {
        if (typeof message !== 'string' || message.length > 4096) throw Error('BAD_COMMAND');
        const action = JSON.parse(message);
        if (action.type === 'resync') {
          ws.send(JSON.stringify({ type: 'snapshot', ...this.view(seat) }));
          return;
        }
        // Liveness probe: the client compares the authoritative version with what it rendered
        // and resyncs (or reconnects when no pong comes back) — a lost push never sticks.
        if (action.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', version: this.room?.version ?? 0 }));
          return;
        }
        const r = this.room!;
        if (action.type === 'surrender') {
          if (r.game && !r.result) {
            await this.finish(1 - seat, 'SURRENDER');
            this.broadcast();
          }
          return;
        }
        if (!r.game || r.result) throw Error('BATTLE_OVER');
        if (typeof action.id !== 'string' || action.id.length > 80 || !action.id.length)
          throw Error('BAD_ACTION_ID');
        const key = 'action:' + r.matchId + ':' + seat + ':' + action.id,
          payload = JSON.stringify(action.command);
        const accepted = await this.ctx.storage.get<{ payload: string }>(key);
        if (accepted) {
          if (accepted.payload !== payload) throw Error('ACTION_ID_REUSED');
          ws.send(JSON.stringify({ type: 'snapshot', ack: action.id, ...this.view(seat) }));
          return;
        }
        if (action.version !== r.version) throw Error('STALE_VERSION');
        if (r.game.duel!.active !== seat) throw Error('NOT_YOUR_TURN');
        if (r.members.some((m) => m.offlineAt !== null)) throw Error('OPPONENT_DISCONNECTED');
        if (r.deadline !== null && r.deadline <= Date.now()) {
          await this.ctx.storage.setAlarm(Date.now());
          throw Error('TURN_EXPIRED');
        }
        if (!validCommand(action.command)) throw Error('BAD_COMMAND');
        const command = canonicalCommand(action.command);
        const applied = applyDuel(r.game, command, PVP_CONTENT);
        r.game = applied.state;
        r.version++;
        r.commandCount++;
        const writes = {
          [key]: { seat, payload },
          ['command:' + r.matchId + ':' + String(r.commandCount).padStart(8, '0')]: {
            seat,
            command,
            version: r.version,
          },
        };
        if (command.type === 'END_TURN') r.deadline = Date.now() + 90000;
        if (r.game.outcome) {
          const winner =
            r.game.dominion?.winner ??
            (r.game.units.some((u) => u.id === r.game!.duel!.champions[0]) ? 0 : 1);
          await this.finish(
            winner,
            r.game.dominion?.winner != null ? 'DOMINION_SCORE' : 'CHAMPION_DEFEATED',
            writes,
          );
        } else await this.save(writes);
        this.broadcast(applied.events);
        ws.send(JSON.stringify({ type: 'ack', id: action.id, version: r.version }));
      } catch (e) {
        this.room = (await this.ctx.storage.get<Room>('room')) ?? this.room;
        ws.send(
          JSON.stringify({
            type: 'error',
            message: e instanceof Error ? e.message : 'SERVER_ERROR',
            version: this.room?.version,
          }),
        );
      }
    });
  }
  webSocketClose(ws: Socket): Promise<void> {
    return this.serial(async () => {
      const seat = ws.deserializeAttachment().seat;
      if (!this.ctx.getWebSockets(String(seat)).some((s) => s !== ws)) {
        this.room!.members[seat]!.offlineAt = Date.now();
        this.room!.version++;
        await this.save();
        this.broadcast();
      }
    });
  }
  webSocketError(ws: Socket): Promise<void> {
    ws.close(1011, 'Connection error');
    return this.webSocketClose(ws);
  }
  alarm(): Promise<void> {
    return this.serial(async () => {
      const r = this.room;
      if (!r) return;
      if (r.result) {
        await this.recordResult();
        await this.ctx.storage.deleteAlarm();
        if (r.ranked) this.broadcast(); // a retried ranked result reaches the open result screens
        return;
      }
      const now = Date.now(),
        expired = r.members.findIndex((m) => m.offlineAt !== null && m.offlineAt + 60000 <= now);
      if (r.game && expired >= 0) {
        const connected = r.members.findIndex((m) => m.offlineAt === null);
        if (connected >= 0) {
          await this.finish(connected, 'OPPONENT_DISCONNECTED');
          this.broadcast();
        } else if (r.members.every((m) => m.offlineAt! + 60000 <= now)) {
          await this.finish(-1, 'BOTH_DISCONNECTED');
          this.broadcast();
        } else {
          r.deadline = now + 60000;
          await this.save();
        }
      } else if (r.expiresAt <= now) {
        if (r.game) {
          await this.finish(-1, 'MATCH_EXPIRED');
          this.broadcast();
          return;
        }
        await this.env.DB.prepare('UPDATE tactics_pvp_rooms SET expires_at=? WHERE code=?')
          .bind(now, r.code)
          .run();
        for (const s of this.ctx.getWebSockets()) s.close(1000, 'Room expired');
      } else if (r.game && r.deadline !== null && r.deadline <= now) {
        if (r.members.every((m) => m.offlineAt === null)) {
          // Timer expired: the server ends the turn itself. Over the hand size it discards by the
          // deterministic fallback rule (last card in hand), recorded in the command log.
          const fallback = fallbackDiscardUid(r.game),
            command: Command = fallback ? { type: 'END_TURN', discardUid: fallback } : { type: 'END_TURN' },
            seat = r.game.duel!.active,
            result = applyDuel(r.game, command, PVP_CONTENT);
          r.game = result.state;
          r.version++;
          r.commandCount++;
          const writes = {
            ['command:' + r.matchId + ':' + String(r.commandCount).padStart(8, '0')]: {
              seat,
              command,
              version: r.version,
            },
          };
          r.deadline = now + 90000;
          if (r.game.outcome)
            await this.finish(
              r.game.dominion?.winner ??
                (r.game.units.some((u) => u.id === r.game!.duel!.champions[0]) ? 0 : 1),
              r.game.dominion?.winner != null ? 'DOMINION_SCORE' : 'CHAMPION_DEFEATED',
              writes,
            );
          else await this.save(writes);
          this.broadcast(result.events);
        } else r.deadline = now + 60000;
        await this.save();
      } else await this.save();
    });
  }
}
export function validCommand(c: unknown): c is Command {
  if (!c || typeof c !== 'object') return false;
  const v = c as Record<string, unknown>;
  const pos = (p: unknown) =>
    !!p &&
    typeof p === 'object' &&
    Number.isInteger((p as { x: number }).x) &&
    Number.isInteger((p as { y: number }).y) &&
    Math.abs((p as { x: number }).x) < 100 &&
    Math.abs((p as { y: number }).y) < 100;
  if (v.type === 'END_TURN') return v.discardUid === undefined || (typeof v.discardUid === 'string' && v.discardUid.length < 100);
  if (v.type === 'SEARCH_SUMMON') return typeof v.cardUid === 'string' && v.cardUid.length > 0 && v.cardUid.length < 100 && typeof v.choiceUid === 'string' && v.choiceUid.length > 0 && v.choiceUid.length < 100;
  if (v.type === 'PLAY_CARD')
    return (
      typeof v.cardUid === 'string' &&
      v.cardUid.length < 100 &&
      (v.target === null || pos(v.target)) &&
      (v.secondary === undefined || pos(v.secondary))
    );
  if (v.type === 'MOVE_UNIT')
    return typeof v.unitId === 'string' && v.unitId.length < 100 && pos(v.to);
  if (v.type === 'COMMIT_RITUAL_PIECE' || v.type === 'RELEASE_RITUAL_PIECE')
    return typeof v.cardUid === 'string' && v.cardUid.length < 100;
  if (v.type === 'ACTIVATE_RITUAL')
    return typeof v.ritualId === 'string' && v.ritualId.length < 100 && (v.target === null || pos(v.target));
  return false;
}

function canonicalCommand(command: Command): Command {
  if (command.type === 'SEARCH_SUMMON') return {type:command.type,cardUid:command.cardUid,choiceUid:command.choiceUid};

  if (command.type === 'END_TURN')
    return command.discardUid === undefined ? { type: 'END_TURN' } : { type: 'END_TURN', discardUid: command.discardUid };
  if (command.type === 'MOVE_UNIT')
    return { type: 'MOVE_UNIT', unitId: command.unitId, to: { x: command.to.x, y: command.to.y } };
  if (command.type === 'COMMIT_RITUAL_PIECE' || command.type === 'RELEASE_RITUAL_PIECE')
    return { type: command.type, cardUid: command.cardUid };
  // Never reached in PvP (validCommand refuses INTERACT); keeps the Command union exhaustive.
  if (command.type === 'INTERACT') return { type: 'INTERACT', mechanismId: command.mechanismId };
  if (command.type === 'ACTIVATE_RITUAL')
    return {
      type: 'ACTIVATE_RITUAL',
      ritualId: command.ritualId,
      target: command.target ? { x: command.target.x, y: command.target.y } : null,
    };
  return {
    type: 'PLAY_CARD',
    cardUid: command.cardUid,
    target: command.target ? { x: command.target.x, y: command.target.y } : null,
    // Only present when sent: older logs replay byte for byte.
    ...(command.secondary ? { secondary: { x: command.secondary.x, y: command.secondary.y } } : {}),
  };
}

/** Compatible rule catalog for active rooms; championAllowed still gates every new loadout. */
export const PVP_CONTENT = withArcher(DEFAULT_CONTENT);
