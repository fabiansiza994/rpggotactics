import {protectionRpc} from './rankedProtection';
import {
  BOT_POLICY,
  type BotIdentity,
} from "../../src/game/ai/ranked-bot-policy";
import {
  botsEnabled,
  botRewardPreview,
  makeBot,
  botPolicy,
} from "./rankedBots";
import { PVP_MAPS } from "../../src/game/pvp/maps";
import {
  RANKED_RULES,
  RANKED_SEASON,
  rankedPublicConfig,
} from "../../src/game/ranked/ranked";
import type { Env } from "./db";
import { error, json } from "./http";
import { playableBotChampions, recentBotChampions } from "./botChampions";
import { PVP_CONTENT, randomCode, serverLoadout, type RankedSeat } from "./pvp";
import { currentRp } from "./rankedResults";
import { rankedTrackBody, reconcileRankedTrack } from "./rankedTrack";
import {
  PREMIUM_ROUTES,
  premiumAllowed,
  premiumRoute,
  premiumView,
  reconcilePremium,
} from "./rankedPremium";

/**
 * Ranked Preseason v0.1 — profile + a minimal first-come-first-served 1v1 queue (migration 0023).
 * No skill matching, regions or buckets. Pairing is ONE atomic D1 statement (both tickets or
 * neither), then the matched pair gets a fresh PvPMatchRoom through an internal-only path, so the
 * whole match runs on the existing authoritative room. Identity is always the session caller: no
 * route takes a user id, an RP value or a result.
 *
 *   GET  /api/tactics/ranked/me      own RP, record, milestones, safe config, queue state
 *   GET  /api/tactics/ranked/track   Reward Track timeline (peak RP, granted / unlocked / locked)
 *                                    + `premium` (the PREMIUM row) when the pass is open
 *   GET/POST /api/tactics/ranked/premium[/purchase|/showcase]   Ranked Premium Track (rankedPremium.ts)
 *   POST /api/tactics/ranked/queue   { heroId } join (or refresh) the queue
 *   GET  /api/tactics/ranked/queue   poll: heartbeat + pairing attempt
 *   POST /api/tactics/ranked/cancel  leave the queue (no effect once matched)
 */

const QA_USERS = ["tactics_qa_a", "tactics_qa_b"];
/** RANKED_PRESEASON_ENABLED="1" opens it; RANKED_PRESEASON_QA="1" only for the QA accounts. Unset = off. */
export const rankedAllowed = (env: Env, username: string) =>
  env.RANKED_PRESEASON_ENABLED === "1" ||
  (env.RANKED_PRESEASON_QA === "1" && QA_USERS.includes(username));

/** A matched ticket whose room never showed up (failed creation) is dropped after this. */
const MATCHING_GRACE_MS = 15_000;

type QueueState =
  | { state: "IDLE" }
  | {
      state: "SEARCHING";
      heroId: string;
      deckId: string | null;
      since: number;
      botOffer?: {
        identity: BotIdentity;
        rewards: Awaited<ReturnType<typeof botRewardPreview>>;
      };
    }
  | { state: "MATCHED"; code: string };

interface Ticket {
  user_id: number;
  hero_id: string;
  /** Migration 0028; NULL on tickets from older Workers (= default deck). */
  deck_id?: string | null;
  joined_at: number;
  expires_at: number;
  room_code: string | null;
  matched_at: number | null;
  bot_seed?: number;
  bot_request?: string | null;
}

type Caller = { userId: number; username: string };

