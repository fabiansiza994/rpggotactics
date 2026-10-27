import { allPositions, tileAt } from '../board/board';
import { obstacleAt, unitAt } from '../board/occupancy';
import { dealDamage } from '../combat/damage';
import type { RuleContext } from '../context';
import type { Pos } from '../core/position';
import type { Unit } from '../entities/unit';
import { applyStatus } from '../statuses/status-rules';
import { tickTraps } from '../combat/traps';
import type { TerrainType } from './terrain';

/** Paint (usually temporary) terrain. Returns false if the tile cannot take it. */
export function createTerrain(
  ctx: RuleContext,
  p: Pos,
  terrain: TerrainType,
  turnsLeft: number | null,
  sourceId: string,
): boolean {
  const tile = tileAt(ctx.state.board, p);
  if (!tile) return false;
  if (!ctx.content.terrain[tile.terrain].canBeOverwritten) return false;
  const previous = tile.terrain;
  tile.terrain = terrain;
  tile.terrainTurnsLeft = turnsLeft;
  if (turnsLeft === null) tile.baseTerrain = terrain;
  ctx.emit({ type: 'TERRAIN_CREATED', pos: p, terrain, previous, turnsLeft, sourceId });
  return true;
}

function revertTerrain(ctx: RuleContext, p: Pos, reason: 'EXPIRED' | 'CLEANSED'): void {
  const tile = tileAt(ctx.state.board, p);
  if (!tile) return;
  const removed = tile.terrain;
  tile.terrain = tile.baseTerrain;
  tile.terrainTurnsLeft = null;
  ctx.emit({ type: 'TERRAIN_REMOVED', pos: p, terrain: removed, revertedTo: tile.terrain, reason });
}

/** Removes hazard terrain (temporary or permanent) from a tile. Permanent hazards become NORMAL. */
export function removeHazard(ctx: RuleContext, p: Pos): boolean {
  const tile = tileAt(ctx.state.board, p);
  if (!tile || !ctx.content.terrain[tile.terrain].isHazard || tile.baseTerrain === 'HAZARD')
    return false;
  if (ctx.content.terrain[tile.terrain].indestructible) return false;
  if (tile.terrainTurnsLeft === null || ctx.content.terrain[tile.baseTerrain].isHazard) {
    tile.baseTerrain = 'NORMAL';
  }
  revertTerrain(ctx, p, 'CLEANSED');
  return true;
}

/** End-of-turn terrain effects for one unit (FIRE/LAVA damage, optional status). Once per turn end. */
export function applyEndTurnTerrain(ctx: RuleContext, unit: Unit): void {
  const tile = tileAt(ctx.state.board, unit.pos);
  if (!tile) return;
  const def = ctx.content.terrain[tile.terrain];
  if (unit.kind === 'ENEMY' && ctx.content.enemies[unit.defId]?.hazardImmune) return;
  if (def.endTurnDamage > 0) {
    dealDamage(
      ctx,
      unit,
      def.endTurnDamage,
      `terrain:${def.type}`,
      def.damageType,
      def.type === 'HAZARD' ? 'GROUND_HAZARD' : undefined,
    );
  }
  if (def.endTurnStatus && ctx.state.units.includes(unit)) {
    applyStatus(
      ctx,
      unit,
      def.endTurnStatus.status,
      def.endTurnStatus.duration,
      `terrain:${def.type}`,
    );
  }
}

export function createObstacle(
  ctx: RuleContext,
  p: Pos,
  defId: string,
  turnsLeft: number | null,
  sourceId: string,
): boolean {
  if (obstacleAt(ctx.state, p) || unitAt(ctx.state, p)) return false;
  const tile = tileAt(ctx.state.board, p);
  if (!tile || !ctx.content.terrain[tile.terrain].walkable) return false;
  const id = `obstacle-${ctx.state.nextId++}`;
  ctx.state.obstacles.push({ id, defId, pos: p, turnsLeft });
  ctx.emit({ type: 'OBSTACLE_CREATED', obstacleId: id, defId, pos: p, turnsLeft, sourceId });
  return true;
}

/** End of round: temporary terrain, obstacles and traps lose one round and may expire. */
export function tickBoardDurations(ctx: RuleContext): void {
  tickTraps(ctx);
  for (const p of allPositions(ctx.state.board)) {
    const tile = tileAt(ctx.state.board, p);
    if (!tile || tile.terrainTurnsLeft === null) continue;
    tile.terrainTurnsLeft -= 1;
    if (tile.terrainTurnsLeft <= 0) revertTerrain(ctx, p, 'EXPIRED');
  }
  for (const o of [...ctx.state.obstacles]) {
    if (o.turnsLeft === null) continue;
    o.turnsLeft -= 1;
    if (o.turnsLeft <= 0) {
      ctx.state.obstacles = ctx.state.obstacles.filter((x) => x !== o);
      ctx.emit({
        type: 'OBSTACLE_REMOVED',
        obstacleId: o.id,
        defId: o.defId,
        pos: o.pos,
        reason: 'EXPIRED',
      });
    }
  }
}
