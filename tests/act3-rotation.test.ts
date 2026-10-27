import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { GameEngine } from '../src/game/engine/GameEngine';
import { replayBattle } from '../src/game/engine/replay';
import { queryContext } from '../src/game/domain/context';
import { computeReachable } from '../src/game/domain/board/pathfinding';
import { hasLineOfSight } from '../src/game/domain/board/line-of-sight';
import type { MechanismBoardDef, MechanismDef, RegionDef } from '../src/game/domain/mechanisms/mechanism';
import { mechanismById } from '../src/game/domain/mechanisms/mechanism-board';
import { rotateCell } from '../src/game/domain/mechanisms/mechanism-transform';
import { validateScenario } from '../src/game/domain/scenario-validation';
import { spawnSummon } from '../src/game/domain/summons/summons';
import type { ScenarioDef } from '../src/game/domain/scenario';
import type { GameState } from '../src/game/domain/state';
import { ctxFor, endTurn, makeEngine, mutable, ofType, p, scenario, unit } from './helpers';

const CONTENT = withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
const QUIET: Partial<ScenarioDef> = { enemies: [], objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 30 }] };

// 7×5 board. The section is the 3×3 block x 3..5, y 1..3 (pivot 4.5, 2.5); the wall at (3,1) is its
// top-left corner. The CW lever sits just left of it at (2,2); the CCW one under it at (2,4).
const LAYOUT = ['.......', '...#...', '.......', '.......', '.......'];
const CELLS = [1, 2, 3].flatMap((y) => [3, 4, 5].map((x) => p(x, y)));
const SECTION = (region: Partial<RegionDef> = {}, extra: Partial<MechanismDef> = {}): MechanismDef => ({
  id: 'section',
  kind: 'REGION',
  pos: p(3, 1),
  region: { cells: CELLS, pivot: { x: 4.5, y: 2.5 }, ...region },
  ...extra,
});
const BOARD = (region: Partial<RegionDef> = {}, objects: MechanismDef[] = [], rules: MechanismBoardDef['rules'] = []): MechanismBoardDef => ({
  objects: [
    SECTION(region),
    { id: 'lever', kind: 'SWITCH', pos: p(2, 2), momentary: true, interactionMode: 'REPEATABLE_CONTROL', prompt: 'GIRAR' },
    { id: 'lever-ccw', kind: 'SWITCH', pos: p(2, 4), momentary: true, interactionMode: 'REPEATABLE_CONTROL', prompt: 'GIRAR' },
    ...objects,
  ],
  rules: [
    { id: 'cw', trigger: { type: 'ON_INTERACT', sources: ['lever'] }, actions: [{ type: 'ROTATE', targets: ['section'], turns: 1 }] },
    { id: 'ccw', trigger: { type: 'ON_INTERACT', sources: ['lever-ccw'] }, actions: [{ type: 'ROTATE', targets: ['section'], turns: -1 }] },
    ...rules,
  ],
});
const engineWith = (mechanisms: MechanismBoardDef, overrides: Partial<ScenarioDef> = {}) =>
  makeEngine({ ...QUIET, layout: LAYOUT, hero: { heroId: 'mage', pos: p(1, 2) }, mechanisms, ...overrides }, CONTENT);
const section = (e: GameEngine) => mechanismById(e.state, 'section')!;
const interact = (e: GameEngine, mechanismId: string) => e.dispatch({ type: 'INTERACT', mechanismId });
const cues = (events: readonly { type: string }[]) => ofType(events as never, 'MECHANISM_CHANGED').map((x) => x.cue);
const walls = (e: GameEngine) => e.state.obstacles.map((o) => `${o.pos.x},${o.pos.y}`).sort();
const roundTrip = (e: GameEngine) => GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)) as GameState, e.content, e.scenario);
/** Gameplay state without the turn-local RNG/ids noise: what a reconnect must reproduce. */
const board = (s: Readonly<GameState>) => JSON.stringify([s.board, s.units.map((u) => [u.id, u.pos, u.hp]), s.obstacles, s.mechanisms]);

