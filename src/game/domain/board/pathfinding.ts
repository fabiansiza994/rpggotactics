import {tileAt} from './board';
import {ignoresIceMovementPenalty} from '../cards/world-frozen';
import {iceWalkQuote} from '../combat/ice-movement';
import type { RuleContext } from '../context';
import { comparePos, DIRECTIONS, posKey, step, type Pos } from '../core/position';
import type { Unit } from '../entities/unit';
import { canEnter, terrainDefAt } from './occupancy';

export interface PathNode {
  pos: Pos;
  /** Total movement cost from the start tile. */
  cost: number;
  /** Tiles stepped on, excluding the start, ending with `pos`. Empty for the start tile. */
  path: Pos[];
}

/** Cost of one orthogonal step: 1 + exit bonus of the tile being left (ICE). */
/** Cost of one step out of `from` (into `to`, when known: see `TerrainDef.exitCostOnlyLeavingZone`). */
export function stepCost(ctx: RuleContext, from: Pos, to?: Pos, unit?: Unit): number {
  const def = terrainDefAt(ctx, from);
  if (!def?.exitCostBonus) return 1;
  if (def.type==='ICE' && unit && ignoresIceMovementPenalty(ctx.state,unit)) return 1;
  if (def.exitCostOnlyLeavingZone && to && terrainDefAt(ctx, to)?.type === def.type) return 1;
  return 1 + (tileAt(ctx.state.board,from)?.iceExitBonus??def.exitCostBonus);
}

/**
 * Deterministic Dijkstra over orthogonal steps. Units and movement-blocking obstacles cannot
 * be crossed. Returns every tile reachable within `maxCost` (including the start tile).
 */
export function computeReachable(
  ctx: RuleContext,
  unit: Unit,
  maxCost = Number.POSITIVE_INFINITY,
): Map<string, PathNode> {
  if(unit.statuses.some(s=>s.id==='FROZEN'||s.id==='ARCANE_SKATING'))return iceReachable(ctx,unit,maxCost);
  const done = new Map<string, PathNode>();
  const frontier: PathNode[] = [{ pos: unit.pos, cost: 0, path: [] }];

  while (frontier.length > 0) {
    // Small boards: a sorted array is plenty and keeps tie-breaking explicit.
    frontier.sort((a, b) => a.cost - b.cost || comparePos(a.pos, b.pos));
    const current = frontier.shift() as PathNode;
    const key = posKey(current.pos);
    if (done.has(key)) continue;
    done.set(key, current);

    for (const dir of DIRECTIONS) {
      const next = step(current.pos, dir);
      const nextCost = current.cost + stepCost(ctx, current.pos, next, unit);
      if (nextCost > maxCost) continue;
      if (done.has(posKey(next))) continue;
      if (!canEnter(ctx, next, unit.id)) continue;
      frontier.push({ pos: next, cost: nextCost, path: [...current.path, next] });
    }
  }
  return done;
}

/** Legal destinations for a walking move (start tile excluded). */
export function reachableDestinations(ctx: RuleContext, unit: Unit, budget: number): PathNode[] {
  return [...computeReachable(ctx, unit, budget).values()]
    .filter((n) => n.path.length > 0)
    .sort((a, b) => comparePos(a.pos, b.pos));
}

/**
 * Walk along a full path but stop when the budget runs out. Returns the truncated node
 * (possibly the start tile with an empty path).
 */
export function truncatePath(ctx: RuleContext, start: Pos, path: Pos[], budget: number): PathNode {
  const mover=ctx.state.units.find(u=>u.pos.x===start.x&&u.pos.y===start.y);
  if(mover?.statuses.some(s=>s.id==='FROZEN'||s.id==='ARCANE_SKATING')){
    const taken:Pos[]=[];let cost=0;
    for(const p of path){const quoted=iceWalkQuote(ctx,mover,[...taken,p]).cost;if(quoted>budget)break;taken.push(p);cost=quoted;}
    return {pos:taken.at(-1)??start,cost,path:taken};
  }
  let spent = 0;
  let prev = start;
  const taken: Pos[] = [];
  for (const p of path) {
    const cost = stepCost(ctx, prev, p, mover);
    if (spent + cost > budget) break;
    spent += cost;
    taken.push(p);
    prev = p;
  }
  return { pos: prev, cost: spent, path: taken };
}

/** At most board × 4 skating states; free travel is limited to two steps. */
function iceReachable(ctx:RuleContext,unit:Unit,maxCost:number):Map<string,PathNode>{
 const result=new Map<string,PathNode>(),done=new Set<string>();
 const queue:PathNode[]=[{pos:unit.pos,cost:0,path:[]}];
 while(queue.length){
  queue.sort((a,b)=>a.cost-b.cost||a.path.length-b.path.length||comparePos(a.pos,b.pos));
  const n=queue.shift()!,q=iceWalkQuote(ctx,unit,n.path);
  const key=posKey(n.pos)+':'+q.free+':'+q.ended;
  if(done.has(key))continue;done.add(key);
  if(!result.has(posKey(n.pos)))result.set(posKey(n.pos),n);
  for(const dir of DIRECTIONS){const next=step(n.pos,dir);if(!canEnter(ctx,next,unit.id))continue;
   const path=[...n.path,next],cost=iceWalkQuote(ctx,unit,path).cost;
   if(cost<=maxCost)queue.push({pos:next,cost,path});
  }
 }
 return result;
}
