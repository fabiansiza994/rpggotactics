import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { withHeroDeck, createProfile } from '../src/game/collection/profile';
import { archerCardForecast } from '../src/game/domain/archer-view';
import { effectiveMoveRange } from '../src/game/domain/board/occupancy';
import { reboundChain } from '../src/game/domain/combat/rebound';
import { queryContext } from '../src/game/domain/context';
import type { GameState } from '../src/game/domain/state';
import type { Unit } from '../src/game/domain/entities/unit';
import type { ScenarioDef } from '../src/game/domain/scenario';
import { replayBattle } from '../src/game/engine/replay';
import { applyDuel, createDuel, duelView, validateLoadout } from '../src/game/pvp/duel';
import type { Command } from '../src/game/engine/commands';
import { EMPTY_7x5, endTurn, makeEngine, mutable, ofType, p, scenario, setHand, unit } from './helpers';

const CONTENT = withArcher(DEFAULT_CONTENT);
const ORC = (id: string, x: number, y: number) => ({ id, enemyId: 'orc_warrior', pos: p(x, y) });
const BRUTE = (id: string, x: number, y: number) => ({ id, enemyId: 'stone_brute', pos: p(x, y) });

function archer(enemies: ScenarioDef['enemies'], overrides: Partial<ScenarioDef> = {}) {
  return makeEngine({ hero: { heroId: 'archer', pos: p(0, 2) }, layout: EMPTY_7x5, enemies, ...overrides }, CONTENT);
}
type Engine = ReturnType<typeof archer>;
const play = (e: Engine, uid: string, target: { x: number; y: number }) => e.dispatch({ type: 'PLAY_CARD', cardUid: uid, target });
const status = (u: Unit, id: string) => u.statuses.find((s) => s.id === id);
/** Ticks of `statusId` on `unitId` seen through the engine's own events. */
function watchTicks(e: Engine, unitId: string, statusId: string) {
  const ticks: number[] = [];
  e.subscribe((events) => {
    for (const ev of events) if (ev.type === 'UNIT_DAMAGED' && ev.unitId === unitId && ev.sourceId === `status:${statusId}`) ticks.push(ev.hpLost);
  });
  return ticks;
}

describe('Flecha de Hielo — Ralentizado', () => {
  it('hits for 2 and slows 2 turns; costs 2 energy', () => {
    const e = archer([ORC('orc-1', 4, 2)]);
    const [ice] = setHand(e, ['ice_arrow']);
    expect(play(e, ice!, p(4, 2)).ok).toBe(true);
    expect(unit(e, 'orc-1').hp).toBe(6);
    expect(status(unit(e, 'orc-1'), 'SLOWED')).toEqual({ id: 'SLOWED', turnsLeft: 2 });
    expect(e.state.player.energy).toBe(2);
  });

  it('the enemy walks 2 less (min 1) for exactly its next 2 turns, then expires', () => {
    const e = archer([ORC('orc-1', 4, 2)]);
    const [ice] = setHand(e, ['ice_arrow']);
    play(e, ice!, p(4, 2));
    e.dispatch(endTurn(e));
    expect(unit(e, 'orc-1').pos).toEqual(p(3, 2)); // 3 − 2 = 1 tile
    expect(status(unit(e, 'orc-1'), 'SLOWED')?.turnsLeft).toBe(1);
    const r = e.dispatch(endTurn(e));
    expect(unit(e, 'orc-1').pos).toEqual(p(2, 2));
    expect(status(unit(e, 'orc-1'), 'SLOWED')).toBeUndefined();
    if (r.ok) expect(ofType(r.events, 'STATUS_REMOVED')).toContainEqual({ type: 'STATUS_REMOVED', unitId: 'orc-1', status: 'SLOWED', reason: 'EXPIRED' });
    e.dispatch(endTurn(e));
    expect(unit(e, 'orc-1').pos).toEqual(p(1, 2)); // full 3 again: adjacent to the Archer
  });

  it('never a lock: a slowed unit still walks 1 and still attacks; re-applying refreshes, never extends', () => {
    const e = archer([BRUTE('brute-1', 4, 2), ORC('orc-1', 1, 2)]);
    const [a, b, c] = setHand(e, ['ice_arrow', 'ice_arrow', 'ice_arrow']);
    play(e, a!, p(4, 2));
    play(e, b!, p(4, 2));
    expect(status(unit(e, 'brute-1'), 'SLOWED')?.turnsLeft).toBe(2);
    const ctx = queryContext(mutable(e), CONTENT);
    expect(effectiveMoveRange(ctx, unit(e, 'brute-1'))).toBe(1); // base 1 stays 1
    mutable(e).player.energy = 4;
    play(e, c!, p(1, 2));
    const hpBefore = unit(e, 'archer').hp;
    e.dispatch(endTurn(e));
    expect(unit(e, 'archer').hp).toBeLessThan(hpBefore); // the adjacent slowed orc still hits
  });

  it('PvP: a slowed champion starts its turn with 2 fewer move points (authoritative, public)', () => {
    const profile = createProfile(CONTENT);
    let s = createDuel([validateLoadout(profile, 'archer', CONTENT), validateLoadout(profile, 'mage', CONTENT)], 7, 'DUEL', 'classic', CONTENT);
    if (s.duel!.active !== 0) s = applyDuel(s, endTurn(s), CONTENT).state;
    s.units.find((u) => u.id === 'champion-a')!.pos = p(4, 1);
    s.units.find((u) => u.id === 'champion-b')!.pos = p(4, 5);
    s.player.hand = [{ uid: 't-ice', cardId: 'ice_arrow' }];
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: 't-ice', target: p(4, 5) } as Command, CONTENT).state;
    for (const seat of [0, 1] as const)
      expect(duelView(s, seat, CONTENT).units.find((u) => u.id === 'champion-b')!.statuses).toContainEqual({ id: 'SLOWED', turnsLeft: 2 });
    s = applyDuel(s, endTurn(s), CONTENT).state;
    expect(s.player.heroId).toBe('champion-b');
    expect(s.player.movePoints).toBe(Math.max(1, s.player.maxMovePoints - 2));
  });
});

