import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONTENT } from '../src/game';
import { handle } from '../server/src/index';
import { PvPMatchRoom, type Room } from '../server/src/pvp';
import { rankedTrackResultStatements } from '../server/src/rankedTrack';
import type { Env } from '../server/src/db';
import { addAccount, memoryD1 } from './support/d1';

/**
 * Ranked Reward Track (0025) on the real Worker + PvPMatchRoom + SQLite D1 (same harness as
 * tests/ranked-server.test.ts). Grants follow the PEAK RP, once per (account, season, reward).
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

const setRp = (id: number, rp: number) =>
  db.sql.prepare("INSERT INTO tactics_ranked_players (user_id, season_id, rp, updated_at) VALUES (?, 'preseason_0', ?, 0) ON CONFLICT (user_id, season_id) DO UPDATE SET rp = excluded.rp").run(id, rp);
const rpOf = (id: number) => Number(db.sql.prepare('SELECT rp FROM tactics_ranked_players WHERE user_id = ?').get(id)?.rp ?? 0);
const crystals = (id: number) => Number(db.sql.prepare('SELECT balance FROM tactics_wallets WHERE user_id = ?').get(id)?.balance ?? 0);
const ledgerRows = (id: number) => Number(db.sql.prepare('SELECT count(*) AS n FROM tactics_wallet_ledger WHERE user_id = ?').get(id)!.n);
const rewards = (id: number) =>
  (db.sql.prepare('SELECT reward_id, reward_type, item_id, hero_id, quantity, granted, match_id FROM tactics_ranked_rewards WHERE user_id = ? ORDER BY required_rp, reward_id').all(id) as Json[]);
const copies = (id: number, hero: string, card: string) =>
  db.sql.prepare('SELECT copies, source FROM tactics_player_cards WHERE user_id = ? AND hero_id = ? AND card_id = ?').get(id, hero, card) as { copies: number; source: string } | undefined;
const cosmetics = (id: number) => db.sql.prepare('SELECT cosmetic_id, kind, source, reference_id FROM tactics_player_cosmetics WHERE user_id = ? ORDER BY cosmetic_id').all(id) as Json[];
const track = async (p: Player) => (await call(p.token, 'GET', '/ranked/track')).body;

/** A legacy ranked history (before the track existed): result rows + their match rows. */
function legacyResult(userId: number, opponentId: number, matchId: string, rpBefore: number, rpAfter: number, rounds = 4) {
  db.sql
    .prepare(
      `INSERT INTO tactics_pvp_matches (match_id,player_a,player_b,champion_a,champion_b,winner,loser,reason,created_at,finished_at,command_count,first_player,rounds)
       VALUES (?, ?, ?, 'mage', 'mage', ?, ?, 'SURRENDER', 0, 0, 10, 0, ?) ON CONFLICT DO NOTHING`,
    )
    .run(matchId, userId, opponentId, userId, opponentId, rounds);
  db.sql
    .prepare(
      `INSERT INTO tactics_ranked_results (match_id,user_id,opponent_id,season_id,outcome,rp_before,rp_after,rp_delta,capped,finished_at)
       VALUES (?, ?, ?, 'preseason_0', ?, ?, ?, ?, 0, 1)`,
    )
    .run(matchId, userId, opponentId, rpAfter >= rpBefore ? 'WIN' : 'LOSS', rpBefore, rpAfter, rpAfter - rpBefore);
}

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
  // Stand-in for real turns: the match reached `rounds` (the emblem needs round ≥ 2).
  const live = room.data.get('room') as Room;
  live.game!.round = rounds;
  room.live = room.make();
  return { code, room };
}
const seatOf = (room: FakeRoom, id: number) => (room.data.get('room') as Room).members.findIndex((m) => m.id === id);
async function surrender(room: FakeRoom, loser: Player) {
  const ws = room.sockets[seatOf(room, loser.id)]! as unknown as Parameters<PvPMatchRoom['webSocketMessage']>[0];
  await room.live.webSocketMessage(ws, JSON.stringify({ type: 'surrender' }));
}

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

