import { useState } from 'react';
import { useBattleStore } from '../../store/battleStore';

export function SummonerQa() {
  const prepare = useBattleStore(s=>s.prepareSummonerQa);
  const busy = useBattleStore(s=>s.cloud.busy);
  const [encounter,setEncounter]=useState('ascent_05_alpha');
  const [tier,setTier]=useState('STARTER');
  const [seed,setSeed]=useState(1);
  const [done,setDone]=useState(false);
  return <details className="summoner-qa">
    <summary>QA privado · balance Invocador</summary>
    <p>Prepara o repite solo la campaña y el mazo del Invocador de esta cuenta QA. Conserva el Mago. Las copias necesarias se añaden a la colección QA.</p>
    <label>Encuentro <select value={encounter} onChange={e=>{setEncounter(e.target.value);setDone(false);}}>
      <option value="ascent_05_alpha">05 · Alfa</option><option value="ascent_07_chasm">07 · Abismo</option><option value="ascent_09_elder">09 · Anciano</option><option value="ascent_10_colossus">10 · Coloso</option>
    </select></label>
    <label>Mazo <select value={tier} onChange={e=>{setTier(e.target.value);setDone(false);}}><option value="STARTER">Inicial</option><option value="MID">Medio</option><option value="VETERAN">Veterano</option></select></label>
    <label>Semilla <input type="number" min="1" max="4294967295" value={seed} onChange={e=>setSeed(Number(e.target.value))}/></label>
    <button disabled={!!busy} onClick={()=>void prepare(encounter,tier,seed).then(setDone)}>Preparar / repetir intento</button>
    {done && <p role="status">Preparado y guardado. Pulsa Continuar campaña para jugar.</p>}
  </details>;
}