describe('Flecha Ígnea — Ardiendo (existing status)', () => {
  it('2 on hit, then 1 fire at the start of each of the target\'s next 2 turns: exactly 2 ticks', () => {
    const e = archer([ORC('orc-1', 4, 2)]);
    const ticks = watchTicks(e, 'orc-1', 'BURNING');
    const [fire] = setHand(e, ['fire_arrow']);
    play(e, fire!, p(4, 2));
    expect(unit(e, 'orc-1').hp).toBe(6);
    expect(status(unit(e, 'orc-1'), 'BURNING')?.turnsLeft).toBe(2);
    for (let i = 0; i < 3; i++) e.dispatch(endTurn(e));
    expect(ticks).toEqual([1, 1]);
    expect(status(unit(e, 'orc-1'), 'BURNING')).toBeUndefined();
  });

  it('re-applying refreshes the duration (max), never stacks ticks', () => {
    const e = archer([ORC('orc-1', 4, 2)]);
    const ticks = watchTicks(e, 'orc-1', 'BURNING');
    const [a, b] = setHand(e, ['fire_arrow', 'fire_arrow']);
    play(e, a!, p(4, 2));
    play(e, b!, p(4, 2));
    expect(unit(e, 'orc-1').statuses.filter((s) => s.id === 'BURNING')).toEqual([{ id: 'BURNING', turnsLeft: 2 }]);
    e.dispatch(endTurn(e));
    expect(ticks).toEqual([1]);
  });

  it('a burn tick that kills removes the unit with its statuses (no orphan, no further ticks)', () => {
    const e = archer([ORC('orc-1', 4, 2), ORC('orc-2', 6, 4)]);
    const ticks = watchTicks(e, 'orc-1', 'BURNING');
    unit(e, 'orc-1').hp = 3;
    const [fire] = setHand(e, ['fire_arrow']);
    play(e, fire!, p(4, 2));
    e.dispatch(endTurn(e));
    expect(e.state.units.some((u) => u.id === 'orc-1')).toBe(false);
    e.dispatch(endTurn(e));
    expect(ticks).toEqual([1]);
  });
});

