import { describe, expect, it } from 'vitest';
import { posKey } from '../src/game/domain/core/position';
import { makeEngine, mutable, ofType, p, unit } from './helpers';

describe('hero movement', () => {
  it('moves orthogonally, consumes MP and emits UNIT_MOVED with the path', () => {
    const engine = makeEngine();
    const result = engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 1) });
    expect(result.ok).toBe(true);
    expect(unit(engine, 'mage').pos).toEqual(p(2, 1));
    expect(engine.state.player.movePoints).toBe(0);
    const moved = ofType(result.events, 'UNIT_MOVED')[0];
    expect(moved).toMatchObject({ unitId: 'mage', from: p(0, 2), to: p(2, 1), cost: 3 });
    expect(moved?.path).toHaveLength(3);
    expect(ofType(result.events, 'MOVE_POINTS_CHANGED')[0]).toMatchObject({ from: 3, to: 0 });
  });

  it('allows splitting movement across several commands', () => {
    const engine = makeEngine();
    expect(engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) }).ok).toBe(true);
    expect(engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) }).ok).toBe(true);
    expect(engine.state.player.movePoints).toBe(1);
  });

  it('rejects tiles beyond the remaining MP, out of bounds, or diagonal-only shortcuts', () => {
    const engine = makeEngine();
    expect(engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(4, 2) }).ok).toBe(false);
    expect(engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(-1, 2) }).ok).toBe(false);
    const legal = new Set(engine.getLegalMoves().map((n) => posKey(n.pos)));
    expect(legal.has('3,2')).toBe(true);
    expect(legal.has('4,2')).toBe(false);
    expect(legal.has('0,2')).toBe(false); // own tile is not a destination
  });

  it('cannot cross obstacles or units', () => {
    const engine = makeEngine({
      layout: ['.#.....', '.#.....', '.#.....', '.#.....', '.......'],
      hero: { heroId: 'mage', pos: p(0, 0) },
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(0, 3) }],
    });
    const legal = new Set(engine.getLegalMoves().map((n) => posKey(n.pos)));
    expect(legal).toEqual(new Set(['0,1', '0,2'])); // pillar column and the orc block the rest
    const blocked = engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 0) });
    expect(blocked).toMatchObject({ ok: false, error: 'UNREACHABLE' });
    expect(engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(0, 3) }).ok).toBe(false);
  });

  it('cannot enter BLOCKED terrain', () => {
    const engine = makeEngine({ layout: ['.......', '.......', '.x.....', '.......', '.......'] });
    expect(engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) }).ok).toBe(false);
  });

  it('pays +1 MP when leaving an ICE tile', () => {
    const engine = makeEngine({ layout: ['.......', '.......', 'I......', '.......', '.......'] });
    const legal = new Map(engine.getLegalMoves().map((n) => [posKey(n.pos), n.cost]));
    expect(legal.get('1,2')).toBe(2);
    expect(legal.get('2,2')).toBe(3);
    expect(legal.has('3,2')).toBe(false);
  });

  it('only the hero is controllable and rooted units cannot walk', () => {
    const engine = makeEngine();
    expect(engine.dispatch({ type: 'MOVE_UNIT', unitId: 'orc-1', to: p(5, 2) })).toMatchObject({
      ok: false,
      error: 'UNIT_NOT_CONTROLLABLE',
    });
    unit(engine, 'mage').statuses.push({ id: 'ROOTED', turnsLeft: 1 });
    expect(engine.getLegalMoves()).toEqual([]);
    expect(engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) })).toMatchObject({
      ok: false,
      error: 'MOVEMENT_PREVENTED',
    });
  });

  it('rejected commands leave the state untouched', () => {
    const engine = makeEngine();
    const before = engine.state;
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(6, 4) });
    expect(engine.state).toBe(before);
    expect(mutable(engine).player.movePoints).toBe(3);
  });
});
