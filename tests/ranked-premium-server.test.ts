import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONTENT } from '../src/game';
import { handle } from '../server/src/index';
import { PvPMatchRoom, type Room } from '../server/src/pvp';
import { premiumResultStatements } from '../server/src/rankedPremium';
import { RANKED_PREMIUM, RANKED_PREMIUM_ITEMS, RANKED_PREMIUM_TRACK, rankedPremiumGrantTable } from '../src/game/ranked/premiumTrack';
import { RANKED_TRACK } from '../src/game/ranked/rewardTrack';
import { RANKED_PREMIUM_AVATARS, PROFILE_AVATARS } from '../src/shared/profileAvatars';
import { COSMETICS } from '../src/game/data/store-catalog';
import type { Env } from '../server/src/db';
import { addAccount, memoryD1 } from './support/d1';

/**
 * Ranked Premium Track (0027) on the real Worker + PvPMatchRoom + SQLite D1 (same harness as
 * tests/ranked-track-server.test.ts). The pass costs 600, once per season; grants follow the PEAK RP,
 * once per (account, season, reward), retroactively at purchase.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type DB = ReturnType<typeof memoryD1>;

class FakeSocket {
  closed = false;
  constructor(public seat: number) {}
  deserializeAttachment() {
    return { seat: this.seat };
  }
  serializeAttachment() {}
  send() {}
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
            get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined,
            put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
            setAlarm: async () => {},
            deleteAlarm: async () => {},
          },
          blockConcurrencyWhile: <T,>(fn: () => Promise<T>) => {
            const p = fn();
            init = p;
            return p;
          },
          acceptWebSocket: () => {},
          getWebSockets: (tag?: string) => sockets.filter((s) => !s.closed && (tag === undefined || s.seat === Number(tag))),
        };
        // The room sees the same flags as the Worker (premium statements need RANKED_PREMIUM_*).
        const make = () => new PvPMatchRoom(ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], { ...env, DB: db });
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

const crystals = (id: number) => Number(db.sql.prepare("SELECT balance FROM tactics_wallets WHERE user_id = ? AND currency_id = 'arcane_crystals'").get(id)?.balance ?? 0);
const ledger = (id: number, reason?: string) =>
  db.sql.prepare(`SELECT amount_delta, reason, reference_id FROM tactics_wallet_ledger WHERE user_id = ?${reason ? ' AND reason = ?' : ''} ORDER BY id`).all(...(reason ? [id, reason] : [id])) as Json[];
const premiumRows = (id: number) =>
  db.sql.prepare('SELECT reward_id, reward_type, item_id, hero_id, quantity, granted, match_id FROM tactics_ranked_premium_rewards WHERE user_id = ? ORDER BY required_rp, reward_id').all(id) as Json[];
const passes = (id: number) => db.sql.prepare('SELECT season_id, price, idempotency_key FROM tactics_ranked_premium_passes WHERE user_id = ?').all(id) as Json[];
const copies = (id: number, hero: string, card: string) =>
  db.sql.prepare('SELECT copies, source FROM tactics_player_cards WHERE user_id = ? AND hero_id = ? AND card_id = ?').get(id, hero, card) as { copies: number; source: string } | undefined;
const cosmetics = (id: number) => db.sql.prepare('SELECT cosmetic_id, kind, source FROM tactics_player_cosmetics WHERE user_id = ? ORDER BY cosmetic_id').all(id) as Json[];
const freeRows = (id: number) => db.sql.prepare('SELECT reward_id FROM tactics_ranked_rewards WHERE user_id = ? ORDER BY reward_id').all(id).map((r) => (r as Json).reward_id);
function fund(id: number, amount: number, ref = `qa-${amount}-${Math.random()}`) {
  db.sql
    .prepare(
      "INSERT INTO tactics_wallet_ledger (transaction_id,user_id,currency_id,amount_delta,balance_before,balance_after,reason,reference_id,note,created_at) SELECT ?, ?, 'arcane_crystals', ?, b, b + ?, 'QA_GRANT', ?, 'test', 1 FROM (SELECT COALESCE((SELECT balance FROM tactics_wallets WHERE user_id = ? AND currency_id = 'arcane_crystals'), 0) AS b)",
    )
    .run(`tx-${ref}`, id, amount, amount, ref, id);
}
/** A ranked history row (+ its match): the server's only RP truth. */
function result(userId: number, opponentId: number, matchId: string, rpBefore: number, rpAfter: number) {
  db.sql
    .prepare(
      `INSERT INTO tactics_pvp_matches (match_id,player_a,player_b,champion_a,champion_b,winner,loser,reason,created_at,finished_at,command_count,first_player,rounds)
       VALUES (?, ?, ?, 'mage', 'mage', ?, ?, 'SURRENDER', 0, 0, 10, 0, 4) ON CONFLICT DO NOTHING`,
    )
    .run(matchId, userId, opponentId, userId, opponentId);
  db.sql
    .prepare(
      `INSERT INTO tactics_ranked_results (match_id,user_id,opponent_id,season_id,outcome,rp_before,rp_after,rp_delta,capped,finished_at)
       VALUES (?, ?, ?, 'preseason_0', ?, ?, ?, ?, 0, 1)`,
    )
    .run(matchId, userId, opponentId, rpAfter >= rpBefore ? 'WIN' : 'LOSS', rpBefore, rpAfter, rpAfter - rpBefore);
}
const buy = (p: Player, key = `key-${p.name}-0001`, extra: Json = {}) => call(p.token, 'POST', '/ranked/premium/purchase', { idempotencyKey: key, ...extra });
const view = async (p: Player) => (await call(p.token, 'GET', '/ranked/premium')).body.premium;