export async function rankedRoute(
  request: Request,
  env: Env,
  caller: Caller,
  now: number,
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (!path.startsWith("/api/tactics/ranked/")) return null;
  const route = `${request.method} ${path.slice("/api/tactics/ranked/".length)}`;
  if (
    ![
      "GET me",
      "GET track",
      "POST queue",
      "GET queue",
      "POST cancel",
      "POST bot",
      ...PREMIUM_ROUTES,
    ].includes(route)
  )
    return error(404, "NOT_FOUND", "Not found");
  if (!rankedAllowed(env, caller.username)) {
    if (route === "GET me" || route === "GET track" || route === "GET premium")
      return json({ enabled: false });
    return error(
      403,
      "RANKED_DISABLED",
      "La clasificatoria todavía no está disponible.",
    );
  }
  let protection:Awaited<ReturnType<typeof protectionRpc>>={serverNow:now,until:0,reason:null};
  if(['GET me','POST queue','GET queue','POST bot'].includes(route)){try{protection=await protectionRpc(env,caller.userId);}catch{return error(503,'PROTECTION_UNAVAILABLE','No se puede comprobar la disponibilidad Ranked. Reintenta.');}}
  if(['POST queue','GET queue','POST bot'].includes(route)&&protection.until>now){
    await env.DB.prepare('DELETE FROM tactics_ranked_queue WHERE user_id=? AND room_code IS NULL').bind(caller.userId).run();
    return json({error:{code:'RANKED_COOLDOWN',message:'Búsqueda Ranked temporalmente restringida'},protection},429);
  }
  const db = env.DB;

  if (PREMIUM_ROUTES.includes(route))
    return premiumRoute(route, request, env, caller, now);
  if (route === "GET track") {
    const body = await rankedTrackBody(db, caller.userId, now);
    // FREE row + PREMIUM row in one read (the premium line is additive; absent while it is closed).
    return json(
      premiumAllowed(env, caller.username)
        ? { ...body, premium: await premiumView(db, caller.userId, now) }
        : body,
    );
  }

  if (route === "GET me") {
    // Reward Track safety net / legacy backfill: idempotent, grants only what the peak reached.
    await reconcileRankedTrack(db, caller.userId, now);
    if (premiumAllowed(env, caller.username))
      await reconcilePremium(db, caller.userId, now);
    const row = await db
      .prepare(
        "SELECT rp, wins, losses, draws FROM tactics_ranked_players WHERE user_id = ? AND season_id = ?",
      )
      .bind(caller.userId, RANKED_SEASON.id)
      .first<{ rp: number; wins: number; losses: number; draws: number }>();
    const { results } = await db
      .prepare(
        "SELECT tier_id FROM tactics_ranked_milestones WHERE user_id = ? AND season_id = ? ORDER BY reached_at",
      )
      .bind(caller.userId, RANKED_SEASON.id)
      .all<{ tier_id: string }>();
    return json({
      enabled: true,
      protection,
      config: rankedPublicConfig(),
      rp: row?.rp ?? 0,
      wins: row?.wins ?? 0,
      losses: row?.losses ?? 0,
      draws: row?.draws ?? 0,
      milestones: results.map((r) => r.tier_id),
      queue: await queueState(env, caller, now),
      botHistory: (
        await db
          .prepare(
            "SELECT e.match_id AS matchId,e.bot_json AS bot,r.outcome,r.rp_delta AS rpDelta,r.xp,r.finished_at AS finishedAt FROM tactics_ranked_bot_encounters e JOIN tactics_ranked_bot_results r ON r.match_id=e.match_id WHERE e.user_id=? ORDER BY r.finished_at DESC LIMIT 5",
          )
          .bind(caller.userId)
          .all()
      ).results.map((r) => ({ ...r, bot: JSON.parse(String(r.bot)) })),
    });
  }

  if (route === "POST bot") return acceptBot(request, env, caller, now);

  if (route === "POST cancel") {
    await db
      .prepare(
        "DELETE FROM tactics_ranked_queue WHERE user_id = ? AND room_code IS NULL",
      )
      .bind(caller.userId)
      .run();
    const ticket = await db
      .prepare(
        "SELECT room_code,bot_request FROM tactics_ranked_queue WHERE user_id=?",
      )
      .bind(caller.userId)
      .first<{ room_code: string | null; bot_request: string | null }>();
    if (ticket?.room_code && ticket.bot_request && env.PVP_ROOMS) {
      const cancelled = await env.PVP_ROOMS.get(
        env.PVP_ROOMS.idFromName(ticket.room_code),
      ).fetch(
        new Request("https://room/cancel-bot-search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Pvp-User": String(caller.userId),
          },
          body: "{}",
        }),
      );
      if (cancelled.ok)
        await db.batch([
          db
            .prepare(
              "DELETE FROM tactics_ranked_queue WHERE user_id=? AND room_code=?",
            )
            .bind(caller.userId, ticket.room_code),
          db
            .prepare(
              "DELETE FROM tactics_match_reservations WHERE user_id=? AND room_code=?",
            )
            .bind(caller.userId, ticket.room_code),
        ]);
      else if (cancelled.status !== 409)
        return error(
          503,
          "CANCEL_PENDING",
          "No se pudo confirmar la cancelación. Reintenta.",
        );
    }
    return json({ queue: await queueState(env, caller, now) });
  }

  if (route === "GET queue") {
    // Heartbeat: only a searching ticket is refreshed; then try to pair.
    await db
      .prepare(
        "UPDATE tactics_ranked_queue SET expires_at = ? WHERE user_id = ? AND room_code IS NULL AND expires_at > ?",
      )
      .bind(now + RANKED_RULES.queueHeartbeatMs, caller.userId, now)
      .run();
    return json({ queue: await pairOrState(env, caller, now) });
  }

  // POST queue
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 1024)
      return error(413, "TOO_LARGE", "Solicitud demasiado grande.");
    body = JSON.parse(raw || "{}");
  } catch {
    return error(400, "BAD_REQUEST", "Cuerpo inválido.");
  }
  const state = await queueState(env, caller, now);
  if (state.state === "MATCHED") return json({ queue: state });
  // Never two live matches at once (a started casual game blocks the queue; an idle casual lobby does not).
  const live = await db
    .prepare(
      "SELECT 1 FROM tactics_pvp_rooms WHERE (player_a = ? OR player_b = ?) AND started_at IS NOT NULL AND finished_at IS NULL AND expires_at > ? LIMIT 1",
    )
    .bind(caller.userId, caller.userId, now)
    .first();
  if (live)
    return error(
      409,
      "IN_MATCH",
      "Termina tu partida en curso antes de buscar clasificatoria.",
    );
  // The deck is validated now (owned, this champion's, legal) and re-resolved at pairing time.
  const own = await serverLoadout(env, caller, body.heroId, body.deckId);
  if (own instanceof Response) return own;
  await db
    .prepare(
      `INSERT INTO tactics_ranked_queue (user_id, hero_id, deck_id, joined_at, expires_at, bot_seed) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET hero_id = excluded.hero_id, deck_id = excluded.deck_id, expires_at = excluded.expires_at WHERE room_code IS NULL`,
    )
    .bind(
      caller.userId,
      own.loadout.heroId,
      own.loadout.deckId ?? null,
      now,
      now + RANKED_RULES.queueHeartbeatMs,
      crypto.getRandomValues(new Uint32Array(1))[0]!,
    )
    .run();
  return json({ queue: await pairOrState(env, caller, now) });
}

