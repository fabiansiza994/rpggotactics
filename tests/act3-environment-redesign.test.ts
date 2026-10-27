import { describe, it, expect } from 'vitest';
import { GameEngine, DEFAULT_CONTENT, encounterFor } from '../src/game';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
import { GridProjection } from '../src/presentation/pixi/GridProjection';
import { templeComposition, templeCliffEdges } from '../src/presentation/pixi/TempleComposition';
const state = (n: number) =>
  new GameEngine(encounterFor(TEMPLE_CAMPAIGN, `w3_e0${n}`, 'mage'), DEFAULT_CONTENT).state;
describe('Act III architectural composition', () => {
  it('has six distinct spatial identities without touching simulation state', () => {
    const ids = [];
    for (let n = 1; n <= 6; n++) {
      const s = state(n),
        before = JSON.stringify(s),
        c = templeComposition(s)!;
      ids.push(c.identity);
      // Direction reset: floating tactical board, no architecture or dressing around the grid.
      expect(c.walls).toEqual([]);
      expect(c.dressing.every(p=>p.asset==='brazier' && p.at.y<0)).toBe(true);
      expect(JSON.stringify(s)).toBe(before);
    }
    expect(new Set(ids).size).toBe(6);
    expect(templeComposition({ ...state(1), scenarioId: 'e01' })).toBeNull();
  });
  it('derives long cliff banks from real voids and preserves the bridge aperture', () => {
    const s = state(2),
      before = JSON.stringify(s),
      edges = templeCliffEdges(s);
    expect(edges.some((e) => e.from.x === 4 && e.to.x === 4)).toBe(true);
    expect(edges.some((e) => Math.abs(e.to.y - e.from.y) > 1)).toBe(true);
    expect(edges.every((e) => e.from.x === e.to.x || e.from.y === e.to.y)).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('keeps the abyss only where the board really has chasms (XXII, XXIV)', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => templeComposition(state(n))!.abyss)).toEqual([false, true, false, true, false, false]);
  });
  for (const [cols, rows] of [
    [9, 6],
    [10, 7],
  ])
    it(`keeps oblique rendering and tile picking inverse for ${cols}×${rows}`, () => {
      const p = new GridProjection({
        cols: cols!,
        rows: rows!,
        tile: 96,
        perspective: 1.18,
        depth: 0.66,
        oblique: 0.58,
      });
      for (let y = 0; y < rows!; y++)
        for (let x = 0; x < cols!; x++)
          expect(p.screenToGrid(p.getTileCenter({ x, y }))).toEqual({ x, y });
      expect(p.project(4, 5).x).toBeGreaterThan(p.project(4, 0).x);
    });
  it('does not alias fractional architectural anchors into unrelated cached cells', () => {
    const p = new GridProjection({
      cols: 10,
      rows: 7,
      tile: 96,
      perspective: 1.18,
      depth: 0.66,
      oblique: 0.58,
    });
    expect(p.getUnitAnchor({ x: 9, y: 3.4 })).toEqual(p.project(9.5, 3.9));
    expect(p.getTilePolygon({ x: 10, y: 0 })[0]).toEqual(p.project(10, 0));
  });
  it('retains the default camera exactly for non-temple consumers', () => {
    const config = { cols: 9, rows: 6, tile: 96, perspective: 1.18, depth: 0.66 };
    const standard = new GridProjection(config),
      explicit = new GridProjection({ ...config, oblique: 0 });
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 9; x++)
        expect(standard.getTileCenter({ x, y })).toEqual(explicit.getTileCenter({ x, y }));
  });
});