describe('Reward Track grants from real ranked results', () => {
  it('no reward below a threshold; crossing it grants once (playset ×2 + Ranked metadata); the first valid match gives the emblem', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    setRp(alice.id, 85);
    const { room } = await started(alice, bob);
    await surrender(room, bob);
    expect(rpOf(alice.id)).toBe(105);
    expect(rewards(alice.id).map((r) => r.reward_id)).toEqual(['rt.preseason_0.IRON_III.emblem', 'rt.preseason_0.IRON_II.card']);
    expect(rewards(alice.id)[1]).toMatchObject({ reward_type: 'CARD', item_id: 'palisade', hero_id: 'archer', quantity: 2, granted: 2 });
    expect(copies(alice.id, 'archer', 'palisade')).toEqual({ copies: 2, source: 'RANKED_TRACK' });
    expect(copies(alice.id, 'warrior', 'wall_patience')).toBeUndefined(); // 200 RP not reached
    // Bob lost at 0 RP: emblem yes (valid match), no card.
    expect(rewards(bob.id).map((r) => r.reward_id)).toEqual(['rt.preseason_0.IRON_III.emblem']);
    // Result screen reveal comes from the same rows.
    const outcome = (room.data.get('room') as Room).ranked!.outcome![seatOf(room, alice.id)]!;
    expect(outcome.rewards.map((r) => r.rewardId)).toEqual(['rt.preseason_0.IRON_III.emblem', 'rt.preseason_0.IRON_II.card']);
  });

  it('retry / alarm / DO restart / re-run batch / reconcile never duplicate a card, title or cosmetic', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    setRp(alice.id, 885);
    const { room } = await started(alice, bob);
    await surrender(room, bob);
    await surrender(room, bob);
    await room.make().alarm();
    const r = room.data.get('room') as Room;
    await db.batch(rankedTrackResultStatements(db, [alice.id, bob.id], r.matchId, Date.now()));
    await track(alice);
    await call(alice.token, 'GET', '/ranked/me');
    await call(alice.token, 'GET', '/state');
    expect(rpOf(alice.id)).toBe(905);
    const ids = rewards(alice.id).map((x) => x.reward_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((x) => x.includes('.card'))).toHaveLength(6); // IRON_II … SILVER_I (Oro III has no card)
    expect(copies(alice.id, 'mage', 'ignition_rune')!.copies).toBe(2);
    expect(cosmetics(alice.id).filter((c) => c.cosmetic_id === 'frame_ranked_gold_duelist')).toHaveLength(1);
  });

  it('demotion after a reward removes nothing; re-climbing grants nothing new', async () => {
    const [alice, bob, carol] = [await player('alice'), await player('bob'), await player('carol')];
    setRp(bob.id, 105);
    legacyResult(bob.id, carol.id, 'old-1', 85, 105);
    expect((await track(bob)).track.nodes.find((n: Json) => n.nodeId === 'IRON_II').status).toBe('CLAIMED');
    const { room } = await started(alice, bob);
    await surrender(room, bob); // 105 → 93: back to Hierro III
    expect(rpOf(bob.id)).toBe(93);
    expect(copies(bob.id, 'archer', 'palisade')!.copies).toBe(2);
    const view = (await track(bob)).track;
    expect(view.rp).toBe(93);
    expect(view.peakRp).toBe(105);
    expect(view.rank.label).toBe('Hierro III');
    expect(view.nodes.find((n: Json) => n.nodeId === 'IRON_II').status).toBe('CLAIMED');
    expect(view.nextReward).toMatchObject({ nodeId: 'IRON_I', requiredRp: 200, distance: 107 });
  });
});

