import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {STANDARD_CARD_BACK} from '../cosmetics/CardBack';
import {presentationBus} from '../events/presentationBus';
import {opponentHandMotions,type OpponentHandMotion} from './opponentHandMotion';
import '../../styles/opponent-hand.css';

/** Anonymous slots from the public count, not cards hidden with CSS. */
export function OpponentHand({count,opponentId}:{count:number;opponentId:string}){
  const root=useRef<HTMLSpanElement>(null),[arrival,setArrival]=useState<{from:number;to:number}|null>(null);
  useEffect(()=>{
    const seen=new Set<string>(),cleanups=new Set<()=>void>();let arrivalTimer:ReturnType<typeof setTimeout>|undefined;
    const off=presentationBus.subscribe((events,state,batch)=>{
      if(!batch?.live||seen.has(batch.key))return;
      seen.add(batch.key);if(seen.size>64)seen.delete(seen.values().next().value!);
      const before=batch.before?.pileCounts?.opponentHand,after=state.pileCounts?.opponentHand;
      if(before===undefined||after===undefined)return; // initial load/reconnect never replays a draw
      const host=root.current,battle=host?.closest<HTMLElement>('.battle');if(!host||!battle)return;
      const hand=host.getBoundingClientRect(),deck=battle.querySelector('.battle-pile-bank.is-rival .battle-pile-deck')?.getBoundingClientRect(),grave=battle.querySelector('.battle-pile-bank.is-rival .battle-pile-grave')?.getBoundingClientRect(),own=battle.querySelector('.hand-bar .hand')?.getBoundingClientRect(),board=battle.querySelector('.board-host')?.getBoundingClientRect();
      if(!deck||!grave||!own||!board)return;
      const centre=(r:DOMRect)=>({x:r.left+r.width/2,y:r.top+r.height/2});
      const destinations:Record<OpponentHandMotion,{from:{x:number;y:number};to:{x:number;y:number}}>={draw:{from:centre(deck),to:centre(hand)},play:{from:centre(hand),to:{x:board.left+board.width/2,y:board.top+board.height*.3}},discard:{from:centre(hand),to:centre(grave)},'trade-out':{from:centre(hand),to:centre(own)},'trade-in':{from:centre(own),to:centre(hand)}};
      const motions=opponentHandMotions(before,after,events,opponentId);
      for(const kind of motions){
        const {from,to}=destinations[kind],layer=document.createElement('div'),card=document.createElement('div'),image=document.createElement('img');
        const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
        // Same flight animation and reduced mode as own hand activations. No new VFX renderer.
        layer.className=`hand card-activation-layer opponent-hand-flight${reduced?' is-reduced':''}`;
        layer.dataset.opponentMotion=kind;layer.setAttribute('aria-hidden','true');layer.setAttribute('inert','');
        Object.assign(layer.style,{left:`${from.x-12}px`,top:`${from.y-18}px`,width:'24px',height:'36px'});
        layer.style.setProperty('--cast-x',`${to.x-from.x}px`);layer.style.setProperty('--cast-y',`${to.y-from.y}px`);
        card.className='card card-activation';image.src=STANDARD_CARD_BACK;image.alt='';image.draggable=false;card.appendChild(image);layer.appendChild(card);
        const remove=()=>{clearTimeout(timer);layer.remove();cleanups.delete(remove)};const timer=setTimeout(remove,reduced?240:460);layer.addEventListener('animationend',e=>{if(e.target===layer)remove()});cleanups.add(remove);battle.appendChild(layer);
      }
      if(after>before){clearTimeout(arrivalTimer);setArrival({from:before,to:after});arrivalTimer=setTimeout(()=>setArrival(null),260)}
    });
    return()=>{off();clearTimeout(arrivalTimer);for(const stop of [...cleanups])stop();seen.clear()};
  },[opponentId]);
  const visible=Math.max(0,Math.trunc(Number.isFinite(count)?count:0));
  return <span className="opponent-hand" ref={root} role={visible?'img':undefined} aria-label={visible?`Mano rival: ${visible} cartas`:undefined} aria-hidden={!visible||undefined} data-opponent-hand-count={visible} style={{'--opponent-count':visible} as CSSProperties}>
    {Array.from({length:visible},(_,i)=><span key={i} className={`opponent-hand-card${arrival&&i>=arrival.from&&i<arrival.to?' is-arriving':''}`} aria-hidden="true" style={{left:`calc((100% - var(--opponent-card-width)) * ${i/Math.max(1,visible-1)})`,'--opponent-angle':`${((visible-1)/2-i)*Math.min(2.5,10/Math.max(1,visible-1))}deg`,'--opponent-rise':`${-Math.abs(i-(visible-1)/2)*.5}px`} as CSSProperties}><img src={STANDARD_CARD_BACK} alt="" draggable={false} decoding="async"/></span>)}
  </span>;
}
