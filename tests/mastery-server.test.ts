import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ASCENT_CAMPAIGN,
  campaignBattleContent,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  fallbackDiscardUid,
  GameEngine,
  type PlayerProfile,
  type RunState,
} from '../src/game';
import { handle } from '../server/src/index';
import { PvPMatchRoom, type Room } from '../server/src/pvp';
import type { Env } from '../server/src/db';
import { addAccount, memoryD1 } from './support/d1';
import { playBattle } from './support/bot';
import { pveVictoryMastery } from '../server/src/mastery';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type DB = ReturnType<typeof memoryD1>;

let db: DB;
let env: Env;
let rooms: Map<string, FakeRoom>;
let ids = 0;
// Fresh run seed per run, like production (crypto random): it is the per-run XP reference.
let runSeed = 100;
const deps = () => ({ content: DEFAULT_CONTENT, now: () => Date.now(), seed: () => ++runSeed, summonerCampaign: true, store: { newId: () => `tx-${++ids}`, catalog: [], cosmetics: {} } });

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
function namespace() {
  rooms = new Map();
  return {
    idFromName: (n: string) => n,
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
          blockConcurrencyWhile: <T>(fn: () => Promise<T>) => ((init = fn()), init as Promise<T>),
          acceptWebSocket: () => {},
          getWebSockets: (tag?: string) => sockets.filter((s) => !s.closed && (tag === undefined || s.seat === Number(tag))),
        };
        const make = () => new PvPMatchRoom(ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], env);
        const entry = { data, sockets, make, live: make() } as FakeRoom & { fetch(r: Request): Promise<Response> };
        entry.fetch = async (r: Request) => {
          await init;
          return entry.live.fetch(r);
        };
        rooms.set(key, entry);
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
    deps(),
  );
  return { status: res.status, body: (await res.json()) as Json };
}
async function player(name: string) {
  const a = addAccount(db, name);
  expect((await call(a.token, 'POST', '/profile', {})).status).toBe(200);
  return { ...a, name };
}
type Player = Awaited<ReturnType<typeof player>>;
const xpOf = (id: number, hero: string) => Number(db.sql.prepare('SELECT xp FROM tactics_champion_mastery WHERE user_id = ? AND hero_id = ?').get(id, hero)?.xp ?? 0);
const crystals = (id: number) => Number(db.sql.prepare('SELECT balance FROM tactics_wallets WHERE user_id = ?').get(id)?.balance ?? 0);
const sources = (id: number, hero: string) =>
  db.sql.prepare('SELECT source, xp FROM tactics_mastery_ledger WHERE user_id = ? AND hero_id = ? ORDER BY id').all(id, hero).map((r) => `${r.source}:${r.xp}`);
const seedXp = (id: number, hero: string, xp: number) =>
  db.sql.prepare("INSERT INTO tactics_mastery_ledger (user_id, hero_id, source, reference_id, xp, day, created_at) VALUES (?, ?, 'QA_FIXTURE', ?, ?, 'qa', 0)").run(id, hero, String(Math.random()), xp);

/** Starts (or restarts) the champion's World 1 run and wins its current encounter with the bot. */
async function winCurrent(p: Player, heroId: string, restart = false) {
  if (restart) expect((await call(p.token, 'POST', '/campaign/start', { heroId })).status).toBe(200);
  const state = (await call(p.token, 'GET', '/state')).body as { profile: PlayerProfile; runs: Record<string, RunState> };
  const run = state.runs[heroId]!;
  const encounter = currentEncounter(ASCENT_CAMPAIGN, run);
  for (let seed = 1; seed < 60; seed++) {
    const engine = new GameEngine(encounter, campaignBattleContent(DEFAULT_CONTENT, state.profile, run, DECK_RULES), seed);
    playBattle(engine, 30);
    if (engine.state.outcome?.result !== 'WON') continue;
    const proof = { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(engine.history)) };
    const res = await call(p.token, 'POST', '/campaign/victory', { proof, heroId });
    expect(res.status).toBe(200);
    return { proof, encounter };
  }
  throw Error('bot could not win');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 9, 20, 12));
  db = memoryD1({ legacyProfiles: true });
  for (const f of ['0004_pvp.sql', '0005_pvp_dominion.sql', '0006_pvp_maps.sql', '0009_tactics_social.sql', '0010_pvp_room_started.sql', '0019_tactics_pvp_history.sql'])
    db.sql.exec(readFileSync(new URL(`../server/migrations/${f}`, import.meta.url), 'utf8'));
  env = { DB: db, MASTERY_ENABLED: '1', RANKED_PRESEASON_ENABLED: '1' };
  env.PVP_ROOMS = namespace();
});
afterEach(() => vi.useRealTimers());

