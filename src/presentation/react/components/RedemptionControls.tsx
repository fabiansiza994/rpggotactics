import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import type { GameContent } from '../../../game';
import {redemptionContext,redemptionPlacement,type ContextRect} from '../../cards/redemptionContext';
import {useBattleStore} from '../../store/battleStore';
import '../../../styles/redemption-controls.css';
export type RedemptionSelection={targetId:string;heroId:string;round:number};
export function RedemptionControls({selection,content,project,onClose}:{selection:RedemptionSelection|null;content:GameContent;project(id:string):ContextRect|null;onClose():void}){
  const state=useBattleStore(s=>s.state),busy=useBattleStore(s=>s.playbackBusy||s.introLocked||!!s.handDiscard),card=useBattleStore(s=>s.selectedCardUid);
  const [anchor,A]=useState<{x:number;y:number}|null>(null);
  const valid=selection&&state&&selection.heroId===state.player.heroId&&selection.round===state.round;
  const view=valid?redemptionContext(state,content,selection.targetId):null;
  const targetId=view?.target.id;
  const units=state?.units;
  useEffect(()=>{
    if(!targetId||busy||card)return;
    let frame=0;
    const measure=()=>{const hp=project(targetId);const occupied:ContextRect[]=Array.from(document.querySelectorAll('.top-bar,.hand,.battle-utilities,.pause-trigger,.pvp-header,dialog[open]')).map(e=>e.getBoundingClientRect());occupied.push(...(units??[]).filter(u=>u.id!==targetId).flatMap(u=>{const r=project(u.id);return r?[r]:[]}));const next=hp?redemptionPlacement(hp,{width:innerWidth,height:innerHeight},occupied):null;A(old=>old?.x===next?.x&&old?.y===next?.y?old:next);frame=requestAnimationFrame(measure);};
    frame=requestAnimationFrame(measure);return()=>cancelAnimationFrame(frame);
  },[targetId,busy,card,project,units]);
  if(!view||busy||card||!anchor)return null;
  const execute=(action:'HEAL'|'PROTECT')=>{onClose();useBattleStore.getState().performRedemption(view.spirit.id,view.target.id,action);};
  return createPortal(<div className="redemption-controls" data-target-id={view.target.id} role="group" aria-label={`Apoyo del Espíritu sobre ${view.target.name}`} style={{left:anchor.x,top:anchor.y}} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
    <span className="redemption-control" data-kind="heal" title={view.healLabel}><button type="button" disabled={!view.heal} aria-label={view.healLabel} onClick={()=>execute('HEAL')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg></button><span role="tooltip">{view.healLabel}</span></span>
    <span className="redemption-control" data-kind="protect" title={view.protectLabel}><button type="button" disabled={!view.protect} aria-label={view.protectLabel} onClick={()=>execute('PROTECT')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 21 6v6c0 5-5 9-9 11-4-2-9-6-9-11V6z"/></svg></button><span role="tooltip">{view.protectLabel}</span></span>
  </div>,document.body);
}