async function started(a: Player, b: Player) {
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
  live.game!.round = 3;
  room.live = room.make();
  return { code, room };
}
const seatOf = (room: FakeRoom, id: number) => (room.data.get('room') as Room).members.findIndex((m) => m.id === id);
async function surrender(room: FakeRoom, loser: Player) {
  const ws = room.sockets[seatOf(room, loser.id)]! as unknown as Parameters<PvPMatchRoom['webSocketMessage']>[0];
  await room.live.webSocketMessage(ws, JSON.stringify({ type: 'surrender' }));
}
const setRp = (id: number, rp: number) =>
  db.sql.prepare("INSERT INTO tactics_ranked_players (user_id, season_id, rp, updated_at) VALUES (?, 'preseason_0', ?, 0) ON CONFLICT (user_id, season_id) DO UPDATE SET rp = excluded.rp").run(id, rp);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_800_000_000_000);
  db = memoryD1({ legacyProfiles: true });
  for (const f of ['0004_pvp.sql', '0005_pvp_dominion.sql', '0006_pvp_maps.sql', '0009_tactics_social.sql', '0010_pvp_room_started.sql', '0019_tactics_pvp_history.sql', '0027_tactics_ranked_premium_track.sql'])
    db.sql.exec(readFileSync(new URL(`../server/migrations/${f}`, import.meta.url), 'utf8'));
  env = {
    DB: db,
    PVP_ROOMS: namespace(),
    RANKED_PRESEASON_ENABLED: '1',
    RANKED_PREMIUM_ENABLED: '1',
    MASTERY_ENABLED: '1',
    ARCHER_ENABLED: '1',
    SHAPESHIFTER_ENABLED: '1',
  } as Env;
});
afterEach(() => vi.useRealTimers());

