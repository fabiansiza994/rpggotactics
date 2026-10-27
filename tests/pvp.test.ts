import { describe, it, expect, vi } from 'vitest';
import { endTurn } from './helpers';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_CONTENT,
  GameEngine,
  createProfile,
  type Command,
  type GameState,
} from '../src/game';
import {
  createDuel,
  applyDuel,
  duelView,
  validateLoadout,
  DUEL_SCENARIO,
} from '../src/game/pvp/duel';
import { PvPMatchRoom, validCommand, type Room } from '../server/src/pvp';
import { handle } from '../server/src/index';
import { memoryD1, addAccount } from './support/d1';
const profile = createProfile(DEFAULT_CONTENT);
const loads = [validateLoadout(profile, 'mage'), validateLoadout(profile, 'summoner')] as const;
function duel(seed = 7) {
  return createDuel([...loads], seed);
}
function harness() {
  const db = memoryD1({ legacyProfiles: true });
  db.sql.exec(readFileSync(new URL('../server/migrations/0004_pvp.sql', import.meta.url), 'utf8'));
  db.sql.exec(
    readFileSync(new URL('../server/migrations/0005_pvp_dominion.sql', import.meta.url), 'utf8'),
  );
  db.sql.exec(
    readFileSync(new URL('../server/migrations/0006_pvp_maps.sql', import.meta.url), 'utf8'),
  );
  db.sql.exec(
    readFileSync(new URL('../server/migrations/0010_pvp_room_started.sql', import.meta.url), 'utf8'),
  );
  db.sql.exec(
    readFileSync(new URL('../server/migrations/0019_tactics_pvp_history.sql', import.meta.url), 'utf8'),
  );
  const data = new Map<string, unknown>(),
    sockets: FakeSocket[] = [];
  let init = Promise.resolve();
  let alarm = 0;
  const ctx = {
    storage: {
      get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined,
      put: async (k: string, v: unknown) => {
        data.set(k, structuredClone(v));
      },
      setAlarm: async (n: number) => {
        alarm = n;
      },
      deleteAlarm: async () => {
        alarm = 0;
      },
    },
    blockConcurrencyWhile: <T>(fn: () => Promise<T>) => {
      const p = fn();
      init = p.then(() => {});
      return p;
    },
    acceptWebSocket: () => {},
    getWebSockets: (tag?: string) =>
      sockets.filter((s) => !s.closed && (tag === undefined || s.seat === Number(tag))),
  };
  const room = new PvPMatchRoom(ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], {
    DB: db,
  });
  async function call(path: string, id: number, heroId = 'mage', mode = 'DUEL', mapId = 'classic', extra: Record<string, unknown> = {}) {
    await init;
    return room.fetch(
      new Request('https://room/' + path, {
        method: 'POST',
        headers: { 'X-Pvp-User': String(id), 'X-Pvp-Name': 'QA' + id },
        body: JSON.stringify({
          code: 'ABCDEFGH',
          mode,
          mapId,
          loadout: validateLoadout(profile, heroId),
          ...extra,
        }),
      }),
    );
  }
  async function setup(mode = 'DUEL', mapId = 'classic') {
    await call('create', 1, 'mage', mode, mapId);
    await call('join', 2, 'summoner');
    const a = new FakeSocket(0),
      b = new FakeSocket(1);
    sockets.push(a, b);
    const stored = data.get('room') as { members: { offlineAt: number | null }[] };
    stored.members.forEach((m) => (m.offlineAt = null)); // serialized storage recovery represents connected authenticated sockets
    const restarted = new PvPMatchRoom(
      ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0],
      { DB: db },
    );
    await init;
    await restarted.fetch(
      new Request('https://room/ready', {
        method: 'POST',
        headers: { 'X-Pvp-User': '1' },
        body: JSON.stringify({ loadout: loads[0] }),
      }),
    );
    await restarted.fetch(
      new Request('https://room/ready', {
        method: 'POST',
        headers: { 'X-Pvp-User': '2' },
        body: JSON.stringify({ loadout: loads[1] }),
      }),
    );
    return { live: restarted, a, b };
  }
  return { db, data, sockets, ctx, call, setup, alarm: () => alarm };
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
const socketType = (s: FakeSocket) =>
  s as unknown as Parameters<PvPMatchRoom['webSocketMessage']>[0];
