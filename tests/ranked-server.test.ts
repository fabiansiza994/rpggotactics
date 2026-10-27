import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONTENT } from '../src/game';
import { handle } from '../server/src/index';
import { PvPMatchRoom, type Room } from '../server/src/pvp';
import { rankedResultStatements } from '../server/src/rankedResults';
import type { Env } from '../server/src/db';
import { RANKED_RULES } from '../src/game/ranked/ranked';
import { addAccount, memoryD1 } from './support/d1';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type DB = ReturnType<typeof memoryD1>;

class FakeSocket {
  closed = false;
  messages: string[] = [];
  constructor(public seat: number) {}
  deserializeAttachment() {
    return { seat: this.seat };
  }
  serializeAttachment() {}
  send(s: string) {
    this.messages.push(s);
  }
  close() {
    this.closed = true;
  }
}
const sock = (s: FakeSocket) => s as unknown as Parameters<PvPMatchRoom['webSocketMessage']>[0];

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
            get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined,
            put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
            setAlarm: async () => {},
            deleteAlarm: async () => {},
          },
          blockConcurrencyWhile: <T>(fn: () => Promise<T>) => {
            const p = fn();
            init = p;
            return p;
          },
          acceptWebSocket: () => {},
          getWebSockets: (tag?: string) => sockets.filter((s) => !s.closed && (tag === undefined || s.seat === Number(tag))),
        };
        const make = () => new PvPMatchRoom(ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], { DB: db });
        const entry: FakeRoom = { data, sockets, make, live: make() };
        rooms.set(key, entry);
        (entry as FakeRoom & { fetch(r: Request): Promise<Response> }).fetch = async (r: Request) => {
          await init;
          return entry.live.fetch(r);
        };
      }
      return rooms.get(key) as unknown as { fetch(r: Request): Promise<Response> };
    },
  };
}