/** The caller's queue state; drops their ticket when its room is gone (finished, expired, failed). */
async function queueState(
  env: Env,
  caller: Caller,
  now: number,
): Promise<QueueState> {
  const db = env.DB;
  const t = await db
    .prepare("SELECT * FROM tactics_ranked_queue WHERE user_id = ?")
    .bind(caller.userId)
    .first<Ticket>();
  if (!t) return { state: "IDLE" };
  if (t.room_code === null) {
    if (t.expires_at > now) {
      const rp = await currentRp(db, caller.userId);
      let botOffer: Extract<QueueState, { state: "SEARCHING" }>["botOffer"];
      if (
        botsEnabled(env) &&
        now - t.joined_at >= BOT_POLICY.offerAfterMs &&
        playableBotChampions(env, PVP_CONTENT).length
      ) {
        botOffer = {
          identity: makeBot(
            caller.userId,
            t.joined_at,
            rp,
            t.bot_seed ?? t.joined_at,
            env,
            PVP_CONTENT,
            await recentBotChampions(db, caller.userId, t.joined_at),
          ),
          rewards: await botRewardPreview(
            db,
            caller.userId,
            rp,
            now,
            botPolicy(env),
          ),
        };
      }
      return {
        state: "SEARCHING",
        heroId: t.hero_id,
        deckId: t.deck_id ?? null,
        since: t.joined_at,
        ...(botOffer ? { botOffer } : {}),
      };
    }
  } else {
    const room = await db
      .prepare(
        "SELECT finished_at, expires_at FROM tactics_pvp_rooms WHERE code = ?",
      )
      .bind(t.room_code)
      .first<{ finished_at: number | null; expires_at: number }>();
    if (
      room
        ? room.finished_at === null && room.expires_at > now
        : (t.matched_at ?? 0) + MATCHING_GRACE_MS > now
    )
      return room
        ? { state: "MATCHED", code: t.room_code }
        : {
            state: "SEARCHING",
            heroId: t.hero_id,
            deckId: t.deck_id ?? null,
            since: t.joined_at,
          };
  }
  await db
    .prepare(
      "DELETE FROM tactics_ranked_queue WHERE user_id = ? AND joined_at = ?",
    )
    .bind(caller.userId, t.joined_at)
    .run();
  if (t.bot_request && t.room_code)
    await db
      .prepare(
        "DELETE FROM tactics_match_reservations WHERE user_id=? AND room_code=?",
      )
      .bind(caller.userId, t.room_code)
      .run();
  return { state: "IDLE" };
}