describe('rotateCell', () => {
  it('quarter turns clockwise about a cell-centre pivot, and four turns are the identity', () => {
    const pivot = { x: 4.5, y: 2.5 };
    expect(rotateCell(p(3, 1), pivot, 1)).toEqual(p(5, 1));
    expect(rotateCell(p(3, 1), pivot, 2)).toEqual(p(5, 3));
    expect(rotateCell(p(3, 1), pivot, 3)).toEqual(p(3, 3));
    expect(rotateCell(p(3, 1), pivot, -1)).toEqual(p(3, 3));
    expect(rotateCell(p(3, 1), pivot, 4)).toEqual(p(3, 1));
    expect(rotateCell(p(4, 2), pivot, 1)).toEqual(p(4, 2)); // the pivot cell stays
  });
  it('works for an even section about a tile corner', () => {
    expect(rotateCell(p(0, 0), { x: 1, y: 1 }, 1)).toEqual(p(1, 0));
    expect(rotateCell(p(1, 0), { x: 1, y: 1 }, 1)).toEqual(p(1, 1));
  });
});

describe('Act III phase 3 — rotating sections (ROTATE)', () => {
  it('empty section: the wall turns with it, ORIENTATION_90, one SECTION_ROTATED', () => {
    const e = engineWith(BOARD());
    const r = interact(e, 'lever');
    expect(r.ok).toBe(true);
    expect(cues(r.events)).toEqual(['SWITCH_ACTIVATED', 'SECTION_ROTATED']);
    const ev = ofType(r.events, 'MECHANISM_CHANGED').find((x) => x.cue === 'SECTION_ROTATED')!;
    expect(ev.rotation).toMatchObject({ from: 0, to: 90, turns: 1, pivot: { x: 4.5, y: 2.5 } });
    expect(ev.causeId).toBe('lever');
    expect(walls(e)).toEqual(['5,1']);
    expect(section(e)).toMatchObject({ state: 'ORIENTATION_90', active: true });
  });

  it('90 → 180 → 270 → 0: every orientation, and a full turn restores the board exactly', () => {
    const e = engineWith(BOARD(), { enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(5, 3) }] });
    const before = board(e.state);
    const seen: string[] = [];
    const wallAt: string[] = [];
    for (let i = 0; i < 4; i++) {
      expect(interact(e, 'lever').ok).toBe(true);
      seen.push(section(e).state);
      wallAt.push(walls(e)[0]!);
    }
    expect(seen).toEqual(['ORIENTATION_90', 'ORIENTATION_180', 'ORIENTATION_270', 'ORIENTATION_0']);
    expect(wallAt).toEqual(['5,1', '5,3', '3,3', '3,1']);
    // Everything back in place; only the "was ever used" bookkeeping remembers the spin.
    expect(board(e.state).replace(',"everActive":true', '')).toBe(before);
    expect(section(e).active).toBe(false);
  });

  it('counter-clockwise control undoes a clockwise turn', () => {
    const e = engineWith(BOARD(), { hero: { heroId: 'mage', pos: p(2, 3) } });
    interact(e, 'lever');
    expect(interact(e, 'lever-ccw').ok).toBe(true);
    expect(section(e).state).toBe('ORIENTATION_0');
    expect(walls(e)).toEqual(['3,1']);
  });

  it('carries the champion (HP, statuses, movement points kept) as a mechanism teleport', () => {
    const e = engineWith(BOARD(), { hero: { heroId: 'mage', pos: p(3, 2) } });
    mutable(e).units[0]!.hp = 11;
    const mp = e.state.player.movePoints;
    const r = interact(e, 'lever');
    expect(unit(e, 'mage')).toMatchObject({ pos: p(4, 1), hp: 11 });
    expect(e.state.player.movePoints).toBe(mp);
    expect(ofType(r.events, 'UNIT_TELEPORTED')).toEqual([{ type: 'UNIT_TELEPORTED', unitId: 'mage', from: p(3, 2), to: p(4, 1), sourceId: 'mechanism:section' }]);
    expect(ofType(r.events, 'MECHANISM_CHANGED').find((x) => x.cue === 'SECTION_ROTATED')!.carriedIds).toContain('mage');
  });

  it('carries an enemy (and turns its telegraphed charge with it)', () => {
    const e = engineWith(BOARD(), { enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(5, 3) }] });
    mutable(e).intents = [{ kind: 'CHARGE', enemyId: 'orc-1', direction: 'LEFT', range: 3, damage: 2 }];
    interact(e, 'lever');
    expect(unit(e, 'orc-1').pos).toEqual(p(3, 3));
    expect(e.state.intents[0]).toMatchObject({ kind: 'CHARGE', direction: 'UP' });
  });

  it('carries a summon with its ownership and summon data', () => {
    const e = engineWith(BOARD(), { hero: { heroId: 'summoner', pos: p(1, 2) } });
    const fox = spawnSummon(ctxFor(e), unit(e, 'summoner'), 'fox', p(5, 2))!;
    const data = structuredClone(fox.summon);
    interact(e, 'lever');
    const moved = unit(e, fox.id);
    expect(moved.pos).toEqual(p(4, 3));
    expect(moved.summon).toEqual(data);
  });

  it('carries a statue, and a plate keeps the statue pressed (no release/press edge)', () => {
    const e = engineWith(
      BOARD({}, [
        { id: 'plate', kind: 'PRESSURE_PLATE', pos: p(5, 1) },
        { id: 'statue', kind: 'STATUE', pos: p(5, 1) },
        { id: 'bell', kind: 'SWITCH', pos: p(4, 3) },
      ]),
      { layout: ['.......', '.......', '.......', '.......', '.......'] },
    );
    expect(mechanismById(e.state, 'plate')!.active).toBe(true);
    const r = interact(e, 'lever');
    expect(mechanismById(e.state, 'statue')!.pos).toEqual(p(5, 3));
    expect(mechanismById(e.state, 'plate')!).toMatchObject({ pos: p(5, 3), active: true });
    expect(mechanismById(e.state, 'bell')!.pos).toEqual(p(3, 2)); // a mechanism on the section rides too
    expect(cues(r.events)).not.toContain('PLATE_RELEASED');
    expect(cues(r.events)).not.toContain('PLATE_PRESSED');
  });

  it('floor terrain (a chasm) turns with the section', () => {
    const e = engineWith(BOARD(), { layout: ['.......', '...x...', '.......', '.......', '.......'] });
    interact(e, 'lever');
    const t = (x: number, y: number) => e.state.board.tiles[y * 7 + x]!.terrain;
    expect(t(3, 1)).not.toBe('BLOCKED');
    expect(t(5, 1)).toBe('BLOCKED');
  });

  it('BLOCKED: units that do not ride would end inside a wall → refused, nothing changes', () => {
    const e = engineWith(BOARD({ occupantsMoveWithRegion: false, blockedByOccupancy: true }), {
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(5, 1) }],
    });
    const before = board(e.state);
    const r = interact(e, 'lever');
    expect(r.ok).toBe(true); // the lever was pulled; the section refused to turn
    expect(cues(r.events)).toEqual(['SWITCH_ACTIVATED', 'SECTION_ROTATION_BLOCKED']);
    expect(ofType(r.events, 'MECHANISM_CHANGED').find((x) => x.cue === 'SECTION_ROTATION_BLOCKED')!.reason).toBeTruthy();
    expect(board(e.state)).toBe(before);
    expect(ofType(r.events, 'UNIT_TELEPORTED')).toEqual([]);
  });

  it('BLOCKED: a pedestal that does not ride would end inside the turned wall', () => {
    const e = engineWith(BOARD({ mechanismsMoveWithRegion: false }, [{ id: 'pedestal', kind: 'SWITCH', pos: p(5, 1) }]));
    const before = board(e.state);
    const r = interact(e, 'lever');
    expect(cues(r.events)).toContain('SECTION_ROTATION_BLOCKED');
    expect(board(e.state)).toBe(before);
  });

  it('BLOCKED: an orientation outside allowedOrientations; ADVANCE toggles between the allowed ones', () => {
    const e = engineWith(BOARD({ allowedOrientations: [0, 90] }));
    interact(e, 'lever');
    const r = interact(e, 'lever');
    expect(cues(r.events)).toContain('SECTION_ROTATION_BLOCKED');
    expect(section(e).state).toBe('ORIENTATION_90');

    const t = engineWith({
      objects: [SECTION({ allowedOrientations: [0, 90] }), { id: 'lever', kind: 'SWITCH', pos: p(2, 2), momentary: true, interactionMode: 'REPEATABLE_CONTROL' }],
      rules: [{ id: 'toggle', trigger: { type: 'ON_INTERACT', sources: ['lever'] }, actions: [{ type: 'ADVANCE', targets: ['section'] }] }],
    });
    interact(t, 'lever');
    expect(section(t).state).toBe('ORIENTATION_90');
    interact(t, 'lever');
    expect(section(t).state).toBe('ORIENTATION_0');
  });

  it('blockedByOccupancy: refuses to turn while anyone stands on it', () => {
    const e = engineWith(BOARD({ blockedByOccupancy: true }), { hero: { heroId: 'mage', pos: p(3, 2) } });
    const r = interact(e, 'lever');
    expect(cues(r.events)).toContain('SECTION_ROTATION_BLOCKED');
    expect(unit(e, 'mage').pos).toEqual(p(3, 2));
  });

  it('RESET and MOVE{orientation} reach an exact orientation', () => {
    const e = engineWith(
      BOARD({}, [
        { id: 'home', kind: 'SWITCH', pos: p(0, 0), momentary: true, interactionMode: 'REPEATABLE_CONTROL' },
        { id: 'half', kind: 'SWITCH', pos: p(0, 4), momentary: true, interactionMode: 'REPEATABLE_CONTROL' },
      ], [
        { id: 'reset', trigger: { type: 'ON_INTERACT', sources: ['home'] }, actions: [{ type: 'RESET', targets: ['section'] }] },
        { id: 'to180', trigger: { type: 'ON_INTERACT', sources: ['half'] }, actions: [{ type: 'MOVE', targets: ['section'], orientation: 180 }] },
      ]),
      { hero: { heroId: 'mage', pos: p(1, 4) } },
    );
    mutable(e).units[0]!.pos = p(1, 4);
    expect(interact(e, 'half').ok).toBe(true);
    expect(section(e).state).toBe('ORIENTATION_180');
    expect(walls(e)).toEqual(['5,3']);
    mutable(e).units[0]!.pos = p(1, 0);
    interact(e, 'home');
    expect(section(e).state).toBe('ORIENTATION_0');
    expect(walls(e)).toEqual(['3,1']);
  });
});