describe('Premium catalog + economy invariants', () => {
  it('18 nodes = the free track nodes (same ids, same thresholds); price 600; crystal return 560 < 600', () => {
    expect(RANKED_PREMIUM_TRACK).toHaveLength(18);
    expect(RANKED_PREMIUM_TRACK.map((n) => [n.nodeId, n.requiredRp])).toEqual(RANKED_TRACK.map((n) => [n.nodeId, n.requiredRp]));
    expect(RANKED_PREMIUM_TRACK.every((n) => n.items.length > 0)).toBe(true);
    expect(RANKED_PREMIUM.price).toBe(600);
    const total = RANKED_PREMIUM_ITEMS.filter((i) => i.type === 'CRYSTALS').reduce((s, i) => s + i.quantity, 0);
    expect(total).toBe(560);
    expect(RANKED_PREMIUM.crystalReturn).toBe(total);
    expect(total).toBeLessThan(RANKED_PREMIUM.price);
    expect(RANKED_PREMIUM_ITEMS.filter((i) => i.type === 'CARD').map((i) => i.cardId)).toEqual(['double_moon_pact', 'fallen_king_wall', 'stalker_heart', 'ash_eclipse', 'primal_ascent']);
    const ids = RANKED_PREMIUM_ITEMS.map((i) => i.rewardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rankedPremiumGrantTable().some((r) => r.type === ('SHOWCASE_CHOICE' as string))).toBe(false);
  });

  it('premium cosmetics are never in the store registry; premium avatars stay out of the picker list until their art ships', () => {
    for (const id of ['frame_premium_circle_bronze', 'frame_premium_threshold_crown', 'cardback_premium_arcane_circle']) expect(COSMETICS[id]).toBeUndefined();
    for (const a of RANKED_PREMIUM_AVATARS) {
      expect(PROFILE_AVATARS.some((x) => x.id === a.id)).toBe(false);
      expect(a).toMatchObject({ unlockType: 'OWNED', unlockSource: 'rankedPremium' });
    }
  });
});

describe('Purchase (600, once per season, server-authoritative)', () => {
  it('exactly 600 → pass bought, balance 0, one RANKED_PREMIUM_PASS debit; at 0 RP only the Hierro III avatar', async () => {
    const alice = await player('alice');
    fund(alice.id, 600);
    const r = await buy(alice);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'PURCHASED', balance: 0 });
    expect(r.body.granted.map((g: Json) => g.rewardId)).toEqual(['rp.preseason_0.IRON_III.avatar']);
    expect(r.body.premium.purchased).toBe(true);
    expect(r.body.premium.nodes.filter((n: Json) => n.claimable)).toEqual([]); // no stuck "claimable" node
    expect(crystals(alice.id)).toBe(0);
    expect(ledger(alice.id, 'RANKED_PREMIUM_PASS')).toEqual([{ amount_delta: -600, reason: 'RANKED_PREMIUM_PASS', reference_id: 'preseason_0' }]);
    expect(passes(alice.id)).toEqual([{ season_id: 'preseason_0', price: 600, idempotency_key: 'key-alice-0001' }]);
  });

  it('599 → INSUFFICIENT_FUNDS; no pass, no ledger row, no grant', async () => {
    const alice = await player('alice');
    const bob = await player('bob');
    result(alice.id, bob.id, 'm1', 0, 500);
    fund(alice.id, 599);
    const r = await buy(alice);
    expect(r.status).toBe(409);
    expect(r.body.error?.code ?? r.body.code).toBe('INSUFFICIENT_FUNDS');
    expect(crystals(alice.id)).toBe(599);
    expect(passes(alice.id)).toEqual([]);
    expect(premiumRows(alice.id)).toEqual([]);
    expect(ledger(alice.id, 'RANKED_PREMIUM_PASS')).toEqual([]);
  });

  it('a second purchase (new key) is refused; the same key is a replay; never charged twice', async () => {
    const alice = await player('alice');
    fund(alice.id, 2000);
    expect((await buy(alice, 'key-alice-first')).status).toBe(200);
    const again = await buy(alice, 'key-alice-other');
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toContain('ALREADY_PURCHASED');
    const replay = await buy(alice, 'key-alice-first');
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe('REPLAYED');
    expect(crystals(alice.id)).toBe(1400);
    expect(ledger(alice.id, 'RANKED_PREMIUM_PASS')).toHaveLength(1);
  });

  it('concurrent purchases (two keys, even with enough for two): one pass, one debit', async () => {
    const alice = await player('alice');
    fund(alice.id, 1200);
    const [a, b] = await Promise.all([buy(alice, 'key-alice-conc-a'), buy(alice, 'key-alice-conc-b')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(passes(alice.id)).toHaveLength(1);
    expect(ledger(alice.id, 'RANKED_PREMIUM_PASS')).toHaveLength(1);
    expect(crystals(alice.id)).toBe(600);
  });

  it('the database itself refuses an unpaid pass and a premium grant without a pass', async () => {
    const alice = await player('alice');
    expect(() =>
      db.sql.prepare("INSERT INTO tactics_ranked_premium_passes (user_id, season_id, price, currency_id, idempotency_key, purchased_at) VALUES (?, 'preseason_0', 600, 'arcane_crystals', 'raw-key-1', 1)").run(alice.id),
    ).toThrow();
    expect(passes(alice.id)).toEqual([]);
    expect(() =>
      db.sql
        .prepare("INSERT INTO tactics_ranked_premium_rewards (user_id, season_id, reward_id, node_id, reward_type, item_id, quantity, granted, required_rp, match_id, granted_at) VALUES (?, 'preseason_0', 'x', 'IRON_II', 'CRYSTALS', 'arcane_crystals', 50, 50, 100, 'RAW', 1)")
        .run(alice.id),
    ).toThrow();
    expect(crystals(alice.id)).toBe(0);
  });

  it('bad requests: missing/short key, wrong season, flag off', async () => {
    const alice = await player('alice');
    fund(alice.id, 600);
    expect((await call(alice.token, 'POST', '/ranked/premium/purchase', {})).status).toBe(400);
    expect((await buy(alice, 'short')).status).toBe(400);
    expect((await buy(alice, 'key-alice-season', { seasonId: 'season_9' })).status).toBe(409);
    env = { ...env, RANKED_PREMIUM_ENABLED: undefined } as Env;
    expect((await buy(alice)).status).toBe(403);
    expect((await call(alice.token, 'GET', '/ranked/premium')).body).toEqual({ enabled: false });
    expect((await call(alice.token, 'GET', '/ranked/track')).body.premium).toBeUndefined();
    expect(crystals(alice.id)).toBe(600);
  });
});

