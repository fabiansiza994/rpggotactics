import { INFORMED_RESPONSE_PROTOCOL, negotiateResponseProtocol, responseDuration } from '../src/protocol/negationResponse';
import { withDarkLightRelease } from '../src/game/data/dark-light';
import{competitiveFixture}from'./support/competitive-profile';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_CONTENT,
  createProfile,
  type Command,
} from '../src/game';
import {
  createDuel,
  validateLoadout,
} from '../src/game/pvp/duel';
import { PvPMatchRoom, type Room } from '../server/src/pvp';
import { memoryD1 } from './support/d1';
const profile = createProfile(DEFAULT_CONTENT);
for(const hero of ['mage','summoner']){const p=competitiveFixture(hero).profile;profile.heroes[hero]=p.heroes[hero]!;profile.heroes[hero]!.activeDeckId='competitive';}
const loads = [validateLoadout(profile, 'mage'), validateLoadout(profile, 'summoner')] as const;
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
describe('Dark/light room response deadlines (local DO harness)', () => {
  async function pendingRoom(allowResponse = true, protocol?: string) {
    const h = harness(); await h.setup();
    const room = h.data.get('room') as Room;
    room.responseProtocol = protocol;
    room.rulesRelease = 'universal-cards-1';
    room.preparation = undefined;
    const profile = createProfile(DEFAULT_CONTENT);
    const load = validateLoadout(profile, 'mage');
    room.game = createDuel([load, load], 42, 'DUEL', 'classic', withDarkLightRelease(DEFAULT_CONTENT));
    room.game.duel!.active = 0;
    room.game.player.energy = 5;
    room.game.player.hand = [{ uid: 'cast', cardId: 'magic_missile' }];
    room.game.duel!.other.energy=3;
    room.game.duel!.other.hand=allowResponse ? [{uid:'seal',cardId:'dark_silence_seal'},{uid:'cost',cardId:'fireball'}] : [];
    room.game.units.find(u => u.id === room.game!.player.heroId)!.pos = { x: 2, y: 2 };
    room.game.units.find(u => u.id === room.game!.duel!.other.heroId)!.pos = { x: 3, y: 2 };
    room.deadline = Date.now() + 45000;
    room.members.forEach(m => m.offlineAt = null);
    h.data.set('room', structuredClone(room));
    const restored = new PvPMatchRoom(h.ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], { DB: h.db });
    await Promise.resolve(); await Promise.resolve();
    const command = { type: 'PLAY_CARD', cardUid: 'cast', target: { x: 3, y: 2 } } as const;
    type Driver = { applyRoomCommand(seat: number, action: { id: string; version: number; command: Command }): Promise<boolean> };
    const driver = restored as unknown as Driver;
    await driver.applyRoomCommand(0, { id: 'cast-once', version: room.version, command });
    return { ...h, live: restored, driver, snapshot: () => h.data.get('room') as Room };
  }
  it('without a legal response never pauses the turn clock or installs a response deadline', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(3000000);
    try {
      const h = await pendingRoom(false), state = h.snapshot();
      expect(state.game!.pendingCast).toBeUndefined();
      expect(state.deadline).toBe(3045000);
      expect(state.responseTurnRemainingMs).toBeFalsy();
      expect(h.alarm()).not.toBe(3005000);
      expect(state.game!.player.energy).toBe(4);
      expect(state.game!.player.discard.filter(c => c.uid === 'cast')).toHaveLength(1);
    } finally { vi.restoreAllMocks(); }
  });
  it('persists a five-second absolute deadline and restores it without extending it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000000);
    try {
      const h = await pendingRoom(), state = h.snapshot();
      expect(state.game!.pendingCast!.deadline).toBe(1005000);
      expect(state.deadline).toBeNull();
      expect(state.responseTurnRemainingMs).toBe(45000);
      expect(h.alarm()).toBe(1005000);
      vi.mocked(Date.now).mockReturnValue(1002000);
      new PvPMatchRoom(h.ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0], { DB: h.db });
      await Promise.resolve(); await Promise.resolve();
      expect(h.snapshot().game!.pendingCast!.deadline).toBe(1005000);
    } finally { vi.restoreAllMocks(); }
  });
  it('timeout resolves once, keeps the single energy debit and resumes the remaining turn', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000000);
    try {
      const h = await pendingRoom();
      vi.mocked(Date.now).mockReturnValue(2005000);
      await h.live.alarm();
      const done = h.snapshot();
      expect(done.game!.pendingCast).toBeUndefined();
      expect(done.game!.player.energy).toBe(4);
      expect(done.game!.player.discard.filter(c => c.uid === 'cast')).toHaveLength(1);
      expect(done.deadline).toBe(2050000);
      const hp = done.game!.units.find(u => u.id === done.game!.duel!.other.heroId)!.hp;
      await h.live.alarm();
      expect(h.snapshot().game!.units.find(u => u.id === done.game!.duel!.other.heroId)!.hp).toBe(hp);
      expect(h.snapshot().game!.player.discard.filter(c => c.uid === 'cast')).toHaveLength(1);
    } finally { vi.restoreAllMocks(); }
  });
  it('only the defender responds; replay of the same accepted action does not resolve twice', async () => {
    const h = await pendingRoom(), pending = h.snapshot();
    const action = { id: 'pass-once', version: pending.version, command: { type: 'SILENCE_RESPONSE', windowId: pending.game!.pendingCast!.id, pass: true } as const };
    await expect(h.driver.applyRoomCommand(0, action)).rejects.toThrow('NOT_YOUR_TURN');
    await h.driver.applyRoomCommand(1, action);
    const before = JSON.stringify(h.snapshot().game);
    await h.driver.applyRoomCommand(1, action);
    expect(JSON.stringify(h.snapshot().game)).toBe(before);
  });
  it('negotiates fifteen seconds only when every human supports it', () => {
    const modern={responseProtocol:INFORMED_RESPONSE_PROTOCOL};
    expect(negotiateResponseProtocol([modern,modern])).toBe(INFORMED_RESPONSE_PROTOCOL);
    expect(negotiateResponseProtocol([modern,{kind:'BOT'}])).toBe(INFORMED_RESPONSE_PROTOCOL);
    expect(negotiateResponseProtocol([modern,{}])).toBeUndefined();
    expect(responseDuration(undefined)).toBe(5000);
    expect(responseDuration(INFORMED_RESPONSE_PROTOCOL)).toBe(15000);
  });
  it('persists fifteen seconds across hydration, expires once, and resumes the paused turn', async () => {
    vi.spyOn(Date,'now').mockReturnValue(4000000);
    try {
      const h=await pendingRoom(true,INFORMED_RESPONSE_PROTOCOL);
      expect(h.snapshot().game!.pendingCast!.deadline).toBe(4015000);
      expect(h.snapshot().deadline).toBeNull();
      const pending=h.snapshot().game!.pendingCast!;
      expect(pending.durationMs).toBe(15000);
      expect(pending.announcement!.card.id).toBe('magic_missile');
      expect(pending.announcement!.paidEnergy).toBe(1);
      expect(pending.announcement!.target).toEqual({x:3,y:2});
      vi.mocked(Date.now).mockReturnValue(4002000);
      const restored=new PvPMatchRoom(h.ctx as unknown as ConstructorParameters<typeof PvPMatchRoom>[0],{DB:h.db});
      await Promise.resolve();await Promise.resolve();
      expect(h.snapshot().game!.pendingCast!.deadline-Date.now()).toBe(13000);
      vi.mocked(Date.now).mockReturnValue(4014999);
      await restored.alarm();
      expect(h.snapshot().game!.pendingCast).toBeDefined();
      vi.mocked(Date.now).mockReturnValue(4015000);
      await restored.alarm();
      expect(h.snapshot().game!.pendingCast).toBeUndefined();
      expect(h.snapshot().deadline).toBe(4060000);
      expect(h.snapshot().game!.player.energy).toBe(4);
      const before=JSON.stringify(h.snapshot().game);
      await restored.alarm();
      expect(JSON.stringify(h.snapshot().game)).toBe(before);
    } finally {vi.restoreAllMocks();}
  });
  it('allows immediate pass in a fifteen-second room without spending the response cards', async () => {
    const h=await pendingRoom(true,INFORMED_RESPONSE_PROTOCOL), pending=h.snapshot();
    await h.driver.applyRoomCommand(1,{id:'v2-pass',version:pending.version,command:{type:'SILENCE_RESPONSE',windowId:pending.game!.pendingCast!.id,pass:true}});
    expect(h.snapshot().game!.pendingCast).toBeUndefined();
    expect(h.snapshot().game!.duel!.other.hand.map(c=>c.uid)).toEqual(['seal','cost']);
    expect(h.snapshot().game!.duel!.other.energy).toBe(3);
  });

  it('projects only the public announcement and requires the new capability to resume a new room', async () => {
    const h=await pendingRoom(true,INFORMED_RESPONSE_PROTOCOL);
    const old=await h.live.fetch(new Request('https://room/state',{method:'POST',body:'{}',headers:{'X-Pvp-User':'2'}}));
    expect(old.status).toBe(409);
    const current=await h.live.fetch(new Request('https://room/state',{method:'POST',body:'{}',headers:{'X-Pvp-User':'2','X-Pvp-Negation':INFORMED_RESPONSE_PROTOCOL}}));
    expect(current.status).toBe(200);
    const wire=await current.json() as {game:{responseWindow:unknown;pendingCast?:unknown}};
    const announcement=JSON.stringify(wire.game.responseWindow);
    expect(announcement).toContain('magic_missile');
    expect(announcement).toContain('15000');
    for(const privateKey of ['cardUid','searchUid','sealUid','discardUid','twistedCurse','sacrificeHp'])expect(announcement).not.toContain(privateKey);
    expect(wire.game.pendingCast).toBeUndefined();
  });
  it('retains existing Seal energy and discard costs in the fifteen-second room', async () => {
    const h=await pendingRoom(true,INFORMED_RESPONSE_PROTOCOL),pending=h.snapshot();
    await h.driver.applyRoomCommand(1,{id:'v2-seal',version:pending.version,command:{type:'SILENCE_RESPONSE',windowId:pending.game!.pendingCast!.id,pass:false,sealUid:'seal',discardUid:'cost'}});
    const game=h.snapshot().game!;
    expect(game.pendingCast).toBeUndefined();
    expect(game.duel!.other.hand).toHaveLength(0);
    expect(game.duel!.other.discard.map(c=>c.uid)).toEqual(expect.arrayContaining(['seal','cost']));
    expect(game.duel!.other.energy).toBe(1);
  });
  it('does not open fifteen seconds without a legal response',async()=>{
    const h=await pendingRoom(false,INFORMED_RESPONSE_PROTOCOL);
    expect(h.snapshot().game!.pendingCast).toBeUndefined();
    expect(h.snapshot().deadline).not.toBeNull();
  });

});
