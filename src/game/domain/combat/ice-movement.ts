import type {RuleContext} from '../context';
import type {Unit} from '../entities/unit';
import type {Pos} from '../core/position';
import {tileAt} from '../board/board';
import {stepCost} from '../board/pathfinding';
/** Pure quote. Paths carry their own finite skating budget; snapshots never recompute consumption. */
export function iceWalkQuote(ctx:RuleContext,unit:Unit,path:readonly Pos[]):{cost:number;free:number;ended:boolean}{
 const skate=unit.statuses.find(s=>s.id==='ARCANE_SKATING');
 let left=skate&&!skate.skatingEnded?Math.max(0,(skate.power??2)-(skate.skatingUsed??0)):0;
 let prev=unit.pos,cost=path.length&&unit.statuses.some(s=>s.id==='FROZEN')?1:0,free=0;
 let ended=!!skate?.skatingEnded;
 for(const p of path){
  const icy=tileAt(ctx.state.board,prev)?.terrain==='ICE'&&tileAt(ctx.state.board,p)?.terrain==='ICE';
  if(!icy){left=0;ended=true;}
  if(left>0){left--;free++;}else cost+=stepCost(ctx,prev,p);
  prev=p;
 }
 return {cost,free,ended};
}
