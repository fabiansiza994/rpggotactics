import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import type { GameEvent } from '../src/game/domain/events';
import type { GameState } from '../src/game/domain/state';
import { mechanismById } from '../src/game/domain/mechanisms/mechanism-board';
import { mechanismView } from '../src/game/domain/mechanisms/mechanism-view';
import { rotationPreview } from '../src/game/domain/mechanisms/mechanism-transform';
import { GridProjection } from '../src/presentation/pixi/GridProjection';
import { RotatingSections, SECTION_SPIN_MS } from '../src/presentation/pixi/RotatingSections';
import type { BoardViewModel } from '../src/presentation/pixi/viewModel';
import { encounterIdentity } from '../src/presentation/assets/visualIdentity';
import { applyLabOp, inspectGrid, newLabEngine, rebuildLab, sameBoard, type LabSave } from '../src/presentation/qa/act3/rotationLabOps';

const CONTENT = withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
const proj = new GridProjection({ cols: 11, rows: 7, tile: 96, perspective: 1.18, depth: 0.66 });
const vmOf = (state: Readonly<GameState>, selectedMechanismId: string | null = null) =>
  ({ state, mechanisms: mechanismView(state), selectedMechanismId }) as unknown as BoardViewModel;

/** XXVIII at 180° with the champion at (6,4) next to the console, then the real console INTERACT. */
function rideSetup() {
  const { engine: e } = rebuildLab(CONTENT, { hero: 'mage', seed: 308, steps: [{ op: { type: 'ORIENT', to: 180 } }, { op: { type: 'PLACE_CHAMPION', at: { x: 6, y: 4 } } }] });
  const result = e.dispatch({ type: 'INTERACT', mechanismId: 'console' });
  expect(result.ok).toBe(true);
  return { e, events: result.events as GameEvent[] };
}

describe('XXVIII presentation — rotating section layer', () => {
  it('carries a rider along the arc, owns its position while turning, then locks at the grid anchor', () => {
    const { e, events } = rideSetup();
    const hero = new Container();
    const locks: { points: number; reduced: boolean }[] = [];
    const layer = new RotatingSections((id) => (id === 'mage' ? hero : undefined), () => undefined, (points, reduced) => locks.push({ points: points.length, reduced }));
    layer.update(vmOf(e.state), proj);
    layer.playEvents(events, e.state, false);
    expect(layer.busy).toBe(true);
    expect(layer.ownsPosition('mage')).toBe(true);
    const from = proj.getUnitAnchor({ x: 6, y: 4 }),
      to = proj.getUnitAnchor({ x: 7, y: 3 });
    layer.tick(450, false);
    const mid = { x: hero.x, y: hero.y };
    expect(Math.hypot(mid.x - from.x, mid.y - from.y)).toBeGreaterThan(4);
    expect(Math.hypot(mid.x - to.x, mid.y - to.y)).toBeGreaterThan(4);
    layer.tick(SECTION_SPIN_MS, false);
    expect(layer.busy).toBe(false);
    expect(layer.ownsPosition('mage')).toBe(false);
    expect(hero.x).toBeCloseTo(to.x, 3);
    expect(hero.y).toBeCloseTo(to.y, 3);
    expect(locks).toEqual([{ points: 8, reduced: false }]);
  });

  it('reduced motion: no travel, no busy time, a lock flash only', () => {
    const { e, events } = rideSetup();
    const hero = new Container();
    const locks: boolean[] = [];
    const layer = new RotatingSections(() => hero, () => undefined, (_p, reduced) => locks.push(reduced));
    layer.update(vmOf(e.state), proj);
    layer.playEvents(events, e.state, true);
    expect(layer.busy).toBe(false);
    expect(layer.ownsPosition('mage')).toBe(false);
    expect(locks).toEqual([true]);
  });

  it('a refused turn never starts an animation', () => {
    const { e } = rideSetup();
    const layer = new RotatingSections(() => undefined, () => undefined);
    layer.update(vmOf(e.state), proj);
    const blocked = { type: 'MECHANISM_CHANGED', cue: 'SECTION_ROTATION_BLOCKED', mechanismId: 'maze', kind: 'REGION', state: 'ORIENTATION_0', pos: { x: 3, y: 0 }, reason: 'x', rotation: { from: 0, to: 90, turns: 1, pivot: { x: 6.5, y: 3.5 }, cells: [] } } as GameEvent;
    layer.playEvents([blocked], e.state, false);
    expect(layer.busy).toBe(false);
  });

  it('the telegraph predicts exactly where the turn puts walls and riders', () => {
    const e = newLabEngine(CONTENT, 'mage');
    const preview = rotationPreview(e.state as GameState, mechanismById(e.state, 'maze')!, 1);
    const turned = applyLabOp(e, { type: 'ROTATE', turns: 1 }, { next: 1 })!.state;
    // Walls = low blocks + solid mechanisms riding the section (the console stays on the pivot).
    expect(preview.walls).toEqual([...turned.obstacles.map((o) => o.pos), mechanismById(turned, 'console')!.pos]);
    for (const u of preview.units) expect(turned.units.find((x) => x.id === u.id)!.pos).toEqual(u.to);
    expect(preview.floor.every((t) => turned.board.tiles[t.y * 11 + t.x]!.terrain !== 'BLOCKED')).toBe(true);
  });

  it('the temple stands on the temple-mechanism floating board', () => {
    expect(encounterIdentity('w3_e08').theme).toBe('temple_mechanism');
    expect(encounterIdentity('w3_e01').theme).toBe('temple_mechanism');
  });
});

describe('ACT III — ROTATING BOARD LAB', () => {
  it('rebuilds a session of commands and lab ops exactly (replay)', () => {
    const save: LabSave = {
      hero: 'summoner',
      seed: 308,
      steps: [
        { op: { type: 'ORIENT', to: 180 } },
        { op: { type: 'SPAWN_ENEMY', enemyId: 'orc_warrior', at: { x: 1, y: 6 } } },
        { op: { type: 'SPAWN_SUMMON', summonId: Object.keys(CONTENT.summons ?? {})[0]!, at: { x: 2, y: 2 } } },
        { command: { type: 'MOVE_UNIT', unitId: 'summoner', to: { x: 1, y: 2 } } },
        { command: { type: 'INTERACT', mechanismId: 'lever' } },
      ],
    };
    const a = rebuildLab(CONTENT, save),
      b = rebuildLab(CONTENT, save);
    expect(a.failedAt).toBeNull();
    expect(mechanismById(a.engine.state, 'maze')!.state).toBe('ORIENTATION_270');
    expect(a.engine.state.units.some((u) => u.kind === 'SUMMON')).toBe(true);
    expect(sameBoard(a.engine.state, b.engine.state)).toBe(true);
  });

  it('the pathfinding inspector sees the route open only in the right orientation', () => {
    const e = newLabEngine(CONTENT, 'mage');
    expect(inspectGrid(e, 'mage', { x: 10, y: 3 }).pathLength).toBeNull();
    const { engine } = rebuildLab(CONTENT, { hero: 'mage', seed: 308, steps: [{ op: { type: 'ORIENT', to: 90 } }, { op: { type: 'PLACE_CHAMPION', at: { x: 7, y: 3 } } }] });
    expect(inspectGrid(engine, 'mage', { x: 10, y: 3 }).pathLength).toBe(3);
  });
});
