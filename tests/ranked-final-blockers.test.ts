import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { COSMETICS, DEFAULT_CONTENT, STORE_CATALOG } from '../src/game';
import { RANKED_COSMETICS, RANKED_TRACK } from '../src/game/ranked/rewardTrack';
import { equippableCosmetics, RANKED_EQUIPPABLE } from '../src/game/ranked/rankedCosmetics';
import { handle } from '../server/src/index';
import { PvPMatchRoom, type Room } from '../server/src/pvp';
import type { Env } from '../server/src/db';
import { addAccount, memoryD1 } from './support/d1';

/**
 * Final Ranked release blockers (qa/ranked-final/REPORT.md):
 * 1. Ranked Reward Track cosmetics equip through the existing cosmetics slots (server-validated).
 * 2. Abandon resolution reaches the winner: pushed snapshot, authoritative /pvp/state read, ping/pong
 *    version probe; results stay idempotent. Same harness as tests/ranked-track-server.test.ts.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type DB = ReturnType<typeof memoryD1>;

class FakeSocket {
  closed = false;
  dead = false;
  sent: Json[] = [];
  constructor(public seat: number) {}
  deserializeAttachment() {
    return { seat: this.seat };
  }
  serializeAttachment() {}
  send(data: string) {
    if (this.dead) throw Error('socket gone');
    this.sent.push(JSON.parse(data));
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
        const ctx = {
          storage: {
            get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined,
            put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
            setAlarm: async () => {},
            deleteAlarm: async () => {},
          },
          blockConcurrencyWhile: <T>(fn: () => Promise<T>) => fn(),
          acceptWebSocket: () => {},
          getWebSockets: (tag?: string) => sockets.filter((s) => !s.closed && (tag === undefined || s.seat === Number(tag))),
        };
        const make = () => new PvPMatchRoom(ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], env);
        const entry: FakeRoom = { data, sockets, make, live: make() };
        rooms.set(key, entry);
        (entry as FakeRoom & { fetch(r: Request): Promise<Response> }).fetch = async (r: Request) => {
          await Promise.resolve();
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

const setRp = (id: number, rp: number) =>
  db.sql.prepare("INSERT INTO tactics_ranked_players (user_id, season_id, rp, updated_at) VALUES (?, 'preseason_0', ?, 0) ON CONFLICT (user_id, season_id) DO UPDATE SET rp = excluded.rp").run(id, rp);
const rpOf = (id: number) => Number(db.sql.prepare('SELECT rp FROM tactics_ranked_players WHERE user_id = ?').get(id)?.rp ?? 0);
const count = (q: string, ...args: (string | number)[]) => Number((db.sql.prepare(q).get(...args) as { n: number }).n);
const ownedIds = (id: number) => (db.sql.prepare('SELECT cosmetic_id FROM tactics_player_cosmetics WHERE user_id = ? ORDER BY cosmetic_id').all(id) as Json[]).map((r) => r.cosmetic_id);
/** Owns a Ranked cosmetic exactly as the track grants it (0025 trigger → tactics_player_cosmetics). */
function grant(userId: number, cosmeticId: string) {
  const node = RANKED_TRACK.find((n) => n.items.some((i) => i.cosmeticId === cosmeticId))!;
  const item = node.items.find((i) => i.cosmeticId === cosmeticId)!;
  db.sql
    .prepare(
      `INSERT INTO tactics_ranked_rewards (user_id, season_id, reward_id, node_id, required_rp, reward_type, item_id, item_kind, hero_id, quantity, granted, match_id, granted_at)
       VALUES (?, ?, ?, ?, ?, 'COSMETIC', ?, ?, NULL, 1, 1, 'TEST', 1)`,
    )
    .run(userId, item.seasonId, item.rewardId, node.nodeId, node.requiredRp, cosmeticId, item.cosmeticKind!);
}
const equip = (p: Player, slot: string, cosmeticId: string | null) => call(p.token, 'PUT', '/cosmetics/equip', { slot, cosmeticId });

