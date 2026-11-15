import { botTurnBudget } from "../src/game/ai/ranked-bot-policy";
import { applyDuel } from "../src/game/pvp/duel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_CONTENT, fallbackDiscardUid } from "../src/game";
import { handle } from "../server/src/index";
import { PvPMatchRoom, PVP_CONTENT, type Room } from "../server/src/pvp";
import type { Env } from "../server/src/db";
import { addAccount, memoryD1 } from "./support/d1";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type DB = ReturnType<typeof memoryD1>;

class FakeSocket {
  closed = false;
  messages: string[] = [];
  constructor(
    public seat: number,
    public botProtocol = "ranked-bots-1",
  ) {}
  deserializeAttachment() {
    return {
      seat: this.seat,
      ...(this.botProtocol ? { botProtocol: this.botProtocol } : {}),
    };
  }
  serializeAttachment() {}
  send(s: string) {
    this.messages.push(s);
  }
  close() {
    this.closed = true;
  }
}
const sock = (s: FakeSocket) =>
  s as unknown as Parameters<PvPMatchRoom["webSocketMessage"]>[0];

interface FakeRoom {
  data: Map<string, unknown>;
  sockets: FakeSocket[];
  make(): PvPMatchRoom;
  live: PvPMatchRoom;
}

let db: DB;
let env: Env;
let rooms: Map<string, FakeRoom>;
const deps = { content: DEFAULT_CONTENT, now: () => Date.now(), seed: () => 7 };

function namespace() {
  rooms = new Map();
  return {
    idFromName: (name: string) => name,
    get: (name: unknown) => {
      const key = String(name);
      if (!rooms.has(key)) {
        const data = new Map<string, unknown>(),
          sockets: FakeSocket[] = [];
        let init: Promise<unknown> = Promise.resolve();
        const ctx = {
          storage: {
            get: async <T>(k: string) =>
              structuredClone(data.get(k)) as T | undefined,
            put: async (k: string, v: unknown) =>
              void data.set(k, structuredClone(v)),
            setAlarm: async () => {},
            deleteAlarm: async () => {},
          },
          blockConcurrencyWhile: <T>(fn: () => Promise<T>) => {
            const p = fn();
            init = p;
            return p;
          },
          acceptWebSocket: () => {},
          getWebSockets: (tag?: string) =>
            sockets.filter(
              (s) => !s.closed && (tag === undefined || s.seat === Number(tag)),
            ),
        };
        const make = () =>
          new PvPMatchRoom(
            ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0],
            env,
          );
        const entry: FakeRoom = { data, sockets, make, live: make() };
        rooms.set(key, entry);
        (entry as FakeRoom & { fetch(r: Request): Promise<Response> }).fetch =
          async (r: Request) => {
            await init;
            return entry.live.fetch(r);
          };
      }
      return rooms.get(key) as unknown as {
        fetch(r: Request): Promise<Response>;
      };
    },
  };
}

async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Json }> {
  const res = await handle(
    new Request(
      `https://api.test/api/tactics${path}${path.includes("?") ? "&" : "?"}botProtocol=ranked-bots-1`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ),
    env,
    deps,
  );
  return { status: res.status, body: (await res.json()) as Json };
}

async function player(name: string) {
  const account = addAccount(db, name);
  expect((await call(account.token, "POST", "/profile", {})).status).toBe(200);
  return { ...account, name };
}
type Player = Awaited<ReturnType<typeof player>>;

const queue = (p: Player, heroId = "mage", extra: Json = {}) =>
  call(p.token, "POST", "/ranked/queue", { heroId, ...extra });
const poll = (p: Player) => call(p.token, "GET", "/ranked/queue");
const count = (table: string) =>
  Number(db.sql.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_800_000_000_000);
  db = memoryD1({ legacyProfiles: true });
  for (const f of [
    "0004_pvp.sql",
    "0005_pvp_dominion.sql",
    "0006_pvp_maps.sql",
    "0009_tactics_social.sql",
    "0010_pvp_room_started.sql",
    "0019_tactics_pvp_history.sql",
    "0030_tactics_ranked_bots.sql",
  ])
    db.sql.exec(
      readFileSync(
        new URL(`../server/migrations/${f}`, import.meta.url),
        "utf8",
      ),
    );
  env = {
    DB: db,
    PVP_ROOMS: namespace(),
    RANKED_PRESEASON_ENABLED: "1",
    RANKED_BOTS_ENABLED: "1",
    SHAPESHIFTER_ENABLED: "1",
    SUMMONER_RITUALS_ENABLED: "1",
    FREE_CATALOG_ENABLED: "1",
  };
});
afterEach(() => vi.useRealTimers());

