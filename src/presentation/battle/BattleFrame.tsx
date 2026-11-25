import {useEffect,useMemo,useState,type HTMLAttributes,type ReactNode} from 'react';
import {BattleRailContext,type RailSlot} from './BattleRails';
import '../../styles/desktop-battlefield.css';
import '../../styles/premium-battle-interface.css';
const QUERY='(min-width:900px) and (min-height:600px)';
const LEFT:RailSlot[]=['hero','preview','aim','piles','altar'];
const RIGHT:RailSlot[]=['enemy','terrain','map','camera','log','pause','end'];
const ALL:RailSlot[]=[...LEFT,...RIGHT,'header','opponent'];
/** Shared composition only: every battle mode retains its own commands and state. */
export function BattleFrame({children,className='',...props}:HTMLAttributes<HTMLDivElement>&{children:ReactNode}){
 const [wide,setWide]=useState(()=>matchMedia(QUERY).matches);
 const [slots,setSlots]=useState<Partial<Record<RailSlot,HTMLElement>>>({});
 const refs=useMemo(()=>Object.fromEntries(ALL.map(slot=>[slot,(node:HTMLDivElement|null)=>{if(node)setSlots(old=>old[slot]===node?old:{...old,[slot]:node});}])) as Record<RailSlot,(node:HTMLDivElement|null)=>void>,[]);
 useEffect(()=>{const mq=matchMedia(QUERY),change=()=>setWide(mq.matches);mq.addEventListener('change',change);return()=>mq.removeEventListener('change',change);},[]);
 const elements=(names:RailSlot[])=>names.map(slot=><div key={slot} ref={refs[slot]} className={`battle-rail-slot slot-${slot}`}/>);
 return <BattleRailContext.Provider value={wide?slots:{}}><div {...props} className={`battle premium-battle ${className}`}>
 {wide&&<><aside className="battle-side-rail is-left" aria-label="Campeón, cartas y altar">{elements(LEFT)}</aside><aside className="battle-side-rail is-right" aria-label="Rival y controles">{elements(RIGHT)}</aside><div className="premium-center-header">{elements(['header','opponent'])}</div></>}
 {children}</div></BattleRailContext.Provider>;
}
