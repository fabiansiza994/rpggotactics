import type {RuleContext} from '../context';
import type {Unit} from '../entities/unit';
import {applyStatus,removeStatus} from './status-rules';

/** One target-wide two-tier effect, not a stack per attacking turtle. Called only after HP damage. */
export function applyTurtleBite(ctx:RuleContext,target:Unit,sourceId:string):void {
 const turtle=ctx.state.units.find(u=>u.id===sourceId);
 if(turtle?.defId!=='turtle'||turtle.kind!=='SUMMON'||target.faction===turtle.faction||target.kind==='STRUCTURE'||!ctx.state.units.includes(target))return;
 const advanced=target.statuses.some(s=>s.id==='TURTLE_HOBBLE_1'||s.id==='TURTLE_HOBBLE_2');
 if(advanced)removeStatus(ctx,target,'TURTLE_HOBBLE_1','CONSUMED');
 applyStatus(ctx,target,advanced?'TURTLE_HOBBLE_2':'TURTLE_HOBBLE_1',2,sourceId);
}

export function clearTurtleHobble(state:import('../state').GameState):void {
 for(const unit of state.units)unit.statuses=unit.statuses.filter(s=>s.id!=='TURTLE_HOBBLE_1'&&s.id!=='TURTLE_HOBBLE_2');
}
