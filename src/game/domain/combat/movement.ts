import { faceTravel } from './qa-depth';
import { inBounds } from '../board/board';
import { blocksMovementAt, canEnter, terrainDefAt, unitAt } from '../board/occupancy';
import type { RuleContext } from '../context';
import { samePos, step, type Direction, type Pos } from '../core/position';
import type { Unit } from '../entities/unit';
import { collectAlong } from '../objectives/collect-rules';
import { dealDamage } from './damage';
import { onUnitMoved } from './momentum';
import { cutPathAtTrap, hostileTrapAt, springTrap } from './traps';
import { mechanismFloorAt } from '../mechanisms/mechanism-board';

/**
 * Moves a unit along an already-validated path. The logical position changes instantly. A hostile
 * trap on the path stops the unit on it (the rest of the path is not walked). Returns the tiles
 * actually walked; `cost` is reported as given (callers that pay per step use the returned path).
 */
export function walkUnit(
  ctx: RuleContext,
  unit: Unit,
  fullPath: Pos[],
  cost: number,
  mode: 'WALK' | 'CHARGE' = 'WALK',
): Pos[] {
  const path = cutPathAtTrap(ctx, unit, fullPath);
  const to = path[path.length - 1];
  if (!to) return [];
  const from = unit.pos;
  faceTravel(ctx, unit, path.length > 1 ? path[path.length - 2]! : from, to);
  unit.pos = to;
  ctx.emit({ type: 'UNIT_MOVED', unitId: unit.id, from, to, path, cost, mode });
  collectAlong(ctx, unit, path);
  onUnitMoved(ctx, unit, from);
  springTrap(ctx, unit);
  return path;
}

export function teleportUnit(ctx: RuleContext, unit: Unit, to: Pos, sourceId: string): boolean {
  if (!canEnter(ctx, to, unit.id) || samePos(unit.pos, to)) return false;
  const from = unit.pos;
  unit.pos = to;
  ctx.emit({ type: 'UNIT_TELEPORTED', unitId: unit.id, from, to, sourceId });
  collectAlong(ctx, unit, [to]);
  springTrap(ctx, unit);
  return true;
}

/**
 * Two units exchange tiles (Intercambio Arcano, Relevo del Pacto). Both moves are teleports: no
 * path, no engage, roots ignored; a hostile trap under a destination springs as usual.
 */
export function swapUnits(ctx: RuleContext, a: Unit, b: Unit, sourceId: string): void {
  if (a === b || !ctx.state.units.includes(a) || !ctx.state.units.includes(b)) return;
  const from = a.pos,
    to = b.pos;
  a.pos = to;
  b.pos = from;
  ctx.emit({ type: 'UNIT_TELEPORTED', unitId: a.id, from, to, sourceId });
  ctx.emit({ type: 'UNIT_TELEPORTED', unitId: b.id, from: to, to: from, sourceId });
  collectAlong(ctx, a, [to]);
  collectAlong(ctx, b, [from]);
  springTrap(ctx, a);
  springTrap(ctx, b);
}

export type PushCollision = 'UNIT' | 'OBSTACLE' | 'EDGE' | 'BLOCKED_TERRAIN';

/**
 * Pushes a unit up to `distance` tiles. If something stops it early, the pushed unit (and a
 * unit it slams into) take `collisionDamage`.
 */
export function pushUnit(
  ctx: RuleContext,
  unit: Unit,
  dir: Direction,
  distance: number,
  collisionDamage: number,
  sourceId: string,
): void {
  const from = unit.pos;
  let current = from;
  let collision: PushCollision | null = null;
  let blocker: Unit | undefined;

  for (let i = 0; i < distance; i++) {
    const next = step(current, dir);
    if (!inBounds(ctx.state.board, next)) collision = 'EDGE';
    else if ((blocker = unitAt(ctx.state, next))) collision = 'UNIT';
    else if (blocksMovementAt(ctx, next)) collision = 'OBSTACLE';
    else if (!terrainDefAt(ctx, next)?.walkable && !mechanismFloorAt(ctx.state, next)) collision = 'BLOCKED_TERRAIN';
    if (collision) break;
    current = next;
    // A hostile trap stops the slide (no collision: nothing was hit).
    if (hostileTrapAt(ctx, unit, current)) break;
  }

  unit.pos = current;
  ctx.emit({ type: 'UNIT_PUSHED', unitId: unit.id, from, to: current, direction: dir, sourceId, collision });
  collectAlong(ctx, unit, [current]);

  if (collision && collisionDamage > 0) {
    dealDamage(ctx, unit, collisionDamage, sourceId, 'FORCE');
    if (blocker) dealDamage(ctx, blocker, collisionDamage, sourceId, 'FORCE');
  }
  if (!samePos(from, current)) springTrap(ctx, unit);
}
