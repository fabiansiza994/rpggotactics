import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {navigatePlay} from '../play/navigation';
import {useBattleStore} from '../store/battleStore';
import {useRankedPresence} from './rankedPresence';
import '../../styles/global-ranked.css';
export function rankedRemaining(deadline:number,now:number){return Math.max(0,Math.ceil((deadline-now)/1000));}
export function RankedSearchIndicator(){
 const queue=useRankedPresence(s=>s.queue),busy=useRankedPresence(s=>s.busy),cancel=useRankedPresence(s=>s.cancel);
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{if(queue.state!=='SEARCHING')return;const timer=setInterval(()=>setNow(Date.now()),500);return()=>clearInterval(timer);},[queue.state]);
 if(queue.state!=='SEARCHING')return null;
 const elapsed=Math.max(0,Math.floor((now-queue.since)/1000));
 return <aside className="global-ranked-search" aria-label="Búsqueda Ranked activa"><span className="ranked-search-orbit" aria-hidden="true">✧</span><div><strong>Buscando rival…</strong><time aria-label="Tiempo de búsqueda global">{Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,'0')}</time></div><button type="button" onClick={()=>{if(navigatePlay('pvp',{queue:'ranked'}))useBattleStore.getState().backToMenu();}}>Ver Ranked</button><button type="button" data-audio-cue="cancel" disabled={busy||!cancel} onClick={()=>cancel?.()}>Cancelar</button></aside>;
}
/** Presents the existing room's ready/leave actions; owns no acceptance or deadline. */
export function RankedChallenge({code,expiresAt,ready,busy,connected,error,onAccept,onReject}:{code:string;expiresAt:number;ready:boolean;busy:boolean;connected:boolean;error:string;onAccept():void;onReject():void}){
 const dialog=useRef<HTMLDialogElement>(null);const [now,setNow]=useState(Date.now);
 useEffect(()=>{dialog.current?.showModal();const t=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(t);},[]);
 const remaining=rankedRemaining(expiresAt,now);
 return createPortal(<dialog ref={dialog} className="global-ranked-challenge" aria-labelledby="ranked-challenge-title" data-challenge-id={code} onCancel={e=>e.preventDefault()}>
 <small>ARENA CLASIFICATORIA</small><span className="ranked-challenge-sigil" aria-hidden="true">✧</span><h2 id="ranked-challenge-title">Desafío encontrado</h2><p>Un rival está listo para enfrentarte.</p><p className="ranked-challenge-clock" role="timer">{remaining?`${remaining} s para responder`:'Comprobando el plazo con el servidor…'}</p><p>Tu campeón y el mazo registrado se conservan.</p>{error&&<p role="alert">{error}</p>}<footer><button type="button" disabled={busy||!remaining} onClick={onReject}>Rechazar</button><button type="button" data-audio-activation="true" disabled={busy||!connected||ready||!remaining} onClick={onAccept}>{ready?'Esperando al rival…':'Aceptar desafío'}</button></footer>
 </dialog>,document.body);
}
