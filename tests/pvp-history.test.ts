import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createProfile, DEFAULT_CONTENT } from '../src/game';
import { validateLoadout } from '../src/game/pvp/duel';
import { PvPMatchRoom, type Room } from '../server/src/pvp';
import { handle } from '../server/src/index';
import { matchPlayerStatements, HISTORY_PAGE_SIZE, type FinishedMatch } from '../server/src/pvpHistory';
import { memoryD1, addAccount } from './support/d1';

const profile = createProfile(DEFAULT_CONTENT);
type DB = ReturnType<typeof memoryD1>;

function database() {
  const db = memoryD1({ legacyProfiles: true });
  for (const f of ['0004_pvp.sql', '0005_pvp_dominion.sql', '0006_pvp_maps.sql', '0009_tactics_social.sql', '0010_pvp_room_started.sql', '0019_tactics_pvp_history.sql'])
    db.sql.exec(readFileSync(new URL(`../server/migrations/${f}`, import.meta.url), 'utf8'));
  const alice = addAccount(db, 'alice'),
    bob = addAccount(db, 'bob'),
    carol = addAccount(db, 'carol');
  return { db, alice, bob, carol };
}

class FakeSocket {
  messages: string[] = [];
  closed = false;
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

/** A real PvPMatchRoom over fake DO storage, started between two accounts (seat 0 = first id). */
async function startedRoom(db: DB, ids: [number, number], mode = 'DUEL', heroes: [string, string] = ['mage', 'summoner']) {
  const data = new Map<string, unknown>(),
    sockets: FakeSocket[] = [];
  let init = Promise.resolve();
  const ctx = {
    storage: {
      get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined,
      put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    },
    blockConcurrencyWhile: <T>(fn: () => Promise<T>) => {
      const p = fn();
      init = p.then(() => {});
      return p;
    },
    acceptWebSocket: () => {},
    getWebSockets: (tag?: string) => sockets.filter((s) => !s.closed && (tag === undefined || s.seat === Number(tag))),
  };
  const make = () => new PvPMatchRoom(ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], { DB: db });
  const post = async (room: PvPMatchRoom, path: string, id: number, hero: string) => {
    await init;
    return room.fetch(
      new Request('https://room/' + path, {
        method: 'POST',
        headers: { 'X-Pvp-User': String(id), 'X-Pvp-Name': 'u' + id },
        body: JSON.stringify({ code: 'ABCDEFGH', mode, mapId: 'classic', loadout: validateLoadout(profile, hero) }),
      }),
    );
  };
  let room = make();
  await post(room, 'create', ids[0], heroes[0]);
  await post(room, 'join', ids[1], heroes[1]);
  const a = new FakeSocket(0),
    b = new FakeSocket(1);
  sockets.push(a, b);
  (data.get('room') as Room).members.forEach((m) => (m.offlineAt = null)); // connected sockets
  room = make();
  await post(room, 'ready', ids[0], heroes[0]);
  await post(room, 'ready', ids[1], heroes[1]);
  return { room, data, a, b, make, post, ready: () => init };
}

const get = (db: DB, token: string, path: string, method = 'GET') =>
  handle(new Request('https://api/api/tactics/pvp/' + path, { method, headers: { Authorization: 'Bearer ' + token } }), { DB: db });
