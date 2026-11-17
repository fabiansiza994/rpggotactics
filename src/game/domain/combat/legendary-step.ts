import type {RuleContext} from '../context';
import {getHero,canEnter,isActionPrevented,isMovementPrevented} from '../board/occupancy';
import {allPositions} from '../board/board';
import {manhattan,type Pos} from '../core/position';
import {teleportUnit} from './movement';
import {fail,OK} from '../result';
export const LEGENDARY_STEP_SELECTION='legendary:thunder-step';
export function legendaryStepTargets(ctx:RuleContext):Pos[] {
 const hero=getHero(ctx.state),s=hero?.statuses.find(s=>ctx.content.statuses[s.id]?.thunderEconomy);
 if(!hero || !s?.stepReady || s.stepUsed || ctx.state.phase!=='PLAYER' || ctx.state.outcome || isActionPrevented(ctx,hero) || isMovementPrevented(ctx,hero))return [];
 return allPositions(ctx.state.board).filter(p=>manhattan(hero.pos,p)===1 && canEnter(ctx,p));
}
export function legendaryStep(ctx:RuleContext,to:Pos) {
 if(!legendaryStepTargets(ctx).some(p=>p.x===to.x&&p.y===to.y))return fail('INVALID_TARGET','Elige una casilla libre adyacente para el desplazamiento eléctrico.');
 const hero=getHero(ctx.state)!,s=hero.statuses.find(s=>ctx.content.statuses[s.id]?.thunderEconomy)!;
 s.stepUsed=true; s.stepReady=false;
 ctx.emit({type:'LEGENDARY_TRIGGER',unitId:hero.id,status:s.id,kind:'STEP',amount:1,pos:hero.pos});
 teleportUnit(ctx,hero,to,'legendary:thunder-step');
 return OK;
}