describe('PvE mastery (server-verified victories only)', () => {
  it('legacy/new account starts at Maestría 1 with 0 XP for every champion', async () => {
    const p = await player('fresh');
    const m = (await call(p.token, 'GET', '/mastery')).body;
    expect(m.enabled).toBe(true);
    expect(Object.values(m.champions)).toEqual(Array(5).fill({ xp: 0, level: 1 }));
    expect(m.titles.filter((t: Json) => t.unlocked).map((t: Json) => t.id)).toEqual(
      ['mage', 'summoner', 'warrior', 'archer', 'shapeshifter'].map((c) => `mastery.${c}.1`),
    );
    expect(m.equippedTitleId).toBeNull();
    expect(JSON.stringify(m)).not.toMatch(/displayName|Aprendiz/); // names come from the client catalog
  });

  it('victory + first clear + daily first win go to THAT champion; retries and replays never duplicate bonuses', async () => {
    const p = await player('pve');
    const { proof } = await winCurrent(p, 'mage', true);
    expect(sources(p.id, 'mage')).toEqual(['PVE_VICTORY:30', 'FIRST_CLEAR:40', 'DAILY_FIRST_WIN:50']);
    expect(xpOf(p.id, 'mage')).toBe(120);
    expect(xpOf(p.id, 'summoner')).toBe(0);
    // Lost-response retry of the same victory.
    expect((await call(p.token, 'POST', '/campaign/victory', { proof, heroId: 'mage' })).status).toBe(200);
    expect(xpOf(p.id, 'mage')).toBe(120);
    // Replaying the encounter in a new run: base XP only (no first clear, daily already paid).
    await winCurrent(p, 'mage', true);
    expect(sources(p.id, 'mage')).toEqual(['PVE_VICTORY:30', 'FIRST_CLEAR:40', 'DAILY_FIRST_WIN:50', 'PVE_VICTORY:30']);
    // Another champion progresses independently (its own first clear, no second daily today).
    await winCurrent(p, 'summoner', true);
    expect(sources(p.id, 'summoner')).toEqual(['PVE_VICTORY:30', 'FIRST_CLEAR:40']);
    expect(xpOf(p.id, 'mage')).toBe(150);
    expect((await call(p.token, 'GET', '/mastery')).body.champions.mage).toEqual({ xp: 150, level: 2 });
  });

  it('a clear verified before this version never pays a first-clear bonus later (no backfill)', async () => {
    const p = await player('legacy');
    await call(p.token, 'POST', '/campaign/start', { heroId: 'mage' });
    const first = ASCENT_CAMPAIGN.encounters[0]!.id;
    db.sql.prepare(`INSERT INTO tactics_reward_log(user_id,campaign_id,hero_id,run_seed,encounter_id,pool,event,offered_json,chosen_json,pity_before,pity_after,created_at) VALUES(?,?,NULL,1,?,'NORMAL','NO_DROP',NULL,NULL,0,0,1)`).run(p.id, ASCENT_CAMPAIGN.id, first);
    await winCurrent(p, 'mage');
    expect(sources(p.id, 'mage')).toEqual(['PVE_VICTORY:30', 'DAILY_FIRST_WIN:50']);
  });

  it('crossing a reward level pays its Cristales once; titles unlock by level and only unlocked ones equip', async () => {
    const p = await player('climb');
    seedXp(p.id, 'mage', 249); // QA fixture: one step under Maestría 3
    await winCurrent(p, 'mage', true);
    expect(xpOf(p.id, 'mage')).toBe(369);
    expect(crystals(p.id)).toBe(40 + 25); // daily first win + Maestría 3 reward
    expect(db.sql.prepare('SELECT level, crystals FROM tactics_mastery_rewards WHERE user_id = ? ORDER BY level').all(p.id)).toEqual([
      { level: 1, crystals: 0 },
      { level: 3, crystals: 25 },
    ]);
    await winCurrent(p, 'mage', true); // still level 3: nothing repaid
    expect(crystals(p.id)).toBe(65);
    expect(Number(db.sql.prepare("SELECT count(*) AS n FROM tactics_wallet_ledger WHERE reason = 'MASTERY_REWARD'").get()!.n)).toBe(1);

    expect((await call(p.token, 'PUT', '/mastery/title', { titleId: 'mastery.mage.5' })).status).toBe(403);
    expect((await call(p.token, 'PUT', '/mastery/title', { titleId: 'mastery.summoner.3' })).status).toBe(403);
    expect((await call(p.token, 'PUT', '/mastery/title', { titleId: 'Archimago' })).status).toBe(422);
    const equip = await call(p.token, 'PUT', '/mastery/title', { titleId: 'mastery.mage.3' });
    expect(equip.status).toBe(200);
    expect(equip.body.equippedTitleId).toBe('mastery.mage.3');
    // A fresh server read preserves the equipped title (not just the PUT response).
    expect((await call(p.token, 'GET', '/mastery')).body.equippedTitleId).toBe('mastery.mage.3');
    // Any unlocked title, not only the highest; null unequips.
    expect((await call(p.token, 'PUT', '/mastery/title', { titleId: 'mastery.archer.1' })).body.equippedTitleId).toBe('mastery.archer.1');
    expect((await call(p.token, 'PUT', '/mastery/title', { titleId: null })).body.equippedTitleId).toBeNull();
  });

  it('jumping several levels at once pays each reached level exactly once', async () => {
    const p = await player('jump');
    seedXp(p.id, 'mage', 2000);
    await winCurrent(p, 'mage', true);
    expect(db.sql.prepare('SELECT level FROM tactics_mastery_rewards WHERE user_id = ? AND crystals > 0 ORDER BY level').all(p.id).map((r) => r.level)).toEqual([3, 5, 7]);
    expect(crystals(p.id)).toBe(40 + 25 + 50 + 75);
  });

  it('client cannot write XP/level; flag off grants nothing', async () => {
    const p = await player('forge');
    expect((await call(p.token, 'PUT', '/mastery', { mage: { xp: 9999 } })).status).toBe(405);
    expect((await call(p.token, 'POST', '/mastery/title', { titleId: 'mastery.mage.10' })).status).toBe(405);
    env = { ...env, MASTERY_ENABLED: undefined };
    expect((await call(p.token, 'GET', '/mastery')).body).toEqual({ enabled: false });
    await winCurrent(p, 'mage', true);
    expect(xpOf(p.id, 'mage')).toBe(0);
  });
});

