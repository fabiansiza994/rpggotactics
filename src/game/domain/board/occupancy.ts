import { requireDef } from '../content';
import type { RuleContext } from '../context';
import { samePos, type Pos } from '../core/position';
import type { Obstacle, ObstacleDef } from '../entities/obstacle';
import type { Unit } from '../entities/unit';
import type { GameState } from '../state';
import type { TerrainDef } from '../terrain/terrain';
import { inBounds, tileAt } from './board';
import { mechanismBlocksMovementAt, mechanismBlocksSightAt, mechanismFloorAt } from '../mechanisms/mechanism-board';

export const unitAt = (state: GameState, p: Pos): Unit | undefined =>
  state.units.find((u) => samePos(u.pos, p));

export const unitById = (state: GameState, id: string): Unit | undefined =>
  state.units.find((u) => u.id === id);

export const obstacleAt = (state: GameState, p: Pos): Obstacle | undefined =>
  state.obstacles.find((o) => samePos(o.pos, p));

export const obstacleDef = (ctx: RuleContext, o: Obstacle): ObstacleDef =>
  requireDef(ctx.content.obstacles, o.defId, 'obstacle');

export function terrainDefAt(ctx: RuleContext, p: Pos): TerrainDef | undefined {
  const tile = tileAt(ctx.state.board, p);
  return tile ? ctx.content.terrain[tile.terrain] : undefined;
}

export const getHero = (state: GameState): Unit | undefined =>
  state.units.find((u) => u.id === state.player.heroId);

export const getEnemies = (state: GameState): Unit[] =>
  state.units.filter((u) => u.faction === 'ENEMY');

export const areHostile = (a: Unit, b: Unit): boolean => a.faction !== b.faction;

export function blocksMovementAt(ctx: RuleContext, p: Pos): boolean {
  const o = obstacleAt(ctx.state, p);
  return (!!o && obstacleDef(ctx, o).blocksMovement) || mechanismBlocksMovementAt(ctx.state, p);
}

export function blocksLineOfSightAt(ctx: RuleContext, p: Pos): boolean {
  const o = obstacleAt(ctx.state, p);
  return (!!o && obstacleDef(ctx, o).blocksLineOfSight) || terrainDefAt(ctx, p)?.blocksLineOfSight === true || mechanismBlocksSightAt(ctx.state, p);
}

/** Terrain + obstacles allow standing here (ignores units). */
export function isStandable(ctx: RuleContext, p: Pos): boolean {
  if (!inBounds(ctx.state.board, p)) return false;
  const terrain = terrainDefAt(ctx, p);
  if (!terrain?.walkable && !mechanismFloorAt(ctx.state, p)) return false;
  return !blocksMovementAt(ctx, p);
}

/**
 * A unit could enter this tile right now. `moverId` is ignored for occupancy so a unit does
 * not block itself.
 */
export function canEnter(ctx: RuleContext, p: Pos, moverId?: string): boolean {
  if (!isStandable(ctx, p)) return false;
  const occupant = unitAt(ctx.state, p);
  return !occupant || occupant.id === moverId;
}

/** Nothing at all on the tile: walkable terrain, no unit, no obstacle. */
export function isEmptyTile(ctx: RuleContext, p: Pos): boolean {
  return isStandable(ctx, p) && !unitAt(ctx.state, p) && !obstacleAt(ctx.state, p);
}

export function hasStatus(unit: Unit, statusId: string): boolean {
  return unit.statuses.some((s) => s.id === statusId);
}

/**
 * Walking budget after slows (`StatusDef.moveReduction`, the strongest one only): never below 1
 * when the base is positive. `base` defaults to the unit's move range (a champion passes its
 * max move points).
 */
export function effectiveMoveRange(ctx: RuleContext, unit: Unit, base = unit.moveRange): number {
  const slow = Math.max(0, ...unit.statuses.map((s) => ctx.content.statuses[s.id]?.moveReduction ?? 0));
  return base <= 0 || slow === 0 ? base : Math.max(1, base - slow);
}

export function isMovementPrevented(ctx: RuleContext, unit: Unit): boolean {
  return unit.statuses.some((s) => ctx.content.statuses[s.id]?.preventsMovement);
}

export function isActionPrevented(ctx: RuleContext, unit: Unit): boolean {
  return unit.statuses.some((s) => ctx.content.statuses[s.id]?.preventsActions);
}