describe('Retroactive grants follow the PEAK RP', () => {
  it('peak Platino I then bought: every premium reward Hierro III → Platino I at once (410 crystals, 5 cards)', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    result(alice.id, bob.id, 'old-1', 0, 1400);
    fund(alice.id, 600);
    const before = await view(alice);
    expect(before.purchased).toBe(false);
    expect(before.onPurchase).toMatchObject({ nodes: 15, crystals: 410, cards: ['double_moon_pact', 'fallen_king_wall', 'stalker_heart', 'ash_eclipse', 'primal_ascent'] });
    expect(before.nodes.filter((n: Json) => n.unlocked)).toHaveLength(15);
    const r = await buy(alice);
    expect(r.status).toBe(200);
    expect(r.body.granted.map((g: Json) => g.rewardId)).toEqual(before.onPurchase.rewardIds.slice().sort((x: string, y: string) => {
      const rp = (id: string) => RANKED_PREMIUM_TRACK.find((n) => n.items.some((i) => i.rewardId === id))!.requiredRp;
      return rp(x) - rp(y) || (x < y ? -1 : 1);
    }));
    expect(premiumRows(alice.id).every((g) => g.match_id === 'PURCHASE')).toBe(true);
    expect(crystals(alice.id)).toBe(410); // 600 − 600 + 410
    for (const [hero, card] of [['summoner', 'double_moon_pact'], ['warrior', 'fallen_king_wall'], ['archer', 'stalker_heart'], ['mage', 'ash_eclipse'], ['shapeshifter', 'primal_ascent']] as const)
      expect(copies(alice.id, hero, card)).toEqual({ copies: 1, source: 'RANKED_PREMIUM' });
    expect(cosmetics(alice.id).map((c) => c.cosmetic_id)).toEqual([
      'cardback_premium_arcane_circle',
      'frame_premium_circle_bronze',
      'premium_arcane_emblem',
      'premium_celestial_fox',
      'premium_golden_circle_sorcerer',
    ]);
    const after = r.body.premium;
    expect(after.nodes.filter((n: Json) => n.claimed)).toHaveLength(15);
    expect(after.nodes.find((n: Json) => n.nodeId === 'DIAMOND_III')).toMatchObject({ locked: true, premiumRequired: true, requirement: { rp: 1500, label: 'Diamante III', premium: true } });
    expect(after.onPurchase).toMatchObject({ nodes: 0, crystals: 0, cards: [] });
  });

  it('peak, not current rank: climbed to 1400, dropped to 900 → still Platino I rewards', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    result(alice.id, bob.id, 'old-1', 0, 1400);
    result(alice.id, bob.id, 'old-2', 1400, 900);
    setRp(alice.id, 900);
    fund(alice.id, 600);
    await buy(alice);
    expect(premiumRows(alice.id).map((r) => r.reward_id)).toContain('rp.preseason_0.PLATINUM_I.card');
    const v = await view(alice);
    expect([v.rp, v.peakRp]).toEqual([900, 1400]);
  });

  it('pass first, then climbing in real ranked matches: each node lands once, in the result batch', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    fund(alice.id, 600);
    await buy(alice);
    setRp(alice.id, 85);
    const { room } = await started(alice, bob);
    await surrender(room, bob); // 85 → 105: Hierro II
    const r = room.data.get('room') as Room;
    expect(premiumRows(alice.id).map((x) => [x.reward_id, x.match_id])).toEqual([
      ['rp.preseason_0.IRON_III.avatar', 'PURCHASE'], // 0 RP: reached at purchase
      ['rp.preseason_0.IRON_II.crystals', r.matchId],
    ]);
    expect(crystals(alice.id)).toBe(50);
    // Bob (no pass) got only his free-track rows, never premium ones.
    expect(premiumRows(bob.id)).toEqual([]);
    // Retry / alarm / re-run batch / reconcile: nothing more.
    await surrender(room, bob);
    await room.make().alarm();
    await db.batch(premiumResultStatements(db, [alice.id, bob.id], r.matchId, Date.now()));
    await view(alice);
    await call(alice.token, 'GET', '/state');
    await call(alice.token, 'GET', '/ranked/me');
    await call(alice.token, 'GET', '/ranked/track');
    expect(premiumRows(alice.id)).toHaveLength(2);
    expect(crystals(alice.id)).toBe(50);
    expect(ledger(alice.id, 'RANKED_PREMIUM_REWARD')).toEqual([{ amount_delta: 50, reason: 'RANKED_PREMIUM_REWARD', reference_id: 'preseason_0:rp.preseason_0.IRON_II.crystals' }]);
  });

  it('demotion after a grant removes nothing; re-climbing grants nothing new', async () => {
    const [alice, bob, carol] = [await player('alice'), await player('bob'), await player('carol')];
    result(bob.id, carol.id, 'old-1', 85, 105);
    setRp(bob.id, 105);
    fund(bob.id, 600);
    await buy(bob);
    const { room } = await started(alice, bob);
    await surrender(room, bob); // 105 → 93
    expect(premiumRows(bob.id).map((x) => x.reward_id)).toEqual(['rp.preseason_0.IRON_III.avatar', 'rp.preseason_0.IRON_II.crystals']);
    expect(cosmetics(bob.id).some((c) => c.cosmetic_id === 'premium_arcane_emblem')).toBe(true);
    expect(crystals(bob.id)).toBe(50);
    const v = await view(bob);
    expect(v.nodes.find((n: Json) => n.nodeId === 'IRON_II').claimed).toBe(true);
  });

  it('full climb: 560 crystals back in total → the pass never pays for itself (net −40)', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    result(alice.id, bob.id, 'old-1', 0, 1800);
    fund(alice.id, 600);
    await buy(alice);
    for (let i = 0; i < 3; i++) await view(alice);
    expect(crystals(alice.id)).toBe(560);
    expect(ledger(alice.id, 'RANKED_PREMIUM_REWARD').reduce((s, r) => s + r.amount_delta, 0)).toBe(560);
    expect(premiumRows(alice.id)).toHaveLength(RANKED_PREMIUM_ITEMS.filter((i) => i.type !== 'SHOWCASE_CHOICE').length);
    // A second season purchase is impossible: same season → refused, wallet untouched.
    fund(alice.id, 100);
    expect((await buy(alice, 'key-alice-twice')).status).toBe(409);
    expect(crystals(alice.id)).toBe(660);
  });

  it('a card already owned is granted as 0 copies (never past Única\'s 1-copy limit)', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    db.sql.prepare("INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, 'summoner', 'double_moon_pact', 1, 1, 'QA', 0)").run(alice.id);
    result(alice.id, bob.id, 'old-1', 0, 250);
    fund(alice.id, 600);
    await buy(alice);
    expect(premiumRows(alice.id).find((r) => r.item_id === 'double_moon_pact')).toMatchObject({ quantity: 1, granted: 0 });
    expect(copies(alice.id, 'summoner', 'double_moon_pact')!.copies).toBe(1);
  });

  it('the free track is untouched by the pass (same rows with and without it)', async () => {
    const [alice, bob, carol] = [await player('alice'), await player('bob'), await player('carol')];
    result(alice.id, carol.id, 'a-1', 0, 1000);
    result(bob.id, carol.id, 'b-1', 0, 1000);
    fund(alice.id, 600);
    await buy(alice);
    await call(alice.token, 'GET', '/ranked/track');
    await call(bob.token, 'GET', '/ranked/track');
    expect(freeRows(alice.id).map((x) => String(x).replace(/^rt\./, ''))).toEqual(freeRows(bob.id).map((x) => String(x).replace(/^rt\./, '')));
    expect(freeRows(alice.id).length).toBeGreaterThan(0);
  });
});