describe("ranked bot authoritative room integration", () => {
  it("offers at 15 seconds, preserves offer identity and always prioritizes a waiting human", async () => {
    const a = await player("bot-alpha"),
      b = await player("bot-beta");
    await queue(a);
    vi.setSystemTime(Date.now() + 14_000);
    // Refresh heartbeat during normal search rather than resurrecting an expired ticket.
    // Existing ticket heartbeat must be kept live every <20 s.
    db.sql
      .prepare("UPDATE tactics_ranked_queue SET expires_at=?")
      .run(Date.now() + 20_000);
    expect((await poll(a)).body.queue.botOffer).toBeUndefined();
    vi.setSystemTime(Date.now() + 1000);
    const offer = (await poll(a)).body.queue;
    expect(offer.botOffer.identity.name).toContain("IA");
    expect(rooms.size).toBe(0); // An offer alone never starts an AI match.
    expect((await poll(a)).body.queue.botOffer).toEqual(offer.botOffer);
    await queue(b);
    const accepted = await call(a.token, "POST", "/ranked/bot", {
      since: offer.since,
    });
    expect(accepted.body.queue.state).toBe("MATCHED");
    const room = rooms.get(accepted.body.queue.code)!.data.get("room") as Room;
    expect(room.bot).toBeUndefined();
  });
  it("cancellation wins before acceptance and does not create a bot", async () => {
    const a = await player("cancel-bot");
    const q = (await queue(a)).body.queue;
    vi.setSystemTime(Date.now() + 30_000);
    db.sql
      .prepare("UPDATE tactics_ranked_queue SET expires_at=?")
      .run(Date.now() + 20_000);
    await call(a.token, "POST", "/ranked/cancel");
    expect(
      (await call(a.token, "POST", "/ranked/bot", { since: q.since })).status,
    ).toBe(409);
    expect(rooms.size).toBe(0);
  });
  it("cancel after automatic claim expires only the unstarted bot lobby and blocks late creation", async () => {
    const a = await player("auto-cancel");
    const q = (await queue(a)).body.queue;
    vi.setSystemTime(Date.now() + 15_000);
    db.sql
      .prepare("UPDATE tactics_ranked_queue SET expires_at=?")
      .run(Date.now() + 20_000);
    const claimed = await call(a.token, "POST", "/ranked/bot", {
      since: q.since,
    });
    expect(claimed.body.queue.state).toBe("MATCHED");
    const code = claimed.body.queue.code;
    const cancelled = await call(a.token, "POST", "/ranked/cancel");
    expect(cancelled.body.queue.state).toBe("IDLE");
    expect(count("tactics_match_reservations")).toBe(0);
    const late = await env
      .PVP_ROOMS!.get(env.PVP_ROOMS!.idFromName(code))
      .fetch(
        new Request("https://room/bot-create", {
          method: "POST",
          headers: { "X-Pvp-User": String(a.id) },
          body: "{}",
        }),
      );
    expect(late.status).toBe(409);
    expect(count("tactics_ranked_bot_results")).toBe(0);
  });
  it("cancellation tombstone wins against a delayed bot-create and survives recovery", async () => {
    const a = await player("cancel-delayed"),
      q = (await queue(a)).body.queue;
    vi.setSystemTime(Date.now() + 15_000);
    db.sql
      .prepare("UPDATE tactics_ranked_queue SET expires_at=?")
      .run(Date.now() + 20_000);
    const namespace = env.PVP_ROOMS!;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delayed = false;
    env.PVP_ROOMS = {
      ...namespace,
      get: (id: Parameters<typeof namespace.get>[0]) => {
        const stub = namespace.get(id);
        return {
          fetch: async (request: Request) => {
            if (new URL(request.url).pathname === "/bot-create" && !delayed) {
              delayed = true;
              await gate;
            }
            return stub.fetch(request);
          },
        } as unknown as ReturnType<typeof namespace.get>;
      },
    };
    const claim = call(a.token, "POST", "/ranked/bot", { since: q.since });
    await vi.waitFor(() => expect(delayed).toBe(true));
    expect(
      (await call(a.token, "POST", "/ranked/cancel")).body.queue.state,
    ).toBe("IDLE");
    release!();
    expect((await claim).status).toBe(503);
    expect((await poll(a)).body.queue.state).toBe("IDLE");
    expect(count("tactics_match_reservations")).toBe(0);
    expect(count("tactics_ranked_bot_encounters")).toBe(0);
  });
  it("claims one bot without a fake user, runs legal alarm commands and restores identity after restart", async () => {
    env.RANKED_BOTS_HIGHER_LEVEL_BPS = "10000";
    const a = await player("human-bot");
    const q = (await queue(a)).body.queue;
    vi.setSystemTime(Date.now() + 30_000);
    db.sql
      .prepare("UPDATE tactics_ranked_queue SET expires_at=?")
      .run(Date.now() + 20_000);
    const offer = (await poll(a)).body.queue.botOffer;
    const accepted = await call(a.token, "POST", "/ranked/bot", {
      since: q.since,
    });
    expect(accepted.status).toBe(200);
    const code = accepted.body.queue.code,
      room = rooms.get(code)!;
    let r = room.data.get("room") as Room;
    expect(r.members[1]!.id).toBeNull();
    expect(count("users")).toBe(1);
    expect(r.bot!.identity).toEqual(offer.identity);
    expect(r.bot!.identity.difficultyMix).toMatchObject({
      promoted: true,
      higherBps: 10000,
    });
    expect(r.bot!.identity.level).toBe(1);
    // A new configuration must never reroll an existing room on reconnect.
    env.RANKED_BOTS_HIGHER_LEVEL_BPS = "0";
    expect(
      (await call(a.token, "POST", "/ranked/bot", { since: q.since })).body
        .queue.code,
    ).toBe(code);
    expect(rooms.size).toBe(1);
    r.members[0]!.offlineAt = null;
    room.sockets.push(new FakeSocket(0));
    room.live = room.make();
    expect(
      (await call(a.token, "POST", "/pvp/ready", { code, heroId: "mage" }))
        .status,
    ).toBe(200);
    r = room.data.get("room") as Room;
    expect(r.game).not.toBeNull();
    if (r.game!.duel!.active === 0)
      await room.live.webSocketMessage(
        sock(room.sockets[0]!),
        JSON.stringify({
          type: "command",
          id: "human-end",
          version: r.version,
          command: { type: "END_TURN" },
        }),
      );
    r = room.data.get("room") as Room;
    const before = r.commandCount;
    vi.setSystemTime(
      ((room.data.get("room") as Room).bot!.nextDecisionAt ?? Date.now()) + 1,
    );
    await room.live.alarm();
    r = room.data.get("room") as Room;
    if (r.bot!.pendingEnd) {
      vi.setSystemTime(r.bot!.nextDecisionAt! + 1);
      await room.live.alarm();
      r = room.data.get("room") as Room;
    }
    expect(r.commandCount).toBe(before + 1);
    expect(r.bot!.errors).toBe(0);
    expect(r.game!.player.energy).toBeGreaterThanOrEqual(0);
    const identity = structuredClone(r.bot!.identity),
      cards = structuredClone(r.members[1]!.loadout.cards);
    room.live = room.make();
    await room.live.fetch(
      new Request("https://room/connect", {
        method: "POST",
        headers: {
          "X-Pvp-User": String(a.id),
          "X-Pvp-Bot-Protocol": "ranked-bots-1",
        },
        body: "{}",
      }),
    );
    expect((room.data.get("room") as Room).bot!.identity).toEqual(identity);
    expect((room.data.get("room") as Room).members[1]!.loadout.cards).toEqual(
      cards,
    );
  });
  it("concurrent acceptance reserves once; killswitch prevents new IA but not existing rooms", async () => {
    const a = await player("race-bot");
    const q = (await queue(a)).body.queue;
    vi.setSystemTime(Date.now() + 30_000);
    db.sql
      .prepare("UPDATE tactics_ranked_queue SET expires_at=?")
      .run(Date.now() + 20_000);
    const results = await Promise.all([
      call(a.token, "POST", "/ranked/bot", { since: q.since }),
      call(a.token, "POST", "/ranked/bot", { since: q.since }),
    ]);
    const codes = results
      .filter((x) => x.status === 200 && x.body.queue.state === "MATCHED")
      .map((x) => x.body.queue.code);
    expect(new Set(codes).size).toBe(1);
    expect(count("tactics_ranked_bot_encounters")).toBe(1);
    env.RANKED_BOTS_ENABLED = "0";
    expect((await poll(a)).body.queue.state).toBe("MATCHED");
    expect(
      (await call(a.token, "POST", "/ranked/bot", { since: q.since })).status,
    ).toBe(403);
  });
  it("a Casual start cannot race past an existing bot reservation", async () => {
    const a = await player("reserved-bot");
    const q = (await queue(a)).body.queue;
    vi.setSystemTime(Date.now() + 30_000);
    db.sql
      .prepare("UPDATE tactics_ranked_queue SET expires_at=?")
      .run(Date.now() + 20_000);
    await call(a.token, "POST", "/ranked/bot", { since: q.since });
    db.sql
      .prepare(
        "INSERT INTO tactics_pvp_rooms(code,player_a,created_at,expires_at) VALUES(?,?,?,?)",
      )
      .run("CASUALXX", a.id, Date.now(), Date.now() + 90000);
    expect(() =>
      db.sql
        .prepare("UPDATE tactics_pvp_rooms SET started_at=? WHERE code=?")
        .run(Date.now(), "CASUALXX"),
    ).toThrow("IN_MATCH");
    expect(
      db.sql
        .prepare("SELECT started_at FROM tactics_pvp_rooms WHERE code=?")
        .get("CASUALXX")?.started_at,
    ).toBeNull();
  });
  it("caps IA concurrency without blocking a new human pair", async () => {
    env.RANKED_BOTS_MAX_CONCURRENT = "1";
    const a = await player("cap-a"),
      b = await player("cap-b"),
      c = await player("cap-c");
    const qa = (await queue(a)).body.queue;
    vi.setSystemTime(Date.now() + 30_000);
    db.sql
      .prepare("UPDATE tactics_ranked_queue SET expires_at=?")
      .run(Date.now() + 20_000);
    expect(
      (await call(a.token, "POST", "/ranked/bot", { since: qa.since })).status,
    ).toBe(200);
    const qb = (await queue(b)).body.queue;
    vi.setSystemTime(Date.now() + 30_000);
    db.sql
      .prepare(
        "UPDATE tactics_ranked_queue SET expires_at=? WHERE room_code IS NULL",
      )
      .run(Date.now() + 20_000);
    expect(
      (await call(b.token, "POST", "/ranked/bot", { since: qb.since })).status,
    ).toBe(429);
    expect(count("tactics_ranked_bot_encounters")).toBe(1);
    const human = await queue(c);
    expect(human.body.queue.state).toBe("MATCHED");
    expect(
      (rooms.get(human.body.queue.code)!.data.get("room") as Room).bot,
    ).toBeUndefined();
  });
  it("repeated alarms never repeat a decision; repeated planner faults end neutrally", async () => {
    const a = await player("fault-bot");
    const q = (await queue(a)).body.queue;
    vi.setSystemTime(Date.now() + 30_000);
    db.sql
      .prepare("UPDATE tactics_ranked_queue SET expires_at=?")
      .run(Date.now() + 20_000);
    const accepted = await call(a.token, "POST", "/ranked/bot", {
        since: q.since,
      }),
      code = accepted.body.queue.code,
      room = rooms.get(code)!;
    let r = room.data.get("room") as Room;
    r.members[0]!.offlineAt = null;
    room.sockets.push(new FakeSocket(0));
    room.live = room.make();
    await call(a.token, "POST", "/pvp/ready", { code, heroId: "mage" });
    r = room.data.get("room") as Room;
    if (r.game!.duel!.active === 0)
      await room.live.webSocketMessage(
        sock(room.sockets[0]!),
        JSON.stringify({
          type: "command",
          id: "fault-end",
          version: r.version,
          command: { type: "END_TURN" },
        }),
      );
    vi.setSystemTime(
      ((room.data.get("room") as Room).bot!.nextDecisionAt ?? Date.now()) + 1,
    );
    await room.live.alarm();
    r = room.data.get("room") as Room;
    const commands = r.commandCount;
    await room.live.alarm();
    expect((room.data.get("room") as Room).commandCount).toBe(commands);
    r = room.data.get("room") as Room;
    if (r.game!.duel!.active === 0)
      await room.live.webSocketMessage(
        sock(room.sockets[0]!),
        JSON.stringify({
          type: "command",
          id: "fault-end-2",
          version: r.version,
          command: {
            type: "END_TURN",
            discardUid: fallbackDiscardUid(r.game!) ?? undefined,
          },
        }),
      );
    r = room.data.get("room") as Room;
    // This is a separate corrupt-input recovery fixture, not an accepted client command.
    // Normalize its turn through the unchanged engine; previous live plans vary with host load/seed.
    if (r.game!.duel!.active === 0)
      r.game = applyDuel(
        r.game!,
        {
          type: "END_TURN",
          discardUid: fallbackDiscardUid(r.game!) ?? undefined,
        },
        PVP_CONTENT,
      ).state;
    expect(r.game!.duel!.active).toBe(1);
    r.bot!.cpuMs = 0;
    r.bot!.nodes = 0;
    r.bot!.actions = 0;
    r.bot!.nextDecisionAt = Date.now();
    // Fault injection must invalidate a previously planned END_TURN; otherwise it executes
    // against the deliberately removed hero and correctly resolves CHAMPION_DEFEATED.
    delete r.bot!.pendingEnd;
    delete r.bot!.nextDelayMs;
    // Explicit test fault injection: corrupt the visible planning input. Never a product bypass.
    r.game!.units = r.game!.units.filter(
      (u) => u.id !== r.game!.duel!.champions[0],
    );
    room.live = room.make();
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(Date.now() + 1500);
      await room.live.alarm();
    }
    r = room.data.get("room") as Room;
    expect(r.result?.reason).toBe("BOT_SERVER_ERROR");
    expect(r.bot!.outcome).toMatchObject({ rpDelta: 0, xp: 0 });
  });
  it("rejects old IA clients without mutation while accepting the existing version for humans", async () => {
    const a = await player("old-client"),
      other = await player("outsider");
    const q = (await queue(a)).body.queue;
    vi.setSystemTime(Date.now() + 30_000);
    db.sql
      .prepare("UPDATE tactics_ranked_queue SET expires_at=?")
      .run(Date.now() + 20_000);
    const accepted = await call(a.token, "POST", "/ranked/bot", {
        since: q.since,
      }),
      code = accepted.body.queue.code,
      room = rooms.get(code)!;
    const before = JSON.stringify(room.data.get("room"));
    const old = await handle(
      new Request(
        "https://api.test/api/tactics/pvp/connect?clientRelease=thunder-release-2",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + a.token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ code }),
        },
      ),
      env,
      deps,
    );
    expect(old.status).toBe(409);
    expect(await old.json()).toMatchObject({
      error: { code: "CLIENT_UPDATE_REQUIRED" },
    });
    expect(JSON.stringify(room.data.get("room"))).toBe(before);
    const wrong = await handle(
      new Request("https://api.test/api/tactics/pvp/connect", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + other.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      }),
      env,
      deps,
    );
    expect(wrong.status).toBe(403);
    expect((await call(a.token, "POST", "/pvp/connect", { code })).status).toBe(
      200,
    );
    const oldSocket = new FakeSocket(0, "");
    await room.live.webSocketMessage(
      sock(oldSocket),
      JSON.stringify({
        id: "stale",
        version: 2,
        command: { type: "END_TURN" },
      }),
    );
    expect(oldSocket.closed).toBe(true);
    expect((room.data.get("room") as Room).commandCount).toBe(0);
  });
  it("leaving an unstarted IA lobby frees the reservation without RP or XP", async () => {
    const a = await player("cancel-lobby");
    const q = (await queue(a)).body.queue;
    vi.setSystemTime(Date.now() + 30_000);
    db.sql
      .prepare("UPDATE tactics_ranked_queue SET expires_at=?")
      .run(Date.now() + 20_000);
    const accepted = await call(a.token, "POST", "/ranked/bot", {
        since: q.since,
      }),
      code = accepted.body.queue.code;
    expect(count("tactics_match_reservations")).toBe(1);
    expect((await call(a.token, "POST", "/pvp/leave", { code })).status).toBe(
      200,
    );
    expect(count("tactics_match_reservations")).toBe(0);
    expect(count("tactics_ranked_bot_results")).toBe(0);
    expect((await poll(a)).body.queue.state).toBe("IDLE");
    expect((await queue(a)).body.queue.state).toBe("SEARCHING");
  });
  it.each([0, 6])(
    "persistent work budget ends profile %i even without timer progress",
    async (level) => {
      const a = await player("work-cap-" + level),
        q = (await queue(a)).body.queue;
      vi.setSystemTime(Date.now() + 30000);
      db.sql
        .prepare("UPDATE tactics_ranked_queue SET expires_at=?")
        .run(Date.now() + 20000);
      const accepted = await call(a.token, "POST", "/ranked/bot", {
          since: q.since,
        }),
        code = accepted.body.queue.code,
        room = rooms.get(code)!;
      let r = room.data.get("room") as Room;
      r.members[0]!.offlineAt = null;
      room.sockets.push(new FakeSocket(0));
      room.live = room.make();
      await call(a.token, "POST", "/pvp/ready", { code, heroId: "mage" });
      r = room.data.get("room") as Room;
      if (r.game!.duel!.active === 0)
        r.game = applyDuel(
          r.game!,
          {
            type: "END_TURN",
            discardUid: fallbackDiscardUid(r.game!) ?? undefined,
          },
          PVP_CONTENT,
        ).state;
      r.bot!.identity.level = level;
      r.bot!.turn = r.game!.duel!.turns;
      r.bot!.actions = 0;
      r.bot!.cpuMs = 0;
      r.bot!.nodes = botTurnBudget(level).nodes;
      r.bot!.nextDecisionAt = Date.now();
      const commands = r.commandCount;
      room.live = room.make();
      vi.setSystemTime(
        ((room.data.get("room") as Room).bot!.nextDecisionAt ?? Date.now()) + 1,
      );
      await room.live.alarm();
      r = room.data.get("room") as Room;
      if (r.bot!.pendingEnd) {
        vi.setSystemTime(r.bot!.nextDecisionAt! + 1);
        await room.live.alarm();
        r = room.data.get("room") as Room;
      }
      expect(r.commandCount).toBe(commands + 1);
      expect(r.game!.duel!.active).toBe(0);
      expect(r.bot!.cpuMs).toBe(0);
      expect(r.bot!.nodes).toBe(botTurnBudget(level).nodes);
    },
  );
});