describe('PvE XP table, story bonus and daily cap (statement level)', () => {
  it('first clear by tier: normal 40 / elite 80 / boss 150, story +25; skirmish = base only; 12 repeatable wins per day', async () => {
    const p = await player('table');
    const now = Date.now();
    const win = (v: Partial<Parameters<typeof pveVictoryMastery>[3]>) =>
      db.batch(pveVictoryMastery(db, p.id, now, { heroId: 'archer', campaignId: 'archer_hunt', story: true, encounterId: 'e1', tier: 'NORMAL', runRef: '1', ...v }));
    await win({ tier: 'ELITE', encounterId: 'elite' });
    await win({ tier: 'BOSS', encounterId: 'boss', story: false, campaignId: 'ascent' });
    await win({ tier: 'BOSS', encounterId: 'boss', story: false, campaignId: 'ascent', runRef: '2' }); // replay: base only
    expect(sources(p.id, 'archer')).toEqual(['PVE_VICTORY:30', 'FIRST_CLEAR:80', 'STORY_FIRST_CLEAR:25', 'PVE_VICTORY:30', 'FIRST_CLEAR:150', 'PVE_VICTORY:30']);
    for (let i = 0; i < 15; i++) await win({ skirmish: true, runRef: `s${i}`, encounterId: 'sk' });
    expect(sources(p.id, 'archer').filter((s) => s.startsWith('PVE_VICTORY'))).toHaveLength(12);
    expect(sources(p.id, 'archer').filter((s) => s.startsWith('FIRST_CLEAR'))).toHaveLength(2);
    // Daily first win bonus fires only when this batch's economy row exists.
    await win({ encounterId: 'x', runRef: '9', dailyFirstWinTransactionId: 'not-paid' });
    expect(sources(p.id, 'archer').some((s) => s.startsWith('DAILY'))).toBe(false);
  });
});