describe('shared deterministic duel rules', () => {
  it('mirrored board, champion opening hands, server seed and randomized first seat', () => {
    const first = new Set<number>();
    for (let seed = 1; seed < 20; seed++) {
      const s = duel(seed);
      first.add(s.duel!.active);
      expect(s.units.map((u) => u.pos)).toEqual([
        { x: 0, y: 1 },
        { x: 8, y: 4 },
      ]);
      expect((s.duel!.active === 0 ? s.duel!.other : s.player).hand).toHaveLength(5); // every champion: hand 5
      expect(s.intents).toEqual([]);
    }
    expect(first.size).toBe(2);
    expect(duel()).toEqual(duel());
  });
  it('both projections hide every opponent card/order and RNG', () => {
    const s = duel();
    for (const seat of [0, 1] as const) {
      const v = duelView(s, seat),
        rival = s.duel!.active === seat ? s.duel!.other : s.player;
      expect(v.duel).toBeUndefined();
      expect(v.player.deck).toEqual([]);
      expect(v.rngState).toBe(0);
      for (const card of [...rival.hand, ...rival.deck])
        expect(JSON.stringify(v)).not.toContain('"uid":"' + card.uid + '"');
      expect(v.pileCounts.opponentHand).toBe(rival.hand.length);
    }
  });
  it('turns alternate without AI, and replay full state matches', () => {
    let s = duel();
    const commands: Command[] = [];
    const hp = s.units.map((u) => u.hp);
    for (let i = 0; i < 10; i++) {
      commands.push(endTurn(s));
      const prior = s.duel!.active;
      s = applyDuel(s, commands.at(-1)!).state;
      expect(s.duel!.active).not.toBe(prior);
      expect(s.intents).toEqual([]);
    }
    expect(s.units.map((u) => u.hp)).toEqual(hp);
    let replay = duel();
    for (const c of commands) replay = applyDuel(replay, c).state;
    expect(replay).toEqual(s);
  });
  it('rejects forged movement/cards atomically', () => {
    const s = duel(),
      before = structuredClone(s);
    expect(() =>
      applyDuel(s, { type: 'MOVE_UNIT', unitId: s.duel!.other.heroId, to: { x: 4, y: 4 } }),
    ).toThrow();
    expect(() =>
      applyDuel(s, { type: 'MOVE_UNIT', unitId: s.player.heroId, to: { x: 8, y: 5 } }),
    ).toThrow();
    expect(() => applyDuel(s, { type: 'PLAY_CARD', cardUid: 'forged', target: null })).toThrow();
    expect(s).toEqual(before);
  });
  it('rejects insufficient energy and illegal targets without consuming a card', () => {
    const s = duel();
    s.player.hand = [
      {
        uid: 'energy-check',
        cardId: loads[s.duel!.active].heroId === 'mage' ? 'fireball' : 'summon_chicken',
      },
    ];
    s.player.energy = 0;
    const before = structuredClone(s);
    expect(() =>
      applyDuel(s, { type: 'PLAY_CARD', cardUid: 'energy-check', target: { x: -1, y: -1 } }),
    ).toThrow('NOT_ENOUGH_ENERGY');
    expect(s).toEqual(before);
    s.player.energy = 5;
    expect(() =>
      applyDuel(s, { type: 'PLAY_CARD', cardUid: 'energy-check', target: { x: -1, y: -1 } }),
    ).toThrow('INVALID_TARGET');
    expect(s.player.hand).toHaveLength(1);
  });
  it('validates ownership, duplicates, deck size and champion', () => {
    expect(() => validateLoadout(profile, 'orc')).toThrow();
    const p = structuredClone(profile);
    p.heroes.mage!.decks[0]!.cards = [{ cardId: 'summon_wolf', count: 20 }];
    expect(() => validateLoadout(p, 'mage')).toThrow();
  });
  it('fatigue 0/1/2/3 uses normal draws for BOTH players and resets', () => {
    let s = duel();
    const events = [];
    // 30-card decks: three recycles take ~80 draws per player.
    for (let i = 0; i < 260 && !s.outcome; i++) {
      const r = applyDuel(s, endTurn(s));
      s = r.state;
      events.push(...r.events);
    }
    for (const id of ['champion-a', 'champion-b'])
      expect(
        events
          .filter((e) => e.type === 'ARCANE_FATIGUE' && e.unitId === id)
          .map((e) => (e.type === 'ARCANE_FATIGUE' ? e.amount : 0))
          .slice(0, 3),
      ).toEqual([1, 2, 3]);
    expect(duel().player.deckRecycles).toBe(0);
    expect(duel().duel!.other.deckRecycles).toBe(0);
  });
  it('summons persist, capacity validates, only active owner summons act', () => {
    let s = duel();
    if (s.player.heroId === 'champion-a') s = applyDuel(s, endTurn(s)).state;
    s.player.hand = [
      { uid: 'qa-wolf', cardId: 'summon_wolf' },
      { uid: 'qa-chicken', cardId: 'summon_chicken' },
    ];
    s.player.energy = 5;
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'qa-wolf', target: { x: 7, y: 4 } }).state;
    expect(s.units.find((u) => u.kind === 'SUMMON')?.hp).toBe(14);
    expect(() =>
      applyDuel(s, { type: 'PLAY_CARD', cardUid: 'qa-chicken', target: { x: 7, y: 2 } }),
    ).toThrow('SUMMON_CAPACITY');
    for (let i = 0; i < 8; i++) s = applyDuel(s, endTurn(s)).state;
    expect(s.units.some((u) => u.kind === 'SUMMON')).toBe(true);
    expect(s.units.find((u) => u.kind === 'SUMMON')!.summon!.lastActedRound).toBeGreaterThan(1);
  });
  it('duel ends on CHAMPION death, not defeated summons', () => {
    const s = duel();
    const opponent = s.units.find((u) => u.id === s.duel!.other.heroId)!;
    opponent.hp = 1;
    opponent.pos = {
      x: s.units.find((u) => u.id === s.player.heroId)!.pos.x + 1,
      y: s.units.find((u) => u.id === s.player.heroId)!.pos.y,
    };
    s.player.heroId = 'champion-a';
    s.units.find((u) => u.id === 'champion-a')!.faction = 'PLAYER';
    opponent.id = 'champion-b';
    opponent.faction = 'ENEMY';
    s.duel!.active = 0;
    s.duel!.other.heroId = 'champion-b';
    s.player.hand = [{ uid: 'qa-damage', cardId: 'force_push' }];
    s.player.energy = 5;
    const result = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'qa-damage', target: opponent.pos });
    expect(result.state.outcome?.result).toBe('WON');
  });
});
describe('room authority and durable recovery', () => {
  it('lobby create/join/full/stranger and persistent restart', async () => {
    const h = harness();
    expect((await h.call('create', 1)).status).toBe(200);
    expect((await h.call('join', 2, 'summoner')).status).toBe(200);
    expect((await h.call('join', 3)).status).toBe(409);
    expect((await h.call('state', 3)).status).toBe(403);
    expect(h.data.has('room')).toBe(true);
    expect(h.db.sql.prepare('SELECT player_a,player_b FROM tactics_pvp_rooms').get()).toEqual({
      player_a: 1,
      player_b: 2,
    });
  });
  it('changing champion/loadout resets lobby ready states', async () => {
    const h = harness();
    await h.call('create', 1);
    await h.call('join', 2, 'summoner');
    await h.call('ready', 1);
    const changed = await h.call('loadout', 1, 'summoner');
    const view = await changed.json();
    expect(view.members.every((m: { ready: boolean }) => !m.ready)).toBe(true);
    expect(view.members[0].heroId).toBe('summoner');
    expect(view.game).toBeNull();
  });
  it('expired lobby rejects joining and removes it from active lookup', async () => {
    const h = harness();
    await h.call('create', 1);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60000);
    const res = await h.call('join', 2, 'summoner');
    expect(res.status).toBe(404);
    await new PvPMatchRoom(h.ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], {
      DB: h.db,
    }).alarm();
    expect(
      h.db.sql
        .prepare('SELECT count(*) AS n FROM tactics_pvp_rooms WHERE expires_at>?')
        .get(Date.now()),
    ).toEqual({ n: 0 });
    vi.useRealTimers();
  });
  it('two ready start; rejects stale/out-of-turn and deduplicates exact retries', async () => {
    const h = harness(),
      { live, a, b } = await h.setup();
    let s = h.data.get('room') as { game: GameState; version: number };
    expect(s.game).not.toBeNull();
    const active = s.game.duel!.active,
      ws = active ? b : a,
      other = active ? a : b;
    await live.webSocketMessage(
      socketType(other),
      JSON.stringify({ id: 'other', version: s.version, command: { type: 'END_TURN' } }),
    );
    expect(other.messages.at(-1)).toContain('NOT_YOUR_TURN');
    await live.webSocketMessage(
      socketType(ws),
      JSON.stringify({ id: 'stale', version: s.version - 1, command: { type: 'END_TURN' } }),
    );
    expect(ws.messages.at(-1)).toContain('STALE_VERSION');
    const action = { id: 'once', version: s.version, command: { type: 'END_TURN' } };
    await live.webSocketMessage(socketType(ws), JSON.stringify(action));
    s = h.data.get('room') as typeof s;
    const v = s.version;
    await live.webSocketMessage(socketType(ws), JSON.stringify(action));
    expect((h.data.get('room') as typeof s).version).toBe(v);
    expect(ws.messages.at(-1)).toContain('ack');
    await live.webSocketMessage(
      socketType(ws),
      JSON.stringify({ ...action, command: { type: 'PLAY_CARD', cardUid: 'x', target: null } }),
    );
    expect(ws.messages.at(-1)).toContain('ACTION_ID_REUSED');
  });
  it('disconnect preserves state, reconnect snapshot recovers and timeout records result', async () => {
    const h = harness(),
      { live, a } = await h.setup();
    a.closed = true;
    await live.webSocketClose(socketType(a));
    const before = h.data.get('room') as { game: GameState; version: number; result: unknown };
    expect(before.result).toBeNull();
    expect(h.alarm()).toBeGreaterThan(0);
    const revived = new PvPMatchRoom(
      h.ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0],
      { DB: h.db },
    );
    const b = new FakeSocket(1);
    await revived.webSocketMessage(socketType(b), JSON.stringify({ type: 'resync' }));
    expect(JSON.parse(b.messages.at(-1)!).game.units).toEqual(duelView(before.game, 1).units);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61000);
    await revived.alarm();
    vi.useRealTimers();
    expect(h.db.sql.prepare('SELECT reason FROM tactics_pvp_matches').get()).toEqual({
      reason: 'OPPONENT_DISCONNECTED',
    });
    expect(JSON.parse(h.sockets[1]!.messages.at(-1)!).result.reason).toBe('OPPONENT_DISCONNECTED');
  });
  it('both disconnected is abandoned without awarding either account a win', async () => {
    const h = harness(),
      { live, a, b } = await h.setup();
    a.closed = true;
    await live.webSocketClose(socketType(a));
    b.closed = true;
    await live.webSocketClose(socketType(b));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61000);
    await live.alarm();
    vi.useRealTimers();
    expect(h.db.sql.prepare('SELECT winner,loser,reason FROM tactics_pvp_matches').get()).toEqual({
      winner: 0,
      loser: 0,
      reason: 'BOTH_DISCONNECTED',
    });
  });
  it('turn timer applies one authoritative END_TURN and broadcasts', async () => {
    const h = harness(),
      { live, a } = await h.setup();
    const before = h.data.get('room') as { version: number; game: GameState };
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 90001);
    await live.alarm();
    vi.useRealTimers();
    const after = h.data.get('room') as typeof before;
    expect(after.game.duel!.active).not.toBe(before.game.duel!.active);
    expect(after.version).toBeGreaterThan(before.version);
    expect(JSON.parse(a.messages.at(-1)!).version).toBe(after.version);
  });
  it('surrender persists once and grants no rewards', async () => {
    const h = harness(),
      { live, a } = await h.setup();
    await live.webSocketMessage(socketType(a), JSON.stringify({ type: 'surrender' }));
    await live.webSocketMessage(socketType(a), JSON.stringify({ type: 'surrender' }));
    expect(h.db.sql.prepare('SELECT winner,loser,reason FROM tactics_pvp_matches').get()).toEqual({
      winner: 2,
      loser: 1,
      reason: 'SURRENDER',
    });
    expect(h.db.sql.prepare('SELECT count(*) AS n FROM tactics_reward_log').get()).toEqual({
      n: 0,
    });
  });
  it('full Mage versus Summoner legal-command match records champion death', async () => {
    const h = harness(),
      { live, a, b } = await h.setup();
    let commandId = 0;
    for (let turn = 0; turn < 320; turn++) {
      let r = h.data.get('room') as { game: GameState; version: number; result: unknown };
      if (r.result) break;
      const seat = r.game.duel!.active,
        ws = seat ? b : a;
      for (let attempt = 0; attempt < 12; attempt++) {
        r = h.data.get('room') as typeof r;
        if (r.result) break;
        const engine = GameEngine.fromSnapshot(r.game, DEFAULT_CONTENT, DUEL_SCENARIO);
        const target = r.game.units.find((u) => u.id === r.game.duel!.other.heroId)!;
        let chosen: Command | undefined;
        for (const card of r.game.player.hand) {
          if (!engine.getCardPlayability(card.uid).playable) continue;
          const def = DEFAULT_CONTENT.cards[card.cardId]!;
          const targets = engine.getValidTargets(card.uid);
          const harmful = def.effects.some((f) => f.type === 'DAMAGE');
          const summon = def.effects.some((f) => f.type === 'SUMMON');
          if (harmful) {
            const hit = targets.find((p) => p.x === target.pos.x && p.y === target.pos.y);
            if (hit) chosen = { type: 'PLAY_CARD', cardUid: card.uid, target: hit };
          } else if (summon && targets[0])
            chosen = { type: 'PLAY_CARD', cardUid: card.uid, target: targets[0] };
          if (chosen) break;
        }
        if (!chosen) {
          const hero = r.game.units.find((u) => u.id === r.game.player.heroId)!;
          const distance = (p: { x: number; y: number }) =>
            Math.abs(p.x - target.pos.x) + Math.abs(p.y - target.pos.y);
          const move = engine
            .getLegalMoves()
            .sort((x, y) => distance(x.pos) - distance(y.pos))
            .find((n) => distance(n.pos) < distance(hero.pos));
          if (move) chosen = { type: 'MOVE_UNIT', unitId: hero.id, to: move.pos };
        }
        if (!chosen) break;
        await live.webSocketMessage(
          socketType(ws),
          JSON.stringify({ id: 'full-' + commandId++, version: r.version, command: chosen }),
        );
      }
      r = h.data.get('room') as typeof r;
      if (!r.result)
        await live.webSocketMessage(
          socketType(ws),
          JSON.stringify({
            id: 'end-' + commandId++,
            version: r.version,
            command: endTurn(r.game!),
          }),
        );
    }
    const result = h.db.sql.prepare('SELECT reason,command_count FROM tactics_pvp_matches').get();
    expect(result?.reason).toBe('CHAMPION_DEFEATED');
    expect(Number(result?.command_count)).toBeGreaterThan(2);
    // History projection (0019): one WIN and one LOSS row for the same champion defeat.
    expect(
      h.db.sql.prepare('SELECT result, reason FROM tactics_pvp_match_players ORDER BY result').all(),
    ).toEqual([
      { result: 'LOSS', reason: 'CHAMPION_DEFEATED' },
      { result: 'WIN', reason: 'CHAMPION_DEFEATED' },
    ]);
  });
  it('authenticated outer route never trusts client user identity', async () => {
    const h = harness();
    const a = addAccount(h.db, 'a');
    await handle(
      new Request('https://api/api/tactics/profile', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + a.token },
        body: '{}',
      }),
      { DB: h.db },
    );
    const calls: Request[] = [];
    const ns = {
      idFromName: (s: string) => s,
      get: () => ({
        fetch: async (req: Request) => {
          calls.push(req);
          return new Response('{}');
        },
      }),
    };
    const req = new Request('https://api/api/tactics/pvp/create', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + a.token, 'X-Pvp-User': '999' },
      body: JSON.stringify({ heroId: 'mage', userId: 999, loadout: { cards: [] } }),
    });
    expect((await handle(req, { DB: h.db, PVP_ROOMS: ns })).status).toBe(200);
    expect(calls[0]!.headers.get('X-Pvp-User')).toBe(String(a.id));
    expect(
      (
        await handle(
          new Request('https://api/api/tactics/pvp/join', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + a.token },
            body: JSON.stringify({ code: 'bad', heroId: 'mage' }),
          }),
          { DB: h.db, PVP_ROOMS: ns },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handle(
          new Request('https://api/api/tactics/pvp/create', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + a.token },
            body: JSON.stringify({ heroId: 'mage', mode: 'FORGED' }),
          }),
          { DB: h.db, PVP_ROOMS: ns },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handle(
          new Request('https://api/api/tactics/pvp/create', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + a.token },
            body: JSON.stringify({ heroId: 'mage', mapId: 'forged', mode: 'DOMINION' }),
          }),
          { DB: h.db, PVP_ROOMS: ns },
        )
      ).status,
    ).toBe(400);
    expect((await calls[0]!.json()).loadout.cards).toHaveLength(loads[0].cards.length);
    expect(
      (
        await handle(
          new Request('https://api/api/tactics/pvp/create', { method: 'POST', body: '{}' }),
          { DB: h.db, PVP_ROOMS: ns },
        )
      ).status,
    ).toBe(401);
  });
  it('cosmetics: the outer route sends the D1-equipped frame (forged ids overwritten); members expose only that id', async () => {
    const h = harness();
    const a = addAccount(h.db, 'framed');
    const auth = { Authorization: 'Bearer ' + a.token };
    await handle(new Request('https://api/api/tactics/profile', { method: 'POST', headers: auth, body: '{}' }), { DB: h.db });
    const calls: Request[] = [];
    const ns = { idFromName: (s: string) => s, get: () => ({ fetch: async (req: Request) => (calls.push(req), new Response('{}')) }) };
    const create = () =>
      handle(
        new Request('https://api/api/tactics/pvp/create', {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ heroId: 'mage', frameId: 'frame_pact_grove' }),
        }),
        { DB: h.db, PVP_ROOMS: ns },
      );
    await create();
    expect((await calls[0]!.json()).frameId).toBeNull(); // owns nothing: the forged id is dropped
    h.db.sql.prepare("INSERT INTO tactics_player_cosmetics VALUES (?, 'frame_arcane_gilt', 'PROFILE_FRAME', 'STORE_PURCHASE', 'pur_x', 0)").run(a.id);
    h.db.sql.prepare("INSERT INTO tactics_equipped_cosmetics VALUES (?, 'PROFILE_FRAME', 'frame_arcane_gilt', 0)").run(a.id);
    await create();
    expect((await calls[1]!.json()).frameId).toBe('frame_arcane_gilt');

    await h.call('create', 1, 'mage', 'DUEL', 'classic', { frameId: 'frame_arcane_gilt' });
    const joined = (await (await h.call('join', 2, 'summoner')).json()) as { members: Record<string, unknown>[] };
    expect(joined.members.map((m) => m.frameId)).toEqual(['frame_arcane_gilt', null]);
    // Multi-Deck exposes the chosen deck id only to its owner (joiner's seat is 1).
    for (const [seat, member] of joined.members.entries()) {
      const fields = ['badgeId', 'connected', 'crestId', 'frameId', 'heroId', 'name', 'ready', 'titleId'];
      if (seat === 1) {
        fields.push('deckId');
        expect(member.deckId).toBe(loads[seat].deckId);
      } else expect(member).not.toHaveProperty('deckId');
      expect(Object.keys(member).sort()).toEqual(fields.sort());
    }
  });
  it('malformed commands rejected before reducer', () => {
    expect(validCommand({ type: 'MOVE_UNIT', unitId: 'a', to: { x: NaN, y: 0 } })).toBe(false);
    expect(validCommand({ type: 'PLAY_CARD', cardUid: 'x', target: { x: 1.5, y: 0 } })).toBe(false);
    expect(validCommand({ type: 'CHEAT' })).toBe(false);
  });
});

