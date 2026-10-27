import { describe, expect, it } from 'vitest';
import { tileAt } from '../src/game/domain/board/board';
import { computeDamage, dealDamage } from '../src/game/domain/combat/damage';
import { applyStatus } from '../src/game/domain/statuses/status-rules';
import type { GameEvent } from '../src/game/domain/events';
import { ENEMIES } from '../src/game/data';
import { ctxFor, makeEngine, mutable, ofType, p, setHand, unit, endTurn } from './helpers';

const ORC_HP = ENEMIES.orc_warrior!.maxHp;

describe('damage & shields', () => {
  it('finalDamage = max(0, base - armor), then shield absorbs before HP', () => {
    const u = { hp: 10, shield: 2, armor: 1 } as Parameters<typeof computeDamage>[0];
    expect(computeDamage(u, 5)).toEqual({ armorMitigated: 1, shieldAbsorbed: 2, hpLost: 2 });
    expect(computeDamage(u, 1)).toEqual({ armorMitigated: 1, shieldAbsorbed: 0, hpLost: 0 });
  });

  it('defeats units at 0 HP, removes them and their intent', () => {
    const engine = makeEngine();
    const events: GameEvent[] = [];
    const orc = unit(engine, 'orc-1');
    dealDamage(ctxFor(engine, events), orc, 99, 'test', 'ARCANE');
    expect(engine.state.units.find((u) => u.id === 'orc-1')).toBeUndefined();
    expect(engine.state.intents).toHaveLength(0);
    expect(ofType(events, 'UNIT_DEFEATED')[0]).toMatchObject({ unitId: 'orc-1', pos: p(6, 2) });
    expect(ofType(events, 'UNIT_DAMAGED')[0]).toMatchObject({ hpLost: ORC_HP, hpAfter: 0 });
  });

  it('Barrier shields an ally; the shield breaks on damage and expires on the owner turn start', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(1, 2) },
      structures: [{ id: 'crystal', structureId: 'crystal', pos: p(0, 2) }],
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 4) }],
    });
    const [barrier] = setHand(engine, ['barrier']);
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: barrier as string, target: p(0, 2) });
    expect(ofType(r.events, 'SHIELD_GAINED')[0]).toMatchObject({ unitId: 'crystal', amount: 4, total: 4 });

    const events: GameEvent[] = [];
    dealDamage(ctxFor(engine, events), unit(engine, 'crystal'), 5, 'orc-1', 'PHYSICAL');
    expect(ofType(events, 'UNIT_DAMAGED')[0]).toMatchObject({ shieldAbsorbed: 4, hpLost: 1 });
    expect(ofType(events, 'SHIELD_BROKEN')).toHaveLength(1);

    const [barrier2] = setHand(engine, ['barrier']);
    engine.dispatch({ type: 'PLAY_CARD', cardUid: barrier2 as string, target: p(1, 2) });
    const end = engine.dispatch(endTurn(engine));
    expect(ofType(end.events, 'SHIELD_EXPIRED')[0]).toMatchObject({ unitId: 'mage', amount: 4 });
    expect(unit(engine, 'mage').shield).toBe(0);
  });
});

