import {useEffect,useRef,useState} from 'react';
import {useBattleStore} from '../../store/battleStore';
import '../../../styles/pause-menu.css';
import {readDialogueSettings,writeDialogueSettings} from '../../dialogue/dialogueSession';

export function PauseMenu({busy=false,online=false,onRestart,onExit,onOpenChange}:{busy?:boolean;online?:boolean;onRestart?:()=>void;onExit:()=>void;onOpenChange?:(open:boolean)=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const [view,setView]=useState<'main'|'controls'|'restart'|'exit'>('main');
 const [dialogue,setDialogue]=useState(readDialogueSettings);
 const dialogueKey=online?'pvp':'campaign';
 const toggleDialogue=()=>{const next={...dialogue,[dialogueKey]:!dialogue[dialogueKey]};writeDialogueSettings(next);setDialogue(next);};
 const close=()=>{dialog.current?.close();onOpenChange?.(false);setView('main');trigger.current?.focus();};
 const open=()=>{if(busy)return;setView('main');dialog.current?.showModal();onOpenChange?.(true);};
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(e.key!=='Escape'||e.repeat)return;
   if(dialog.current?.open)return; // Native dialog cancel owns its nested-view priority.
   if((e.target as HTMLElement).closest?.('input,textarea,select,[contenteditable="true"]')||Array.from(document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"]')).some(el=>el.getClientRects().length>0))return;
   const s=useBattleStore.getState();
   if(s.selectedCardUid||s.aim?.source==='tap')return; // Existing card/target cancellation wins.
   const details=document.querySelector<HTMLDetailsElement>('.battle details[open]');
   if(details){details.open=false;e.preventDefault();e.stopImmediatePropagation();return;}
   if(busy||s.state?.outcome)return;
   e.preventDefault();e.stopImmediatePropagation();dialog.current?.showModal();setView('main');onOpenChange?.(true);
  };
  window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
 },[busy,onOpenChange]);
 return <>
  <button ref={trigger} className="pause-trigger" type="button" disabled={busy} onClick={open} aria-haspopup="dialog"><span aria-hidden="true">Ⅱ</span> Pausa <kbd>Esc</kbd></button>
  <dialog ref={dialog} className="pause-dialog" aria-labelledby="pause-title" onCancel={e=>{e.preventDefault();if(view==='main')close();else setView('main');}}>
   <span className="pause-eyebrow">RPG-GO TACTICS</span><h2 id="pause-title">{online?'Menú de combate':'Combate en pausa'}</h2>
   {online&&<p className="pause-online-note">La partida online continúa. El reloj y el turno del rival no se detienen.</p>}
   {view==='main'?<div className="pause-actions">
    <button autoFocus className="pause-primary" onClick={close}>Reanudar combate</button>
    <button disabled={!onRestart||busy} title={!onRestart?'No disponible en PvP':undefined} onClick={()=>setView('restart')}>Reiniciar combate</button>
    <button onClick={()=>setView('controls')}>Controles</button>
    <button aria-pressed={dialogue[dialogueKey]} onClick={toggleDialogue}>{online?'Diálogos PvP':'Diálogos de campaña'}: {dialogue[dialogueKey]?'Sí':'No'}</button>
    <button className="pause-caution" onClick={()=>setView('exit')}>Volver al menú</button>
   </div>:view==='controls'?<div className="pause-controls">
    <h3>Controles</h3><p>Clic en casilla azul: mover · Clic en carta (o 1–9) y luego en objetivo · Clic derecho / Esc: cancelar.</p>
    <p>Táctil: toca una carta y una casilla para previsualizar. Toca de nuevo el objetivo para confirmar. Toca una casilla azul para mover.</p>
    <p>E: finalizar turno · Esc sin selección: pausa.</p><button onClick={()=>setView('main')}>Volver a pausa</button>
   </div>:<div className="pause-confirm" role="group" aria-label="Confirmar acción">
    <p>{view==='restart'?'¿Quieres reiniciar este combate? Perderás el progreso del encuentro actual.':online?'¿Quieres salir? Se aplican las reglas actuales de abandono de la partida online.':'¿Quieres volver al menú? El combate actual se cerrará según las reglas de campaña existentes.'}</p>
    <button className="pause-caution" onClick={()=>{const action=view==='restart'?onRestart:onExit;close();action?.();}}>{view==='restart'?'Sí, reiniciar':'Sí, volver al menú'}</button>
    <button onClick={()=>setView('main')}>Cancelar</button>
   </div>}
  </dialog>
 </>;
}