describe('Legacy reconciliation (players whose peak predates the track)', () => {
  it('peak Oro II: all cards/titles/cosmetics up to Oro II at once, crystals already paid by 0023 are not paid again', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    // Pre-track history: climbed to 1010 (Oro II) and dropped to 960; 0023 already paid Bronce/Plata/Oro.
    legacyResult(alice.id, bob.id, 'old-1', 0, 1010);
    legacyResult(alice.id, bob.id, 'old-2', 1010, 960);
    for (const [tier, amount] of [['BRONZE', 50], ['SILVER', 100], ['GOLD', 150]] as const) {
      db.sql.prepare("INSERT INTO tactics_ranked_milestones (user_id, season_id, tier_id, match_id, crystals, reached_at) VALUES (?, 'preseason_0', ?, 'old-1', ?, 1)").run(alice.id, tier, amount);
      db.sql
        .prepare("INSERT INTO tactics_wallet_ledger (transaction_id,user_id,currency_id,amount_delta,balance_before,balance_after,reason,reference_id,note,created_at) SELECT ?, ?, 'arcane_crystals', ?, b, b + ?, 'RANKED_MILESTONE', ?, 'legacy', 1 FROM (SELECT COALESCE((SELECT balance FROM tactics_wallets WHERE user_id = ? AND currency_id = 'arcane_crystals'), 0) AS b)")
        .run(`legacy-${tier}`, alice.id, amount, amount, `preseason_0:${tier}`, alice.id);
    }
    const walletBefore = crystals(alice.id),
      ledgerBefore = ledgerRows(alice.id);
    expect(walletBefore).toBe(300);
    // First touch after the deploy: the app's /state load.
    const state = (await call(alice.token, 'GET', '/state')).body;
    const ids = rewards(alice.id).map((r) => r.reward_id);
    expect(ids).toEqual([
      'rt.preseason_0.IRON_III.emblem',
      'rt.preseason_0.IRON_II.card',
      'rt.preseason_0.IRON_I.card',
      'rt.preseason_0.BRONZE_III.title',
      'rt.preseason_0.BRONZE_II.card',
      'rt.preseason_0.BRONZE_I.card',
      'rt.preseason_0.SILVER_III.title',
      'rt.preseason_0.SILVER_II.card',
      'rt.preseason_0.SILVER_I.card',
      'rt.preseason_0.GOLD_III.frame',
      'rt.preseason_0.GOLD_III.title',
      'rt.preseason_0.GOLD_II.card',
    ]);
    expect(rewards(alice.id).every((r) => r.match_id === 'RECONCILE')).toBe(true);
    expect(crystals(alice.id)).toBe(walletBefore);
    expect(ledgerRows(alice.id)).toBe(ledgerBefore);
    // The collection the client receives already has the playsets (Deck Builder availability).
    expect(state.profile.heroes.mage.collection.ignition_rune.copies).toBe(2);
    expect(state.profile.heroes.warrior.collection.siege_leap.copies).toBe(1);
    expect(state.profile.heroes.summoner.collection.altar_echo.copies).toBe(2);
    expect(state.profile.heroes.archer.collection.palisade.copies).toBe(2);
    expect(state.profile.heroes.shapeshifter.collection.wild_burst.copies).toBe(2);
    expect(state.profile.heroes.archer.collection.tracking_arrow).toBeUndefined(); // Oro I not reached
    // Idempotent: a second reconcile adds nothing.
    await track(alice);
    expect(rewards(alice.id)).toHaveLength(ids.length);
    expect(copies(alice.id, 'mage', 'ignition_rune')!.copies).toBe(2);
  });

  it('a legacy first match that ended in round 1 (instant surrender) does not give the emblem; a reached card still does', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    legacyResult(alice.id, bob.id, 'old-1', 0, 120, 1);
    await track(alice);
    expect(rewards(alice.id).map((r) => r.reward_id)).toEqual(['rt.preseason_0.IRON_II.card']);
  });

  it('flag off: no reconcile, no grants', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    legacyResult(alice.id, bob.id, 'old-1', 0, 500);
    env = { ...env, RANKED_PRESEASON_ENABLED: undefined } as Env;
    await call(alice.token, 'GET', '/state');
    expect((await call(alice.token, 'GET', '/ranked/track')).body).toEqual({ enabled: false });
    expect(rewards(alice.id)).toEqual([]);
  });
});