describe('Showcase final (Diamante I): one of the five, once', () => {
  it('locked below Diamante I and without the pass; one choice persists; a different one is refused', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    fund(alice.id, 600);
    result(alice.id, bob.id, 'old-1', 0, 1650);
    expect((await call(alice.token, 'POST', '/ranked/premium/showcase', { cardId: 'ash_eclipse' })).status).toBe(403); // no pass
    await buy(alice);
    expect((await call(alice.token, 'POST', '/ranked/premium/showcase', { cardId: 'ash_eclipse' })).status).toBe(403); // 1650 < 1700
    result(alice.id, bob.id, 'old-2', 1650, 1700);
    expect((await view(alice)).showcase).toMatchObject({ claimable: true, chosenCardId: null, requiredRp: 1700 });
    expect((await call(alice.token, 'POST', '/ranked/premium/showcase', { cardId: 'magic_missile' })).status).toBe(422);
    const ok = await call(alice.token, 'POST', '/ranked/premium/showcase', { cardId: 'ash_eclipse' });
    expect(ok.status).toBe(200);
    expect(ok.body.chosenCardId).toBe('ash_eclipse');
    expect((await call(alice.token, 'POST', '/ranked/premium/showcase', { cardId: 'ash_eclipse' })).status).toBe(200);
    const other = await call(alice.token, 'POST', '/ranked/premium/showcase', { cardId: 'stalker_heart' });
    expect(other.status).toBe(409);
    const art = cosmetics(alice.id).filter((c) => c.kind === 'CARD_ART');
    expect(art).toEqual([{ cosmetic_id: 'showcase_ash_eclipse', kind: 'CARD_ART', source: 'RANKED_PREMIUM' }]);
    const v = await view(alice);
    const node = v.nodes.find((n: Json) => n.nodeId === 'DIAMOND_I');
    expect(node.claimed).toBe(true);
    expect(node.items.find((i: Json) => i.type === 'SHOWCASE_CHOICE')).toMatchObject({ status: 'CLAIMED', chosenCardId: 'ash_eclipse' });
    // The Showcase is presentation only: the gameplay card is the same one.
    expect(copies(alice.id, 'mage', 'ash_eclipse')!.copies).toBe(1);
  });

  it('reached + owned but not chosen = CLAIMABLE (the only manual node)', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    result(alice.id, bob.id, 'old-1', 0, 1750);
    fund(alice.id, 600);
    await buy(alice);
    const v = await view(alice);
    expect(v.nodes.filter((n: Json) => n.claimable).map((n: Json) => n.nodeId)).toEqual(['DIAMOND_I']);
    expect(v.nodes.find((n: Json) => n.nodeId === 'DIAMOND_I').items.find((i: Json) => i.type === 'CRYSTALS').status).toBe('CLAIMED');
  });
});

