/** Opt-in local experiment. Public content and every duel remain unchanged. */
import type { RuleContext } from '../context';
import type { Unit } from '../entities/unit';
import { alignedDirection, DIRECTION_VECTORS, type Direction, type Pos } from '../core/position';
export const depthEnabled = (ctx: Pick<RuleContext, 'state' | 'content'>): boolean =>
  !!ctx.content.qaCombatDepth && !ctx.state.duel;
export const combatFacing = (unit: Unit): Direction =>
  unit.combatFacing ?? (unit.faction === 'PLAYER' ? 'RIGHT' : 'LEFT');
export function faceTravel(ctx: RuleContext, unit: Unit, from: Pos, to: Pos): void {
  if (depthEnabled(ctx)) unit.combatFacing = alignedDirection(from, to) ?? combatFacing(unit);
}
/** Exact rear ray only: diagonals are lateral, not an invented rear arc. */
export function behind(attacker: Unit, defender: Unit): boolean {
  const v = DIRECTION_VECTORS[combatFacing(defender)],
    dx = attacker.pos.x - defender.pos.x,
    dy = attacker.pos.y - defender.pos.y;
  return dx * v.y - dy * v.x === 0 && dx * v.x + dy * v.y < 0;
}
export type AttackKind =
  'RANGED' | 'GROUND_HAZARD' | 'COUNTER' | 'PIERCING' | 'DIRECT_MELEE' | 'DIRECT_RANGED';