async function call(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await handle(
    new Request(`https://api.test/api/tactics${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    deps,
  );
  return { status: res.status, body: (await res.json()) as Json };
}

async function player(name: string) {
  const account = addAccount(db, name);
  expect((await call(account.token, 'POST', '/profile', {})).status).toBe(200);
  return { ...account, name };
}
type Player = Awaited<ReturnType<typeof player>>;

const queue = (p: Player, heroId = 'mage', extra: Json = {}) => call(p.token, 'POST', '/ranked/queue', { heroId, ...extra });
const poll = (p: Player) => call(p.token, 'GET', '/ranked/queue');
const me = async (p: Player) => (await call(p.token, 'GET', '/ranked/me')).body;
const rpOf = (id: number) => Number(db.sql.prepare('SELECT rp FROM tactics_ranked_players WHERE user_id = ?').get(id)?.rp ?? 0);
const setRp = (id: number, rp: number) =>
  db.sql.prepare("INSERT INTO tactics_ranked_players (user_id, season_id, rp, updated_at) VALUES (?, 'preseason_0', ?, 0)").run(id, rp);
const crystals = (id: number) => Number(db.sql.prepare('SELECT balance FROM tactics_wallets WHERE user_id = ?').get(id)?.balance ?? 0);
const count = (table: string) => Number(db.sql.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);

/** Queue both, then mark both seats connected (stands in for authenticated sockets) and ready. */
async function matched(a: Player, b: Player, heroes: [string, string] = ['mage', 'summoner']) {
  expect((await queue(a, heroes[0])).body.queue.state).toBe('SEARCHING');
  const paired = await queue(b, heroes[1]);
  expect(paired.body.queue.state).toBe('MATCHED');
  const code = paired.body.queue.code as string;
  expect((await poll(a)).body.queue).toEqual({ state: 'MATCHED', code });
  const room = rooms.get(code)!;
  const stored = room.data.get('room') as Room;
  stored.members.forEach((m) => (m.offlineAt = null));
  room.sockets.push(new FakeSocket(0), new FakeSocket(1));
  room.live = room.make();
  return { code, room };
}
async function started(a: Player, b: Player, heroes: [string, string] = ['mage', 'summoner']) {
  const m = await matched(a, b, heroes);
  for (const [p, hero] of [[a, heroes[0]], [b, heroes[1]]] as const)
    expect((await call(p.token, 'POST', '/pvp/ready', { code: m.code, heroId: hero })).status).toBe(200);
  expect((m.room.data.get('room') as Room).game).not.toBeNull();
  return m;
}
const seatOf = (room: FakeRoom, id: number) => (room.data.get('room') as Room).members.findIndex((m) => m.id === id);
async function surrender(room: FakeRoom, loser: Player) {
  await room.live.webSocketMessage(sock(room.sockets[seatOf(room, loser.id)]!), JSON.stringify({ type: 'surrender' }));
}
const view = async (p: Player, code: string) => (await call(p.token, 'POST', '/pvp/connect', { code })).status;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_800_000_000_000);
  db = memoryD1({ legacyProfiles: true });
  for (const f of ['0004_pvp.sql', '0005_pvp_dominion.sql', '0006_pvp_maps.sql', '0009_tactics_social.sql', '0010_pvp_room_started.sql', '0019_tactics_pvp_history.sql'])
    db.sql.exec(readFileSync(new URL(`../server/migrations/${f}`, import.meta.url), 'utf8'));
  env = { DB: db, PVP_ROOMS: namespace(), RANKED_PRESEASON_ENABLED: '1' };
});
afterEach(() => vi.useRealTimers());

describe('ranked queue v0.1 (first available → first paired)', () => {
  it('join, double join keeps one ticket, cancel', async () => {
    const alice = await player('alice');
    const first = await queue(alice);
    expect(first.body.queue).toMatchObject({ state: 'SEARCHING', heroId: 'mage' });
    vi.advanceTimersByTime(1000);
    expect((await queue(alice, 'summoner')).body.queue).toMatchObject({ state: 'SEARCHING', heroId: 'summoner', since: first.body.queue.since });
    expect(count('tactics_ranked_queue')).toBe(1);
    expect((await call(alice.token, 'POST', '/ranked/cancel')).body.queue).toEqual({ state: 'IDLE' });
    expect(count('tactics_ranked_queue')).toBe(0);
  });

  it('a user alone never matches themselves', async () => {
    const alice = await player('alice');
    await queue(alice);
    await queue(alice);
    expect((await poll(alice)).body.queue.state).toBe('SEARCHING');
    expect(rooms.size).toBe(0);
  });

  it('two players pair into one authoritative ranked room, both tickets leave the queue state', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    const { code, room } = await matched(alice, bob);
    const r = room.data.get('room') as Room;
    expect(r.ranked).toEqual({ rp: [0, 0], outcome: null });
    expect(r.members.map((m) => [m.id, m.loadout.heroId])).toEqual([[alice.id, 'mage'], [bob.id, 'summoner']]);
    expect(r.mode).toBe('DUEL');
    // A third account cannot take a seat with the code.
    const carol = await player('carol');
    expect((await call(carol.token, 'POST', '/pvp/join', { code, heroId: 'mage' })).status).toBe(409);
    // No more pairing for an already matched pair.
    expect((await queue(carol)).body.queue.state).toBe('SEARCHING');
  });

  it('expired ticket (client stopped polling = disconnect) is never paired', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    await queue(alice);
    vi.advanceTimersByTime(RANKED_RULES.queueHeartbeatMs + 1);
    expect((await queue(bob)).body.queue.state).toBe('SEARCHING');
    expect((await poll(alice)).body.queue).toEqual({ state: 'IDLE' });
    // The heartbeat keeps a live searcher in.
    await queue(alice);
    vi.advanceTimersByTime(RANKED_RULES.queueHeartbeatMs - 1000);
    await poll(bob);
    expect(rooms.size).toBe(1);
  });

  it('blocked pairs are not paired; a live casual match blocks queueing', async () => {
    const [alice, bob, carol] = [await player('alice'), await player('bob'), await player('carol')];
    db.sql.prepare('INSERT INTO tactics_social_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, 0)').run(bob.id, alice.id);
    await queue(alice);
    expect((await queue(bob)).body.queue.state).toBe('SEARCHING');
    expect((await queue(carol)).body.queue.state).toBe('MATCHED'); // carol ↔ alice (oldest unblocked)
    expect(rooms.size).toBe(1);
    const dave = await player('dave');
    db.sql.prepare('INSERT INTO tactics_pvp_rooms (code, player_a, player_b, created_at, expires_at, started_at) VALUES (?,?,?,?,?,?)').run('CASUAL22', dave.id, carol.id, Date.now(), Date.now() + 3600_000, Date.now());
    expect((await queue(dave)).status).toBe(409);
  });

  it('identity and loadout come from the session/profile: client ids, RP and decks are ignored', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    await queue(alice, 'mage', { userId: bob.id, rp: 9999, loadout: { heroId: 'mage', cards: [] } });
    const paired = await queue(bob, 'summoner', { winner: bob.id, rpDelta: 500 });
    const r = rooms.get(paired.body.queue.code)!.data.get('room') as Room;
    expect(r.ranked!.rp).toEqual([0, 0]);
    expect(r.members.map((m) => m.id)).toEqual([alice.id, bob.id]);
    expect(r.members[0]!.loadout.cards.reduce((n, e) => n + e.count, 0)).toBe(30); // stored deck, not the forged one
    expect((await me(alice)).rp).toBe(0);
    expect((await me(bob)).rp).toBe(0);
  });

  it('flag off: queue refused, profile reports disabled', async () => {
    const alice = await player('alice');
    env = { ...env, RANKED_PRESEASON_ENABLED: undefined };
    expect(await me(alice)).toEqual({ enabled: false });
    expect((await queue(alice)).status).toBe(403);
  });
});

describe('ranked results (server-decided, applied once per matchId)', () => {
  it('win +20 / loss −12 at 0 floor, history marks RANKED with the deltas, me() shows record', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    setRp(alice.id, 850);
    const { room, code } = await started(alice, bob);
    await surrender(room, bob);
    expect(rpOf(alice.id)).toBe(870);
    expect(rpOf(bob.id)).toBe(0);
    const outcome = (room.data.get('room') as Room).ranked!.outcome!;
    expect(outcome[0]).toMatchObject({ outcome: 'WIN', rpBefore: 850, rpAfter: 870, rpDelta: 20, capped: false });
    expect(outcome[1]).toMatchObject({ outcome: 'LOSS', rpBefore: 0, rpAfter: 0, rpDelta: 0 });
    const history = (await call(alice.token, 'GET', '/pvp/history')).body.matches[0];
    expect(history).toMatchObject({ queue: 'RANKED', ranked: { rpBefore: 850, rpAfter: 870, rpDelta: 20, capped: false } });
    const profile = await me(alice);
    expect(profile).toMatchObject({ enabled: true, rp: 870, wins: 1, losses: 0, queue: { state: 'IDLE' } });
    const text = JSON.stringify(profile);
    for (const leak of ['user_id', 'opponent', 'email', 'token', 'password']) expect(text).not.toContain(leak);
    expect(await view(alice, code)).toBe(200); // finished room still readable
    // Rematch is not allowed in ranked.
    expect((await call(alice.token, 'POST', '/pvp/rematch', { code, heroId: 'mage' })).status).toBe(409);
  });

  it('duplicate completion: repeated surrender, alarm retry, DO restart and a re-run batch change nothing', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    const { room } = await started(alice, bob);
    await surrender(room, alice);
    await surrender(room, alice);
    await room.make().alarm();
    const r = room.data.get('room') as Room;
    await db.batch(rankedResultStatements(db, { matchId: r.matchId, players: [alice.id, bob.id], winner: alice.id, reason: 'CHAMPION_DEFEATED', finishedAt: Date.now() }));
    expect(rpOf(bob.id)).toBe(20);
    expect(count('tactics_ranked_results')).toBe(2);
    expect((await me(bob)).wins).toBe(1);
  });

  it('rank up crosses into Bronze and pays the one-time milestone once; rank down demotes', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    setRp(alice.id, 290);
    setRp(bob.id, 305);
    const { room } = await started(alice, bob);
    await surrender(room, bob);
    expect(rpOf(alice.id)).toBe(310); // Hierro I → Bronce III
    expect(rpOf(bob.id)).toBe(293); // Bronce III → Hierro I
    expect(crystals(alice.id)).toBe(50);
    expect((room.data.get('room') as Room).ranked!.outcome![0]!.milestones).toEqual([{ tierId: 'BRONZE', crystals: 50 }]);
    expect((await me(alice)).milestones).toEqual(['BRONZE']);
    await room.make().alarm(); // retry
    expect(crystals(alice.id)).toBe(50);
    // Fall back under Bronze and climb again: the milestone is not paid a second time.
    db.sql.prepare('UPDATE tactics_ranked_players SET rp = 290 WHERE user_id = ?').run(alice.id);
    const carol = await player('carol');
    const again = await started(alice, carol);
    await surrender(again.room, carol);
    expect(rpOf(alice.id)).toBe(310);
    expect(crystals(alice.id)).toBe(50);
    expect(Number(db.sql.prepare("SELECT count(*) AS n FROM tactics_wallet_ledger WHERE reason = 'RANKED_MILESTONE'").get()!.n)).toBe(1);
  });

  it('abandon: walking out of a live match costs −20; the timeout window decides disconnects', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    setRp(alice.id, 100);
    const { code } = await started(alice, bob);
    expect((await call(alice.token, 'POST', '/pvp/leave', { code })).status).toBe(200);
    expect(rpOf(alice.id)).toBe(80);
    expect(rpOf(bob.id)).toBe(20);
    expect(db.sql.prepare('SELECT outcome FROM tactics_ranked_results WHERE user_id = ?').get(alice.id)).toEqual({ outcome: 'ABANDON' });
  });

  it('reconnect inside the window is not punished; a confirmed disconnect is an abandon', async () => {
    const [alice, bob, carol] = [await player('alice'), await player('bob'), await player('carol')];
    setRp(alice.id, 100);
    const first = await started(alice, bob);
    const a = first.room.sockets[seatOf(first.room, alice.id)]!;
    a.closed = true;
    await first.room.live.webSocketClose(sock(a));
    vi.advanceTimersByTime(30_000);
    await first.room.live.alarm();
    expect((first.room.data.get('room') as Room).result).toBeNull();
    // Back online (new authenticated socket) and the match ends normally: a plain loss.
    (first.room.data.get('room') as Room).members.forEach((m) => (m.offlineAt = null));
    first.room.sockets.push(new FakeSocket(seatOf(first.room, alice.id)));
    first.room.live = first.room.make();
    await surrender(first.room, alice);
    expect(db.sql.prepare('SELECT outcome, rp_delta FROM tactics_ranked_results WHERE user_id = ?').get(alice.id)).toEqual({ outcome: 'LOSS', rp_delta: -12 });
    expect(rpOf(alice.id)).toBe(88);
    // Second match: carol drops and never returns → OPPONENT_DISCONNECTED → carol ABANDON.
    const second = await started(alice, carol);
    const c = second.room.sockets[seatOf(second.room, carol.id)]!;
    c.closed = true;
    await second.room.live.webSocketClose(sock(c));
    vi.advanceTimersByTime(61_000);
    await second.room.live.alarm();
    expect(db.sql.prepare('SELECT outcome, rp_delta FROM tactics_ranked_results WHERE user_id = ?').get(carol.id)).toEqual({ outcome: 'ABANDON', rp_delta: 0 });
    expect(rpOf(alice.id)).toBe(108);
  });

  it('anti-farm: after 3 rated games vs the same rival in 24 h the match counts but RP does not', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    for (let i = 0; i < 4; i++) {
      const { room } = await started(alice, bob);
      await surrender(room, alice);
      vi.advanceTimersByTime(60_000);
    }
    expect(rpOf(bob.id)).toBe(60);
    expect(db.sql.prepare('SELECT capped, rp_delta FROM tactics_ranked_results WHERE user_id = ? ORDER BY finished_at').all(bob.id).map((r) => [r.capped, r.rp_delta])).toEqual([
      [0, 20], [0, 20], [0, 20], [1, 0],
    ]);
    vi.advanceTimersByTime(RANKED_RULES.pairWindowMs);
    const { room } = await started(alice, bob);
    await surrender(room, alice);
    expect(rpOf(bob.id)).toBe(80);
  });

  it('casual matches never touch RP; the ranked lobby keeps the queued champion; no-show expires without RP', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    const created = await call(alice.token, 'POST', '/pvp/create', { heroId: 'mage' });
    expect(created.status).toBe(200);
    expect((await call(bob.token, 'POST', '/pvp/join', { code: created.body.code, heroId: 'summoner' })).status).toBe(200);
    const casual = rooms.get(created.body.code)!;
    (casual.data.get('room') as Room).members.forEach((m) => (m.offlineAt = null));
    casual.sockets.push(new FakeSocket(0), new FakeSocket(1));
    casual.live = casual.make();
    await call(alice.token, 'POST', '/pvp/ready', { code: created.body.code, heroId: 'mage' });
    await call(bob.token, 'POST', '/pvp/ready', { code: created.body.code, heroId: 'summoner' });
    await surrender(casual, alice);
    expect(count('tactics_pvp_match_players')).toBe(2);
    expect(count('tactics_ranked_results')).toBe(0);
    expect((await call(bob.token, 'GET', '/pvp/history')).body.matches[0]).toMatchObject({ queue: 'CASUAL', ranked: null });

    const { code, room } = await matched(alice, bob);
    expect((await call(alice.token, 'POST', '/pvp/ready', { code, heroId: 'summoner' })).status).toBe(409);
    vi.advanceTimersByTime(RANKED_RULES.lobbyMs + 1);
    await room.live.alarm();
    expect(count('tactics_ranked_results')).toBe(0);
    expect((await poll(alice)).body.queue).toEqual({ state: 'IDLE' });
    // Stats filter: Casual/Ranked split.
    expect((await call(bob.token, 'GET', '/pvp/stats?queue=RANKED')).body.overall.matches).toBe(0);
    expect((await call(bob.token, 'GET', '/pvp/stats?queue=CASUAL')).body.overall.matches).toBe(1);
  });
});
