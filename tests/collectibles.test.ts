import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, validateScenario } from '../src/game';
import { makeEngine, mutable, ofType, p, scenario, setHand, unit, endTurn } from './helpers';

const orbs = [
  { id: 'orb-1', kind: 'ORB' as const, pos: p(2, 0) },
  { id: 'orb-2', kind: 'ORB' as const, pos: p(2, 4) },
];
const stunned = { id: 'STUNNED' as const, turnsLeft: 99 };

describe('COLLECT_OBJECTS', () => {
  const collectBattle = () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(2, 2) },
      collectibles: orbs,
      objectives: [{ type: 'COLLECT_OBJECTS', kind: 'ORB', required: 2 }],
    });
    unit(engine, 'orc-1').statuses.push(stunned);
    return engine;
  };

  it('collectibles start on their tiles, uncollected, at 0/required', () => {
    const engine = collectBattle();
    expect(engine.state.collectibles).toEqual(orbs.map((o) => ({ ...o, collected: false })));
    expect(engine.state.objectives[0]).toMatchObject({ status: 'IN_PROGRESS', current: 0, target: 2 });
  });

  it('walking onto a pickup collects it and advances progress; collecting all wins', () => {
    const engine = collectBattle();
    const first = engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 0) });
    expect(ofType(first.events, 'COLLECTIBLE_COLLECTED')).toEqual([
      { type: 'COLLECTIBLE_COLLECTED', collectibleId: 'orb-1', kind: 'ORB', pos: p(2, 0), unitId: 'mage' },
    ]);
    expect(ofType(first.events, 'OBJECTIVE_UPDATED')[0]).toMatchObject({ current: 1, target: 2, status: 'IN_PROGRESS' });
    expect(engine.state.outcome).toBeNull();

    engine.dispatch(endTurn(engine));
    mutable(engine).player.movePoints = 4;
    const second = engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 4) });
    expect(ofType(second.events, 'COLLECTIBLE_COLLECTED')[0]?.collectibleId).toBe('orb-2');
    expect(engine.state.outcome).toEqual({ result: 'WON', reason: 'OBJECTIVES_COMPLETED' });
    // The enemy is still alive: the mission objective alone decided the battle.
    expect(engine.state.units.some((u) => u.id === 'orc-1')).toBe(true);
  });

  it('passing through a pickup tile on a walk collects it', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(0, 2) },
      collectibles: [{ id: 'orb-1', kind: 'ORB', pos: p(1, 2) }],
      objectives: [{ type: 'COLLECT_OBJECTS', kind: 'ORB', required: 1 }],
    });
    const r = engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(3, 2) });
    expect(ofType(r.events, 'COLLECTIBLE_COLLECTED')).toHaveLength(1);
    expect(engine.state.outcome?.result).toBe('WON');
  });

  it('a teleport onto a pickup collects it', () => {
    const engine = collectBattle();
    const [blink] = setHand(engine, ['blink']);
    const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: blink as string, target: p(2, 4) });
    expect(r.ok).toBe(true);
    expect(engine.state.collectibles.find((c) => c.id === 'orb-2')?.collected).toBe(true);
    expect(engine.state.objectives[0]).toMatchObject({ current: 1 });
  });

  it('enemies walking over a pickup never collect it', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(0, 2) },
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(4, 2) }],
      collectibles: [{ id: 'orb-1', kind: 'ORB', pos: p(3, 2) }],
      objectives: [{ type: 'COLLECT_OBJECTS', kind: 'ORB', required: 1 }],
    });
    const r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'UNIT_MOVED').some((e) => e.unitId === 'orc-1' && e.path.some((t) => t.x === 3 && t.y === 2))).toBe(true);
    expect(ofType(r.events, 'COLLECTIBLE_COLLECTED')).toHaveLength(0);
    expect(engine.state.collectibles[0]?.collected).toBe(false);
  });

  it('only counts pickups of its kind, and an optional round limit fails it', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(2, 2) },
      collectibles: [...orbs, { id: 'page-1', kind: 'PAGE', pos: p(3, 2) }],
      objectives: [{ type: 'COLLECT_OBJECTS', kind: 'ORB', required: 2, roundLimit: 1 }],
    });
    unit(engine, 'orc-1').statuses.push(stunned);
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(3, 2) });
    expect(engine.state.objectives[0]).toMatchObject({ current: 0 });
    const r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'BATTLE_LOST')[0]?.outcome.reason).toBe('ROUND_LIMIT_REACHED');
  });

  it('composition: COLLECT + DEFEAT_TARGET needs both', () => {
    const engine = makeEngine({
      hero: { heroId: 'mage', pos: p(2, 2) },
      enemies: [{ id: 'boss', enemyId: 'orc_warrior', pos: p(6, 2) }],
      collectibles: [{ id: 'orb-1', kind: 'ORB', pos: p(3, 2) }],
      objectives: [
        { type: 'COLLECT_OBJECTS', kind: 'ORB', required: 1 },
        { type: 'DEFEAT_TARGET', targetUnitId: 'boss' },
      ],
    });
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(3, 2) });
    expect(engine.state.objectives.map((o) => o.status)).toEqual(['COMPLETED', 'IN_PROGRESS']);
    expect(engine.state.outcome).toBeNull();
    unit(engine, 'boss').hp = 1;
    const [missile] = setHand(engine, ['magic_missile']);
    engine.dispatch({ type: 'PLAY_CARD', cardUid: missile as string, target: p(6, 2) });
    expect(engine.state.outcome?.result).toBe('WON');
  });
});

