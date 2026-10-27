import type { RuleContext } from '../context';
import { samePos, type Pos } from '../core/position';
import { blocksLineOfSightAt } from './occupancy';

/** Tiles strictly between `a` and `b` along a Bresenham line. */
export function tilesBetween(a: Pos, b: Pos): Pos[] {
  const out: Pos[] = [];
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;
  let x = a.x;
  let y = a.y;
  while (!(x === b.x && y === b.y)) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (!(x === b.x && y === b.y)) out.push({ x, y });
  }
  return out;
}

/** Obstacles flagged `blocksLineOfSight` on intermediate tiles block the line. Units do not. */
export function hasLineOfSight(ctx: RuleContext, from: Pos, to: Pos): boolean {
  if (samePos(from, to)) return true;
  return tilesBetween(from, to).every((p) => !blocksLineOfSightAt(ctx, p));
}
