import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_CONTENT } from "../src/game";
import { handle } from "../server/src/index";
import { PvPMatchRoom } from "../server/src/pvp";
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
  // Positive API cases model the current explicit-accept client; legacy cases override this marker.
  if (path === "/ranked/bot" && typeof body === "object" && body !== null)
    body = { acceptance: "MANUAL", ...body };
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


it('does not auto-match before 15s, automatically reserves exactly one bot at 15s across concurrent retries',async()=>{
 const a=await player('auto-boundary');await queue(a);vi.setSystemTime(Date.now()+14999);expect((await poll(a)).body.queue.state).toBe('SEARCHING');expect(rooms.size).toBe(0);
 vi.setSystemTime(Date.now()+1);const res=await Promise.all([poll(a),poll(a),poll(a)]);const codes=res.filter(r=>r.body.queue.state==='MATCHED').map(r=>r.body.queue.code);expect(codes.length).toBeGreaterThan(0);expect(new Set(codes).size).toBe(1);expect(rooms.size).toBe(1);expect(count('tactics_match_reservations')).toBe(1);
 expect((await poll(a)).body.queue.code).toBe(codes[0]);
});
it('human pairing before deadline retains priority and creates no bot reservation',async()=>{
 const a=await player('auto-human-a'),b=await player('auto-human-b');await queue(a);vi.setSystemTime(Date.now()+14999);const r=await queue(b);expect(r.body.queue.state).toBe('MATCHED');expect((await poll(a)).body.queue.code).toBe(r.body.queue.code);expect(count('tactics_match_reservations')).toBe(0);
});
it('cancelled ticket cannot create a bot from a delayed poll or legacy acceptance request',async()=>{
 const a=await player('auto-cancel');const q=(await queue(a)).body.queue;await call(a.token,'POST','/ranked/cancel',{});vi.setSystemTime(Date.now()+16000);expect((await poll(a)).body.queue.state).toBe('IDLE');await call(a.token,'POST','/ranked/bot',{since:q.since});expect(rooms.size).toBe(0);
});
it('cancel concurrent with automatic allocation leaves at most one reservation and no duplicate rooms',async()=>{
 const a=await player('auto-race');await queue(a);vi.setSystemTime(Date.now()+15000);await Promise.all([poll(a),call(a.token,'POST','/ranked/cancel',{}),poll(a)]);expect(rooms.size).toBeLessThanOrEqual(1);expect(count('tactics_match_reservations')).toBeLessThanOrEqual(1);
});
it('bots OFF and release drain still prevent automatic allocation',async()=>{
 const a=await player('auto-off');await queue(a);vi.setSystemTime(Date.now()+15000);env.RANKED_BOTS_ENABLED='0';expect((await poll(a)).body.queue.state).toBe('SEARCHING');expect(rooms.size).toBe(0);
 env.RANKED_BOTS_ENABLED='1';env.CONTENT_RELEASE_DRAIN='1';const r=await poll(a);expect(r.status).not.toBe(200);expect(rooms.size).toBe(0);
});
