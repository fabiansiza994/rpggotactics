import {withArcher} from '../../game/data/archer';
import {withShapeshifterRelease} from '../../game/data/shapeshifter-release';
import {useState} from 'react';
import {PRESENTATION_CONTENT} from '../qa/shapeshifter/runtime';
import {DIALOGUE_LIBRARY} from '../../game/data/dialogue';
import {campaignDialogue,pvpIntro,type DialogueSequence} from '../../game/dialogue/dialogue';
import {DialogueOverlay} from './DialogueOverlay';
import {PvpVictoryLines} from './DialogueGates';
import {CHAMPION_DIALOGUE_IDS,CHAMPION_DIALOGUE_VARIANTS,BOSS_DIALOGUE_IDS,BOSS_DIALOGUE_VARIANTS,DIALOGUE_PORTRAITS} from './portraitVariants';
import {ENVIRONMENT_PAINTINGS} from '../assets/paintedAssets';

const QA_DIALOGUE_CONTENT=withArcher(withShapeshifterRelease(PRESENTATION_CONTENT));

/** Local, explicit presentation fixtures; no battle state, network, settings or seen writes. */
export function DialogueVisualQa(){
 const [variant,setVariant]=useState<'comic'|'tactical'>('comic');
 const [champion,setChampion]=useState('archer');
 const [boss,setBoss]=useState<string>('stone_colossus');
 const [scene,setScene]=useState('normal');const [revision,setRevision]=useState(0);const [open,setOpen]=useState(true);
 const pvp=scene==='pvp'||scene==='mirror'||scene==='warrior-shapeshifter';const heroes:readonly[string,string]=scene==='mirror'?['archer','archer']:scene==='warrior-shapeshifter'?['warrior','shapeshifter']:['archer','mage'];
 const encounter=scene==='elite'?'hunt_05_stalker':scene==='boss'?'hunt_10_veil_beast':scene==='forge'?'w2_e10':scene==='colossus'?'ascent_10_colossus':'ascent_01_outpost';
 const bossEncounter:Record<string,string>={stone_colossus:'ascent_10_colossus',forge_king:'w2_e10',veil_stalker:'hunt_05_stalker',veil_guardian:'hunt_09_guardian',veil_beast:'hunt_10_veil_beast'};
 const sequence:DialogueSequence|null=scene==='boss-expressions'?{id:'qa-boss-'+boss,moment:'ENCOUNTER_INTRO',lines:BOSS_DIALOGUE_VARIANTS.map((portraitVariant,i)=>({key:'qa-boss-expression-'+boss+i,speaker:boss,portraitVariant,text:`${boss} · ${portraitVariant} — retrato de diálogo.`}))}:scene==='boss-intro'||scene==='boss-outro'?campaignDialogue(DIALOGUE_LIBRARY,{heroId:'archer',encounterId:bossEncounter[boss]!,tier:boss==='veil_stalker'||boss==='veil_guardian'?'ELITE':'BOSS',phase:scene==='boss-outro'?'outro':'intro'}):scene==='expressions'?{id:'qa-expressions-'+champion,moment:'ENCOUNTER_INTRO',lines:CHAMPION_DIALOGUE_VARIANTS.map((portraitVariant,i)=>({key:'qa-expression-'+champion+i,speaker:champion,portraitVariant,expression:portraitVariant,text:`${champion} · ${portraitVariant} — ilustración de diálogo, sin cambios de combate.`}))}:pvp?pvpIntro(DIALOGUE_LIBRARY,{heroes,matchKey:'visual-qa-fixed-match'}):campaignDialogue(DIALOGUE_LIBRARY,{heroId:champion,encounterId:encounter,tier:scene==='elite'?'ELITE':scene==='normal'?'NORMAL':'BOSS',phase:'intro'});
 return <main style={{minHeight:'100dvh',background:`#0b1420 url(${ENVIRONMENT_PAINTINGS.duel}) center/cover`,color:'#eee',padding:12}}>
  <div style={{position:'relative',zIndex:80,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',background:'#0b1420e8',padding:6}}>
   <label>Variante QA <select aria-label="Variante QA" value={variant} onChange={e=>{setVariant(e.target.value as 'comic'|'tactical');setOpen(true);setRevision(n=>n+1);}}><option value="comic">A · Comic Fantasy</option><option value="tactical">B · Tactical Elegant</option></select></label><label>Escena QA <select aria-label="Escena QA" value={scene} onChange={e=>{setScene(e.target.value);setOpen(true);setRevision(n=>n+1);}}>
    {['normal','elite','boss','forge','colossus','pvp','warrior-shapeshifter','mirror','victory','off','expressions','catalog','boss-expressions','boss-intro','boss-outro','boss-catalog'].map(s=><option key={s}>{s}</option>)}
   </select></label><label>Campeón QA <select aria-label="Campeón QA" value={champion} onChange={e=>{setChampion(e.target.value);setOpen(true);setRevision(n=>n+1);}}>{CHAMPION_DIALOGUE_IDS.map(id=><option key={id}>{id}</option>)}</select></label><label>Jefe QA <select aria-label="Jefe QA" value={boss} onChange={e=>{setBoss(e.target.value);setOpen(true);setRevision(n=>n+1);}}>{BOSS_DIALOGUE_IDS.map(id=><option key={id}>{id}</option>)}</select></label><button onClick={()=>{setOpen(true);setRevision(n=>n+1);}}>Repetir escena</button><span>Solo local · sin red ni cambios de combate</span>
  </div>
  {(scene==='catalog'||scene==='boss-catalog')&&<section className="dialogue-expression-catalog">{(scene==='boss-catalog'?BOSS_DIALOGUE_IDS:CHAMPION_DIALOGUE_IDS).map(id=>{const variants=DIALOGUE_PORTRAITS[id]!;return <div key={id}><h2>{id}</h2><div>{Object.entries(variants).map(([variant,src])=><figure key={variant}><img src={src} alt={`${id} ${variant}`}/><figcaption>{variant}</figcaption></figure>)}</div></div>;})}</section>}
  {!open&&<p role="status">Diálogo cerrado</p>}
  {scene==='off'&&<p>Diálogos desactivados · muestra de presentación</p>}
  {scene==='victory'&&<div className="result-card won" style={{maxWidth:620,margin:'70px auto'}}><h2>Victoria</h2><PvpVictoryLines content={QA_DIALOGUE_CONTENT} matchKey="visual-qa-fixed-match" heroes={heroes} winnerSeat={0}/></div>}
  {sequence&&open&&scene!=='victory'&&scene!=='off'&&scene!=='catalog'&&scene!=='boss-catalog'&&<DialogueOverlay key={scene+revision} visualVariant={variant} sequence={sequence} content={QA_DIALOGUE_CONTENT} mode={pvp?'ambient':'modal'} sideOf={pvp?l=>l.seat===0?'left':'right':undefined} onClose={()=>setOpen(false)}/>}
 </main>;
}