describe('Playsets, caps, titles, cosmetics', () => {
  it('Rare ×1, Uncommon ×2; an account already at the copy limit gets 0 copies (reward still reached, no crystals)', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    db.sql.prepare("INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, 'archer', 'palisade', 2, 1, 'QA', 0)").run(alice.id);
    db.sql.prepare("INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, 'warrior', 'wall_patience', 1, 1, 'QA', 0)").run(alice.id);
    legacyResult(alice.id, bob.id, 'old-1', 0, 1000);
    const walletBefore = crystals(alice.id);
    await track(alice);
    const byId = Object.fromEntries(rewards(alice.id).map((r) => [r.item_id, r]));
    expect(byId.palisade).toMatchObject({ quantity: 2, granted: 0 });
    expect(copies(alice.id, 'archer', 'palisade')!.copies).toBe(2); // never past the limit
    expect(byId.wall_patience).toMatchObject({ quantity: 2, granted: 1 });
    expect(copies(alice.id, 'warrior', 'wall_patience')!.copies).toBe(2);
    expect(byId.siege_leap).toMatchObject({ quantity: 1, granted: 1 });
    expect(crystals(alice.id)).toBe(walletBefore);
    const view = (await track(alice)).track;
    const item = view.nodes.find((n: Json) => n.nodeId === 'IRON_II').items[0];
    expect(item).toMatchObject({ status: 'CLAIMED', grantedCopies: 0 });
  });

  it('ranked titles share the Mastery slot: locked before the node, equippable after, shown as equipped', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    expect((await call(alice.token, 'PUT', '/mastery/title', { titleId: 'ranked.tier.BRONZE' })).status).toBe(403);
    expect((await call(alice.token, 'PUT', '/mastery/title', { titleId: 'ranked.tier.NOPE' })).status).toBe(422);
    legacyResult(alice.id, bob.id, 'old-1', 0, 320);
    await track(alice);
    const equip = await call(alice.token, 'PUT', '/mastery/title', { titleId: 'ranked.tier.BRONZE' });
    expect(equip.status).toBe(200);
    expect(equip.body.equippedTitleId).toBe('ranked.tier.BRONZE');
    expect((await call(alice.token, 'GET', '/mastery')).body.equippedTitleId).toBe('ranked.tier.BRONZE');
    expect((await call(alice.token, 'PUT', '/mastery/title', { titleId: 'ranked.tier.SILVER' })).status).toBe(403);
    // Mastery titles keep working in the same slot.
    expect((await call(alice.token, 'PUT', '/mastery/title', { titleId: 'mastery.mage.1' })).body.equippedTitleId).toBe('mastery.mage.1');
  });

  it('cosmetics: owned with RANKED_TRACK source + "<season>:<reward>" reference; never sold by the store', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    legacyResult(alice.id, bob.id, 'old-1', 0, 1750);
    await track(alice);
    expect(cosmetics(alice.id)).toEqual([
      { cosmetic_id: 'badge_ranked_diamond_victory', kind: 'VICTORY_BADGE', source: 'RANKED_TRACK', reference_id: 'preseason_0:rt.preseason_0.DIAMOND_II.badge' },
      { cosmetic_id: 'crest_ranked_apex_preseason_0', kind: 'RANKED_CREST', source: 'RANKED_TRACK', reference_id: 'preseason_0:rt.preseason_0.DIAMOND_I.crest' },
      { cosmetic_id: 'crest_ranked_platinum', kind: 'RANKED_CREST', source: 'RANKED_TRACK', reference_id: 'preseason_0:rt.preseason_0.PLATINUM_I.crest' },
      { cosmetic_id: 'frame_ranked_diamond_facet', kind: 'PROFILE_FRAME', source: 'RANKED_TRACK', reference_id: 'preseason_0:rt.preseason_0.DIAMOND_III.frame' },
      { cosmetic_id: 'frame_ranked_gold_duelist', kind: 'PROFILE_FRAME', source: 'RANKED_TRACK', reference_id: 'preseason_0:rt.preseason_0.GOLD_III.frame' },
      { cosmetic_id: 'ranked_emblem_preseason_0', kind: 'RANKED_CREST', source: 'RANKED_TRACK', reference_id: 'preseason_0:rt.preseason_0.IRON_III.emblem' },
    ]);
    const view = (await track(alice)).track;
    expect(view.nodes.every((n: Json) => n.status === 'CLAIMED' || n.items.some((i: Json) => i.type === 'CRYSTALS'))).toBe(true);
    // Crystals are the 0023 milestones (none recorded for this synthetic history): shown as
    // reached-but-not-paid by the track, which never pays them itself.
    expect(view.nodes.find((n: Json) => n.nodeId === 'BRONZE_III').status).toBe('UNLOCKED');
    expect(view.nextReward).toBeNull();
  });

  it('/ranked/track exposes only the caller\'s own state (no ids, opponents, emails)', async () => {
    const [alice, bob] = [await player('alice'), await player('bob')];
    legacyResult(alice.id, bob.id, 'old-1', 0, 640);
    const body = await track(alice);
    expect(body.track).toMatchObject({ seasonId: 'preseason_0', rp: 640, peakRp: 640 });
    expect(body.track.nodes).toHaveLength(18);
    const text = JSON.stringify(body);
    for (const leak of ['user_id', 'opponent', 'email', 'token', 'password', 'match_id', 'bob']) expect(text).not.toContain(leak);
  });
});
