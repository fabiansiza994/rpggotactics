import { FINAL_CARD_ART } from '../../assets/paintedAssets';
import { useEffect, useState } from 'react';
import { presentationBus } from '../../events/presentationBus';

/** Only the owning seat receives identities. Geometry is read before React removes the card. */
export function RitualTransfer({ heroId }: { heroId: string }) {
  const [flight,setFlight]=useState<{path:string;release:boolean;reduced:boolean;art?:string}|null>(null);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>;
    const off=presentationBus.subscribe(events=>{
      const e=events.find(e=>(e.type==='RITUAL_PIECE_COMMITTED'||e.type==='RITUAL_PIECE_RELEASED')&&e.casterId===heroId);
      if(!e||(e.type!=='RITUAL_PIECE_COMMITTED'&&e.type!=='RITUAL_PIECE_RELEASED')||!e.cardUid)return;
      const release=e.type==='RITUAL_PIECE_RELEASED';
      const source=release?document.querySelector(`[data-testid="altar-panel"] [data-card-id="${CSS.escape(e.cardId??'')}"]`):document.querySelector(`[data-card-uid="${CSS.escape(e.cardUid)}"]`);
      const socket = e.cardId ? document.querySelector(`[data-testid="altar-panel"] [data-accepts-card="${CSS.escape(e.cardId)}"]`) : null;
      const target = release ? document.querySelector('.pile-discard')
        : socket?.getBoundingClientRect().width ? socket
        : document.querySelector('[data-testid="altar-panel"] summary');
      if(!source||!target)return;
      const a=source.getBoundingClientRect(),b=target.getBoundingClientRect(),x=a.x+a.width/2,y=a.y+a.height/2,tx=b.x+b.width/2,ty=b.y+b.height/2;
      clearTimeout(timer);setFlight({path:`M${x} ${y} Q${(x+tx)/2} ${Math.min(y,ty)-12} ${tx} ${ty}`,release,art:e.cardId ? FINAL_CARD_ART[e.cardId] : undefined,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches});
      timer=setTimeout(()=>setFlight(null),420);
    });return()=>{off();clearTimeout(timer);};
  },[heroId]);
  if(!flight)return null;
  return <svg className={`ritual-transfer ${flight.release?'is-release':''}`} aria-hidden="true">
    <path d={flight.path} fill="none" stroke="currentColor" strokeWidth="2" />
    {!flight.reduced&&flight.art&&<image className="ritual-flying-piece" href={flight.art} x="-16" y="-21" width="32" height="42" style={{offsetPath:`path('${flight.path}')`}} />}
    {!flight.reduced&&<circle r="4" fill="currentColor" style={{offsetPath:`path('${flight.path}')`}} />}
  </svg>;
}
