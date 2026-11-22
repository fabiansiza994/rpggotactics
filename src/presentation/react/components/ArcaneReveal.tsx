import {revealEnabled,refreshRevealControl,subscribeRevealControl} from '../../cards/revealControl';
import {readRevealRenderer} from '../../cards/revealRenderer';
import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import type {GameContent} from '../../../game';
import {MarketCard} from '../../shop/MarketCard';
import {STANDARD_CARD_BACK} from '../../cosmetics/CardBack';
import {readRevealFrame,subscribeReveal,revealPose,readRevealMode,writeRevealMode,subscribeRevealMode,type RevealFrame,type RevealMode} from '../../cards/arcaneReveal';
import '../../../styles/arcane-reveal.css';
const COLORS:Record<string,string>={ICE:'113,219,255',THUNDER:'171,143,255',FIRE:'255,154,77',FORCE:'245,205,123',ARCANE:'170,153,255',NATURE:'115,218,156'};
const surfaces=new WeakMap<HTMLElement,Record<string,HTMLElement>>();
function paint(node:HTMLElement|null,frame:RevealFrame){
 if(!node)return;let refs=surfaces.get(node);if(!refs){refs={};for(const name of ['camera','card','dim','halo','rays','reflection','caption']){const el=node.querySelector<HTMLElement>('.ar-'+name);if(el)refs[name]=el;}surfaces.set(node,refs);}
 const p=revealPose(frame.progress,frame.duration<500);
 if(readRevealRenderer()==='pixi'){if(refs.caption)refs.caption.style.opacity=String(p.opacity);return;}
 if(refs.camera)refs.camera.style.opacity=String(p.opacity);
 if(refs.card)refs.card.style.transform=`translate3d(0,${p.y}px,0) rotateX(${p.pitch}deg) rotateY(${p.yaw}deg) rotateZ(${p.roll}deg) scale(${p.scale})`;
 if(refs.dim)refs.dim.style.opacity=String(p.opacity);
 if(refs.halo){refs.halo.style.opacity=String(p.opacity*.65);refs.halo.style.transform=`translate(-50%,-50%) scale(${.75+p.release*.3})`;}
 if(refs.rays){refs.rays.style.opacity=String(p.opacity*p.release);refs.rays.style.transform=`translate(-50%,-50%) rotate(${p.release*18}deg)`;}
 if(refs.reflection)refs.reflection.style.transform=`translateX(${(p.light-50)*1.4}%)`;
 if(refs.caption)refs.caption.style.opacity=String(p.opacity);
}
/** The existing scene clock drives this surface. No RAF, timeout, gameplay dispatch or secret hand access. */
export function ArcaneReveal({content}:{content:GameContent|undefined}){
 useEffect(()=>{const off=subscribeRevealControl(()=>{if(!revealEnabled())readRevealFrame()?.skip();});const timer=setInterval(()=>{if(!revealEnabled())readRevealFrame()?.skip();void refreshRevealControl();},30000);const visible=()=>{if(!document.hidden)void refreshRevealControl();};document.addEventListener('visibilitychange',visible);return()=>{off();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[]);
 const[shown,setShown]=useState<RevealFrame|null>(null),root=useRef<HTMLDivElement>(null),active=useRef<RevealFrame|null>(null);
 useEffect(()=>{const update=(frame:RevealFrame|null)=>{const previous=active.current;active.current=frame;if(!frame){if(previous)setShown(null);return;}if(previous?.id!==frame.id)setShown(frame);paint(root.current,frame);};update(readRevealFrame());const off=subscribeReveal(update);return()=>{off();active.current=null;};},[]);
 useLayoutEffect(()=>{if(active.current)paint(root.current,active.current);},[shown]);
 useEffect(()=>{if(!shown)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();active.current?.skip();}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[shown]);
 const card=shown&&content?.cards[shown.cardId];if(!shown||!card)return null;
 return createPortal(<div ref={root} className="arcane-reveal" data-reveal-id={shown.id} data-renderer={readRevealRenderer()} data-reduced={shown.duration<500} style={{'--ar-color':COLORS[card.presentation.element]??COLORS.ARCANE}as CSSProperties}>
  {readRevealRenderer()==='css'&&<><div className="ar-dim"/><div className="ar-halo"/><div className="ar-rays"/>
  <div className="ar-camera"><div className="ar-card">
   <div className="ar-back" aria-hidden="true"><img src={STANDARD_CARD_BACK} alt="" draggable={false}/></div>
   <div className="ar-front"><MarketCard card={card} interactive={false}/><span className="ar-reflection"/></div>
  </div></div></>}
  <div className="ar-caption" role="status" aria-live="polite"><span>REVELACIÓN ARCANA · ULTRA</span><strong>{card.name}</strong><small>Activación confirmada</small></div>
  <button type="button" className="ar-skip" onClick={()=>active.current?.skip()}>Saltar presentación <kbd>Esc</kbd></button>
 </div>,document.body);
}
export function ArcaneRevealSettings(){const mode=useSyncExternalStore(subscribeRevealMode,readRevealMode,readRevealMode);return <label>Cinemáticas de activación Ultra<select aria-label="Cinemáticas de activación Ultra" value={mode} onChange={e=>{writeRevealMode(e.target.value as RevealMode);readRevealFrame()?.skip();}}><option value="full">Completa</option><option value="reduced">Reducida</option><option value="off">Desactivada</option></select></label>;}