async function pairOrState(
  env: Env,
  caller: Caller,
  now: number,
): Promise<QueueState> {
  const db = env.DB;
  await recoverBotRoom(env, caller, now);
  const state = await queueState(env, caller, now);
  if (state.state !== "SEARCHING" || !env.PVP_ROOMS) return state;
  await db
    .prepare(
      "DELETE FROM tactics_ranked_queue WHERE room_code IS NULL AND expires_at <= ?",
    )
    .bind(now)
    .run();
  const code = randomCode();
  // Atomic pair: the oldest live ticket that is not the caller and not blocked either way, plus
  // the caller's own live ticket. Both rows or none (count check + RETURNING verified below).
  const { results: claimed } = await db
    .prepare(
      `WITH rival AS (
         SELECT q.user_id FROM tactics_ranked_queue q
         WHERE q.user_id <> ?1 AND q.room_code IS NULL AND q.expires_at > ?2
           AND NOT EXISTS (SELECT 1 FROM tactics_social_blocks s
             WHERE (s.blocker_id = ?1 AND s.blocked_id = q.user_id) OR (s.blocker_id = q.user_id AND s.blocked_id = ?1))
         ORDER BY q.joined_at, q.user_id LIMIT 1
       )
       UPDATE tactics_ranked_queue SET room_code = ?3, matched_at = ?2
       WHERE room_code IS NULL AND expires_at > ?2
         AND user_id IN (?1, (SELECT user_id FROM rival))
         AND (SELECT count(*) FROM rival) = 1
         AND EXISTS (SELECT 1 FROM tactics_ranked_queue WHERE user_id = ?1 AND room_code IS NULL AND expires_at > ?2)
       RETURNING user_id, hero_id, deck_id, joined_at`,
    )
    .bind(caller.userId, now, code)
    .all<{
      user_id: number;
      hero_id: string;
      deck_id: string | null;
      joined_at: number;
    }>();
  const release = (ids: number[]) =>
    db.batch(
      ids.map((id) =>
        db
          .prepare(
            "UPDATE tactics_ranked_queue SET room_code = NULL, matched_at = NULL WHERE user_id = ? AND room_code = ?",
          )
          .bind(id, code),
      ),
    );
  if (claimed.length !== 2) {
    if (claimed.length) await release(claimed.map((c) => c.user_id));
    const pending = await queueState(env, caller, now);
    if (pending.state === "SEARCHING" && pending.botOffer) {
      const response = await assignBot(env, caller, now, pending);
      if (response.ok) return (await response.json() as {queue: QueueState}).queue;
    }
    return queueState(env, caller, now);
  }
  // Earlier ticket = seat A. Both loadouts come from each account's stored profile, right now.
  claimed.sort((x, y) => x.joined_at - y.joined_at || x.user_id - y.user_id);
  const seats: RankedSeat[] = [];
  for (const c of claimed) {
    const user = await db
      .prepare("SELECT username FROM users WHERE id = ?")
      .bind(c.user_id)
      .first<{ username: string }>();
    const resolved = user
      ? await serverLoadout(
          env,
          { userId: c.user_id, username: user.username },
          c.hero_id,
          c.deck_id ?? undefined,
        )
      : null;
    if (!user || !resolved || resolved instanceof Response) {
      // That player's champion/deck is no longer legal: drop their ticket, keep the other searching.
      await release(claimed.map((x) => x.user_id));
      await db
        .prepare(
          "DELETE FROM tactics_ranked_queue WHERE user_id = ? AND room_code IS NULL",
        )
        .bind(c.user_id)
        .run();
      return queueState(env, caller, now);
    }
    seats.push({
      id: c.user_id,
      name: user.username,
      loadout: resolved.loadout,
      avatarId: resolved.avatarId,
      frameId: resolved.frameId,
      titleId: resolved.titleId,
      crestId: resolved.crestId,
      badgeId: resolved.badgeId,
      rp: await currentRp(db, c.user_id),
    });
  }
  const maps = PVP_MAPS.filter((m) => m.allowedModes.includes("DUEL"));
  const mapId =
    maps[crypto.getRandomValues(new Uint32Array(1))[0]! % maps.length]!.id;
  const res = await env.PVP_ROOMS.get(env.PVP_ROOMS.idFromName(code)).fetch(
    new Request("https://room/ranked-create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pvp-User": String(caller.userId),
        "X-Pvp-Name": encodeURIComponent(caller.username),
      },
      body: JSON.stringify({ code, mapId, seats }),
    }),
  );
  if (!res.ok) {
    await release(claimed.map((c) => c.user_id));
    return queueState(env, caller, now);
  }
  return queueState(env, caller, now);
}

