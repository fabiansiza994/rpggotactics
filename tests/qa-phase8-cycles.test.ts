import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {GameEngine,type GameState,type GameEvent,type Command,type ScenarioDef,createProfile,ownedFor} from '../src/game';
import {PVP_CONTENT as content} from '../server/src/pvp';
import {applyStatus} from '../src/game/domain/statuses/status-rules';
import {fallbackDiscardUid} from '../src/game/domain/cards/hand-limit';
import {DARK_LIGHT_CARDS} from '../src/game/data/dark-light';
import {visualFixture,activation} from '../qa/dark-light-visual-20261123/fixtures';
import {ctxFor} from './helpers';
import {nextRandom} from '../src/game/domain/core/rng';
const dir='qa/dark-light-phase8-20261123/';
type RecordStep={command:Command;events:GameEvent[];state:GameState};
const traces:{id:string;scope:string;scenario:ScenarioDef;initial:GameState;steps:RecordStep[]}[]=[];
function recorder(id:string,e:GameEngine,scenario:ScenarioDef,scope:string){const record={id,scope,scenario,initial:structuredClone(e.state),steps:[] as RecordStep[]};let command:Command;e.subscribe((events,state)=>record.steps.push({command:structuredClone(command),events:structuredClone(events) as GameEvent[],state:structuredClone(state)}));traces.push(record);return(c:Command)=>{command=c;const r=e.dispatch(c);expect(r.ok,id+' '+JSON.stringify(c)+' '+(!r.ok?r.message:'')).toBe(true);};}
function end(e:GameEngine,send:(c:Command)=>void){const discardUid=fallbackDiscardUid(e.state);send({type:'END_TURN',...(discardUid?{discardUid}:{})});}
function scenario(heroId:string,enemies:ScenarioDef['enemies']=[]){return{id:'phase8-cycle',name:'Ciclo real de motor local',description:'Arranged starting positions/hand, authoritative commands; no remote data',layout:Array(6).fill('.........'),legend:{'.':{}},hero:{heroId,pos:{x:2,y:2}},structures:[],enemies,waves:[],objectives:[{type:'SURVIVE_ROUNDS',rounds:16}],defaultSeed:42} as ScenarioDef;}
function setup(_id:string,heroId:string,cardIds:string[],enemies:ScenarioDef['enemies']=[],hp?:number){const s=scenario(heroId,enemies),e=new GameEngine(s,content,42);e.state.player.energy=20;e.state.player.hand=cardIds.map((cardId,i)=>({uid:'case-'+i,cardId}));if(hp!==undefined)e.state.units.find(u=>u.id===e.heroId)!.hp=hp;return{e,s};}
it('records confirmed engine traces for all thirty contracts, choices and three Executioner outcomes',()=>{
 for(const card of DARK_LIGHT_CARDS.filter(c=>!c.responseOnly)){
  const {engine:e,scenario:s}=visualFixture(card.id);const send=recorder(card.id,e,s,'Actual local engine, arranged starting fixture, not Cloud');send(activation(e));
  if(e.state.pendingCast)send({type:'SILENCE_RESPONSE',windowId:e.state.pendingCast.id,pass:true});
  if(e.state.player.pendingCardChoice)send({type:'RESOLVE_CARD_CHOICE',choiceUid:e.state.player.pendingCardChoice.options[0]!.uid});
 }
 for(const result of ['SELF','ENEMY','BOTH']){
  const {engine:e,scenario:s}=visualFixture('dark_executioner_call');let seed=0;for(;seed<10000;seed++){const n=nextRandom({rngState:seed});if(result===(n<.45?'SELF':n<.9?'ENEMY':'BOTH'))break;}(e.state as GameState).rngState=seed;
  const send=recorder('executioner-'+result,e,s,'Actual RNG-selected branch, initial seed arranged');send(activation(e));if(e.state.pendingCast)send({type:'SILENCE_RESPONSE',windowId:e.state.pendingCast.id,pass:true});
  expect(traces.at(-1)!.steps.flatMap(s=>s.events).find(e=>e.type==='EXECUTIONER_RESULT')).toMatchObject({result});
 }
});
it('records actual movement, summon attacks, poison, damage and deaths without clip injection',()=>{
 for(const id of ['dark_serpent_king','dark_scorpion_king','light_pact_fairy','dark_the_reaper'])for(const mode of ['pursuit','death']){
  const enemies=mode==='death'?[{id:'a',enemyId:'orc_warrior',pos:{x:4,y:2}},{id:'b',enemyId:'orc_warrior',pos:{x:4,y:3}},{id:'c',enemyId:'orc_warrior',pos:{x:5,y:1}}]:[{id:'a',enemyId:'orc_warrior',pos:{x:7,y:2}}];
  const {e,s}=setup(id,'summoner',[id],enemies);if(mode==='pursuit')applyStatus(ctxFor(e),e.state.units.find(u=>u.kind==='ENEMY')!,'GLACIER_CLAW',3,e.heroId);
  const send=recorder(id+'-'+mode,e,s,'PvE real commands; starting hand/positions and pursuit root arranged, base stats unchanged');send({type:'PLAY_CARD',cardUid:'case-0',target:{x:3,y:2}});if(e.state.player.pendingCardChoice)send({type:'RESOLVE_CARD_CHOICE',choiceUid:e.state.player.pendingCardChoice.options[0]!.uid});
  for(let n=0;n<8&&!e.state.outcome;n++)end(e,send);
 }
 const all=traces.filter(t=>t.id.includes('-pursuit')||t.id.includes('-death')).flatMap(t=>t.steps.flatMap(s=>s.events));expect(all.some(e=>e.type==='SUMMON_ATTACKED')).toBe(true);expect(all.some(e=>e.type==='UNIT_DAMAGED')).toBe(true);expect(all.some(e=>e.type==='UNIT_DEFEATED')).toBe(true);
});
it('records full worlds, low-HP loyalty, range2, expiry and rebellion with unchanged mechanics',()=>{
 for(const id of ['dark_dark_world','light_light_world']){
  const {e,s}=setup(id,'mage',[id]);const send=recorder(id+'-duration',e,s,'Empty SURVIVE_ROUNDS scenario; no fabricated world expiry');send({type:'PLAY_CARD',cardUid:'case-0',target:null});for(let n=0;n<7;n++)end(e,send);expect(e.state.units.find(u=>u.id===e.heroId)!.statuses.some(s=>s.id===(id==='dark_dark_world'?'DARK_WORLD':'LIGHT_WORLD'))).toBe(false);
 }
 for(const world of [false,true]){
  const {e,s}=setup('reaper','mage',world?['glacier_claw','dark_dark_world','dark_the_reaper']:['dark_the_reaper'],world?[{id:'a',enemyId:'orc_warrior',pos:{x:5,y:2}}]:[],5);
  const send=recorder(world?'reaper-loyal-expiry':'reaper-rebellion',e,s,'Owner starts wounded5HP; normal sacrifice4 leaves1; no stat or threshold modification');
  if(world){send({type:'PLAY_CARD',cardUid:'case-0',target:{x:5,y:2}});send({type:'PLAY_CARD',cardUid:'case-1',target:null});}
  send({type:'PLAY_CARD',cardUid:world?'case-2':'case-0',target:{x:3,y:2}});
  for(let n=0;n<9&&!e.state.outcome;n++)end(e,send);
  expect(traces.at(-1)!.steps.flatMap(s=>s.events).some(e=>e.type==='REAPER_DISPOSITION'&&e.disposition==='REBEL')).toBe(true);
 }
 const loyal=traces.find(t=>t.id==='reaper-loyal-expiry')!.steps.flatMap(s=>s.events);expect(loyal.some(e=>e.type==='SUMMON_ATTACKED'&&e.ranged)).toBe(true);
});
it('records Abisal transformation, legal movement/attack, restore and return',()=>{
 const {e,s}=setup('abyssal','shapeshifter',['dark_abyssal_minotaur','qa_wild_strike','wild_burst'],[{id:'a',enemyId:'orc_warrior',pos:{x:6,y:2}}]);const send=recorder('abyssal-cycle',e,s,'PvE real commands and snapshot restore');send({type:'PLAY_CARD',cardUid:'case-0',target:null});
 const moves=e.getLegalMoves(),p=moves.sort((a,b)=>(Math.abs(a.pos.x-6)+Math.abs(a.pos.y-2))-(Math.abs(b.pos.x-6)+Math.abs(b.pos.y-2)))[0]!.pos;send({type:'MOVE_UNIT',unitId:e.heroId,to:p});
 const target=e.getValidTargets('case-1')[0];if(target)send({type:'PLAY_CARD',cardUid:'case-1',target});end(e,send);
 const restored=GameEngine.fromSnapshot(structuredClone(e.state),content,s);expect(restored.state.units.find(u=>u.id===e.heroId)?.activeForm).toBe('dark_abyssal_minotaur');send({type:'PLAY_CARD',cardUid:'case-2',target:null});expect(e.state.units.find(u=>u.id===e.heroId)?.activeForm).toBeUndefined();
});
it('records the unchanged Hammer and Orb mechanics with new presentation only',()=>{
 for(const id of ['thunder_hammer','storm_orb']){const{engine:e,scenario:s}=visualFixture(id);const send=recorder(id+'-phase8',e,s,'Actual local engine command; no altered damage');send(activation(e));}
});
it('exports QA replay evidence and public content metadata only',()=>{
 writeFileSync(dir+'engine-traces.json',JSON.stringify(traces));writeFileSync(dir+'public-content.json',JSON.stringify(content));writeFileSync(dir+'cycle-summary.json',JSON.stringify(traces.map(t=>({id:t.id,steps:t.steps.length,events:t.steps.flatMap(s=>s.events).map(e=>e.type),units:t.steps.at(-1)?.state.units.map(u=>({id:u.defId,hp:u.hp}))})),null,2));
 const profile=createProfile(content);writeFileSync(dir+'starter-decks.json',JSON.stringify(Object.fromEntries(Object.keys(content.heroes).map(id=>[id,profile.heroes[id]?.decks[0]?.cards]))));expect(traces.length).toBeGreaterThan(40);expect(ownedFor(profile,'mage',content)).toBeDefined();
});
