import { CollectionTile } from '../../react/screens/DeckBuilder';
import { MissionRewardChoice } from '../../react/components/MissionRewardChoice';
import { useEffect, useState } from 'react';
import { DEFAULT_CONTENT, GameEngine, type ScenarioDef } from '../../../game';
import { spawnSummon } from '../../../game/domain/summons/summons';
import { FeatureCard } from '../../react/components/BattleCardFeature';
import { CardFinishPreviewContext, CosmeticPreviewContext } from '../../cosmetics/cardCosmetics';
import { useBattleStore } from '../../store/battleStore';
import { BoardView } from '../../react/components/BoardView';
import { HandBar, HeroPanel } from '../../react/components/Hud';
import '../../react/components/BattleStyles';
import '../freeCatalog/final-cleanup-qa.css';
import { RANKED_PREMIUM_ITEMS } from '../../../game/ranked/premiumTrack';
import { PremiumRewardArt } from '../../ranked/RankedPremiumTrack';
import type { Cosmetics } from '../../shop/api';
const EMPTY:Cosmetics={owned:[],equipped:{}};
const SHOWCASE:Cosmetics={owned:[{cosmeticId:'showcase_double_moon_pact',kind:'CARD_ART',acquiredAt:1}],equipped:{CARD_ART:'showcase_double_moon_pact'}};
const SCENARIO:ScenarioDef={id:'foil-qa',name:'Art foil',description:'QA visual',layout:Array(5).fill('.......'),legend:{'.':{}},hero:{heroId:'summoner',pos:{x:1,y:2}},enemies:[{id:'target',enemyId:'orc_warrior',pos:{x:6,y:2}}],structures:[],waves:[],objectives:[{type:'ELIMINATE_ALL'}],defaultSeed:42};
export default function ArtFoilQa() {
  const [battle,setBattle]=useState(false),[showcase,setShowcase]=useState(false),[secret,setSecret]=useState(false),[reward,setReward]=useState(false),[reduced,setReduced]=useState(false);
  const e=useBattleStore(s=>s.engine),state=useBattleStore(s=>s.state);
  useEffect(()=>{
    const engine=new GameEngine(SCENARIO,DEFAULT_CONTENT,42);
    engine.state.player.hand=['summon_chicken','double_moon_pact','summon_pact_golem'].map((cardId,i)=>({cardId,uid:`foil-${i}`}));
    spawnSummon({state:engine.state,content:DEFAULT_CONTENT,emit:()=>{}},engine.state.units.find(u=>u.id===engine.heroId)!,'fox',{x:2,y:2});
    useBattleStore.setState({engine,state:engine.state,selectedCardUid:null,pairSelection:null,aim:null,notice:null,introLocked:false,playbackBusy:false,onlineCommand:null,handDiscard:null});
  },[]);
  const def=DEFAULT_CONTENT.cards.double_moon_pact!;
  return <CardFinishPreviewContext.Provider value={secret?def.id:null}><CosmeticPreviewContext.Provider value={showcase?SHOWCASE:EMPTY}>
    <style>{`.foil-qa-controls{position:fixed;top:0;right:0;z-index:60;background:#0b1729;padding:6px;color:#eee0c6}.foil-qa-gallery{padding:50px 20px 20px;background:#081321;color:#e9dbbf;min-height:100dvh;box-sizing:border-box}.foil-qa-grid{display:flex;justify-content:center;gap:26px;flex-wrap:wrap}.foil-qa-example{width:280px;text-align:center}.foil-qa-example>.feature-card{height:392px;width:100%;position:relative;transform:none}.foil-before .cp-effects[data-art-foil]>.cp-foil{opacity:.1;background:radial-gradient(ellipse at 50% 50%,var(--cp-warm),transparent 55%),repeating-linear-gradient(125deg,transparent 0 24px,var(--cp-cold) 25px,transparent 26px 51px);background-size:auto}.foil-before .cp-foil::after{display:none}.foil-qa-grid .feature-card .fc-text{font-size:12px}.foil-qa-rail{align-items:flex-start;flex-wrap:wrap;display:flex;gap:20px;justify-content:center;padding:24px}.foil-qa-rail .rpt-art{width:240px}.foil-qa-example h2{font-size:16px}.foil-qa-gallery>h1{text-align:center;font:24px Georgia}@media(max-height:500px){.foil-qa-gallery{padding:38px 10px 10px}.foil-qa-example{width:210px}.foil-qa-example>.feature-card{height:294px}.foil-qa-grid{gap:18px}.foil-qa-example h2{font-size:12px}}`}</style>
    <div className="foil-qa-controls"><button onClick={()=>setReward(v=>!v)}>Recompensa QA</button><button onClick={()=>setBattle(v=>!v)}>{battle?'Comparar foil':'Ver mano y preview'}</button><label><input type="checkbox" checked={showcase} onChange={v=>setShowcase(v.target.checked)}/>Showcase equipado QA</label><label><input type="checkbox" checked={secret} onChange={v=>setSecret(v.target.checked)}/>Arcana Secreta QA</label><label><input type="checkbox" checked={reduced} onChange={v=>setReduced(v.target.checked)}/>Revelación reducida QA</label></div>
    {reward ? <main className="battle"><div className="result-overlay"><MissionRewardChoice reducedMotionOverride={reduced || undefined} options={[{id:'secret-qa',kind:'ADD_CARD',cardId:def.id,rarity:def.rarity ?? 'COMMON'}]} heroId="summoner" saving={false} onConfirm={async()=>{setReward(false);}} confirmLabel="Cerrar QA"/></div></main> : battle ? <main className="battle final-cleanup-qa">{e&&state&&<HeroPanel engine={e} state={state}/>}<BoardView focusedEnemyId={null}/>{e&&state&&<HandBar engine={e} state={state}/>}</main> : <main className="foil-qa-gallery"><h1>Acabados cosméticos · comparación QA</h1><div className="foil-qa-grid">{[['Common','',EMPTY],['Rare','',EMPTY],['Legendary','',EMPTY],['Ultra','',EMPTY],['Arcana Secreta','',EMPTY],['Showcase','',SHOWCASE]].map(([label,cls,value])=><CosmeticPreviewContext.Provider key={String(label)} value={value as Cosmetics}><CardFinishPreviewContext.Provider value={label==='Arcana Secreta'?def.id:null}><section className={`foil-qa-example ${String(cls)}`}><h2>{String(label)}</h2><FeatureCard def={{...def,rarity:label==='Common'?'COMMON':label==='Rare'?'RARE':label==='Ultra'?'ULTRA':'LEGENDARY'}} className="" extras={{playable:true}} scrollableDescription/></section></CardFinishPreviewContext.Provider></CosmeticPreviewContext.Provider>)}</div><div className="foil-qa-rail"><section style={{width:220}}><h2>Colección / Deck Builder</h2><CollectionTile card={def} owned={1} inDeck={0} selected={false} pulse={null} isNew={false} onActivate={()=>{}} onPointerDown={()=>{}} onInspect={()=>{}} onAdd={()=>{}} onDoubleClick={()=>{}} onDrag={()=>{}} onDragEnd={()=>{}} availability={1} canAdd={true} addReason="QA cosmético" dragging={false}/></section><PremiumRewardArt item={{...RANKED_PREMIUM_ITEMS.find(i=>i.cardId===def.id)!,status:'LOCKED'}}/><PremiumRewardArt item={{...RANKED_PREMIUM_ITEMS.find(i=>i.type==='SHOWCASE_CHOICE')!,chosenCardId:def.id,status:'LOCKED'}}/></div></main>}
  </CosmeticPreviewContext.Provider></CardFinishPreviewContext.Provider>;
}
