import { allCardEffects } from '../../../game/domain/cards/form-effects';
import { prepareActorReview, actorReviewCommand } from './catalogReviewFixtures';
import { spawnSummon } from '../../../game/domain/summons/summons';
import { withArcher } from '../../../game/data/archer';
import { withShapeshifterRelease } from '../../../game/data/shapeshifter-release';
import { catalogPilot } from '../../vfx/catalogRecipes';
// The standalone lab must not inherit battle CSS from an earlier SPA navigation.
import '../../react/components/BattleStyles';
import { magePilot } from '../../vfx/mageRecipes';
import { universalReactionFixture } from './universalReactionFixtures';
import { hitReactionPilot } from '../../vfx/hitReactions';
import { encounterCheckpoint } from './integrationFixtures';
import { counterFeedback } from '../locomotion/counterFeedback';
import type { BattleCanvas } from '../../pixi/BattleCanvas';
import './fireball-qa.css';
import { FireballMetrics } from './FireballMetrics';
import { phaseTwoPilot } from '../../vfx/phaseTwoRecipes';
import { fireballPilot } from '../../vfx/fireballRecipe';
import { visualSettings } from '../../vfx/visualSettings';
import { createRun } from '../../../game/run/run';
import { TEMPLE_CAMPAIGN } from '../../../game/data/temple-encounters';
import { WorldRewardReveal } from '../../react/components/WorldRewardReveal';
import { presentPublicCast, usePublicCast } from '../../cards/publicCast';
import '../../../styles/mechanisms.css';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CONTENT, GameEngine, type GameState, type ScenarioDef } from '../../../game';
import { useBattleStore } from '../../store/battleStore';
import { presentationBus } from '../../events/presentationBus';
import { BoardView } from '../../react/components/BoardView';
import { HandBar } from '../../react/components/Hud';
const catalogContent=withShapeshifterRelease(withArcher(DEFAULT_CONTENT));
const choices=[...new Set([...Object.keys(catalogContent.cards),...Object.keys(catalogContent.enemies).map(id=>'enemy:'+id),...Object.values(catalogContent.enemies).flatMap(def=>(def.phases??[]).map((_,i)=>'enemy:'+def.id+':phase-'+i)),...Object.keys(catalogContent.summons??{}).map(id=>'summon:'+id),...Object.keys(catalogContent.rituals??{}).map(id=>'ritual:'+id),'hit:physical','hit:fire','hit:ice','hit:arcane','hit:force','hit:heal','fireball','frost_nova','nurture','counter','bastion_blow','magic_missile','ice_wall','barrier','blink','force_push','summon_fox','summon_war_drake','summon_pact_golem','seal_claw','ritual','reward'])];
/** Local-only arranged snapshots. Resolution always goes through the real engine and visual queue. */
export default function ResolutionQa() {
 const [choice,setChoice]=useState<string>(new URLSearchParams(location.search).get('effect') ?? 'ritual'),[generation,setGeneration]=useState(0);
 const [premium,setPremium]=useState(fireballPilot.premium),[speed,setSpeed]=useState(1),[paused,setPaused]=useState(false),[captureAt,setCaptureAt]=useState(0),[reduced,setReduced]=useState(false);
 const [bastionPremium,setBastionPremium]=useState(true),[golemPremium,setGolemPremium]=useState(true);
 const [trigger,setTrigger]=useState(0);
 const [magePremium,setMagePremium]=useState(true);
 const [catalogPremium,setCatalogPremium]=useState(true);
 const [reactions,setReactions]=useState(true),[receiver,setReceiver]=useState('enemy');
 const [victim,setVictim]=useState('damage'),[mode,setMode]=useState('lab'),[restored,setRestored]=useState(0);
 const [sample,setSample]=useState<ReturnType<BattleCanvas['qaFeelSnapshot']>|null>(null);
 const observe=useCallback((s:ReturnType<BattleCanvas['qaFeelSnapshot']>)=>setSample(s),[]);

 const casting=usePublicCast(s=>s.cast?.cardId===choice);
 useEffect(()=>{
  if(!(choice.startsWith('hit:')?trigger:casting)||!captureAt||paused)return;
  let id=0,last=performance.now(),elapsed=0;
  const frame=(now:number)=>{elapsed+=(now-last)*speed;last=now;if(elapsed>=captureAt){visualSettings.timeScale=0;setCaptureAt(0);setPaused(true);}else id=requestAnimationFrame(frame);};
  id=requestAnimationFrame(frame);return()=>cancelAnimationFrame(id);
 },[casting,captureAt,paused,speed,choice,trigger]);
 useEffect(()=>{catalogPilot.enabled=catalogPremium;magePilot.frost=magePilot.missile=magePremium;hitReactionPilot.enabled=reactions;fireballPilot.premium=premium;phaseTwoPilot.bastion=bastionPremium;phaseTwoPilot.golem=golemPremium;visualSettings.timeScale=paused?0:speed;visualSettings.reducedEffects=reduced;return()=>{catalogPilot.enabled=true;magePilot.frost=magePilot.missile=true;hitReactionPilot.enabled=true;fireballPilot.premium=true;phaseTwoPilot.bastion=true;phaseTwoPilot.golem=true;visualSettings.timeScale=1;visualSettings.reducedEffects=false;};},[premium,bastionPremium,golemPremium,speed,paused,reduced,reactions,magePremium,catalogPremium]);
 const engine=useBattleStore(s=>s.engine),busy=useBattleStore(s=>s.playbackBusy);
 useEffect(()=>{
  const actor=prepareActorReview(choice);
  if(actor){useBattleStore.setState({engine:actor,state:actor.state,selectedCardUid:null,aim:null,introLocked:false,playbackBusy:false,onlineCommand:null,handDiscard:null,notice:null});return actor.subscribe((events,state)=>{useBattleStore.setState({state});presentationBus.publish(events,state);});}
  const card=catalogContent.cards[choice];
  const summoner=choice==='nurture'||choice==='ritual'||choice.startsWith('summon_')||choice.startsWith('seal_');
  let scenario:ScenarioDef={id:'resolution_qa',name:'Resolución · QA',description:'Escena controlada local',layout:Array(5).fill('.......'),legend:{'.':{}},hero:{heroId:card?.heroId??(summoner?'summoner':'mage'),pos:{x:2,y:2}},structures:[],enemies:[{id:'qa-target',enemyId:'orc_warrior',pos:{x:3,y:2}}],waves:[],objectives:[{type:'ELIMINATE_ALL'}],defaultSeed:42};
  if(choice.startsWith('hit:')){
    const f=universalReactionFixture(choice.slice(4),receiver,victim);
    const e=GameEngine.fromSnapshot(f.before,DEFAULT_CONTENT,f.scenario);
    useBattleStore.setState({engine:e,state:e.state,selectedCardUid:null,aim:null,introLocked:false,playbackBusy:false,onlineCommand:null,handDiscard:null,notice:null});
    return;
  }
  const minRange=card&&'minRange' in card.targeting?(card.targeting.minRange??1):card?.targeting.type==='TILE'&&card.targeting.leapAnchor?card.targeting.leapAnchor.minRange:1;
  scenario.enemies[0]!.pos={x:2+minRange,y:2};
  const base=new GameEngine(scenario,catalogContent,42);
  let snapshot=structuredClone(base.state) as GameState;
  const encounter=encounterCheckpoint(mode,scenario.hero.heroId);
  if(encounter){scenario=encounter.scenario;snapshot=encounter.state;}
  const counter=choice==='counter'?counterFeedback('bear','multiple'):null;
  if(counter){snapshot=structuredClone(counter.before) as GameState;}

  snapshot.player.energy=20;
  const victimUnit=snapshot.units.find(u=>u.faction==='ENEMY')!;
  if(victim==='shield')victimUnit.shield=10;
  if(victim==='armor')victimUnit.armor=10;
  if(victim==='death')victimUnit.hp=1;
  if(choice==='bastion_blow')snapshot.units.find(u=>u.kind==='HERO')!.shield=4;
  if(choice==='nurture')snapshot.units.find(u=>u.id===snapshot.player.heroId)!.hp-=6;
  snapshot.player.hand=['ritual','reward','counter'].includes(choice)?[]:[{uid:'qa-public-card',cardId:choice},{uid:'qa-repeat',cardId:choice}];
  snapshot.player.altar=choice==='ritual'?['seal_claw','seal_fang','seal_wing','seal_heart'].map(cardId=>({uid:'qa-'+cardId,cardId})):[];
  const champion=snapshot.units.find(u=>u.id===snapshot.player.heroId)!;
  if(card?.requiredForms?.[0])champion.activeForm=card.requiredForms[0];
  if(champion.momentum)champion.momentum.value=champion.momentum.max;
  champion.hp=Math.max(1,champion.maxHp-5);
  if(card?.discardSearch){const piece=Object.values(catalogContent.cards).find(c=>c.heroId===champion.defId&&c.ritualPiece)!;snapshot.player.discard.push({uid:'qa-search',cardId:piece.id});}
  if(card?.deckSearch){const summonCard=Object.values(catalogContent.cards).find(c=>c.heroId===champion.defId&&allCardEffects(c).some(f=>f.type==='SUMMON'))!;snapshot.player.deck.push({uid:'qa-search',cardId:summonCard.id});}
  const e=GameEngine.fromSnapshot(snapshot,counter?.content??catalogContent,scenario);
  if(card?.heroId==='summoner'&&!card.effects.some(f=>f.type==='SUMMON')){const pet=spawnSummon({state:e.state as GameState,content:catalogContent,emit:()=>{}},e.state.units.find(u=>u.id===e.state.player.heroId)!,'fox',{x:2,y:3});if(pet){pet.summon!.readyRound=e.state.round;pet.hp=Math.max(1,pet.hp-3);}}
  if(card&&'preyOnly' in card.targeting&&card.targeting.preyOnly)e.state.units.find(u=>u.faction==='ENEMY')!.statuses.push({id:'PREY',sourceId:champion.id,turnsLeft:2});
  useBattleStore.setState({engine:e,state:e.state,selectedCardUid:null,aim:null,introLocked:false,playbackBusy:false,onlineCommand:null,handDiscard:null,notice:null});
  return e.subscribe((events,state)=>{useBattleStore.setState({state});presentationBus.publish(events,state);});
 },[choice,generation,victim,mode,receiver]);
 const setComparison=(value:boolean)=>{setPremium(value);setMagePremium(value);setBastionPremium(value);setGolemPremium(value);setCatalogPremium(value);setReactions(value);};
 const exportReview=()=>{const data={capturedAt:new Date().toISOString(),choice,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},settings:{premium,magePremium,bastionPremium,golemPremium,catalogPremium,reactions,reduced,speed,paused},sample,heapBytes:(performance as Performance & {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize??null,atlas:performance.getEntriesByType('resource').filter(r=>r.name.includes('/art/vfx/')).map(r=>({name:r.name,duration:r.duration})),note:'Snapshot de métricas, no aprobación visual ni certificación GPU'};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='vfx-review-'+choice.replaceAll(':','-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const launch=()=>{
  if(!engine||busy)return;
  setTrigger(n=>n+1);
  if(/^(enemy|summon|ritual):/.test(choice)){const result=engine.dispatch(actorReviewCommand(engine,choice));if(!result.ok)useBattleStore.setState({notice:result.error});return;}
  if(choice.startsWith('hit:')){const f=universalReactionFixture(choice.slice(4),receiver,victim);useBattleStore.setState({state:f.after,engine:GameEngine.fromSnapshot(f.after,DEFAULT_CONTENT,f.scenario)});presentationBus.publish(f.events,f.after);return;}
  if(choice==='counter'){const f=counterFeedback('bear','multiple');f.after.player.hand=[];useBattleStore.setState({state:f.after,engine:GameEngine.fromSnapshot(f.after,f.content,engine.scenario)});presentationBus.publish(f.events,f.after);return;}
  if(catalogContent.cards[choice]?.deckSearch||catalogContent.cards[choice]?.discardSearch){const uid=engine.state.player.hand.find(c=>c.cardId===choice)?.uid;if(!uid)return;const result=engine.dispatch({type:'SEARCH_SUMMON',cardUid:uid,choiceUid:'qa-search'});if(!result.ok)useBattleStore.setState({notice:result.error});return;}
  const key=choice==='ritual'?'ritual:primordial_dragon':engine.state.player.hand.find(c=>c.cardId===choice)?.uid??'qa-public-card';
  const targets=engine.getValidTargets(key);
  const aim=choice==='ritual'||choice.startsWith('summon_')?{x:2,y:3}:{x:3,y:2};
  const hero=engine.state.units.find(u=>u.id===engine.state.player.heroId)!;
  const enemy=engine.state.units.find(u=>u.faction==='ENEMY');
  const preferred=choice==='nurture'?hero.pos:choice.startsWith('summon_')?{x:hero.pos.x,y:hero.pos.y+1}:enemy?.pos??aim;
  const target=targets.find(p=>p.x===preferred.x&&p.y===preferred.y) ?? targets[0] ?? null;
  const result=choice==='ritual'?engine.dispatch({type:'ACTIVATE_RITUAL',ritualId:'primordial_dragon',target}):engine.dispatch({type:'PLAY_CARD',cardUid:key,target});
  if(!result.ok)useBattleStore.setState({notice:result.error});
 };
 return <main className="battle act3-qa resolution-qa"><header style={{position:'fixed',top:4,left:8,zIndex:100,background:'#101c28',padding:8}}>
  <button disabled={busy} onClick={()=>setComparison(false)}>A · Todo original</button><button disabled={busy} onClick={()=>setComparison(true)}>B · Todo premium</button><button onClick={exportReview}>Exportar métricas actuales</button>
  <label>Reacciones <select aria-label="Versión reacciones universales" value={reactions?'universal':'legacy'} disabled={busy} onChange={e=>setReactions(e.target.value==='universal')}><option value="legacy">Referencia original</option><option value="universal">Universales</option></select></label>
  <label>Receptor de fixture <select aria-label="Receptor reacción QA" value={receiver} disabled={busy} onChange={e=>setReceiver(e.target.value)}><option value="enemy">Enemigo</option><option value="hero">Campeón</option><option value="summon">Invocación real</option></select></label>
  <label>Encuentro <select aria-label="Encuentro integración QA" disabled={busy} value={mode} onChange={e=>setMode(e.target.value)}><option value="lab">Laboratorio</option><option value="first_blood">First Blood · checkpoint</option><option value="crystal_guard">Crystal Guard · checkpoint</option><option value="duel">Duelo local sin red · checkpoint</option></select></label>
  <button onClick={()=>{setPaused(false);visualSettings.timeScale=speed;useBattleStore.setState({playbackBusy:false});setRestored(n=>n+1);}}>Restaurar snapshot final QA</button>
  <label>Escena QA <select aria-label="Familia de efecto QA" value={choice} disabled={busy} onChange={e=>setChoice(e.target.value)}>{choices.map(id=><option key={id}>{id}</option>)}</select></label>
  <label>Objetivo <select aria-label="Respuesta del objetivo QA" value={victim} disabled={busy} onChange={e=>setVictim(e.target.value)}><option value="damage">Daño HP</option><option value="shield">Bloqueo con escudo</option><option value="armor">Armadura</option><option value="death">Muerte</option></select></label>
  <button disabled={busy} onClick={()=>setGeneration(n=>n+1)}>Preparar de nuevo</button>
  <button disabled={!engine||busy||choice==='reward'} onClick={launch}>Lanzar efecto real QA</button>
  <button onClick={()=>presentPublicCast({cardId:choice==='ritual'?'seal_claw':choice,cardUid:'qa-public-preview',casterId:'qa-target'})}>Mostrar preview rival QA</button><button onClick={()=>presentPublicCast(null)}>Ocultar preview QA</button>
  <label>Catálogo <select aria-label="Versión catálogo Premium" value={catalogPremium?'premium':'legacy'} disabled={busy} onChange={e=>setCatalogPremium(e.target.value==='premium')}><option value="legacy">Original</option><option value="premium">Premium reutilizable</option></select></label>
  <label>Mago <select aria-label="Versión hechizos del Mago" value={magePremium?'premium':'legacy'} disabled={busy} onChange={e=>setMagePremium(e.target.value==='premium')}><option value="legacy">Referencia original</option><option value="premium">Premium ilustrado</option></select></label>
  <label>Fireball <select aria-label="Versión Bola de Fuego" value={premium?'premium':'legacy'} disabled={busy} onChange={e=>setPremium(e.target.value==='premium')}><option value="legacy">Referencia original</option><option value="premium">Premium ilustrado</option></select></label>
  <label>Bastión <select aria-label="Versión Golpe del Bastión" value={bastionPremium?'premium':'legacy'} disabled={busy} onChange={e=>setBastionPremium(e.target.value==='premium')}><option value="legacy">Referencia original</option><option value="premium">Premium ilustrado</option></select></label>
  <label>Gólem <select aria-label="Versión Gólem del Pacto" value={golemPremium?'premium':'legacy'} disabled={busy} onChange={e=>setGolemPremium(e.target.value==='premium')}><option value="legacy">Referencia original</option><option value="premium">Premium ilustrado</option></select></label>
  <label>Velocidad <select aria-label="Velocidad visual QA" value={speed} disabled={busy} onChange={e=>setSpeed(Number(e.target.value))}><option value="1">1×</option><option value="0.1">0.1× inspección</option><option value="0.025">0.025× captura</option></select></label>
  <label><input type="checkbox" aria-label="Reduced motion QA" checked={reduced} disabled={busy} onChange={e=>setReduced(e.target.checked)}/>Reduced motion</label><label>Captura <select aria-label="Pausa de captura QA" value={captureAt} disabled={busy} onChange={e=>{setTrigger(0);setCaptureAt(Number(e.target.value));}}><option value="0">Libre</option><option value="100">Reacción ~100 ms</option><option value="340">Contacto Bastión 340 ms</option><option value="800">Gólem 800 ms</option><option value="1100">Aura Gólem 1100 ms</option><option value="400">Vuelo 400 ms</option><option value="550">Contacto arcano 550 ms</option><option value="660">Impacto 660 ms</option></select></label><button onClick={()=>setPaused(p=>!p)}>{paused?'Reanudar visual':'Pausar visual'}</button><output aria-label="Resolución QA">{busy?'Resolviendo':'Preparado'}</output><FireballMetrics busy={busy} inspection={speed!==1||paused||captureAt>0}/><output aria-label="Recursos VFX QA">{sample?JSON.stringify(sample):'Cargando métricas'}</output><output aria-label="Memoria QA">Heap JS aproximado: {(performance as Performance & {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize??'no disponible'}</output><output aria-label="Atlas QA">{performance.getEntriesByType('resource').filter(r=>r.name.includes('/art/vfx/')).map(r=>`${r.name.split('/').pop()}: ${r.duration.toFixed(1)}ms`).join(' · ')}</output>
 </header><BoardView key={restored} focusedEnemyId={null} qaSample={observe}/>{choice==='reward' && <aside style={{position:'fixed',inset:'60px 12% 10px',overflow:'auto',zIndex:30,background:'#0b1725'}}><WorldRewardReveal run={createRun(TEMPLE_CAMPAIGN,DEFAULT_CONTENT,42,'mage')}/></aside>}{engine && <HandBar state={engine.state} engine={engine}/>}</main>;
}
