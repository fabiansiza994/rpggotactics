import {winterOnsetActive} from '../../../game/domain/combat/winter-onset';
import {ScreenEdgeMaterial} from './ScreenEdgeMaterial';
import {ScreenStatusLayer} from './ScreenStatusLayer';
import {useEffect,useState,useRef,type CSSProperties} from 'react';
import type {GameState} from '../../../game';
import '../../../styles/winter-atmosphere.css';
export const winterAtmosphereTurns=(state:Readonly<GameState>,finished=false):number=>finished||state.outcome?0:Math.max(0,...state.units.flatMap(u=>u.statuses.filter(s=>s.id==='ABSOLUTE_ZERO').map(s=>s.turnsLeft)));
/** Public authoritative statuses drive presentation only. No mechanical ice is inferred here. */
export function WinterAtmosphere({state,finished=false}:{state:Readonly<GameState>;finished?:boolean}){
 const turns=winterAtmosphereTurns(state,finished);
 const storm=turns>0&&state.units.some(winterOnsetActive);
 const active=turns>0,previous=useRef(active),[entering,setEntering]=useState(false);
 useEffect(()=>{const transitioned=!previous.current&&active;previous.current=active;if(!transitioned)return;const start=setTimeout(()=>setEntering(true),0),end=setTimeout(()=>setEntering(false),850);return()=>{clearTimeout(start);clearTimeout(end);};},[active]);
 return <ScreenStatusLayer className="winter-atmosphere" aria-hidden="true" data-active={active} data-storm={storm} data-entering={entering&&active} data-stage={turns>=8?'arriving':turns>=4?'established':'blizzard'} style={{'--winter-strength':turns>=8?.45:turns>=4?.65:.9} as CSSProperties}>
  <div className="winter-atmosphere__wave"/><div className="winter-atmosphere__frost"><ScreenEdgeMaterial/></div><div className="winter-atmosphere__wind"/>
  {Array.from({length:18},(_,i)=><i key={i} style={{'--x':`${(i*37)%100}%`,'--delay':`${-i*.61}s`,'--drift':`${(i%3-1)*35}px`,'--duration':`${6+i%4}s`} as CSSProperties}/>)}
 </ScreenStatusLayer>;
}
