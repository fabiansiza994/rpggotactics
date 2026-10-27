import { useEffect, useState } from 'react';
import { DEFAULT_CONTENT, GameEngine, type GameState, type ScenarioDef } from '../../../game';
import { withShapeshifterRelease } from '../../../game/data/shapeshifter-release';
import { spawnSummon } from '../../../game/domain/summons/summons';
import { useBattleStore } from '../../store/battleStore';
import { BoardView } from '../../react/components/BoardView';
import { HandBar } from '../../react/components/Hud';
import '../../react/components/BattleStyles';
import './final-cleanup-qa.css';
import './premium-integration-qa.css';
import { CosmeticPreviewContext } from '../../cosmetics/cardCosmetics';
import { CardBackFace } from '../../cosmetics/CardBack';
import type { Cosmetics } from '../../shop/api';
import { presentationBus } from '../../events/presentationBus';
const SCENARIO:ScenarioDef={id:'premium-integration-qa',name:'Premium local',description:'Sin cuentas ni grants',layout:Array(5).fill('.......'),legend:{'.':{}},hero:{heroId:'summoner',pos:{x:1,y:2}},enemies:[{id:'qa-orc',enemyId:'orc_warrior',pos:{x:6,y:2}}],structures:[],waves:[],objectives:[{type:'ELIMINATE_ALL'}],defaultSeed:42};
const BACK='cardback_premium_arcane_circle', SHOWCASE='showcase_double_moon_pact';
const OWNED:Cosmetics['owned']=[{cosmeticId:BACK,kind:'CARD_BACK',acquiredAt:1},{cosmeticId:SHOWCASE,kind:'CARD_ART',acquiredAt:1}];
export default function PremiumIntegrationQa(){
 const [kind,setKind]=useState('pact'),[generation,setGeneration]=useState(0),[back,setBack]=useState(true),[showcase,setShowcase]=useState(true),[saved,setSaved]=useState<GameState|null>(null);
 const e=useBattleStore(s=>s.engine),state=useBattleStore(s=>s.state),notice=useBattleStore(s=>s.notice),pair=useBattleStore(s=>s.pairSelection);
 const cosmetics:Cosmetics={owned:OWNED,equipped:{CARD_BACK:back?BACK:null,CARD_ART:showcase?SHOWCASE:null}};
 useEffect(()=>{
  const content=withShapeshifterRelease(DEFAULT_CONTENT),scenario={...SCENARIO,hero:{...SCENARIO.hero,heroId:kind==='ascenso'?'shapeshifter':'summoner'}};
  const initial=new GameEngine(scenario,content,42),s=initial.state as GameState;
  s.player.energy=9;s.player.hand=(kind==='ascenso'?['primal_ascent','qa_minotaur_form']:['double_moon_pact']).map((cardId,i)=>({uid:`qa-premium-${i}`,cardId}));
  if(kind==='pact')for(const [summonId,pos] of [['fox',{x:3,y:2}],['chicken',{x:4,y:3}]] as const)spawnSummon({state:s,content,emit:()=>{}},s.units.find(u=>u.id===initial.heroId)!,summonId,pos);
  const engine=GameEngine.fromSnapshot(saved??s,content,scenario);
  useBattleStore.setState({engine,state:engine.state,selectedCardUid:null,pairSelection:null,aim:null,notice:null,introLocked:false,playbackBusy:false,onlineCommand:null,handDiscard:null});
  return engine.subscribe((events,next)=>{useBattleStore.setState({state:next});presentationBus.publish(events,next);});
 },[kind,generation,saved]);
 return <CosmeticPreviewContext.Provider value={cosmetics}><main className="battle final-cleanup-qa premium-integration-qa"><header className="final-cleanup-controls">
 <label>Escenario <select aria-label="Premium integración" value={kind} onChange={ev=>{setSaved(null);setKind(ev.target.value);}}><option value="pact">Pacto · 2 objetivos</option><option value="ascenso">Ascenso · coste efectivo</option></select></label>
 <button onClick={()=>{setSaved(null);setGeneration(n=>n+1);}}>Reiniciar</button><button onClick={()=>{if(e)setSaved(JSON.parse(JSON.stringify(e.state)) as GameState);}}>Reconectar snapshot</button>
 <button aria-pressed={back} onClick={()=>setBack(v=>!v)}>Reverso QA</button><button aria-pressed={showcase} onClick={()=>setShowcase(v=>!v)}>Showcase QA</button>
 <button onClick={()=>{const c=e?.state.player.hand[0];if(c)useBattleStore.getState().selectCard(c.uid);}}>Seleccionar primera carta</button>
 {kind==='pact'&&<><button onClick={()=>useBattleStore.getState().clickTile({x:3,y:2})}>Casilla Zorro</button><button onClick={()=>useBattleStore.getState().clickTile({x:4,y:3})}>Casilla Pollo</button><button onClick={()=>useBattleStore.getState().clickTile({x:1,y:2})}>Casilla Campeón</button></>}
 <CardBackFace cosmetics={cosmetics}/><span>Sin red ni guardados de cuenta · Energía {state?.player.energy} · {pair?'SEGUNDO OBJETIVO':'Primer objetivo'} · {notice}</span>
 </header><BoardView key={`${kind}-${generation}-${!!saved}`} focusedEnemyId={null}/>{e&&state&&<HandBar engine={e} state={state}/>}</main></CosmeticPreviewContext.Provider>;
}