describe('push', () => {
  it('Force Push damages and pushes away from the caster', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(1, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(2, 2) }] });
    const [push] = setHand(engine, ['force_push']);
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: push as string, target: p(2, 2) });
    expect(unit(engine, 'orc-1').pos).toEqual(p(4, 2));
    expect(unit(engine, 'orc-1').hp).toBe(ORC_HP - 1);
    expect(ofType(r.events, 'UNIT_PUSHED')[0]).toMatchObject({ from: p(2, 2), to: p(4, 2), direction: 'RIGHT', collision: null });
  });

  it('collision with an obstacle stops the push and deals extra damage', () => {
    const engine = makeEngine({
      layout: ['.......', '.......', '....#..', '.......', '.......'],
      hero: { heroId: 'mage', pos: p(1, 2) },
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(2, 2) }],
    });
    const [push] = setHand(engine, ['force_push']);
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: push as string, target: p(2, 2) });
    expect(unit(engine, 'orc-1').pos).toEqual(p(3, 2));
    expect(unit(engine, 'orc-1').hp).toBe(ORC_HP - 2);
    expect(ofType(r.events, 'UNIT_PUSHED')[0]?.collision).toBe('OBSTACLE');
  });

  it('collision with another unit damages both; the board edge also stops pushes', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(4, 2) },
      enemies: [
        { id: 'orc-1', enemyId: 'orc_warrior', pos: p(5, 2) },
        { id: 'orc-2', enemyId: 'orc_warrior', pos: p(6, 2) },
      ],
    });
    const [push] = setHand(engine, ['force_push']);
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: push as string, target: p(5, 2) });
    expect(ofType(r.events, 'UNIT_PUSHED')[0]).toMatchObject({ collision: 'UNIT', from: p(5, 2), to: p(5, 2) });
    expect(unit(engine, 'orc-1').hp).toBe(ORC_HP - 2);
    expect(unit(engine, 'orc-2').hp).toBe(ORC_HP - 1);
  });
});

describe('teleport', () => {
  it('Blink teleports the caster ignoring obstacles and root, without spending MP', () => {
    const engine = makeEngine({
      layout: ['.......', '.#.....', '.#.....', '.#.....', '.......'],
      hero: { heroId: 'mage', pos: p(0, 2) },
    });
    unit(engine, 'mage').statuses.push({ id: 'ROOTED', turnsLeft: 1 });
    const [blink] = setHand(engine, ['blink']);
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: blink as string, target: p(2, 1) });
    expect(r.ok).toBe(true);
    expect(unit(engine, 'mage').pos).toEqual(p(2, 1));
    expect(engine.state.player.movePoints).toBe(3);
    expect(ofType(r.events, 'UNIT_TELEPORTED')[0]).toMatchObject({ from: p(0, 2), to: p(2, 1) });
    expect(ofType(r.events, 'UNIT_MOVED')).toHaveLength(0);
  });
});

describe('terrain', () => {
  it('Flame Tile creates temporary FIRE that damages units ending their turn on it, then expires', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(0, 2) },
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(2, 1) }],
    });
    unit(engine, 'orc-1').statuses.push({ id: 'ROOTED', turnsLeft: 1 }); // keep it on the fire tile
    const [flame] = setHand(engine, ['flame_tile']);
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: flame as string, target: p(2, 1) });
    expect(ofType(r.events, 'TERRAIN_CREATED')[0]).toMatchObject({ terrain: 'FIRE', previous: 'NORMAL', turnsLeft: 3 });

    const end = engine.dispatch(endTurn(engine));
    const burn = ofType(end.events, 'UNIT_DAMAGED').find((e) => e.sourceId === 'terrain:FIRE');
    expect(burn).toMatchObject({ unitId: 'orc-1', hpLost: 2, damageType: 'FIRE' });
    expect(tileAt(engine.state.board, p(2, 1))?.terrainTurnsLeft).toBe(2);

    engine.dispatch(endTurn(engine));
    const last = engine.dispatch(endTurn(engine));
    expect(ofType(last.events, 'TERRAIN_REMOVED')[0]).toMatchObject({ pos: p(2, 1), terrain: 'FIRE', reason: 'EXPIRED' });
    expect(tileAt(engine.state.board, p(2, 1))?.terrain).toBe('NORMAL');
  });

  it('Ice Wall creates a 3-tile temporary wall perpendicular to the caster that blocks movement', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(0, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 4) }] });
    const [wall] = setHand(engine, ['ice_wall']);
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: wall as string, target: p(2, 2) });
    expect(ofType(r.events, 'OBSTACLE_CREATED').map((e) => e.pos)).toEqual([p(2, 1), p(2, 2), p(2, 3)]);
    expect(engine.getLegalMoves().some((n) => n.pos.x >= 2 && n.pos.y >= 1 && n.pos.y <= 3 && n.pos.x === 2)).toBe(false);

    engine.dispatch(endTurn(engine));
    expect(engine.state.obstacles).toHaveLength(3);
    const second = engine.dispatch(endTurn(engine));
    expect(ofType(second.events, 'OBSTACLE_REMOVED')).toHaveLength(3);
    expect(engine.state.obstacles).toHaveLength(0);
  });

  it('Dispel removes hazard terrain and negative statuses from allies', () => {
    const engine = makeEngine({ layout: ['.......', '.......', 'F......', '.......', '.......'] });
    unit(engine, 'mage').statuses.push({ id: 'BURNING', turnsLeft: 2 });
    const [dispel] = setHand(engine, ['dispel']);
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: dispel as string, target: p(0, 2) });
    expect(ofType(r.events, 'STATUS_REMOVED')[0]).toMatchObject({ status: 'BURNING', reason: 'CLEANSED' });
    expect(ofType(r.events, 'TERRAIN_REMOVED')[0]).toMatchObject({ terrain: 'FIRE', revertedTo: 'NORMAL', reason: 'CLEANSED' });
    expect(tileAt(engine.state.board, p(0, 2))?.terrain).toBe('NORMAL');
  });
});