describe('PvP mastery (room-decided results; RP untouched)', () => {
  async function connectAndReady(code: string, a: Player, b: Player, heroes: [string, string]) {
    const room = rooms.get(code)!;
    (room.data.get('room') as Room).members.forEach((m) => (m.offlineAt = null));
    room.sockets.push(new FakeSocket(0), new FakeSocket(1));
    room.live = room.make();
    await call(a.token, 'POST', '/pvp/ready', { code, heroId: heroes[0] });
    await call(b.token, 'POST', '/pvp/ready', { code, heroId: heroes[1] });
    return room;
  }
  async function casual(a: Player, b: Player, heroes: [string, string] = ['mage', 'summoner']) {
    const created = await call(a.token, 'POST', '/pvp/create', { heroId: heroes[0] });
    await call(b.token, 'POST', '/pvp/join', { code: created.body.code, heroId: heroes[1] });
    return connectAndReady(created.body.code, a, b, heroes);
  }
  async function ranked(a: Player, b: Player, heroes: [string, string] = ['mage', 'summoner']) {
    await call(a.token, 'POST', '/ranked/queue', { heroId: heroes[0] });
    const code = (await call(b.token, 'POST', '/ranked/queue', { heroId: heroes[1] })).body.queue.code;
    return connectAndReady(code, a, b, heroes);
  }
  /** Both seats end their turn once: the match reaches round 2. */
  async function toRound2(room: FakeRoom) {
    for (let i = 0; i < 2; i++) {
      const r = room.data.get('room') as Room;
      const discard = fallbackDiscardUid(r.game!);
      await room.live.webSocketMessage(
        room.sockets[r.game!.duel!.active] as unknown as Parameters<PvPMatchRoom['webSocketMessage']>[0],
        JSON.stringify({ id: crypto.randomUUID(), version: r.version, command: discard ? { type: 'END_TURN', discardUid: discard } : { type: 'END_TURN' } }),
      );
    }
    expect((room.data.get('room') as Room).game!.round).toBe(2);
  }
  const surrender = (room: FakeRoom, seat: number) =>
    room.live.webSocketMessage(room.sockets[seat] as unknown as Parameters<PvPMatchRoom['webSocketMessage']>[0], JSON.stringify({ type: 'surrender' }));

  it('casual win/loss XP to the champion used; retries never duplicate; title shows on the PvP member', async () => {
    const [a, b] = [await player('pa'), await player('pb')];
    seedXp(a.id, 'mage', 300);
    await call(a.token, 'PUT', '/mastery/title', { titleId: 'mastery.mage.3' });
    const room = await casual(a, b);
    expect((room.data.get('room') as Room).members.map((m) => m.titleId)).toEqual(['mastery.mage.3', null]);
    await toRound2(room);
    await surrender(room, 1);
    await surrender(room, 1);
    await room.make().alarm();
    expect(sources(a.id, 'mage')).toEqual(['QA_FIXTURE:300', 'PVP:40']);
    expect(sources(b.id, 'summoner')).toEqual(['PVP:25']);
    expect(xpOf(b.id, 'mage')).toBe(0);
  });

  it('no XP for a match that ends before round 2 or for the side that abandons', async () => {
    const [a, b] = [await player('qa1'), await player('qb1')];
    const early = await casual(a, b);
    await surrender(early, 0);
    expect(sources(a.id, 'mage')).toEqual([]);
    expect(sources(b.id, 'summoner')).toEqual([]);
    const late = await ranked(a, b);
    await toRound2(late);
    const code = (late.data.get('room') as Room).code;
    await call(a.token, 'POST', '/pvp/leave', { code }); // ranked walk-out = ABANDONED
    expect(sources(a.id, 'mage')).toEqual([]);
    expect(sources(b.id, 'summoner')).toEqual(['PVP:45']);
  });

  it('ranked gives ranked XP and RP stays exactly the ranked rules', async () => {
    const [a, b] = [await player('ra'), await player('rb')];
    const room = await ranked(a, b);
    await toRound2(room);
    await surrender(room, 1);
    expect(sources(a.id, 'mage')).toEqual(['PVP:45']);
    expect(sources(b.id, 'summoner')).toEqual(['PVP:30']);
    expect(db.sql.prepare('SELECT user_id, rp_delta FROM tactics_ranked_results ORDER BY user_id').all().map((r) => r.rp_delta)).toEqual([20, 0]);
  });

  it('same rival: after 3 XP matches in 24 h (casual + ranked together) further matches give no XP', async () => {
    const [a, b] = [await player('fa'), await player('fb')];
    for (let i = 0; i < 4; i++) {
      const room = i % 2 ? await ranked(a, b) : await casual(a, b);
      await toRound2(room);
      await surrender(room, 1);
      if (!(i % 2)) await call(a.token, 'POST', '/pvp/leave', { code: (room.data.get('room') as Room).code });
      vi.advanceTimersByTime(60_000);
    }
    expect(sources(a.id, 'mage')).toEqual(['PVP:40', 'PVP:45', 'PVP:40']);
    vi.advanceTimersByTime(24 * 3600_000);
    const room = await casual(a, b);
    await toRound2(room);
    await surrender(room, 1);
    expect(sources(a.id, 'mage')).toHaveLength(4);
  });
});
