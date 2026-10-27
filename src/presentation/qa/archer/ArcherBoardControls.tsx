import { useEffect, useState } from 'react';
import { useBattleStore } from '../../store/battleStore';
import { visualSettings } from '../../vfx/visualSettings';
import type { CharacterMotion } from '../../pixi/CharacterAnimator';
import './board-controls.css';

/** Opt-in controls over the real BattleScreen; no battle commands are synthesized. */
export function ArcherBoardControls({onShot,onPose,onReset,snapshot}:{
  onShot:(target:string)=>void;onPose:(motion:CharacterMotion)=>void;onReset:()=>void;
  snapshot:()=>string;
}) {
  const state=useBattleStore(s=>s.state), busy=useBattleStore(s=>s.playbackBusy||s.introLocked);
  const [target,setTarget]=useState(''),[readout,setReadout]=useState(''),[slow,setSlow]=useState(false);
  const [reduced,setReduced]=useState(false);
  useEffect(()=>{const id=window.setInterval(()=>setReadout(snapshot()),100);return()=>window.clearInterval(id);},[snapshot]);
  useEffect(()=>{
    const before={...visualSettings};
    return()=>{Object.assign(visualSettings,before);};
  },[]);
  const enemies=state?.units.filter(u=>u.kind==='ENEMY')??[];
  return <details className="archer-board-qa">
    <summary>QA Arquero</summary>
    <div>
      <small>Solo apariencia del héroe · reglas originales</small>
      <label>Blanco <select aria-label="Blanco del Arquero" value={target||enemies[0]?.id||''} onChange={e=>setTarget(e.target.value)}>
        {enemies.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
      </select></label>
      <button disabled={busy||!enemies.length} onClick={()=>onShot(target||enemies[0]!.id)}>Tiro físico QA</button>
      <button disabled={busy} onClick={()=>onPose('hit')}>Daño visual QA</button>
      <button disabled={busy} onClick={()=>onPose('death')}>Derrota visual QA</button>
      <button disabled={busy} onClick={onReset}>Restablecer visual QA</button>
      <label><input type="checkbox" checked={slow} disabled={busy} onChange={e=>{setSlow(e.target.checked);visualSettings.timeScale=e.target.checked?.2:1;}}/>Cámara lenta Arquero</label>
      <label><input type="checkbox" checked={reduced} disabled={busy} onChange={e=>{setReduced(e.target.checked);visualSettings.reducedEffects=e.target.checked;}}/>Movimiento reducido Arquero</label>
      <output aria-label="Estado visual Arquero">{readout}</output>
    </div>
  </details>;
}
