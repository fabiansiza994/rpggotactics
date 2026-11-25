import {useEffect,useRef,useState} from 'react';
import type {GameEngine,GameState} from '../../../game';
import {validScorpionSacrifice} from '../../../game/domain/cards/card-choice';
import {useBattleStore,inputLocked} from '../../store/battleStore';
import '../../../styles/scorpion-ritual.css';
export function ScorpionRitualDialog({state,engine}:{state:Readonly<GameState>;engine:GameEngine}){
 const draft=useBattleStore(s=>s.scorpionDraft);
 return draft?<Ritual key={`${draft.cardUid}:${draft.position.x}:${draft.position.y}`} state={state} engine={engine}/>:null;
}
function Ritual({state,engine}:{state:Readonly<GameState>;engine:GameEngine}){
 const draft=useBattleStore(s=>s.scorpionDraft)!;
 const busy=useBattleStore(inputLocked),cancel=useBattleStore(s=>s.cancelAim),confirm=useBattleStore(s=>s.confirmScorpion);
 const dialog=useRef<HTMLDialogElement>(null),[amount,setAmount]=useState<number|null>(null);
 const owner=state.units.find(u=>u.id===state.player.heroId),hp=owner?.hp??0,min=Math.ceil(hp/2),max=hp-1;
 const card=state.player.hand.find(c=>c.uid===draft.cardUid&&c.cardId==='dark_scorpion_king');
 const valid=!!card&&state.phase==='PLAYER'&&!state.outcome;
 const choice=validScorpionSacrifice(hp,amount);
 const target=engine.getValidTargets(draft.cardUid).some(p=>p.x===draft.position.x&&p.y===draft.position.y);
 const ready=valid&&!busy&&!state.responseWindow&&choice&&target&&engine.getCardPlayability(draft.cardUid).playable;
 useEffect(()=>{if(!valid){useBattleStore.getState().clearScorpionDraft();return;}if(!dialog.current?.open)dialog.current?.showModal();},[valid]);
 if(!valid)return null;
 return <dialog ref={dialog} className="scorpion-ritual" aria-labelledby="scorpion-ritual-title" onCancel={e=>{e.preventDefault();cancel();}} onClick={e=>{if(e.currentTarget===e.target)cancel();}}>
 <header><small>INVOCACIÓN ESPECIAL · ULTRA</small><h2 id="scorpion-ritual-title">Pacto del Rey Escorpión</h2></header>
 <p>Casilla {draft.position.x+1}, {draft.position.y+1} · 4 energía · capacidad 0</p>
 <dl><div><dt>Tu vida actual</dt><dd>{hp} HP</dd></div><div><dt>HP que sacrificas</dt><dd>{amount??'Elige'}</dd></div><div><dt>Tu vida restante</dt><dd>{choice?hp-amount:'—'} HP</dd></div><div><dt>Vida del Escorpión</dt><dd>{choice?6+amount:'—'} HP</dd></div></dl>
 <label htmlFor="scorpion-sacrifice">Elige entre {min} y {max} HP</label>
 <div className="scorpion-slider"><button type="button" aria-label="Reducir sacrificio" disabled={busy||hp<2} onClick={()=>setAmount(n=>n===null?min:Math.max(min,n-1))}>−</button><input id="scorpion-sacrifice" aria-label="HP a sacrificar" type="range" min={min} max={Math.max(min,max)} step="1" value={amount??min} disabled={busy||hp<2} onChange={e=>setAmount(Number(e.target.value))}/><button type="button" aria-label="Aumentar sacrificio" disabled={busy||hp<2} onClick={()=>setAmount(n=>n===null?min:Math.min(max,n+1))}>+</button></div>
 <p role="status">{amount===null?'Selecciona explícitamente el sacrificio antes de confirmar.':!choice?'La vida cambió: selecciona un sacrificio válido.':hp-amount<=2?'Riesgo alto: quedarás con muy poca vida.':`Sacrificarás ${amount} HP sin mitigación de armadura o escudo.`}</p>
 <footer><button data-audio-cue="cancel" type="button" onClick={cancel}>Cancelar</button><button data-audio-cue="confirm" data-audio-activation="true" type="button" disabled={!ready} onClick={()=>{if(choice)confirm(amount);}}>Confirmar invocación</button></footer>
 </dialog>;
}