const body = async (res: Response) => (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const count = (db: DB, table: string) => Number(db.sql.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);

function seed(db: DB, m: Partial<FinishedMatch> & { matchId: string; players: FinishedMatch['players']; winner: number }) {
  return db.batch(
    matchPlayerStatements(db, {
      mode: 'DUEL',
      loser: m.winner === 0 ? 0 : m.players.find((p) => p.id !== m.winner)!.id,
      reason: 'CHAMPION_DEFEATED',
      rounds: 5,
      startedAt: 1_000,
      finishedAt: 61_000,
      ...m,
    }),
  );
}
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

afterEach(() => vi.useRealTimers());

describe('authoritative match summary (PvPMatchRoom → D1)', () => {
  it('surrender persists the match once with WIN/LOSS rows, rounds and duration; retries never duplicate', async () => {
    const { db, alice, bob } = database();
    const { room, a, make, post } = await startedRoom(db, [alice.id, bob.id]);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 125_000);
    await room.webSocketMessage(sock(a), JSON.stringify({ type: 'surrender' }));
    await room.webSocketMessage(sock(a), JSON.stringify({ type: 'surrender' })); // repeated result
    await make().alarm(); // DO restart + alarm retry re-runs recordResult
    const rows = db.sql
      .prepare('SELECT user_id,opponent_id,result,reason,champion,opponent_champion,mode,duration_seconds,rounds FROM tactics_pvp_match_players ORDER BY seat')
      .all();
    expect(count(db, 'tactics_pvp_matches')).toBe(1);
    expect(rows).toEqual([
      { user_id: alice.id, opponent_id: bob.id, result: 'LOSS', reason: 'SURRENDER', champion: 'mage', opponent_champion: 'summoner', mode: 'DUEL', duration_seconds: 125, rounds: 1 },
      { user_id: bob.id, opponent_id: alice.id, result: 'WIN', reason: 'SURRENDER', champion: 'summoner', opponent_champion: 'mage', mode: 'DUEL', duration_seconds: 125, rounds: 1 },
    ]);
    const m = db.sql.prepare('SELECT started_at, finished_at FROM tactics_pvp_matches').get()!;
    expect(Math.round((Number(m.finished_at) - Number(m.started_at)) / 1000)).toBe(125);
    // Rematch records the finished match again (idempotent) before starting a new one.
    const reopened = make();
    await post(reopened, 'rematch', alice.id, 'mage');
    await post(reopened, 'rematch', bob.id, 'summoner');
    expect(count(db, 'tactics_pvp_matches')).toBe(1);
    expect(count(db, 'tactics_pvp_match_players')).toBe(2);
  });

  it('disconnect: the connected player wins after the reconnect window', async () => {
    const { db, alice, bob } = database();
    const { room, a } = await startedRoom(db, [alice.id, bob.id]);
    a.closed = true;
    await room.webSocketClose(sock(a));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    await room.alarm();
    await room.alarm();
    expect(db.sql.prepare('SELECT user_id,result,reason FROM tactics_pvp_match_players ORDER BY seat').all()).toEqual([
      { user_id: alice.id, result: 'LOSS', reason: 'OPPONENT_DISCONNECTED' },
      { user_id: bob.id, result: 'WIN', reason: 'OPPONENT_DISCONNECTED' },
    ]);
  });

  it('both disconnected (no winner) is a DRAW for both, never a win', async () => {
    const { db, alice, bob } = database();
    const { room, a, b } = await startedRoom(db, [alice.id, bob.id]);
    a.closed = b.closed = true;
    await room.webSocketClose(sock(a));
    await room.webSocketClose(sock(b));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    await room.alarm();
    expect(db.sql.prepare('SELECT result,reason FROM tactics_pvp_match_players').all()).toEqual([
      { result: 'DRAW', reason: 'BOTH_DISCONNECTED' },
      { result: 'DRAW', reason: 'BOTH_DISCONNECTED' },
    ]);
  });

  it('objective win (Dominion score) records mode, reason and final points for the detail view', async () => {
    const { db, alice, bob } = database();
    const { a, b, data, make, ready } = await startedRoom(db, [alice.id, bob.id], 'DOMINION');
    const r = data.get('room') as Room;
    r.game!.duel!.turns = 3;
    r.game!.round = 2;
    r.game!.dominion!.scores = [7, 0];
    r.game!.units.find((u) => u.id === 'champion-a')!.pos = { x: 2, y: 2 };
    data.set('room', r);
    const live = make();
    await ready();
    const ws = r.game!.duel!.active === 0 ? a : b;
    await live.webSocketMessage(sock(ws), JSON.stringify({ id: 'win', version: r.version, command: { type: 'END_TURN' } }));
    expect(db.sql.prepare('SELECT user_id,result,reason,mode,rounds FROM tactics_pvp_match_players ORDER BY seat').all()).toEqual([
      { user_id: alice.id, result: 'WIN', reason: 'DOMINION_SCORE', mode: 'DOMINION', rounds: 2 },
      { user_id: bob.id, result: 'LOSS', reason: 'DOMINION_SCORE', mode: 'DOMINION', rounds: 2 },
    ]);
    const matchId = String(db.sql.prepare('SELECT match_id FROM tactics_pvp_matches').get()!.match_id);
    const detail = await body(await get(db, bob.token, 'history/' + matchId));
    expect(detail).toMatchObject({ result: 'LOSS', mode: 'DOMINION', reason: 'DOMINION_SCORE', score: { mine: 0, theirs: 8 }, mapId: 'classic' });
  });
});