describe('Cosmetics ownership (avatar / frame / title / card back)', () => {
  it('avatars: refused before the grant, owned + equippable after', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    expect((await call(alice.token, 'PUT', '/profile/avatar', { avatarId: 'premium_arcane_emblem' })).status).toBe(422);
    result(alice.id, bob.id, 'old-1', 0, 50);
    fund(alice.id, 600);
    await buy(alice);
    const got = await call(alice.token, 'GET', '/profile/avatar');
    expect(got.body.ownedAvatarIds).toContain('premium_arcane_emblem');
    expect(got.body.ownedAvatarIds).not.toContain('premium_celestial_fox');
    const put = await call(alice.token, 'PUT', '/profile/avatar', { avatarId: 'premium_arcane_emblem' });
    expect(put.status).toBe(200);
    expect(put.body.avatarId).toBe('premium_arcane_emblem');
    expect((await call(alice.token, 'PUT', '/profile/avatar', { avatarId: 'premium_celestial_fox' })).status).toBe(422);
  });

  it('frames equip only when owned; the rendered card back has its own slot', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    const equip = (slot: string, cosmeticId: string) => call(alice.token, 'PUT', '/cosmetics/equip', { slot, cosmeticId });
    expect((await equip('PROFILE_FRAME', 'frame_premium_circle_bronze')).status).toBe(403);
    result(alice.id, bob.id, 'old-1', 0, 1200);
    fund(alice.id, 600);
    await buy(alice);
    const ok = await equip('PROFILE_FRAME', 'frame_premium_circle_bronze');
    expect(ok.status).toBe(200);
    expect(ok.body.equipped.PROFILE_FRAME).toBe('frame_premium_circle_bronze');
    expect(ok.body.owned.map((c: Json) => c.cosmeticId)).toContain('cardback_premium_arcane_circle');
    expect((await equip('CARD_BACK', 'cardback_premium_arcane_circle')).status).toBe(200);
    expect((await equip('PROFILE_FRAME', 'frame_premium_threshold_crown')).status).toBe(403);
  });

  it('title «Pretendiente Arcano» shares the Mastery slot: locked before Diamante III with the pass', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    const id = 'ranked.premium.preseason_0.pretender';
    expect((await call(alice.token, 'PUT', '/mastery/title', { titleId: id })).status).toBe(403);
    result(alice.id, bob.id, 'old-1', 0, 1500);
    expect((await call(alice.token, 'PUT', '/mastery/title', { titleId: id })).status).toBe(403); // reached, no pass
    fund(alice.id, 600);
    await buy(alice);
    const r = await call(alice.token, 'PUT', '/mastery/title', { titleId: id });
    expect(r.status).toBe(200);
    expect(r.body.equippedTitleId).toBe(id);
  });
});

