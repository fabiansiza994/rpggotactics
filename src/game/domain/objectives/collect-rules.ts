import type { RuleContext } from '../context';
import { samePos, type Pos } from '../core/position';
import type { Unit } from '../entities/unit';

/**
 * The hero picks up every uncollected collectible on `tiles` (a walked path, or the single
 * tile it was teleported/pushed to). Owned player summons also collect; enemies and structures never collect.
 */
export function collectAlong(ctx: RuleContext, unit: Unit, tiles: readonly Pos[]): void {
  if (unit.kind !== 'HERO' && !(unit.kind === 'SUMMON' && unit.faction === 'PLAYER')) return;
  for (const tile of tiles) {
    for (const item of ctx.state.collectibles) {
      if (item.collected || !samePos(item.pos, tile)) continue;
      item.collected = true;
      ctx.emit({ type: 'COLLECTIBLE_COLLECTED', collectibleId: item.id, kind: item.kind, pos: { ...item.pos }, unitId: unit.id });
    }
  }
}
