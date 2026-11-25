import {freezeSpellGround} from '../cards/ice-terrain';
import type {RuleContext} from '../context';
import type {Unit} from '../entities/unit';
import {worldFrozen} from '../cards/world-frozen';
import {hasLineOfSight} from '../board/line-of-sight';
import {manhattan} from '../core/position';
import {areHostile,unitById,isActionPrevented} from '../board/occupancy';
import {dealDamage,defeatUnit} from './damage';
import {attackDamage} from './attack-modifiers';
import {turnKey} from './momentum';
export function snowTurnEnd(ctx:RuleContext,unit:Unit):void{
 const war=unit.statuses.find(s=>s.id==='SNOW_WAR');
 if(war && war.lastShotTurn!==turnKey(ctx.state)&&!isActionPrevented(ctx,unit)){
  war.lastShotTurn=turnKey(ctx.state);
  const global=worldFrozen(unit);
  const target=ctx.state.units.filter(u=>u.hp>0&&u.kind!=='STRUCTURE'&&areHostile(unit,u)&&
    (global||manhattan(unit.pos,u.pos)<=5)&&hasLineOfSight(ctx,unit.pos,u.pos))
    .sort((a,b)=>manhattan(unit.pos,a.pos)-manhattan(unit.pos,b.pos)||a.id.localeCompare(b.id))[0];
  if(target){ctx.emit({type:'SNOWBALL_FIRED',unitId:unit.id,targetId:target.id,from:unit.pos,to:target.pos,global});dealDamage(ctx,target,attackDamage(ctx,unit,target,2),unit.id,'ICE','RANGED','DIRECT_RANGED');freezeSpellGround(ctx,[target.pos],unit.id);}
 }
 if(unit.summon?.meltTurnsLeft!==undefined && !worldFrozen(unitById(ctx.state,unit.summon.ownerId))){
  unit.summon.meltTurnsLeft=Math.max(0,unit.summon.meltTurnsLeft-1);
  if(unit.summon.meltTurnsLeft===0)defeatUnit(ctx,unit,'MELT');
 }
}