async function started(a: Player, b: Player, rounds = 3) {
  expect((await call(a.token, 'POST', '/ranked/queue', { heroId: 'mage' })).body.queue.state).toBe('SEARCHING');
  const paired = await call(b.token, 'POST', '/ranked/queue', { heroId: 'summoner' });
  expect(paired.body.queue.state).toBe('MATCHED');
  const code = paired.body.queue.code as string;
  const room = rooms.get(code)!;
  const stored = room.data.get('room') as Room;
  stored.members.forEach((m) => (m.offlineAt = null));
  room.sockets.push(new FakeSocket(0), new FakeSocket(1));
  room.live = room.make();
  for (const [p, hero] of [[a, 'mage'], [b, 'summoner']] as const)
    expect((await call(p.token, 'POST', '/pvp/ready', { code, heroId: hero })).status).toBe(200);
  const live = room.data.get('room') as Room;
  live.game!.round = rounds;
  room.live = room.make();
  return { code, room };
}
const seatOf = (room: FakeRoom, id: number) => (room.data.get('room') as Room).members.findIndex((m) => m.id === id);
const socketOf = (room: FakeRoom, p: Player) => room.sockets[seatOf(room, p.id)]!;
const ws = (s: FakeSocket) => s as unknown as Parameters<PvPMatchRoom['webSocketMessage']>[0];
const results = (matchId: string) => count('SELECT count(*) AS n FROM tactics_ranked_results WHERE match_id = ?', matchId);
const matchId = (room: FakeRoom) => (room.data.get('room') as Room).matchId;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_800_000_000_000);
  db = memoryD1({ legacyProfiles: true });
  for (const f of ['0004_pvp.sql', '0005_pvp_dominion.sql', '0006_pvp_maps.sql', '0009_tactics_social.sql', '0010_pvp_room_started.sql', '0019_tactics_pvp_history.sql'])
    db.sql.exec(readFileSync(new URL(`../server/migrations/${f}`, import.meta.url), 'utf8'));
  env = {
    DB: db,
    PVP_ROOMS: namespace(),
    RANKED_PRESEASON_ENABLED: '1',
    MASTERY_ENABLED: '1',
    ARCHER_ENABLED: '1',
    SHAPESHIFTER_ENABLED: '1',
  } as Env;
});
afterEach(() => vi.useRealTimers());

describe('Ranked cosmetics: catalog', () => {
  it('the six Reward Track ids, unchanged, each with an equippable slot; never in the store registry or offers', () => {
    expect(Object.keys(RANKED_COSMETICS).sort()).toEqual([
      'badge_ranked_diamond_victory',
      'crest_ranked_apex_preseason_0',
      'crest_ranked_platinum',
      'frame_ranked_diamond_facet',
      'frame_ranked_gold_duelist',
      'ranked_emblem_preseason_0',
    ]);
    for (const c of Object.values(RANKED_COSMETICS)) expect(RANKED_EQUIPPABLE[c.id]).toMatchObject({ id: c.id, kind: c.kind });
    for (const id of Object.keys(RANKED_COSMETICS)) {
      expect(COSMETICS[id]).toBeUndefined();
      expect(STORE_CATALOG.some((o) => o.contents.some((c) => c.kind === 'COSMETIC' && c.cosmeticId === id))).toBe(false);
    }
    // Store cosmetics stay equippable through the same registry.
    expect(equippableCosmetics().frame_arcane_gilt?.kind).toBe('PROFILE_FRAME');
  });
});