// Real Worker routes and room persistence over the existing disposable SQLite/DO fixture.
for (const human of ["mage", "summoner", "shapeshifter"])
  for (const [seed, enemy] of [
    [1, "mage"],
    [2, "shapeshifter"],
    [3, "summoner"],
  ] as const) {
    it(`authoritative ${human} vs ${enemy}: champion, deck, avatar and reconnect agree`, async () => {
      const a = await player("variety-" + human + "-" + enemy);
      // Fixture entitlement only in disposable SQLite; no product bypass or production write.
      if (human === "shapeshifter")
        db.sql
          .prepare(
            "INSERT INTO tactics_champion_unlocks(user_id,hero_id,milestone,unlocked_at) VALUES(?,'shapeshifter','FREE',?)",
          )
          .run(a.id, Date.now());
      const start = await queue(a, human);
      expect(start.status).toBe(200);
      db.sql
        .prepare("UPDATE tactics_ranked_queue SET bot_seed=? WHERE user_id=?")
        .run(seed, a.id);
      vi.setSystemTime(Date.now() + 15_000);
      const offer = (await poll(a)).body.queue;
      expect(offer.botOffer.identity.heroId).toBe(enemy);
      expect((await poll(a)).body.queue.botOffer.identity).toEqual(
        offer.botOffer.identity,
      );
      const accepted = await call(a.token, "POST", "/ranked/bot", {
        since: offer.since,
      });
      expect(accepted.status).toBe(200);
      const code = accepted.body.queue.code,
        room = rooms.get(code)!;
      let r = room.data.get("room") as Room;
      expect(r.members[0]!.loadout.heroId).toBe(human);
      expect(r.members[1]!.loadout.heroId).toBe(enemy);
      expect(r.members[1]!.avatarId).toBe(
        {
          mage: "wizard_blue",
          summoner: "arcane_sigil",
          shapeshifter: "shapeshifter_bear",
        }[enemy],
      );
      for (const entry of r.members[1]!.loadout.cards)
        expect(
          !PVP_CONTENT.cards[entry.cardId]!.heroId ||
            PVP_CONTENT.cards[entry.cardId]!.heroId === enemy,
        ).toBe(true);
      const before = structuredClone(r.bot!.identity),
        deck = structuredClone(r.members[1]!.loadout.cards);
      r.members[0]!.offlineAt = null;
      room.sockets.push(new FakeSocket(0));
      room.live = room.make();
      expect(
        (await call(a.token, "POST", "/pvp/ready", { code, heroId: human }))
          .status,
      ).toBe(200);
      r = room.data.get("room") as Room;
      expect(r.game).not.toBeNull();
      expect(r.game!.player.hand).toHaveLength(5);
      expect(r.game!.duel!.other.hand).toHaveLength(5);
      expect(
        new Set(
          [...r.game!.player.hand, ...r.game!.duel!.other.hand].map(
            (c) => c.uid,
          ),
        ).size,
      ).toBe(10);
      room.live = room.make();
      await room.live.fetch(
        new Request("https://room/connect", {
          method: "POST",
          headers: {
            "X-Pvp-User": String(a.id),
            "X-Pvp-Bot-Protocol": "ranked-bots-1",
          },
          body: "{}",
        }),
      );
      r = room.data.get("room") as Room;
      expect(r.bot!.identity).toEqual(before);
      expect(r.members[1]!.loadout.cards).toEqual(deck);
      expect(r.members[1]!.loadout.heroId).toBe(enemy);
    });
  }