describe('GET /api/tactics/pvp/history', () => {
  it('own history: newest first, 20 per page with a cursor, public fields only', async () => {
    const { db, alice, bob, carol } = database();
    for (let i = 0; i < 25; i++)
      await seed(db, {
        matchId: uuid(i),
        players: [{ id: alice.id, champion: 'mage' }, { id: i % 2 ? bob.id : carol.id, champion: 'warrior' }],
        winner: i % 3 ? alice.id : i % 2 ? bob.id : carol.id,
        finishedAt: 100_000 + i * 1000,
      });
    const first = await body(await get(db, alice.token, 'history'));
    expect(first.matches).toHaveLength(HISTORY_PAGE_SIZE);
    expect(first.matches[0]).toEqual({
      matchId: uuid(24),
      playedAt: 124_000,
      mode: 'DUEL',
      result: 'LOSS',
      reason: 'CHAMPION_DEFEATED',
      opponent: { username: 'carol', deleted: false, champion: 'warrior' },
      myChampion: 'mage',
      rounds: 5,
      durationSeconds: 123,
      queue: 'CASUAL',
      ranked: null,
    });
    const text = JSON.stringify(first);
    for (const leaked of ['opponent_id', 'user_id', '"userId"', 'email', 'token', 'deck', 'hand']) expect(text).not.toContain(leaked);
    const second = await body(await get(db, alice.token, 'history?cursor=' + encodeURIComponent(first.nextCursor)));
    expect(second.matches.map((m: { matchId: string }) => m.matchId)).toEqual([4, 3, 2, 1, 0].map(uuid));
    expect(second.nextCursor).toBeNull();
    expect((await get(db, alice.token, 'history?cursor=junk')).status).toBe(400);
  });

  it('another user cannot read my history (no user parameter exists; they only see their own)', async () => {
    const { db, alice, bob, carol } = database();
    await seed(db, { matchId: uuid(1), players: [{ id: alice.id, champion: 'mage' }, { id: bob.id, champion: 'summoner' }], winner: alice.id });
    expect((await body(await get(db, carol.token, 'history'))).matches).toEqual([]);
    expect((await body(await get(db, carol.token, `history?user=${alice.id}&userId=${alice.id}`))).matches).toEqual([]);
    expect((await body(await get(db, bob.token, 'history'))).matches[0]).toMatchObject({ result: 'LOSS', opponent: { username: 'alice' } });
    expect((await get(db, 'nope', 'history')).status).toBe(401);
    expect((await get(db, alice.token, 'history', 'POST')).status).toBe(405);
  });

  it('legacy matches (before this version) are not invented into history', async () => {
    const { db, alice, bob } = database();
    db.sql.exec(`INSERT INTO tactics_pvp_matches (match_id,player_a,player_b,champion_a,champion_b,winner,loser,reason,created_at,finished_at,command_count,first_player)
      VALUES ('legacy',${alice.id},${bob.id},'mage','summoner',${alice.id},${bob.id},'SURRENDER',0,1,4,0)`);
    expect((await body(await get(db, alice.token, 'history'))).matches).toEqual([]);
    expect((await body(await get(db, alice.token, 'stats'))).overall.matches).toBe(0);
  });

  it('a deleted rival shows as deleted without breaking the history', async () => {
    const { db, alice, bob } = database();
    await seed(db, { matchId: uuid(1), players: [{ id: alice.id, champion: 'mage' }, { id: bob.id, champion: 'summoner' }], winner: bob.id });
    db.sql.prepare('DELETE FROM users WHERE id = ?').run(bob.id);
    const page = await body(await get(db, alice.token, 'history'));
    expect(page.matches[0].opponent).toEqual({ username: null, deleted: true, champion: 'summoner' });
    expect((await body(await get(db, alice.token, 'history/' + uuid(1)))).opponent.deleted).toBe(true);
  });
});

describe('GET /api/tactics/pvp/history/:matchId', () => {
  it('only participants can read a match; others get the same 404 as an unknown id', async () => {
    const { db, alice, bob, carol } = database();
    await seed(db, { matchId: uuid(7), players: [{ id: alice.id, champion: 'mage' }, { id: bob.id, champion: 'summoner' }], winner: alice.id, reason: 'SURRENDER' });
    const mine = await get(db, alice.token, 'history/' + uuid(7));
    expect(mine.status).toBe(200);
    expect(await body(mine)).toMatchObject({
      matchId: uuid(7),
      result: 'WIN',
      reason: 'SURRENDER',
      me: { username: 'alice', champion: 'mage' },
      opponent: { username: 'bob', champion: 'summoner', deleted: false },
      rounds: 5,
      durationSeconds: 60,
      startedAt: 1_000,
      playedAt: 61_000,
    });
    expect((await body(await get(db, bob.token, 'history/' + uuid(7)))).result).toBe('LOSS');
    expect((await get(db, carol.token, 'history/' + uuid(7))).status).toBe(404);
    expect((await get(db, alice.token, 'history/' + uuid(8))).status).toBe(404);
    expect((await get(db, alice.token, 'history/not-a-uuid')).status).toBe(404);
  });
});