describe('Ranked cosmetics: equip (server-authoritative)', () => {
  it('a locked (not owned) cosmetic cannot be equipped', async () => {
    const alice = await player('alice');
    const r = await equip(alice, 'RANKED_CREST', 'crest_ranked_platinum');
    expect(r.status).toBe(403);
    expect(count("SELECT count(*) AS n FROM tactics_equipped_cosmetics WHERE user_id = ?", alice.id)).toBe(0);
  });

  it('an owned cosmetic equips into its slot and survives a reload and a new login', async () => {
    const alice = await player('alice');
    grant(alice.id, 'frame_ranked_gold_duelist');
    const r = await equip(alice, 'PROFILE_FRAME', 'frame_ranked_gold_duelist');
    expect(r.status).toBe(200);
    expect(r.body.equipped.PROFILE_FRAME).toBe('frame_ranked_gold_duelist');
    expect(r.body.owned.map((c: Json) => c.cosmeticId)).toContain('frame_ranked_gold_duelist');
    // Reload: a fresh read. Logout/login: another session of the same account.
    expect((await call(alice.token, 'GET', '/cosmetics')).body.equipped.PROFILE_FRAME).toBe('frame_ranked_gold_duelist');
    db.sql.prepare("INSERT INTO sessions (token, username, created_at, expires_at) VALUES ('token-alice-2', 'alice', 0, 4000000000000)").run();
    expect((await call('token-alice-2', 'GET', '/cosmetics')).body.equipped).toMatchObject({ PROFILE_FRAME: 'frame_ranked_gold_duelist', RANKED_CREST: null, VICTORY_BADGE: null });
  });

  it('invalid / unknown ids and client-invented slots are rejected', async () => {
    const alice = await player('alice');
    grant(alice.id, 'ranked_emblem_preseason_0');
    expect((await equip(alice, 'RANKED_CREST', 'crest_ranked_bogus')).status).toBe(404);
    expect((await equip(alice, 'RANKED_CREST', 'DROP TABLE;')).status).toBe(400);
    expect((await equip(alice, 'RANKED_CREST', 42 as unknown as string)).status).toBe(400);
    expect((await equip(alice, 'RANKED_BANNER', 'ranked_emblem_preseason_0')).status).toBe(400);
    expect((await equip(alice, 'SUMMON_SKIN:fox', 'ranked_emblem_preseason_0')).status).toBe(400);
  });

  it('a cosmetic in the wrong slot is rejected even when owned', async () => {
    const alice = await player('alice');
    grant(alice.id, 'frame_ranked_gold_duelist');
    grant(alice.id, 'badge_ranked_diamond_victory');
    expect((await equip(alice, 'RANKED_CREST', 'frame_ranked_gold_duelist')).status).toBe(400);
    expect((await equip(alice, 'PROFILE_FRAME', 'badge_ranked_diamond_victory')).status).toBe(400);
    expect((await equip(alice, 'VICTORY_BADGE', 'badge_ranked_diamond_victory')).body.equipped.VICTORY_BADGE).toBe('badge_ranked_diamond_victory');
  });

  it('switching inside a slot replaces it; unequip empties it; ownership never changes', async () => {
    const alice = await player('alice');
    for (const id of ['ranked_emblem_preseason_0', 'crest_ranked_platinum', 'frame_ranked_gold_duelist', 'frame_ranked_diamond_facet']) grant(alice.id, id);
    const before = ownedIds(alice.id);
    expect(before).toHaveLength(4);
    await equip(alice, 'RANKED_CREST', 'ranked_emblem_preseason_0');
    const swapped = await equip(alice, 'RANKED_CREST', 'crest_ranked_platinum');
    expect(swapped.body.equipped.RANKED_CREST).toBe('crest_ranked_platinum');
    await equip(alice, 'PROFILE_FRAME', 'frame_ranked_gold_duelist');
    expect((await equip(alice, 'PROFILE_FRAME', 'frame_ranked_diamond_facet')).body.equipped.PROFILE_FRAME).toBe('frame_ranked_diamond_facet');
    // A Ranked frame and a store frame share PROFILE_FRAME (one shown at a time).
    expect(count("SELECT count(*) AS n FROM tactics_equipped_cosmetics WHERE user_id = ? AND slot = 'RANKED_CREST'", alice.id)).toBe(1);
    const off = await equip(alice, 'RANKED_CREST', null);
    expect(off.status).toBe(200);
    expect(off.body.equipped.RANKED_CREST).toBeNull();
    expect(ownedIds(alice.id)).toEqual(before);
    expect(off.body.owned.map((c: Json) => c.cosmeticId).sort()).toEqual(before);
  });

  it('PvP members carry the SERVER-resolved frame/crest/badge; a client cannot spoof them', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    for (const id of ['frame_ranked_diamond_facet', 'crest_ranked_apex_preseason_0', 'badge_ranked_diamond_victory']) grant(alice.id, id);
    await equip(alice, 'PROFILE_FRAME', 'frame_ranked_diamond_facet');
    await equip(alice, 'RANKED_CREST', 'crest_ranked_apex_preseason_0');
    await equip(alice, 'VICTORY_BADGE', 'badge_ranked_diamond_victory');
    const created = await call(alice.token, 'POST', '/pvp/create', { heroId: 'mage' });
    const joined = await call(bob.token, 'POST', '/pvp/join', {
      code: created.body.code,
      heroId: 'summoner',
      frameId: 'frame_ranked_gold_duelist',
      crestId: 'crest_ranked_apex_preseason_0',
      badgeId: 'badge_ranked_diamond_victory',
    });
    expect(joined.body.members[0]).toMatchObject({ frameId: 'frame_ranked_diamond_facet', crestId: 'crest_ranked_apex_preseason_0', badgeId: 'badge_ranked_diamond_victory' });
    expect(joined.body.members[1]).toMatchObject({ frameId: null, crestId: null, badgeId: null });
    // Ranked rooms resolve the same way through the queue.
    const { room } = await started(alice, bob);
    const members = (room.data.get('room') as Room).members;
    expect(members[seatOf(room, alice.id)]).toMatchObject({ crestId: 'crest_ranked_apex_preseason_0', badgeId: 'badge_ranked_diamond_victory' });
  });

  it('titles and cosmetics stay separate systems (equipping one never touches the other)', async () => {
    const alice = await player('alice');
    grant(alice.id, 'ranked_emblem_preseason_0');
    const titlesBefore = count('SELECT count(*) AS n FROM tactics_profile_titles WHERE user_id = ?', alice.id);
    await equip(alice, 'RANKED_CREST', 'ranked_emblem_preseason_0');
    expect(count('SELECT count(*) AS n FROM tactics_profile_titles WHERE user_id = ?', alice.id)).toBe(titlesBefore);
    expect((await call(alice.token, 'PUT', '/mastery/title', { titleId: 'ranked_emblem_preseason_0' })).status).not.toBe(200);
  });
});