describe('Act III phase 3 — pathfinding and line of sight follow the grid', () => {
  // A wall column inside the section: x=4, y=1..3 splits it. After a quarter turn it is a row (y=2).
  const SPLIT = ['.......', '....#..', '....#..', '....#..', '.......'];
  it('a path closes and another opens after a turn', () => {
    const e = engineWith(BOARD(), { layout: SPLIT, hero: { heroId: 'mage', pos: p(3, 2) } });
    const reach = () => computeReachable(queryContext(mutable(e), e.content), unit(e, 'mage'), 2);
    expect(reach().has('4,1')).toBe(false); // wall
    expect(reach().has('5,2')).toBe(false); // behind the wall, 2 steps is not enough
    mutable(e).units[0]!.pos = p(2, 3);
    interact(e, 'lever-ccw'); // hero at (2,3) is adjacent to the CCW lever (2,4)
    mutable(e).units[0]!.pos = p(3, 1);
    expect(walls(e)).toEqual(['3,2', '4,2', '5,2']);
    expect(reach().has('5,1')).toBe(true); // the top row is open now
    expect(reach().has('3,3')).toBe(false); // the bottom row is cut off (2 steps)
  });

  it('line of sight is recomputed from the turned walls', () => {
    const e = engineWith(BOARD(), { layout: SPLIT });
    const los = () => hasLineOfSight(queryContext(mutable(e), e.content), p(3, 1), p(5, 1));
    expect(los()).toBe(false);
    interact(e, 'lever');
    expect(walls(e)).toEqual(['3,2', '4,2', '5,2']);
    expect(los()).toBe(true);
  });

  it('an enemy re-routes through the new geometry on its turn', () => {
    // The orc (6,1) wants the champion (2,1). Row 1 is cut by the split wall at (4,1); after a quarter
    // turn the wall is the row y=2 and the orc walks straight through where the wall stood.
    const run = (rotate: boolean) => {
      const e = engineWith(BOARD(), { layout: SPLIT, hero: { heroId: 'mage', pos: p(2, 1) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 1) }] });
      if (rotate) interact(e, 'lever');
      const moved = ofType(e.dispatch(endTurn(e)).events, 'UNIT_MOVED').filter((m) => m.unitId === 'orc-1');
      return moved.flatMap((m) => m.path.map((t) => `${t.x},${t.y}`));
    };
    expect(run(false)).not.toContain('4,1');
    expect(run(true)).toContain('4,1');
  });
});