describe('Flecha Venenosa — Envenenado', () => {
  it('1 on hit, then 1 per turn for 3 turns, through armour (Ardiendo would be stopped by it)', () => {
    const e = archer([BRUTE('brute-1', 4, 2)]);
    const ticks = watchTicks(e, 'brute-1', 'POISONED');
    const [poison] = setHand(e, ['poison_arrow']);
    play(e, poison!, p(4, 2));
    expect(unit(e, 'brute-1').hp).toBe(8); // the 1-damage arrow is stopped by armour 1
    expect(status(unit(e, 'brute-1'), 'POISONED')?.turnsLeft).toBe(3);
    for (let i = 0; i < 4; i++) e.dispatch(endTurn(e));
    expect(ticks).toEqual([1, 1, 1]);
    expect(unit(e, 'brute-1').hp).toBe(5);
    expect(status(unit(e, 'brute-1'), 'POISONED')).toBeUndefined();
  });

  it('re-applying refreshes to 3 (no stacks); poison and burn coexist as separate statuses', () => {
    const e = archer([ORC('orc-1', 4, 2)]);
    const [a] = setHand(e, ['poison_arrow']);
    play(e, a!, p(4, 2));
    e.dispatch(endTurn(e));
    expect(status(unit(e, 'orc-1'), 'POISONED')?.turnsLeft).toBe(2);
    const [c] = setHand(e, ['poison_arrow']);
    play(e, c!, unit(e, 'orc-1').pos);
    expect(unit(e, 'orc-1').statuses.filter((s) => s.id === 'POISONED')).toEqual([{ id: 'POISONED', turnsLeft: 3 }]);
    mutable(e).player.energy = 4;
    const [d] = setHand(e, ['fire_arrow']);
    play(e, d!, unit(e, 'orc-1').pos);
    expect(unit(e, 'orc-1').statuses.map((s) => s.id).sort()).toEqual(['BURNING', 'POISONED']);
  });

  it('a lethal poison tick removes the unit cleanly', () => {
    const e = archer([ORC('orc-1', 4, 2), ORC('orc-2', 6, 4)]);
    unit(e, 'orc-1').hp = 2;
    const [poison] = setHand(e, ['poison_arrow']);
    play(e, poison!, p(4, 2));
    e.dispatch(endTurn(e));
    expect(e.state.units.some((u) => u.id === 'orc-1')).toBe(false);
  });
});

