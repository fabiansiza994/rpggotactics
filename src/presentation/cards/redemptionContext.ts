import type { GameContent, GameState } from '../../game';
import { queryContext } from '../../game/domain/context';
import { hasLineOfSight } from '../../game/domain/board/line-of-sight';
import { isActionPrevented } from '../../game/domain/board/occupancy';
import { manhattan } from '../../game/domain/core/position';
import { redemptionOptions, REDEMPTION_SPIRIT } from '../../game/domain/summons/redemption';
/** Presentation eligibility only; executable benefits/costs come from the unchanged rules query. */
export function redemptionContext(state: Readonly<GameState>, content: GameContent, targetId: string) {
  if(state.phase!=='PLAYER'||state.outcome||state.pendingCast||state.responseWindow||state.player.pendingCardChoice)return null;
  const spirit=state.units.find(u=>u.defId===REDEMPTION_SPIRIT&&u.hp>0&&u.summon?.ownerId===state.player.heroId);
  const target=state.units.find(u=>u.id===targetId);
  if(!spirit?.summon||!target||target.hp<=0||target.id===spirit.id||target.faction!==spirit.faction||state.round<spirit.summon.readyRound||spirit.summon.lastActedRound===state.round)return null;
  const ctx=queryContext(state,content);
  if(isActionPrevented(ctx,spirit)||manhattan(spirit.pos,target.pos)>2||!hasLineOfSight(ctx,spirit.pos,target.pos))return null;
  const heal=redemptionOptions(ctx,spirit.id,'HEAL').find(o=>o.target.id===target.id);
  const protect=redemptionOptions(ctx,spirit.id,'PROTECT').find(o=>o.target.id===target.id);
  return {spirit,target,heal,protect,
    healLabel:heal?`Curar ${heal.amount} HP · sacrifica ${heal.cost} HP del Espíritu`:'Curar no disponible: el aliado tiene la vida completa.',
    protectLabel:protect?`Proteger con ${protect.amount} de escudo · sacrifica ${protect.cost} HP del Espíritu`:target.shield>0?'Proteger no disponible: el aliado ya tiene escudo.':'Proteger no disponible: el Espíritu necesita 2 HP.'};
}
export type ContextRect={left:number;right:number;top:number;bottom:number};
export function redemptionPlacement(hp:ContextRect,viewport:{width:number;height:number},occupied:ContextRect[]) {
  const width=104,height=48;
  const x=Math.max(8,Math.min(viewport.width-width-8,(hp.left+hp.right)/2-width/2));
  let y=hp.top-height-10;
  // Keep the controls centred on the selected unit; rise over neighbouring HP bars/HUD.
  for(let n=0;n<=occupied.length;n++){
    if(y<8||y+height>viewport.height-8)return null;
    const collisions=occupied.filter(r=>x<r.right&&x+width>r.left&&y<r.bottom&&y+height>r.top);
    if(!collisions.length)return {x,y};
    y=Math.min(...collisions.map(r=>r.top))-height-10;
  }
  return null;
}