describe('Act III phase 3 — repeatable control, replay, reconnect', () => {
  it('REPEATABLE_CONTROL: many turns per round, and it never spends the turn interaction', () => {
    const e = engineWith(BOARD({}, [{ id: 'bell', kind: 'SWITCH', pos: p(1, 1) }]));
    for (let i = 0; i < 6; i++) expect(interact(e, 'lever').ok).toBe(true);
    expect(section(e).state).toBe('ORIENTATION_180');
    expect(interact(e, 'bell').ok).toBe(true); // the one ordinary interaction is still available
    expect(interact(e, 'bell').ok).toBe(false);
    expect(interact(e, 'lever').ok).toBe(true); // and the control still is
  });

  it('fails closed: a reward/spawn rule the section can reach makes the control an ordinary interaction', () => {
    // The plate rides the section (4,1): turning it could press/release it → not free.
    const e = engineWith(
      BOARD({}, [{ id: 'plate', kind: 'PRESSURE_PLATE', pos: p(4, 1) }], [
        { id: 'reward', trigger: { type: 'ON_OCCUPIED', sources: ['plate'] }, actions: [{ type: 'COMPLETE_OBJECTIVE', flag: 'won' }], once: true },
      ]),
    );
    expect(interact(e, 'lever').ok).toBe(true);
    const again = interact(e, 'lever');
    expect(again.ok).toBe(false);
    expect(again.ok ? '' : again.error).toBe('INTERACTION_USED');
    expect(e.state.mechanisms!.flags).toEqual([]);
  });

  it('narrow rule (XXIX): the same reward plate OUTSIDE the section leaves the control free', () => {
    const e = engineWith(
      BOARD({}, [{ id: 'plate', kind: 'PRESSURE_PLATE', pos: p(6, 0) }], [
        { id: 'reward', trigger: { type: 'ON_OCCUPIED', sources: ['plate'] }, actions: [{ type: 'COMPLETE_OBJECTIVE', flag: 'won' }], once: true },
      ]),
    );
    for (let k = 0; k < 3; k++) expect(interact(e, 'lever').ok).toBe(true);
    expect(e.state.mechanisms!.flags).toEqual([]);
  });

  it('no duplicate rewards: spinning a full circle many times raises nothing and spawns nothing', () => {
    const e = engineWith(BOARD());
    const units = e.state.units.length;
    const events = [];
    for (let i = 0; i < 12; i++) events.push(...interact(e, 'lever').events);
    expect(e.state.mechanisms!.flags).toEqual([]);
    expect(e.state.units.length).toBe(units);
    expect(ofType(events, 'MECHANISM_CHANGED').filter((x) => x.cue === 'SECTION_ROTATED')).toHaveLength(12);
  });

  it('replay: the command log rebuilds the exact rotated board', () => {
    const e = engineWith(BOARD(), { hero: { heroId: 'mage', pos: p(3, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(5, 3) }] });
    interact(e, 'lever');
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(3, 1) });
    e.dispatch(endTurn(e));
    mutable(e); // no direct mutation below: the replay must reproduce dispatches only
    const { state, rejectedAt } = replayBattle(e.scenario, e.content, e.seed, e.history);
    expect(rejectedAt).toBeNull();
    expect(board(state)).toBe(board(e.state));
  });

  it('reconnect: a snapshot mid-puzzle keeps orientation and keeps rotating identically', () => {
    const e = engineWith(BOARD(), { hero: { heroId: 'mage', pos: p(1, 2) } });
    interact(e, 'lever');
    const back = roundTrip(e);
    expect(mechanismById(back.state, 'section')!.state).toBe('ORIENTATION_90');
    interact(e, 'lever');
    interact(back, 'lever');
    expect(board(back.state)).toBe(board(e.state));
  });
});

