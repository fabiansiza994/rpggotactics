import type {GameEvent} from '../events';
import {collectScoutResources,discoverScoutResource,enterDrakeFire} from './scout-siege';
import {collectLifeFeathers,shedLifeFeather} from './raven';
import {leaveBloodTrail} from './blood-trail';
import {iceWalkQuote} from './ice-movement';
import {setMovePoints} from '../cards/deck';
import {tileAt} from '../board/board';
import {removeStatus} from '../statuses/status-rules';
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
  mode: 'WALK' | 'CHARGE' | 'SLIDE' = 'WALK',
): Pos[] {
  let path = cutPathAtTrap(ctx, unit, fullPath);
  let to = path[path.length - 1];
  if (!to) return [];
  const from = unit.pos;
  const quote=iceWalkQuote(ctx,unit,path);
  const frozen=unit.statuses.some(s=>s.id==='FROZEN');
  if(frozen){
    if(cost===0 && unit.id===ctx.state.player.heroId){
      if(ctx.state.player.movePoints<1)return [];
      setMovePoints(ctx,ctx.state.player.movePoints-1);
    }
    removeStatus(ctx,unit,'FROZEN','CONSUMED');
  }
  const skate=unit.statuses.find(s=>s.id==='ARCANE_SKATING');
  if(skate){skate.skatingUsed=(skate.skatingUsed??0)+quote.free;skate.skatingEnded=quote.ended;}
  const fireEvents:GameEvent[]=[];
  path=enterDrakeFire({...ctx,emit:event=>fireEvents.push(event)},unit,path);
  to=path.at(-1);if(!to)return [];
  faceTravel(ctx, unit, path.length > 1 ? path[path.length - 2]! : from, to);
  leaveBloodTrail(ctx, unit, [from, ...path]);
  unit.pos = to;
  ctx.emit({ type: 'UNIT_MOVED', unitId: unit.id, from, to, path, cost, mode:skate&&!quote.ended?'SLIDE':mode });
  for(const event of fireEvents)ctx.emit(event);
  if(!ctx.state.units.includes(unit))return path;
  collectAlong(ctx, unit, path);
  collectLifeFeathers(ctx, unit, path);
  onUnitMoved(ctx, unit, from);
  springTrap(ctx, unit);
  collectScoutResources(ctx,unit,path);
  discoverScoutResource(ctx,unit,[from,...path]);
  shedLifeFeather(ctx, unit, [from,...path]);
  return path;
}

export function teleportUnit(ctx: RuleContext, unit: Unit, to: Pos, sourceId: string): boolean {
  if (!canEnter(ctx, to, unit.id) || samePos(unit.pos, to)) return false;
  const from = unit.pos;
  unit.pos = to;
  ctx.emit({ type: 'UNIT_TELEPORTED', unitId: unit.id, from, to, sourceId });
  collectAlong(ctx, unit, [to]);
  collectLifeFeathers(ctx, unit, [to]);
  enterDrakeFire(ctx,unit,[to]);collectScoutResources(ctx,unit,[to]);
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
  collectLifeFeathers(ctx, a, [to]);
  collectLifeFeathers(ctx, b, [from]);
  enterDrakeFire(ctx,a,[to]);enterDrakeFire(ctx,b,[from]);
  collectScoutResources(ctx,a,[to]);collectScoutResources(ctx,b,[from]);
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
  if(distance>0 && unit.statuses.some(s=>s.id==='FROST_MANTLE')){
    distance=unit.statuses.find(s=>s.id==='FROST_MANTLE')?.power===-1?0:Math.max(0,distance-1);removeStatus(ctx,unit,'FROST_MANTLE','CONSUMED');
  }
  let current = from;
  const traversed: Pos[] = [];
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
    traversed.push(current);
    // A hostile trap stops the slide (no collision: nothing was hit).
    if (hostileTrapAt(ctx, unit, current)) break;
  }

  // At most ONE extra tile per forced displacement; no recursive call.
  if(!collision && !samePos(from,current) && tileAt(ctx.state.board,current)?.slippery && !hostileTrapAt(ctx,unit,current)){
    const extraSteps=Math.min(2,tileAt(ctx.state.board,current)?.slipDistance??1);
    for(let i=0;i<extraSteps;i++){const extra=step(current,dir);if(!canEnter(ctx,extra,unit.id))break;current=extra;traversed.push(current);if(hostileTrapAt(ctx,unit,current))break;}
  }
  if(traversed.length)leaveBloodTrail(ctx, unit, [from, ...traversed]);
  const fireEvents:GameEvent[]=[];
  const entered=enterDrakeFire({...ctx,emit:event=>fireEvents.push(event)},unit,traversed);
  if(!ctx.state.units.includes(unit))current=entered.at(-1)??current;
  unit.pos = current;
  ctx.emit({ type: 'UNIT_PUSHED', unitId: unit.id, from, to: current, direction: dir, sourceId, collision });
  for(const event of fireEvents)ctx.emit(event);
  if(!ctx.state.units.includes(unit))return;
  collectAlong(ctx, unit, [current]);
  collectLifeFeathers(ctx, unit, traversed);
  collectScoutResources(ctx,unit,traversed);

  if (collision && collisionDamage > 0) {
    dealDamage(ctx, unit, collisionDamage, sourceId, 'FORCE');
    if (blocker) dealDamage(ctx, blocker, collisionDamage, sourceId, 'FORCE');
  }
  if (!samePos(from, current)) springTrap(ctx, unit);
}