describe('Reconnect / reads / privacy', () => {
  it('/ranked/track carries the FREE and PREMIUM rows (18 + 18); /state shows the premium cards in the collection', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    result(alice.id, bob.id, 'old-1', 0, 1100);
    fund(alice.id, 600);
    await buy(alice);
    const body = (await call(alice.token, 'GET', '/ranked/track')).body;
    expect(body.track.nodes).toHaveLength(18);
    expect(body.premium.nodes).toHaveLength(18);
    const state = (await call(alice.token, 'GET', '/state')).body;
    expect(state.profile.heroes.mage.collection.ash_eclipse.copies).toBe(1);
    expect(state.profile.heroes.summoner.collection.double_moon_pact.copies).toBe(1);
    const text = JSON.stringify(body.premium);
    for (const leak of ['user_id', 'email', 'token', 'password', 'match_id', 'bob', 'idempotency']) expect(text).not.toContain(leak);
  });

  it('every node exposes the UI contract (status flags, requirement, premium requirement, art, type)', async () => {
    const alice = await player('alice');
    const v = await view(alice);
    expect(v).toMatchObject({ price: 600, currencyId: 'arcane_crystals', crystalReturn: 560, purchased: false });
    for (const n of v.nodes) {
      expect(n).toMatchObject({ premiumRequired: true, requirement: { premium: true } });
      expect(['locked', 'unlocked', 'claimable', 'claimed'].filter((k) => n[k])).toHaveLength(1);
      for (const i of n.items) {
        expect(typeof i.art).toBe('string');
        expect(i.type).toBeTruthy();
      }
    }
  });
});
