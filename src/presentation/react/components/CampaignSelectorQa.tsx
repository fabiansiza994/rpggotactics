import {useState} from 'react';
import {PRESENTATION_CONTENT} from '../../qa/shapeshifter/runtime';
import {championPortrait} from '../../assets/champions';
import {CampaignChampionSelector} from './CampaignChampionSelector';
/** Loopback/dev route only. Fixture entries never reach a profile, deck or campaign store. */
export function CampaignSelectorQa(){
 const [open,setOpen]=useState(true);const [selected,setSelected]=useState('qa-0');
 const heroes=Object.values(PRESENTATION_CONTENT.heroes);
 const entries=Array.from({length:20},(_,i)=>{const hero=heroes[i%heroes.length]!;return {id:'qa-'+i,name:`${hero.name} · QA ${i+1}`,portrait:championPortrait(hero.id)??'',completed:i%11,total:10,...(i===19?{reason:'Bloqueado · fixture'}:{})};});
 return <main style={{padding:24,color:'#eee',background:'#091423',minHeight:'100dvh'}}><h1>Selector · 20 entradas de prueba</h1><p>Sin persistencia ni campeones nuevos.</p><button onClick={()=>setOpen(true)}>Abrir selector QA</button><p role="status">Selección: {selected}</p>{open&&<CampaignChampionSelector entries={entries} selectedId={selected} actName="El Ascenso · QA" onClose={()=>setOpen(false)} onSelect={id=>{setSelected(id);setOpen(false);}}/>}</main>;
}