describe('Dominion authoritative room integration', () => {
  it('mode is frozen for guest, readiness starts Dominion and reconnect restores public objectives', async () => {
    const h = harness(),
      { live, a } = await h.setup('DOMINION');
    const before = JSON.parse(a.messages.at(-1)!);
    expect(before.mode).toBe('DOMINION');
    expect(before.game.dominion.nodes).toHaveLength(3);
    const stored = h.data.get('room') as Room;
    stored.game!.dominion!.scores = [3, 2];
    stored.game!.round = 5;
    const restarted = new PvPMatchRoom(
      h.ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0],
      { DB: h.db },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await restarted.webSocketMessage(socketType(a), JSON.stringify({ type: 'resync' }));
    const recovered = JSON.parse(a.messages.at(-1)!);
    expect(recovered.game.dominion.scores).toEqual([3, 2]);
    expect(recovered.game.round).toBe(5);
    expect(recovered.game.dominion.target).toBe(8);
    expect(recovered.mode).toBe('DOMINION');
    await live.fetch(
      new Request('https://room/loadout', {
        method: 'POST',
        headers: { 'X-Pvp-User': '2' },
        body: JSON.stringify({ mode: 'DUEL', loadout: loads[1] }),
      }),
    );
    expect((h.data.get('room') as Room).mode).toBe('DOMINION');
  });
  it('ignores forged score/target/nodes and rejects capture command and stale revision', async () => {
    const h = harness(),
      { live, a, b } = await h.setup('DOMINION');
    let r = h.data.get('room') as Room;
    const seat = r.game!.duel!.active,
      ws = seat === 0 ? a : b;
    await live.webSocketMessage(
      socketType(ws),
      JSON.stringify({
        id: 'fake-capture',
        version: r.version,
        command: { type: 'CAPTURE_NODE', node: 1, score: 999 },
      }),
    );
    expect(JSON.parse(ws.messages.at(-1)!).type).toBe('error');
    await live.webSocketMessage(
      socketType(ws),
      JSON.stringify({
        id: 'fake-fields',
        version: r.version,
        score: 999,
        target: 1,
        nodes: [{ control: seat }],
        command: { type: 'END_TURN', score: 999, target: 1, nodes: [] },
      }),
    );
    r = h.data.get('room') as Room;
    expect(r.game!.dominion!.scores).toEqual([0, 0]);
    expect(r.game!.dominion!.target).toBe(8);
    expect(r.game!.dominion!.nodes).toHaveLength(3);
    await live.webSocketMessage(
      socketType(seat === 0 ? b : a),
      JSON.stringify({ id: 'stale', version: r.version - 1, command: { type: 'END_TURN' } }),
    );
    expect(JSON.parse((seat === 0 ? b : a).messages.at(-1)!).message).toBe('STALE_VERSION');
  });
  it('score victory persists mode and final scores through normal DO END_TURN, rejects post-result', async () => {
    const h = harness(),
      { a, b } = await h.setup('DOMINION');
    const r = h.data.get('room') as Room;
    r.game!.duel!.turns = 3;
    r.game!.round = 2;
    r.game!.dominion!.scores = [7, 0];
    r.game!.units.find((u) => u.id === 'champion-a')!.pos = { x: 2, y: 2 };
    const restarted = new PvPMatchRoom(
      h.ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0],
      { DB: h.db },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const seat = r.game!.duel!.active,
      ws = seat === 0 ? a : b;
    await restarted.webSocketMessage(
      socketType(ws),
      JSON.stringify({ id: 'score-win', version: r.version, command: { type: 'END_TURN' } }),
    );
    const finished = h.data.get('room') as Room;
    expect(finished.result?.reason).toBe('DOMINION_SCORE');
    expect(finished.result?.winner).toBe(1);
    const result = h.db.sql
      .prepare('SELECT mode,score_a,score_b,rounds,reason FROM tactics_pvp_matches')
      .get();
    expect(result).toEqual({
      mode: 'DOMINION',
      score_a: 8,
      score_b: 0,
      rounds: 2,
      reason: 'DOMINION_SCORE',
    });
    await restarted.webSocketMessage(
      socketType(ws),
      JSON.stringify({ id: 'after', version: finished.version, command: { type: 'END_TURN' } }),
    );
    expect(JSON.parse(ws.messages.at(-1)!).message).toBe('BATTLE_OVER');
  });
  it('additive migration backfills earlier match history as Duel', () => {
    const db = memoryD1({ legacyProfiles: true });
    db.sql.exec(
      readFileSync(new URL('../server/migrations/0004_pvp.sql', import.meta.url), 'utf8'),
    );
    db.sql.exec(
      "INSERT INTO tactics_pvp_matches VALUES ('old',1,2,'mage','summoner',1,2,'SURRENDER',0,1,4,0)",
    );
    db.sql.exec(
      readFileSync(new URL('../server/migrations/0005_pvp_dominion.sql', import.meta.url), 'utf8'),
    );
    expect(db.sql.prepare('SELECT mode,score_a,score_b FROM tactics_pvp_matches').get()).toEqual({
      mode: 'DUEL',
      score_a: null,
      score_b: null,
    });
  });
});

