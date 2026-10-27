import { useState } from 'react';
import { CardBackArtQa } from './CardBackArtQa';
import ForbiddenBondQa from '../forbiddenBond/ForbiddenBondQa';
import { MissionRewardChoice } from '../../react/components/MissionRewardChoice';
import { PRESENTATION_CONTENT as CONTENT } from '../shapeshifter/runtime';
import type { RewardOption } from '../../../game';

/** Browser-only fixture; never calls a save/grant API or changes a persisted run. */
export default function MissionRewardQa() {
  const [reduced, setReduced] = useState(false);
  const [scene, setScene] = useState('mixed'), [epoch, setEpoch] = useState(0), [saved, setSaved] = useState(''), [count,setCount] = useState(0);
  const ids = scene === 'common' ? Object.values(CONTENT.cards).filter(c=>c.heroId==='mage' && c.rarity==='COMMON').slice(0,3).map(c=>c.id) : scene === 'legendary' ? Object.values(CONTENT.cards).filter(c=>c.rarity==='LEGENDARY').slice(0,3).map(c=>c.id) : scene === 'ultra' ? Object.values(CONTENT.cards).filter(c=>c.rarity==='ULTRA').slice(0,3).map(c=>c.id) : ['magic_missile',...Object.values(CONTENT.cards).filter(c=>c.heroId==='mage' && c.rarity==='RARE').slice(0,1).map(c=>c.id),'forbidden_bond'];
  const options:RewardOption[] = ids.map((id,i)=>({id:`reward-${i}`,kind:'ADD_CARD',cardId:id,rarity:CONTENT.cards[id]!.rarity ?? 'COMMON',isNew:true}));
  return <><ForbiddenBondQa/><details style={{position:'fixed',top:0,right:0,zIndex:50,background:'#101c2b',padding:4}}><summary>Controles QA</summary>
    <label><input type="checkbox" checked={reduced} onChange={e=>setReduced(e.target.checked)}/>Movimiento reducido QA</label><label>QA <select aria-label="Escena de recompensa" value={scene} onChange={e=>{setScene(e.target.value);setSaved('');setCount(0);setEpoch(n=>n+1);}}><option value="common">3 Common</option><option value="mixed">Rare/Common</option><option value="legendary">Legendary</option><option value="ultra">Ultra</option><option value="backs">Comparar reversos</option></select></label>
    <button onClick={()=>{setSaved('');setEpoch(n=>n+1);}}>Recargar recompensa pendiente</button><output aria-label="Guardados QA">{count} guardados QA {saved}</output>
    </details><div className="battle"><div className="result-overlay" role="dialog" aria-label="Recompensa de misión QA">
    {scene === 'backs' ? <CardBackArtQa/> : saved ? <section className="result-card"><h2>Recompensa guardada</h2><p>{saved}</p></section> : <MissionRewardChoice key={`${scene}:${epoch}`} reducedMotionOverride={reduced ? true : undefined} options={options} heroId="mage" saving={false} footer="Siguiente: encuentro de prueba" confirmLabel="Guardar recompensa" onConfirm={id=>{setSaved(id);setCount(n=>n+1);}}/>}
    </div></div></>;
}
