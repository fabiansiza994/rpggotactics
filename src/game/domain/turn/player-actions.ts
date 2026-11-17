import { getHero, isMovementPrevented, unitById } from '../board/occupancy';
import {cutPathAtTrap} from '../combat/traps';
import {iceWalkQuote} from '../combat/ice-movement';
import { computeReachable, reachableDestinations, type PathNode } from '../board/pathfinding';
import { setMovePoints } from '../cards/deck';
import { walkUnit } from '../combat/movement';
import type { RuleContext } from '../context';
import { posKey, samePos, type Pos } from '../core/position';
import { fail, OK, type RuleResult } from '../result';

/** Legal walking destinations for the hero with the remaining movement points. */
export function legalHeroMoves(ctx: RuleContext): PathNode[] {
  const hero = getHero(ctx.state);
  if (!hero || ctx.state.phase !== 'PLAYER' || isMovementPrevented(ctx, hero)) return [];
  return reachableDestinations(ctx, hero, ctx.state.player.movePoints);
}

/** Base movement: orthogonal, 1 MP per step (+ICE exit cost), no crossing units/obstacles. */
export function moveUnit(ctx: RuleContext, unitId: string, to: Pos): RuleResult {
  const unit = unitById(ctx.state, unitId);
  if (!unit) return fail('UNKNOWN_UNIT', `Unknown unit "${unitId}".`);
  if (unit.id !== ctx.state.player.heroId) {
    return fail('UNIT_NOT_CONTROLLABLE', `${unit.name} is not controlled by the player.`);
  }
  if (isMovementPrevented(ctx, unit)) return fail('MOVEMENT_PREVENTED', `${unit.name} cannot move.`);
  if (samePos(unit.pos, to)) return fail('UNREACHABLE', 'Already there.');

  const node = computeReachable(ctx, unit, ctx.state.player.movePoints).get(posKey(to));
  if (!node) return fail('UNREACHABLE', 'Tile is not reachable with the remaining movement.');

  const path=cutPathAtTrap(ctx,unit,node.path);
  const paid=iceWalkQuote(ctx,unit,path).cost;
  walkUnit(ctx,unit,path,paid);
  setMovePoints(ctx, ctx.state.player.movePoints - paid);
  return OK;
}
