import { CardView } from '../../react/components/CardView';
import { BattleCardFeature } from '../../react/components/BattleCardFeature';
import { useMemo, useState } from 'react';
import { DEFAULT_CONTENT,createProfile,grantCard,GameEngine,ASCENT_CAMPAIGN,encounterFor,type GameState } from '../../../game';
import { withArcher } from '../../../game/data/archer';
import { withShapeshifterRelease } from '../../../game/data/shapeshifter-release';
import { FREE_CATALOG,FREE_CATALOG_EXPANSION } from '../../../game/data/free-catalog';
import { catalogFactsFrom,discoverRarities } from '../../../game/collection/free-catalog';
import { DiscoverRaritiesView } from '../../catalog/FreeCatalog';
import { CatalogRewardView } from '../../catalog/CatalogRewards';
const base=withShapeshifterRelease(withArcher(DEFAULT_CONTENT));
const content={...base,releasedExpansions:[...(base.releasedExpansions??[]),FREE_CATALOG_EXPANSION]};
export default function FreeCatalogQa(){
 const [hero,setHero]=useState('mage'),[owned,setOwned]=useState(false),[reveal,setReveal]=useState(''),[inspect,setInspect]=useState(''),[zoom,setZoom]=useState(false),[demo,setDemo]=useState(false);
 const selected=content.cards[inspect]?.heroId===hero?inspect:FREE_CATALOG[hero]![2]!.cardId;
 const engine=useMemo(()=>{const e=new GameEngine(encounterFor(ASCENT_CAMPAIGN,ASCENT_CAMPAIGN.encounters[0]!.id,hero),content,1);(e.state as GameState).player.hand=[{uid:'catalog-qa',cardId:selected}];return e;},[hero,selected]);
 let profile=createProfile(content);
 if(owned)for(const row of FREE_CATALOG[hero]??[]){if((profile.heroes[hero]?.collection[row.cardId]?.copies??0)>0)continue;const r=grantCard(profile,hero,row.cardId,content);if(r.ok)profile=r.profile;}
 const facts=catalogFactsFrom({runs:()=>[],worldHistory:{},masteryXp:()=>0});
 const rows=discoverRarities(content,profile,hero,facts);
 return <main style={{background:'#09121b',color:'#e5dcc7',minHeight:'100dvh',padding:16}}>
  <h1>Catálogo gratuito · QA local</h1>
  <label>Campeón <select value={hero} onChange={e=>setHero(e.target.value)}>{Object.keys(FREE_CATALOG).map(id=><option key={id}>{id}</option>)}</select></label>{' '}
  <label><input type="checkbox" checked={owned} onChange={e=>setOwned(e.target.checked)}/> Cartas obtenidas</label>{' '}
  <label>Recompensa <select value={reveal} onChange={e=>setReveal(e.target.value)}><option value="">Sin reveal</option><option>ULTRA</option><option>LEGENDARY</option></select></label>
  <p>Fixtures sin guardar, sin API, flags globales sin cambios. Rare: encuentro; Legendaria: Maestría7; Ultra: ActoI/ Sendero.</p>
  <DiscoverRaritiesView rows={rows} content={content}/>
  <label>Vista de combate <select value={selected} onChange={e=>setInspect(e.target.value)}>{rows.map(r=><option key={r.cardId} value={r.cardId}>{r.name}</option>)}</select></label>
  <label><input type="checkbox" checked={demo} onChange={e=>setDemo(e.target.checked)}/> Mostrar mano/preview</label>
  {demo&&<div className="battle catalog-battle-demo" style={{position:'relative',height:620,minHeight:620,overflow:'hidden'}}>
    <BattleCardFeature state={engine.state} engine={engine} selectedCardUid="catalog-qa" inspectedCardUid={zoom?'catalog-qa':null} onCloseInspection={()=>setZoom(false)}/>
    <div style={{position:'absolute',right:30,bottom:20}}><CardView def={content.cards[selected]!} hotkey={1} selected playable onClick={()=>setZoom(true)}/></div>
  </div>}
  {rows.filter(r=>r.tier===reveal).map(r=><CatalogRewardView key={r.cardId} row={{...r,owned:true,copies:1,unlock:{...r.unlock,met:true,progress:r.unlock.progress?{...r.unlock.progress,current:r.unlock.progress.target}:null}}} content={content}/>)}
 </main>;
}