describe('authoritative map and terrain security', () => {
  it('freezes map and restores the complete board after DO restart', async () => {
    const h = harness(),
      { live, a } = await h.setup('DOMINION', 'shattered_sanctum');
    const before = JSON.parse(a.messages.at(-1)!);
    expect(before.mapId).toBe('shattered_sanctum');
    expect(before.game.mapId).toBe(before.mapId);
    await live.fetch(
      new Request('https://room/loadout', {
        method: 'POST',
        headers: { 'X-Pvp-User': '2' },
        body: JSON.stringify({ loadout: loads[1], mapId: 'classic', terrain: 'NORMAL' }),
      }),
    );
    const restarted = new PvPMatchRoom(
      h.ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0],
      { DB: h.db },
    );
    await new Promise((r) => setTimeout(r, 0));
    await restarted.webSocketMessage(socketType(a), JSON.stringify({ type: 'resync' }));
    const after = JSON.parse(a.messages.at(-1)!);
    expect(after.mapId).toBe(before.mapId);
    expect(after.game.board).toEqual(before.game.board);
    expect(after.game.dominion).toEqual(before.game.dominion);
  });
  it('rejects VOID movement and ignores fake terrain, cover and energy submitted alongside commands', async () => {
    const h = harness(),
      { live, a, b } = await h.setup('DUEL', 'shattered_sanctum');
    const r = h.data.get('room') as Room;
    const seat = r.game!.duel!.active,
      sock = seat === 0 ? a : b,
      hero = r.game!.player.heroId;
    const send = async (command: unknown, id: string) =>
      live.webSocketMessage(
        socketType(sock),
        JSON.stringify({
          id,
          version: (h.data.get('room') as Room).version,
          command,
          board: { tiles: [] },
          terrain: 'COVER',
          energy: 999,
          mapId: 'classic',
        }),
      );
    const initial = structuredClone(r.game!);
    await send({ type: 'MOVE_UNIT', unitId: hero, to: { x: 0, y: 0 } }, 'bad-void');
    expect((h.data.get('room') as Room).game).toEqual(initial);
    await send({ type: 'END_TURN', energy: 999, suppressHazard: true }, 'end-legal');
    const after = (h.data.get('room') as Room).game!;
    expect(after.board).toEqual(initial.board);
    expect(after.mapId).toBe('shattered_sanctum');
    expect(after.player.energy).toBeLessThan(999);
  });
});