describe('Flecha de Rebote', () => {
  const shoot = (e: Engine, target = p(4, 2)) => {
    const [rebound] = setHand(e, ['rebound_arrow']);
    const r = play(e, rebound!, target);
    expect(r.ok).toBe(true);
    return r.ok ? r.events : [];
  };
  const damageOrder = (events: ReturnType<typeof shoot>) =>
    ofType(events, 'UNIT_DAMAGED').filter((ev) => ev.sourceId === 'archer').map((ev) => [ev.unitId, ev.hpLost]);

  it('one target only: no bounce', () => {
    const events = shoot(archer([ORC('a', 4, 2)]));
    expect(damageOrder(events)).toEqual([['a', 2]]);
    expect(ofType(events, 'ARROW_REBOUNDED')).toEqual([]);
  });

  it('one rebound, then two: A=2, B=1, C=1', () => {
    expect(damageOrder(shoot(archer([ORC('a', 4, 2), ORC('b', 5, 2)])))).toEqual([['a', 2], ['b', 1]]);
    const events = shoot(archer([ORC('a', 4, 2), ORC('b', 5, 2), ORC('c', 6, 2)]));
    expect(damageOrder(events)).toEqual([['a', 2], ['b', 1], ['c', 1]]);
    expect(ofType(events, 'ARROW_REBOUNDED').map((ev) => [ev.unitId, ev.bounce, ev.fromPos])).toEqual([['b', 1, p(4, 2)], ['c', 2, p(5, 2)]]);
  });

  it('at most three enemies, never the same one twice', () => {
    expect(damageOrder(shoot(archer([ORC('a', 4, 2), ORC('b', 5, 2), ORC('c', 6, 2), ORC('d', 6, 3)])))).toHaveLength(3);
    // B's only neighbour is A, already hit: the arrow stops.
    expect(damageOrder(shoot(archer([ORC('a', 4, 2), ORC('b', 5, 2)])))).toEqual([['a', 2], ['b', 1]]);
  });

  it('ignores the Archer, allies/structures and enemies more than 1 tile away (diagonals included)', () => {
    const e = archer([ORC('a', 4, 2), ORC('far', 5, 3)], {
      hero: { heroId: 'archer', pos: p(3, 2) },
      structures: [{ id: 'crystal', structureId: 'crystal', pos: p(4, 1) }],
    });
    const events = shoot(e);
    expect(damageOrder(events)).toEqual([['a', 2]]);
    expect(unit(e, 'crystal').hp).toBe(unit(e, 'crystal').maxHp);
  });

  it('several candidates: deterministic (closest to the first target, then board order)', () => {
    const enemies = [ORC('a', 4, 2), ORC('up', 4, 1), ORC('down', 4, 3), ORC('right', 5, 2)];
    const orders = [0, 1].map(() => damageOrder(shoot(archer(enemies))).map(([id]) => id));
    // All three neighbours are at distance 1 of A: board order (row, then column) picks (4,1).
    // From there, the next unhit neighbour closest to A... none adjacent to (4,1) but A: it stops.
    expect(orders[0]).toEqual(['a', 'up']);
    expect(orders[1]).toEqual(orders[0]);
    const e = archer(enemies);
    const state = mutable(e);
    expect(reboundChain(state, unit(e, 'archer'), unit(e, 'a'), 2).map((u) => u.id)).toEqual(['up']);
  });

  it('a first target that dies still passes the arrow on; so does a bounce that kills', () => {
    const e = archer([ORC('a', 4, 2), ORC('b', 5, 2), ORC('c', 6, 2)]);
    unit(e, 'a').hp = 2;
    unit(e, 'b').hp = 1;
    shoot(e);
    expect(e.state.units.map((u) => u.id)).toEqual(['archer', 'c']);
    expect(unit(e, 'c').hp).toBe(7);
  });

  it('preview: the forecast shows the exact path and the HP each one loses, matching the real play', () => {
    const e = archer([ORC('a', 4, 2), ORC('b', 5, 2), ORC('c', 6, 2)]);
    const [rebound] = setHand(e, ['rebound_arrow']);
    const f = archerCardForecast(e.state, CONTENT, rebound!, p(4, 2))!;
    expect(f.predictedHpLoss).toBe(2);
    expect(f.rebound.map((r) => [r.unitId, r.hpLoss])).toEqual([['b', 1], ['c', 1]]);
    expect(f.notes).toContain('Rebote: Orco Guerrero → Orco Guerrero → Orco Guerrero');
    const r = play(e, rebound!, p(4, 2));
    expect(r.ok && ofType(r.events, 'ARROW_REBOUNDED').map((ev) => ev.unitId)).toEqual(['b', 'c']);
  });

  it('PvP authority: the duel engine resolves the chain on the server; extra client fields carry nothing', () => {
    const profile = createProfile(CONTENT);
    let s = createDuel([validateLoadout(profile, 'archer', CONTENT), validateLoadout(profile, 'mage', CONTENT)], 7, 'DUEL', 'classic', CONTENT);
    if (s.duel!.active !== 0) s = applyDuel(s, endTurn(s), CONTENT).state;
    s.units.find((u) => u.id === 'champion-a')!.pos = p(4, 1);
    s.units.find((u) => u.id === 'champion-b')!.pos = p(4, 5);
    s.units.push({ ...structuredClone(s.units.find((u) => u.id === 'champion-b')!), id: 'dummy', defId: 'orc_warrior', kind: 'ENEMY', pos: p(5, 5), hp: 8, maxHp: 8, statuses: [] });
    s.player.hand = [{ uid: 't-reb', cardId: 'rebound_arrow' }];
    const forged = { type: 'PLAY_CARD', cardUid: 't-reb', target: p(4, 5), rebound: ['champion-a'], bounces: 9 } as unknown as Command;
    const r = applyDuel(s, forged, CONTENT);
    const hp = (id: string) => r.state.units.find((u) => u.id === id)!.hp;
    expect(hp('champion-b')).toBe(s.units.find((u) => u.id === 'champion-b')!.hp - 2);
    expect(hp('dummy')).toBe(7);
    expect(hp('champion-a')).toBe(s.units.find((u) => u.id === 'champion-a')!.hp);
  });
});

describe('special arrows — replay / reconnect', () => {
  it('a battle using every special arrow replays to the identical state (statuses, ticks, bounces)', () => {
    const content = withHeroDeck(CONTENT, 'archer', [
      { cardId: 'ice_arrow', count: 8 },
      { cardId: 'fire_arrow', count: 8 },
      { cardId: 'poison_arrow', count: 7 },
      { cardId: 'rebound_arrow', count: 7 },
    ]);
    const sc = scenario({ hero: { heroId: 'archer', pos: p(0, 2) }, layout: EMPTY_7x5, enemies: [ORC('o1', 4, 2), ORC('o2', 5, 2), ORC('o3', 6, 1)] });
    const e = makeEngine(sc, content, 21);
    for (let turn = 0; turn < 4 && !e.state.outcome; turn++) {
      for (const card of [...e.state.player.hand]) {
        const targets = e.getValidTargets(card.uid);
        if (targets.length && e.getCardPlayability(card.uid).playable) e.dispatch({ type: 'PLAY_CARD', cardUid: card.uid, target: targets[0]! });
      }
      if (!e.state.outcome) e.dispatch(endTurn(e));
    }
    const replay = replayBattle(sc, content, 21, e.history);
    expect(replay.rejectedAt).toBeNull();
    expect(JSON.stringify(replay.state)).toBe(JSON.stringify(e.state as GameState));
  });
});
