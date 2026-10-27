import { useEffect, useMemo, useState } from 'react';
import type { GameEngine, Pos } from '../../game';
import { useBattleStore } from '../store/battleStore';
import { interactionPresentation, mechanismStateLabel } from './interactionPresentation';
import { phase2ActionLabel } from './phase2Presentation';
import '../../styles/combat-clarity.css';
type Rect={left:number;right:number;top:number;bottom:number};
export function linkedPlacement(point:{x:number;y:number}, board:Rect, viewport:{width:number;height:number}, occupied:Rect[]) {
  const candidates=[{x:board.left-144,y:point.y-42},{x:board.right+8,y:point.y-42}];
  return candidates.find(({x,y})=>x>=6 && x+136<=viewport.width-6 && y>=54 && y+86<=viewport.height-8 &&
    !occupied.some(r=>x<r.right&&x+136>r.left&&y<r.bottom&&y+86>r.top)) ?? null;
}
/** Safe gutter placement: never lays a button over playable cells, HUD or hand. Panel is fallback. */
export function LinkedMechanismAction({engine,project,polygon}:{engine:GameEngine;project(p:Pos):{x:number;y:number}|null;polygon(p:Pos):{x:number;y:number}[]|null}) {
  const selected=useBattleStore(s=>s.selectedMechanismId), card=useBattleStore(s=>s.selectedCardUid);
  const state=useBattleStore(s=>s.state), busy=useBattleStore(s=>s.playbackBusy||s.introLocked||!!s.handDiscard);
  const ui=useMemo(()=>state ? interactionPresentation(engine,selected) : null,[engine,selected,state]);
  const object=ui?.view.objects.find(o=>o.id===selected);
  const option=ui?.options.find(o=>o.mechanismId===selected&&o.allowed);
  const [anchor,setAnchor]=useState<{x:number;y:number;point:{x:number;y:number}}|null>(null);
  useEffect(()=>{
    let frame=0;
    const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      if(!object||!state||!option||busy||card||state.outcome||state.phase!=='PLAYER'){setAnchor(null);return;}
      const point=project(object.pos);
      const corners=[{x:0,y:0},{x:state.board.width-1,y:0},{x:0,y:state.board.height-1},{x:state.board.width-1,y:state.board.height-1}].flatMap(p=>polygon(p)??[]);
      if(!point||!corners.length){setAnchor(null);return;}
      const board={left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))};
      const occupied=Array.from(document.querySelectorAll('.top-bar,.hand,.battle-utilities,.mechanism-controls,.pause-trigger')).map(e=>e.getBoundingClientRect());
      const pos=linkedPlacement(point,board,{width:innerWidth,height:innerHeight},occupied);
      setAnchor(pos?{...pos,point}:null);
    });};
    measure();window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);};
  },[object,selected,state,busy,card,project,polygon,option]);
  if(!anchor||!object||!option||!ui||busy||card)return null;
  return <><svg className="mechanism-action-leader" aria-hidden="true"><path d={`M${anchor.x+68},${anchor.y+43} L${anchor.point.x},${anchor.point.y}`} stroke="#d0b879" strokeWidth="1.5" strokeDasharray="4 3"/><circle cx={anchor.point.x} cy={anchor.point.y} r="5" stroke="#e9d79e" fill="none"/></svg>
    <aside className="mechanism-linked-action" aria-label={`Acción de ${object.label??object.kind}`} style={{left:anchor.x,top:anchor.y}}>
      <strong>{object.label??object.kind}</strong><small>{mechanismStateLabel(object.state)}</small>
      <button type="button" onClick={()=>useBattleStore.getState().interactMechanism(object.id)}>{phase2ActionLabel(option.verb,option.mechanismId,ui.view)}</button>
    </aside></>;
}
