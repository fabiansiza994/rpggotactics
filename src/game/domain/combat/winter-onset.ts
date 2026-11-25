import type {RuleContext} from '../context';
import type {Faction,Unit} from '../entities/unit';
import {areHostile} from '../board/occupancy';
import {loseHpTogether} from '../cards/hp-loss';
import {removeStatus} from '../statuses/status-rules';
export function winterOnsetActive(unit:Unit):boolean {
 const storm=unit.statuses.find(s=>s.id==='WINTER_ONSET');
 return unit.hp>0&&!!storm?.linkedWorldInstanceId&&unit.statuses.some(s=>s.id==='ABSOLUTE_ZERO'&&s.turnsLeft>0&&s.worldInstanceId===storm.linkedWorldInstanceId);
}
/** Only invoked by authoritative turn admission, never by snapshot hydration. */
export function pulseWinterOnset(ctx:RuleContext,faction:Faction):void {
 for(const owner of [...ctx.state.units]){
  if(owner.faction!==faction||!owner.statuses.some(s=>s.id==='WINTER_ONSET'))continue;
  if(!winterOnsetActive(owner)){removeStatus(ctx,owner,'WINTER_ONSET','EXPIRED');continue;}
  const targets=ctx.state.units.filter(u=>u.hp>0&&u.kind!=='STRUCTURE'&&areHostile(owner,u));
  if(!targets.length)continue;
  ctx.emit({type:'WINTER_PULSE',ownerId:owner.id,targets:targets.map(u=>({unitId:u.id,pos:{...u.pos}}))});
  loseHpTogether(ctx,targets,1,`winter-onset:${owner.id}`);
 }
}