describe('Ranked abandon: the winner gets the authoritative result', () => {
  it('A. normal surrender: one result, winner WIN +20 pushed once', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    const { room } = await started(alice, bob);
    await room.live.webSocketMessage(ws(socketOf(room, bob)), JSON.stringify({ type: 'surrender' }));
    const last = socketOf(room, alice).sent.filter((m) => m.type === 'snapshot').at(-1)!;
    expect(last.result.reason).toBe('SURRENDER');
    expect(last.ranked.outcome).toMatchObject({ outcome: 'WIN', rpBefore: 0, rpAfter: 20, rpDelta: 20 });
    expect(results(matchId(room))).toBe(2);
  });

  it('B. disconnect + timeout: no result inside the window, OPPONENT_DISCONNECTED after it (abandon rules unchanged)', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    setRp(bob.id, 50);
    const { room } = await started(alice, bob);
    await room.live.webSocketClose(ws(socketOf(room, bob)));
    vi.setSystemTime(Date.now() + 59_000);
    await room.live.alarm();
    expect((room.data.get('room') as Room).result).toBeNull();
    vi.setSystemTime(Date.now() + 2_000);
    await room.live.alarm();
    const r = room.data.get('room') as Room;
    expect(r.result!.reason).toBe('OPPONENT_DISCONNECTED');
    expect(r.ranked!.outcome![seatOf(room, alice.id)]).toMatchObject({ outcome: 'WIN', rpDelta: 20 });
    expect(r.ranked!.outcome![seatOf(room, bob.id)]).toMatchObject({ outcome: 'ABANDON', rpBefore: 50, rpAfter: 30, rpDelta: -20 });
    expect(socketOf(room, alice).sent.filter((m) => m.type === 'snapshot').at(-1)!.result.reason).toBe('OPPONENT_DISCONNECTED');
  });

  it('C. reconnect before the timeout: never resolved as an abandon', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    const { room } = await started(alice, bob);
    await room.live.webSocketClose(ws(socketOf(room, bob)));
    vi.setSystemTime(Date.now() + 30_000);
    // Back inside the window (what /pvp/socket does on accept: offlineAt = null).
    const r = room.data.get('room') as Room;
    r.members[seatOf(room, bob.id)]!.offlineAt = null;
    room.live = room.make();
    vi.setSystemTime(Date.now() + 120_000);
    await room.live.alarm();
    expect((room.data.get('room') as Room).result).toBeNull();
    expect(results(matchId(room))).toBe(0);
    expect(rpOf(bob.id)).toBe(0);
  });

  it('D + H. /leave mid-match: the winner socket receives result, victory, RP before/after, reward unlocks; history + mastery once', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    setRp(alice.id, 85);
    setRp(bob.id, 40);
    const { code, room } = await started(alice, bob);
    const left = await call(bob.token, 'POST', '/pvp/leave', { code });
    expect(left.status).toBe(200);
    expect(socketOf(room, bob).closed).toBe(true);
    const snap = socketOf(room, alice).sent.filter((m) => m.type === 'snapshot').at(-1)!;
    expect(snap.result).toEqual({ winner: seatOf(room, alice.id), reason: 'ABANDONED' });
    expect(snap.deadline).toBeNull();
    expect(snap.ranked.outcome).toMatchObject({ outcome: 'WIN', rpBefore: 85, rpAfter: 105, rpDelta: 20 });
    expect(snap.ranked.outcome.rewards.map((x: Json) => x.rewardId)).toEqual(['rt.preseason_0.IRON_III.emblem', 'rt.preseason_0.IRON_II.card']);
    expect(rpOf(bob.id)).toBe(20); // ABANDON −20, rule unchanged
    const id = matchId(room);
    expect(count('SELECT count(*) AS n FROM tactics_pvp_matches WHERE match_id = ?', id)).toBe(1);
    expect(count('SELECT count(*) AS n FROM tactics_pvp_match_players WHERE match_id = ?', id)).toBe(2);
    expect(count('SELECT count(*) AS n FROM tactics_mastery_ledger WHERE reference_id = ? AND user_id = ?', id, alice.id)).toBeGreaterThan(0);
  });

  it('E + G. winner socket dead at resolution: /pvp/state (refresh / fallback) returns the same result; ping reports the newer version', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    const { code, room } = await started(alice, bob);
    const dead = socketOf(room, alice);
    const seen = (room.data.get('room') as Room).version;
    dead.dead = true; // half-open: every push to the winner is lost
    await call(bob.token, 'POST', '/pvp/leave', { code });
    expect(dead.sent.some((m) => m.result)).toBe(false);
    const state = await call(alice.token, 'GET', `/pvp/state?code=${code}`);
    expect(state.status).toBe(200);
    expect(state.body.result).toEqual({ winner: seatOf(room, alice.id), reason: 'ABANDONED' });
    expect(state.body.ranked.outcome).toMatchObject({ outcome: 'WIN', rpDelta: 20 });
    // Refresh after the result: same answer, still one result per player.
    const again = await call(alice.token, 'GET', `/pvp/state?code=${code}`);
    expect(again.body.ranked.outcome).toEqual(state.body.ranked.outcome);
    // A fresh socket's ping returns the authoritative version (> what the stale client rendered).
    const fresh = new FakeSocket(seatOf(room, alice.id));
    room.sockets.push(fresh);
    await room.live.webSocketMessage(ws(fresh), JSON.stringify({ type: 'ping' }));
    expect(fresh.sent).toEqual([{ type: 'pong', version: (room.data.get('room') as Room).version }]);
    expect(fresh.sent[0]!.version).toBeGreaterThan(seen);
    // The rival never sees the winner's private state through /pvp/state: own seat only.
    expect((await call(bob.token, 'GET', `/pvp/state?code=${code}`)).body.ranked.outcome.outcome).toBe('ABANDON');
    expect(results(matchId(room))).toBe(2);
  });

  it('F + I. duplicate leave / surrender / alarm / re-read after the result: RP, rewards, history, mastery exactly once', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    setRp(alice.id, 85);
    const { code, room } = await started(alice, bob);
    await call(bob.token, 'POST', '/pvp/leave', { code });
    const snapshot = () => ({
      rp: [rpOf(alice.id), rpOf(bob.id)],
      results: results(matchId(room)),
      rewards: count('SELECT count(*) AS n FROM tactics_ranked_rewards WHERE user_id = ?', alice.id),
      cards: count('SELECT count(*) AS n FROM tactics_player_cards WHERE user_id = ? AND source = ?', alice.id, 'RANKED_TRACK'),
      cosmetics: count('SELECT count(*) AS n FROM tactics_player_cosmetics WHERE user_id = ?', alice.id),
      history: count('SELECT count(*) AS n FROM tactics_pvp_match_players WHERE match_id = ?', matchId(room)),
      mastery: count('SELECT count(*) AS n FROM tactics_mastery_ledger WHERE reference_id = ?', matchId(room)),
      wallet: count('SELECT count(*) AS n FROM tactics_wallet_ledger WHERE user_id = ?', alice.id),
    });
    const once = snapshot();
    expect(once.rp).toEqual([105, 0]);
    await call(bob.token, 'POST', '/pvp/leave', { code });
    await call(alice.token, 'POST', '/pvp/leave', { code });
    await room.live.webSocketMessage(ws(socketOf(room, alice)), JSON.stringify({ type: 'surrender' }));
    await room.make().alarm();
    await call(alice.token, 'GET', `/pvp/state?code=${code}`);
    await call(alice.token, 'GET', '/ranked/me');
    await call(alice.token, 'GET', '/ranked/track');
    await call(alice.token, 'GET', '/state');
    expect(snapshot()).toEqual(once);
    // Only one result frame: later pushes repeat the same terminal state, never a new outcome.
    const outcomes = socketOf(room, alice).sent.filter((m) => m.ranked?.outcome).map((m) => JSON.stringify(m.ranked.outcome));
    expect(new Set(outcomes).size).toBe(1);
  });
});