describe('Act III phase 3 — region validation', () => {
  const check = (mechanisms: MechanismBoardDef, overrides: Partial<ScenarioDef> = {}) =>
    validateScenario(scenario({ ...QUIET, layout: LAYOUT, mechanisms, ...overrides }), CONTENT);
  it('accepts the test section', () => {
    expect(check(BOARD())).toEqual([]);
  });
  it('rejects a section that does not map onto itself', () => {
    const errors = check({ objects: [{ id: 'r', kind: 'REGION', pos: p(3, 1), region: { cells: [p(3, 1), p(4, 1)], pivot: { x: 4, y: 1.5 } } }], rules: [] });
    expect(errors.join()).toMatch(/does not map onto itself at 90/);
  });
  it('rejects an exit inside a section, and ROTATE on a non-region', () => {
    expect(check(BOARD(), { layout: ['.......', '...#...', '....E..', '.......', '.......'] }).join()).toMatch(/exit tile/);
    expect(
      check({
        objects: [{ id: 'gate', kind: 'GATE', pos: p(6, 0) }, { id: 'lever', kind: 'SWITCH', pos: p(2, 2), momentary: true }],
        rules: [{ id: 'bad', trigger: { type: 'ON_INTERACT', sources: ['lever'] }, actions: [{ type: 'ROTATE', targets: ['gate'] }] }],
      }).join(),
    ).toMatch(/ROTATE cannot target GATE/);
  });
});