describe('statuses', () => {
  it('BURNING ticks at the owner turn start and expires after its duration', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(0, 0) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 4) }] });
    applyStatus(ctxFor(engine), unit(engine, 'orc-1'), 'BURNING', 2, 'test');
    const first = engine.dispatch(endTurn(engine));
    expect(ofType(first.events, 'UNIT_DAMAGED').find((e) => e.sourceId === 'status:BURNING')).toMatchObject({ unitId: 'orc-1', hpLost: 1 });
    expect(unit(engine, 'orc-1').statuses[0]?.turnsLeft).toBe(1);
    const second = engine.dispatch(endTurn(engine));
    expect(ofType(second.events, 'STATUS_REMOVED')[0]).toMatchObject({ unitId: 'orc-1', status: 'BURNING', reason: 'EXPIRED' });
    expect(unit(engine, 'orc-1').hp).toBe(ORC_HP - 2);
  });

  it('stacking rules: REFRESH keeps the max duration, IGNORE keeps the original', () => {
    const engine = makeEngine();
    const ctx = ctxFor(engine);
    const orc = unit(engine, 'orc-1');
    applyStatus(ctx, orc, 'BURNING', 3, 't');
    applyStatus(ctx, orc, 'BURNING', 1, 't');
    expect(orc.statuses.find((s) => s.id === 'BURNING')?.turnsLeft).toBe(3);
    applyStatus(ctx, orc, 'STUNNED', 1, 't');
    applyStatus(ctx, orc, 'STUNNED', 5, 't');
    expect(orc.statuses.find((s) => s.id === 'STUNNED')?.turnsLeft).toBe(1);
  });

  it('Frost Nova roots adjacent enemies so they cannot move on their turn, then root expires', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(3, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(4, 3) }] });
    const [nova] = setHand(engine, ['frost_nova']);
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: nova as string, target: null });
    expect(ofType(r.events, 'STATUS_APPLIED')[0]).toMatchObject({ unitId: 'orc-1', status: 'ROOTED', turnsLeft: 1 });
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) });
    const end = engine.dispatch(endTurn(engine));
    expect(ofType(end.events, 'UNIT_MOVED').filter((e) => e.unitId === 'orc-1')).toHaveLength(0);
    expect(unit(engine, 'orc-1').pos).toEqual(p(4, 3));
    expect(unit(engine, 'orc-1').statuses).toHaveLength(0);
  });

  it('STUNNED enemies skip their action', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(3, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(4, 2) }] });
    applyStatus(ctxFor(engine), unit(engine, 'orc-1'), 'STUNNED', 1, 'test');
    const end = engine.dispatch(endTurn(engine));
    expect(ofType(end.events, 'ENEMY_ATTACKED')).toHaveLength(0);
    expect(unit(engine, 'mage').hp).toBe(20);
    expect(mutable(engine).intents[0]?.kind).toBe('MELEE_ATTACK'); // stun expired, acts next round
  });
});
