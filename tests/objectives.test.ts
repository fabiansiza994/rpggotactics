import { describe, expect, it } from 'vitest';
import { makeEngine, mutable, ofType, p, setHand, unit, endTurn } from './helpers';

describe('objectives', () => {
  it('ELIMINATE_ALL: wins when the last enemy dies and reports progress', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(2, 2) },
      enemies: [
        { id: 'orc-1', enemyId: 'orc_warrior', pos: p(4, 2) },
        { id: 'orc-2', enemyId: 'orc_warrior', pos: p(2, 4) },
      ],
    });
    unit(engine, 'orc-1').hp = 2;
    unit(engine, 'orc-2').hp = 2;
    const [m1, m2] = setHand(engine, ['magic_missile', 'magic_missile']);
    const first = engine.dispatch({ type: 'PLAY_CARD', cardUid: m1 as string, target: p(4, 2) });
    expect(ofType(first.events, 'OBJECTIVE_UPDATED')[0]).toMatchObject({ status: 'IN_PROGRESS', current: 1, target: 2 });
    expect(engine.state.outcome).toBeNull();
    const second = engine.dispatch({ type: 'PLAY_CARD', cardUid: m2 as string, target: p(2, 4) });
    expect(ofType(second.events, 'BATTLE_WON')[0]?.outcome).toEqual({ result: 'WON', reason: 'OBJECTIVES_COMPLETED' });
  });

  it('ELIMINATE_ALL is not completed while waves are still pending', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(2, 2) },
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(4, 2) }],
      waves: [{ round: 2, enemies: [{ id: 'orc-2', enemyId: 'orc_warrior', pos: p(6, 4) }] }],
    });
    unit(engine, 'orc-1').hp = 1;
    const [m1] = setHand(engine, ['magic_missile']);
    engine.dispatch({ type: 'PLAY_CARD', cardUid: m1 as string, target: p(4, 2) });
    expect(engine.state.outcome).toBeNull();
    const r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'UNIT_SPAWNED')[0]).toMatchObject({ unitId: 'orc-2', pos: p(6, 4) });
    expect(engine.state.objectives[0]).toMatchObject({ current: 1, target: 2 });
  });

  it('PROTECT_TARGET: wins after surviving N full rounds', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(3, 0) },
      structures: [{ id: 'crystal', structureId: 'crystal', pos: p(0, 4) }],
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 0) }],
      objectives: [{ type: 'PROTECT_TARGET', targetUnitId: 'crystal', rounds: 2 }],
    });
    unit(engine, 'orc-1').statuses.push({ id: 'STUNNED', turnsLeft: 99 });
    engine.dispatch(endTurn(engine));
    expect(engine.state.objectives[0]).toMatchObject({ status: 'IN_PROGRESS', current: 1, target: 2 });
    const r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'BATTLE_WON')).toHaveLength(1);
    expect(engine.state.round).toBe(3);
  });

  it('PROTECT_TARGET: loses when the protected unit is destroyed', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(6, 0) },
      structures: [{ id: 'crystal', structureId: 'crystal', pos: p(0, 2) }],
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(1, 2), targetPreference: 'OBJECTIVE' }],
      objectives: [{ type: 'PROTECT_TARGET', targetUnitId: 'crystal', rounds: 6 }],
    });
    unit(engine, 'crystal').hp = 3;
    const r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'BATTLE_LOST')[0]?.outcome).toEqual({ result: 'LOST', reason: 'PROTECTED_TARGET_DESTROYED' });
    expect(engine.state.phase).toBe('ENDED');
  });

  it('REACH_TILE: wins as soon as the hero steps on an exit', () => {
    const engine = makeEngine({
      layout: ['.......', '.......', '...E...', '.......', '.......'],
      objectives: [{ type: 'REACH_TILE', tiles: [p(3, 2)], roundLimit: 7 }],
      hero: { heroId: 'mage', pos: p(0, 2) },
    });
    const r = engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(3, 2) });
    expect(ofType(r.events, 'BATTLE_WON')).toHaveLength(1);
  });

  it('REACH_TILE: loses when the round limit passes', () => {
    const engine = makeEngine({
      objectives: [{ type: 'REACH_TILE', tiles: [p(6, 4)], roundLimit: 2 }],
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 0) }],
    });
    unit(engine, 'orc-1').statuses.push({ id: 'STUNNED', turnsLeft: 99 });
    engine.dispatch(endTurn(engine));
    expect(engine.state.outcome).toBeNull();
    const r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'BATTLE_LOST')[0]?.outcome.reason).toBe('ROUND_LIMIT_REACHED');
  });

  it('hero death always loses', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(5, 2) } });
    mutable(engine).units.find((u) => u.id === 'mage')!.hp = 2;
    const r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'UNIT_DEFEATED')[0]?.unitId).toBe('mage');
    expect(ofType(r.events, 'BATTLE_LOST')[0]?.outcome.reason).toBe('HERO_DEFEATED');
  });
});