describe('authoritative room summons survive storage hydration', () => {
  for (const species of ['chicken', 'fox', 'raven', 'wolf', 'turtle']) {
    it(`${species}: stored spawn is targetable from both snapshots and damage commits`, async () => {
      const h = harness(), { a, b } = await h.setup();
      let stored = h.data.get('room') as Room;
      let state = stored.game!;
      if (state.player.heroId === 'champion-a') state = applyDuel(state, endTurn(state)).state;
      state.units.find((u) => u.id === state.player.heroId)!.pos = { x: 3, y: 2 };
      state.units.find((u) => u.id === state.duel!.other.heroId)!.pos = { x: 5, y: 2 };
      state.player.hand = [{ uid: 'spawn-qa', cardId: `summon_${species}` }];
      state.player.energy = 5;
      stored.game = state;
      stored.deadline = Date.now() + 90000;
      h.data.set('room', structuredClone(stored));
      const spawning = new PvPMatchRoom(h.ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], { DB: h.db });
      await spawning.webSocketMessage(socketType(b), JSON.stringify({
        id: `spawn-${species}`, version: stored.version,
        command: { type: 'PLAY_CARD', cardUid: 'spawn-qa', target: { x: 4, y: 2 } },
      }));
      stored = h.data.get('room') as Room;
      const summon = stored.game!.units.find((u) => u.kind === 'SUMMON')!;
      expect(summon.defId).toBe(species);
      await spawning.webSocketMessage(socketType(b), JSON.stringify({
        id: `end-${species}`, version: stored.version, command: { type: 'END_TURN' },
      }));
      stored = h.data.get('room') as Room;
      stored.game!.player.hand = [{ uid: 'hit-qa', cardId: 'magic_missile' }];
      h.data.set('room', structuredClone(stored));
      const recovered = new PvPMatchRoom(h.ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], { DB: h.db });
      await recovered.webSocketMessage(socketType(a), JSON.stringify({ type: 'resync' }));
      await recovered.webSocketMessage(socketType(b), JSON.stringify({ type: 'resync' }));
      for (const ws of [a, b]) {
        const snapshot = JSON.parse(ws.messages.at(-1)!);
        const copy = snapshot.game.units.find((u: { id: string }) => u.id === summon.id);
        expect(copy.summon.ownerId).toBe('champion-b');
        expect(copy.faction).toBe(ws.seat === 1 ? 'PLAYER' : 'ENEMY');
      }
      await recovered.webSocketMessage(socketType(a), JSON.stringify({
        id: `hit-${species}`, version: stored.version,
        command: { type: 'PLAY_CARD', cardUid: 'hit-qa', target: summon.pos },
      }));
      const after = h.data.get('room') as Room;
      expect(after.version).toBe(stored.version + 1);
      expect(after.game!.units.find((u) => u.id === summon.id)!.hp).toBeLessThan(summon.hp);
    });
  }
});

describe('PvP dialogue match id', () => {
  it('both seats receive the same stable matchId (cosmetic banter variant and "already shown" key)', async () => {
    const h = harness();
    const { a, b } = await h.setup();
    const last = (s: FakeSocket) => JSON.parse(s.messages.filter((m) => m.includes('"snapshot"')).at(-1)!) as { matchId: string; game: unknown };
    const stored = h.data.get('room') as { matchId: string };
    expect(last(a).game).not.toBeNull();
    expect(last(a).matchId).toBe(stored.matchId);
    expect(last(b).matchId).toBe(stored.matchId);
  });
});