async function acceptBot(
  request: Request,
  env: Env,
  caller: Caller,
  now: number,
): Promise<Response> {
  if (!botsEnabled(env) || !env.PVP_ROOMS)
    return error(403, "BOTS_DISABLED", "La oferta IA no está disponible.");
  let body: { since?: number; acceptance?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 1024)
      return error(413, "TOO_LARGE", "Solicitud demasiado grande.");
    body = JSON.parse(raw) as typeof body;
  } catch {
    return error(400, "BAD_REQUEST", "Solicitud inválida.");
  }
  // Human pairing always gets the final opportunity before an atomic bot claim.
  const state = await pairOrState(env, caller, now);
  if (state.state === "MATCHED") return json({ queue: state });
  // Legacy route remains compatible; the server now owns automatic assignment at the deadline.
  if (state.state !== "SEARCHING" || body.since !== state.since)
    return json({queue: state});
  return json({queue: state});
}

async function assignBot(
  env: Env, caller: Caller, now: number,
  state: Extract<QueueState, {state: "SEARCHING"}>,
): Promise<Response> {
  if (!state.botOffer || !env.PVP_ROOMS) return json({queue:state});
  const own = await serverLoadout(
    env,
    caller,
    state.heroId,
    state.deckId ?? undefined,
  );
  if (own instanceof Response) return own;
  const code = randomCode();
  const accepted = {
    code,
    mapId: "classic",
    human: {
      id: caller.userId,
      name: caller.username,
      ...own,
      rp: await currentRp(env.DB, caller.userId),
    },
    bot: state.botOffer.identity,
    policy: botPolicy(env),
  };
  const cap = Math.max(
    1,
    Math.min(100, Number(env.RANKED_BOTS_MAX_CONCURRENT) || 20),
  );
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE tactics_ranked_queue SET room_code=?,matched_at=?,bot_request=? WHERE user_id=? AND joined_at=? AND room_code IS NULL AND expires_at>?
 AND NOT EXISTS(SELECT 1 FROM tactics_match_reservations WHERE user_id=? AND expires_at>?)
 AND NOT EXISTS(SELECT 1 FROM tactics_pvp_rooms WHERE (player_a=? OR player_b=?) AND started_at IS NOT NULL AND finished_at IS NULL AND expires_at>?)
 AND (SELECT COUNT(*) FROM tactics_match_reservations WHERE kind='BOT' AND expires_at>?)<?`,
      ).bind(
        code,
        now,
        JSON.stringify(accepted),
        caller.userId,
        state.since,
        now,
        caller.userId,
        now,
        caller.userId,
        caller.userId,
        now,
        now,
        cap,
      ),
      env.DB.prepare(
        `INSERT INTO tactics_match_reservations(user_id,room_code,kind,expires_at) SELECT user_id,room_code,'BOT',? FROM tactics_ranked_queue WHERE user_id=? AND room_code=?
 ON CONFLICT(user_id) DO UPDATE SET room_code=excluded.room_code,kind=excluded.kind,expires_at=excluded.expires_at WHERE tactics_match_reservations.expires_at<=?`,
      ).bind(now + RANKED_RULES.lobbyMs, caller.userId, code, now),
    ]);
  } catch {
    return error(409, "IN_MATCH", "Ya hay una partida o reserva activa.");
  }
  const claimed = await env.DB.prepare(
    "SELECT room_code FROM tactics_ranked_queue WHERE user_id=?",
  )
    .bind(caller.userId)
    .first<{ room_code: string | null }>();
  if (claimed?.room_code !== code)
    return claimed?.room_code
      ? json({ queue: await queueState(env, caller, now) })
      : error(
          429,
          "BOTS_BUSY",
          "No hay cupo IA disponible; seguimos buscando humanos.",
        );
  const res = await env.PVP_ROOMS.get(env.PVP_ROOMS.idFromName(code)).fetch(
    new Request("https://room/bot-create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pvp-User": String(caller.userId),
        "X-Pvp-Name": encodeURIComponent(caller.username),
      },
      body: JSON.stringify(accepted),
    }),
  );
  if (!res.ok)
    return error(
      503,
      "BOT_CREATION_PENDING",
      "La reserva se está recuperando. Reintenta la búsqueda.",
    );
  return json({ queue: await queueState(env, caller, now) });
}

async function recoverBotRoom(env: Env, caller: Caller, now: number) {
  if (!env.PVP_ROOMS) return;
  const ticket = await env.DB.prepare(
    "SELECT room_code,bot_request,matched_at FROM tactics_ranked_queue WHERE user_id=?",
  )
    .bind(caller.userId)
    .first<{
      room_code: string | null;
      bot_request: string | null;
      matched_at: number | null;
    }>();
  if (
    !ticket?.room_code ||
    !ticket.bot_request ||
    (ticket.matched_at ?? 0) + MATCHING_GRACE_MS <= now
  )
    return;

  await env.PVP_ROOMS.get(env.PVP_ROOMS.idFromName(ticket.room_code)).fetch(
    new Request("https://room/bot-create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pvp-User": String(caller.userId),
        "X-Pvp-Name": encodeURIComponent(caller.username),
      },
      body: ticket.bot_request,
    }),
  );
}