describe('SURVIVE_ROUNDS', () => {
  it('counts full rounds survived and wins when the last one ends', () => {
    const engine = makeEngine({ objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 3 }] });
    unit(engine, 'orc-1').statuses.push(stunned);
    expect(engine.state.objectives[0]).toMatchObject({ current: 0, target: 3 });
    engine.dispatch(endTurn(engine));
    expect(engine.state.objectives[0]).toMatchObject({ status: 'IN_PROGRESS', current: 1 });
    engine.dispatch(endTurn(engine));
    expect(engine.state.objectives[0]).toMatchObject({ current: 2 });
    const r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'BATTLE_WON')).toHaveLength(1);
    expect(engine.state.objectives[0]).toMatchObject({ status: 'COMPLETED', current: 3 });
  });

  it('killing every enemy does not end it early; hero death loses', () => {
    const engine = makeEngine({ objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 5 }], hero: { heroId: 'mage', pos: p(5, 2) } });
    mutable(engine).units.find((u) => u.id === 'mage')!.hp = 2;
    const r = engine.dispatch(endTurn(engine));
    expect(ofType(r.events, 'BATTLE_LOST')[0]?.outcome.reason).toBe('HERO_DEFEATED');

    const quiet = makeEngine({ objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 2 }], enemies: [] });
    expect(quiet.state.outcome).toBeNull();
  });
});

describe('collectible validation', () => {
  const errors = (overrides: Parameters<typeof scenario>[0]) =>
    validateScenario(scenario(overrides), DEFAULT_CONTENT).join('\n');
  const one = (pos: { x: number; y: number }, id = 'orb-1') => [{ id, kind: 'ORB' as const, pos }];

  it('rejects pickups outside the board, on blocked tiles, or under an initial unit', () => {
    expect(errors({ collectibles: one(p(9, 9)) })).toMatch(/collectible "orb-1" .* outside/);
    expect(errors({ layout: ['.......', '...#...', '.......', '.......', '.......'], collectibles: one(p(3, 1)) })).toMatch(/blocked tile/);
    expect(errors({ collectibles: one(p(6, 2)) })).toMatch(/overlaps "orc-1"/);
    expect(errors({ collectibles: [...one(p(3, 3)), ...one(p(4, 4))] })).toMatch(/duplicate collectible id/);
  });

  it('rejects pickups the hero can never walk to (walled off)', () => {
    const walled = ['.....x.', '.....x.', '.....x.', '.....x.', '.....x.'];
    expect(errors({ layout: walled, enemies: [], collectibles: one(p(6, 0)) })).toMatch(/unreachable from the hero spawn/);
  });

  it('COLLECT_OBJECTS needs enough pickups of its kind; SURVIVE needs rounds', () => {
    expect(
      errors({ collectibles: one(p(3, 3)), objectives: [{ type: 'COLLECT_OBJECTS', kind: 'ORB', required: 2 }] }),
    ).toMatch(/needs 2 ORB but only 1/);
    expect(errors({ objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 0 }] })).toMatch(/at least 1 round/);
  });
});