describe('GET /api/tactics/pvp/head-to-head/:username and /stats', () => {
  async function played() {
    const ctx = database();
    const { db, alice, bob, carol } = ctx;
    const vsBob = [alice.id, alice.id, bob.id, 0, alice.id];
    for (const [i, winner] of vsBob.entries())
      await seed(db, {
        matchId: uuid(i),
        mode: i === 4 ? 'DOMINION' : 'DUEL',
        players: [{ id: alice.id, champion: i < 2 ? 'mage' : 'warrior' }, { id: bob.id, champion: 'summoner' }],
        winner,
        finishedAt: 10_000 + i,
      });
    await seed(db, { matchId: uuid(9), players: [{ id: carol.id, champion: 'mage' }, { id: alice.id, champion: 'mage' }], winner: carol.id, finishedAt: 50_000 });
    return ctx;
  }

  it('head-to-head aggregates only the pair, both perspectives agree', async () => {
    const { db, alice, bob } = await played();
    const mine = await body(await get(db, alice.token, 'head-to-head/Bob'));
    expect(mine).toMatchObject({ opponent: { username: 'bob' }, matchesPlayed: 5, myWins: 3, theirWins: 1, draws: 1, winRate: 60, lastPlayedAt: 10_004 });
    expect(mine.byMode).toEqual([
      { mode: 'DUEL', matches: 4, wins: 2, losses: 1, draws: 1, winRate: 50 },
      { mode: 'DOMINION', matches: 1, wins: 1, losses: 0, draws: 0, winRate: 100 },
    ]);
    expect(mine.byChampion.map((c: { champion: string }) => c.champion)).toEqual(['warrior', 'mage']);
    const theirs = await body(await get(db, bob.token, 'head-to-head/alice'));
    expect(theirs).toMatchObject({ matchesPlayed: 5, myWins: 1, theirWins: 3, draws: 1 });
  });

  it('unknown, blocked (either way) and self are refused without revealing a block', async () => {
    const { db, alice, bob } = await played();
    expect((await get(db, alice.token, 'head-to-head/ghost')).status).toBe(404);
    expect((await get(db, alice.token, 'head-to-head/alice')).status).toBe(400);
    db.sql.prepare('INSERT INTO tactics_social_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, 0)').run(bob.id, alice.id);
    const blocked = await get(db, alice.token, 'head-to-head/bob');
    expect(blocked.status).toBe(404);
    expect(await body(blocked)).toEqual(await body(await get(db, alice.token, 'head-to-head/ghost')));
    expect((await get(db, bob.token, 'head-to-head/alice')).status).toBe(404);
    expect((await get(db, alice.token, 'head-to-head/carol')).status).toBe(200);
  });

  it('stats: overall, by champion and by mode over the caller’s own matches', async () => {
    const { db, alice } = await played();
    const stats = await body(await get(db, alice.token, 'stats'));
    expect(stats.overall).toEqual({ matches: 6, wins: 3, losses: 2, draws: 1, winRate: 50 });
    expect(stats.byChampion).toEqual([
      { champion: 'mage', matches: 3, wins: 2, losses: 1, draws: 0, winRate: 67 },
      { champion: 'warrior', matches: 3, wins: 1, losses: 1, draws: 1, winRate: 33 },
    ]);
    expect(stats.byMode).toEqual([
      { mode: 'DUEL', matches: 5, wins: 2, losses: 2, draws: 1, winRate: 40 },
      { mode: 'DOMINION', matches: 1, wins: 1, losses: 0, draws: 0, winRate: 100 },
    ]);
  });
});

it('loads exactly three recent matches for the selected opponent before paginating',async()=>{
 const {db,alice,bob,carol}=database();
 for(let i=1;i<=6;i++)await seed(db,{matchId:uuid(i),players:[{id:alice.id,champion:'mage'},{id:bob.id,champion:'warrior'}],winner:alice.id,finishedAt:100000+i});
 await seed(db,{matchId:uuid(20),players:[{id:alice.id,champion:'mage'},{id:carol.id,champion:'summoner'}],winner:carol.id,finishedAt:200000});
 const first=await body(await get(db,alice.token,'history?opponent=bob&limit=3'));
 expect(first.matches).toHaveLength(3);expect(first.matches.every((m:{opponent:{username:string}})=>m.opponent.username==='bob')).toBe(true);
 expect(first.nextCursor).toBeTruthy();
 const next=await body(await get(db,alice.token,`history?opponent=bob&limit=3&cursor=${encodeURIComponent(first.nextCursor)}`));expect(next.matches).toHaveLength(3);
 expect(next.matches.map((m:{matchId:string})=>m.matchId).some((id:string)=>first.matches.some((m:{matchId:string})=>m.matchId===id))).toBe(false);
});