it.each([1, 2, 3])(
  "paces real bot %i commands, preserves alarms across restart and never repeats early",
  async (seed) => {
    const a = await player("tempo-" + seed),
      q = (await queue(a)).body.queue;
    db.sql
      .prepare("UPDATE tactics_ranked_queue SET bot_seed=? WHERE user_id=?")
      .run(seed, a.id);
    vi.setSystemTime(Date.now() + 15000);
    const accepted = await call(a.token, "POST", "/ranked/bot", {
      since: q.since,
    });
    const code = accepted.body.queue.code,
      room = rooms.get(code)!;
    let r = room.data.get("room") as Room;
    r.members[0]!.offlineAt = null;
    room.sockets.push(new FakeSocket(0));
    room.live = room.make();
    if (process.env.BOT_TEMPO_REALTIME)
      vi.setSystemTime(vi.getRealSystemTime());
    vi.spyOn(crypto, "getRandomValues").mockReturnValueOnce(
      new Uint32Array([4321]),
    );
    await call(a.token, "POST", "/pvp/ready", { code, heroId: "mage" });
    r = room.data.get("room") as Room;
    if (r.game!.duel!.active === 0)
      await room.live.webSocketMessage(
        sock(room.sockets[0]!),
        JSON.stringify({
          type: "command",
          id: "tempo-end",
          version: r.version,
          command: {
            type: "END_TURN",
            discardUid: fallbackDiscardUid(r.game!) ?? undefined,
          },
        }),
      );
    r = room.data.get("room") as Room;
    if (process.env.BOT_TEMPO_REALTIME) vi.useRealTimers();
    const start = Date.now(),
      first = r.bot!.nextDecisionAt!;
    expect(first - start).toBeGreaterThanOrEqual(1500);
    expect(first - start).toBeLessThanOrEqual(2500);
    const trace: Array<{
      at: number;
      command: unknown;
      cpu: number;
      nodes: number;
    }> = [];
    for (let i = 0; i < 40 && r.game!.duel!.active === 1 && !r.result; i++) {
      const due = r.bot!.nextDecisionAt!,
        count = r.commandCount,
        credit = r.bot!.pacingCreditMs;
      // Early delivery is verified with the controlled clock; real timers may wake late.
      if (!process.env.BOT_TEMPO_REALTIME) {
        vi.setSystemTime(due - 1);
        await room.live.alarm();
        r = room.data.get("room") as Room;
        expect(r.commandCount).toBe(count);
        expect(r.bot!.pacingCreditMs).toBe(credit);
      }
      room.live = room.make(); // actual storage rehydration between every alarm
      if (process.env.BOT_TEMPO_REALTIME)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, due - Date.now() + 2)),
        );
      else vi.setSystemTime(due + 1);
      await room.live.alarm();
      r = room.data.get("room") as Room;
      if (r.commandCount > count) {
        expect(r.commandCount).toBe(count + 1);
        trace.push({
          at: Date.now() - start,
          command: room.data.get(
            `command:${r.matchId}:${String(r.commandCount).padStart(8, "0")}`,
          ),
          cpu: r.bot!.cpuMs,
          nodes: r.bot!.nodes ?? 0,
        });
      }
      expect(r.bot!.pacingCreditMs).toBeLessThanOrEqual(30000);
      expect(r.bot!.errors).toBe(0);
    }
    expect(r.game!.duel!.active).toBe(0);
    expect(trace.length).toBeGreaterThan(0);
    expect(r.bot!.pendingEnd).toBeUndefined();
    expect(r.bot!.nextDecisionAt).toBeNull();
    const measuredElapsed = Date.now() - start;
    const completed = r.commandCount;
    await room.live.webSocketMessage(
      sock(room.sockets[0]!),
      JSON.stringify({ type: "surrender" }),
    );
    const ended = room.data.get("room") as Room;
    expect(ended.result).toBeTruthy();
    if (!process.env.BOT_TEMPO_REALTIME) vi.setSystemTime(Date.now() + 10000);
    await room.live.alarm();
    expect((room.data.get("room") as Room).commandCount).toBe(completed);
    expect(new Set(r.game!.player.hand.map((c) => c.uid)).size).toBe(
      r.game!.player.hand.length,
    );
    if (process.env.BOT_TEMPO_REPORT)
      writeFileSync(
        process.env.BOT_TEMPO_REPORT + "-" + seed + ".json",
        JSON.stringify(
          {
            hero: r.bot!.identity.heroId,
            seed,
            elapsed: measuredElapsed,
            old450ms: trace.length * 450,
            trace,
          },
          null,
          2,
        ),
      );
    console.info(
      "TEMPO_TRACE",
      JSON.stringify({
        hero: r.bot!.identity.heroId,
        seed,
        elapsed: measuredElapsed,
        old450ms: trace.length * 450,
        trace,
      }),
    );
  },
  20_000,
);
it("cancels a persisted end pause when a result arrives, without replaying its command", async () => {
  const a = await player("tempo-result"),
    q = (await queue(a)).body.queue;
  vi.setSystemTime(Date.now() + 15000);
  const accepted = await call(a.token, "POST", "/ranked/bot", {
      since: q.since,
    }),
    code = accepted.body.queue.code,
    room = rooms.get(code)!;
  let r = room.data.get("room") as Room;
  r.members[0]!.offlineAt = null;
  room.sockets.push(new FakeSocket(0));
  room.live = room.make();
  await call(a.token, "POST", "/pvp/ready", { code, heroId: "mage" });
  r = room.data.get("room") as Room;
  if (r.game!.duel!.active === 0)
    r.game = applyDuel(
      r.game!,
      {
        type: "END_TURN",
        discardUid: fallbackDiscardUid(r.game!) ?? undefined,
      },
      PVP_CONTENT,
    ).state;
  r.bot!.turn = r.game!.duel!.turns;
  r.bot!.nodes = botTurnBudget(r.bot!.identity.level).nodes;
  r.bot!.nextDecisionAt = Date.now();
  room.live = room.make();
  await room.live.alarm();
  r = room.data.get("room") as Room;
  expect(r.bot!.pendingEnd).toBeTruthy();
  const before = r.commandCount;
  room.live = room.make();
  await room.live.webSocketMessage(
    sock(room.sockets[0]!),
    JSON.stringify({ type: "surrender" }),
  );
  vi.setSystemTime(Date.now() + 10000);
  await room.live.alarm();
  r = room.data.get("room") as Room;
  expect(r.result).toBeTruthy();
  expect(r.commandCount).toBe(before);
  expect(r.bot!.pendingEnd).toBeUndefined();
  expect(r.bot!.nextDecisionAt).toBeNull();
});
