import {describe,it,expect,vi,beforeEach} from 'vitest';
import {Container} from 'pixi.js';
import {GameEngine,type GameEvent,type GameState} from '../src/game';
import {useBattleStore} from '../src/presentation/store/battleStore';
import {projectEvent} from '../src/presentation/vfx/visualProjection';
import {compileTimeline} from '../src/presentation/vfx/spellTimeline';
import {RotatingSections,SECTION_SPIN_MS} from '../src/presentation/pixi/RotatingSections';
import {GridProjection} from '../src/presentation/pixi/GridProjection';
import type {BoardViewModel} from '../src/presentation/pixi/viewModel';
import {VfxDirector,type DirectorHost} from '../src/presentation/vfx/VfxDirector';
import type {ElementEffects} from '../src/presentation/vfx/ElementEffects';
import {mechanismById} from '../src/game/domain/mechanisms/mechanism-board';
import {mechanismView} from '../src/game/domain/mechanisms/mechanism-view';
import {rotateSection} from '../src/game/domain/mechanisms/mechanism-rules';
import {orientationOf} from '../src/game/domain/mechanisms/mechanism-transform';
import {spawnSummon} from '../src/game/domain/summons/summons';
import {makeEngine,ctxFor,p} from './helpers';

const vm=(state:Readonly<GameState>)=>({state,mechanisms:mechanismView(state)}) as BoardViewModel;
const proj=new GridProjection({cols:7,rows:5,tile:96,perspective:1.18,depth:.66});
function fixture(){
 const e=makeEngine({layout:['.......','.....#.','.......','.......','.......'],hero:{heroId:'summoner',pos:p(3,2)},enemies:[{id:'orc-1',enemyId:'orc_warrior',pos:p(5,3)}],objectives:[{type:'SURVIVE_ROUNDS',rounds:30}],mechanisms:{objects:[
  {id:'section',kind:'REGION',pos:p(3,1),region:{cells:[1,2,3].flatMap(y=>[3,4,5].map(x=>p(x,y))),pivot:p(4.5,2.5)}},
  {id:'statue',kind:'STATUE',pos:p(3,1)}, {id:'plate',kind:'PRESSURE_PLATE',pos:p(3,1)},
  {id:'key',kind:'SWITCH',pos:p(4,1)},
 ],rules:[]}});
 spawnSummon(ctxFor(e),e.state.units.find(u=>u.kind==='HERO')!,'chicken',p(4,3));return e;
}
const geometry=(s:Readonly<GameState>)=>({board:s.board,units:s.units.map(u=>[u.id,u.pos,u.combatFacing]),obstacles:s.obstacles,mechanisms:s.mechanisms?.objects.map(o=>[o.def.id,o.pos,o.state])});
function rotate(e:GameEngine){const events:GameEvent[]=[];const before=structuredClone(e.state);const from=orientationOf(mechanismById(e.state,'section')!.state);expect(rotateSection(ctxFor(e,events),'section',((from+90)%360) as 0|90|180|270,1)).toBe(true);return {before,events,after:e.state};}

describe('turn banner edge identity',()=>{
 beforeEach(()=>useBattleStore.setState({turnBanner:null}));
 it('initial player entry once; card/move/attack/HP/energy/hand/selection and busy slices cannot announce again',()=>{
  const store=useBattleStore.getState();store.showTurnBanner('PLAYER',1);const first=useBattleStore.getState().turnBanner;
  for(const patch of [{playbackBusy:true},{playbackBusy:false},{selectedCardUid:'card'},{notice:'hit'},{handPulse:3},{introLocked:false}]){
   useBattleStore.setState(patch);store.showTurnBanner('PLAYER',1);expect(useBattleStore.getState().turnBanner).toBe(first);
  }
  store.showTurnBanner('ENEMY',1);store.showTurnBanner('PLAYER',2);expect(useBattleStore.getState().turnBanner!.id).toBe(3);
  const next=useBattleStore.getState().turnBanner;for(let i=0;i<8;i++)store.showTurnBanner('PLAYER',2);expect(useBattleStore.getState().turnBanner).toBe(next);
 });
 it('reconnect duplicate turn events are idempotent and presentation does not mutate a replay snapshot',()=>{
  const e=fixture();const saved=JSON.stringify(e.state);for(let i=0;i<5;i++)useBattleStore.getState().showTurnBanner('PLAYER',1);
  expect(useBattleStore.getState().turnBanner!.id).toBe(1);expect(JSON.stringify(e.state)).toBe(saved);
 });
});

describe('atomic rotating section presentation',()=>{
 it('commits floor, champion, enemy, summon, object and plate at one cue without mutating the engine or prior snapshot',()=>{
  const e=fixture();const f=rotate(e);const frozen=JSON.stringify(f.before),final=JSON.stringify(f.after);
  const event=f.events.find(x=>x.type==='MECHANISM_CHANGED'&&x.cue==='SECTION_ROTATED')!;
  const shown=projectEvent(f.before,event,f.after);expect(geometry(shown)).toEqual(geometry(f.after));
  expect(JSON.stringify(f.before)).toBe(frozen);expect(JSON.stringify(f.after)).toBe(final);
  expect(shown.units.some(u=>u.kind==='SUMMON')).toBe(true);
  const rebuilt=GameEngine.fromSnapshot(JSON.parse(JSON.stringify(shown)),e.content,e.scenario);expect(geometry(rebuilt.state)).toEqual(geometry(shown));
 });
 it.each([false,true])('queues the spin after previous actions, then commits the final exact anchors; reduced=%s',reduced=>{
  const e=fixture(),f=rotate(e);const roots=new Map(f.before.units.map(u=>[u.id,new Container()]));
  const obstacles=new Map(f.before.obstacles.map(o=>[o.id,new Container()]));
  const objects=new Map(f.before.mechanisms!.objects.map(o=>[o.def.id,new Container()]));
  const layer=new RotatingSections(id=>roots.get(id),id=>obstacles.get(id),()=>{},id=>objects.get(id));layer.update(vm(f.before),proj);
  const fx=new Proxy({}, {get:(_o,key)=>key==='center'||key==='lift'?(pos:unknown)=>pos:vi.fn(),set:()=>true}) as ElementEffects;
  let shown:Readonly<GameState>=f.before;
  const host={redraw:(s:Readonly<GameState>)=>{shown=s;layer.update(vm(s),proj);},presentEvent:(event:GameEvent)=>{if(event.type==='MECHANISM_CHANGED'&&event.kind==='REGION')layer.playEvents([event],shown,reduced);},unit:()=>undefined,obstacle:()=>undefined,walk:vi.fn(),busy:vi.fn(),impulse:vi.fn(),handPulse:vi.fn(),card:()=>undefined,turnBanner:vi.fn()} satisfies DirectorHost;
  const director=new VfxDirector(fx,host);director.sync(f.before);
  const events:GameEvent[]=[{type:'TURN_STARTED',faction:'ENEMY',round:1},...f.events.filter(x=>x.type!=='UNIT_TELEPORTED')];
  const timeline=compileTimeline(events,x=>x,reduced);const cue=timeline.cues.find(c=>c.event.type==='MECHANISM_CHANGED'&&c.event.cue==='SECTION_ROTATED')!;
  expect(cue.at).toBeGreaterThan(0);director.enqueue(events,f.after,reduced);director.tick(cue.at-1);expect(layer.busy).toBe(false);expect(geometry(shown)).toEqual(geometry(f.before));
  director.tick(1);expect(geometry(shown)).toEqual(geometry(f.after));expect(layer.busy).toBe(!reduced);
  layer.tick(SECTION_SPIN_MS,reduced);director.tick(timeline.duration);
  if(!reduced){for(const u of f.after.units){const anchor=proj.getUnitAnchor(u.pos);expect(roots.get(u.id)!.x).toBeCloseTo(anchor.x,5);expect(roots.get(u.id)!.y).toBeCloseTo(anchor.y,5);}for(const o of f.after.mechanisms!.objects.filter(o=>o.def.id!=='section')){const anchor=proj.getUnitAnchor(o.pos);expect(objects.get(o.def.id)!.x).toBeCloseTo(anchor.x,5);expect(objects.get(o.def.id)!.y).toBeCloseTo(anchor.y,5);}}
  expect(layer.busy).toBe(false);expect(shown).toEqual(f.after);
 });
 it('four complete visual/logical rotations return all occupants to their origin without drift',()=>{
  const e=fixture(),initial=geometry(e.state);const roots=new Map([...e.state.units.map(u=>[u.id,new Container()] as const),...e.state.obstacles.map(o=>[o.id,new Container()] as const),...e.state.mechanisms!.objects.map(o=>[o.def.id,new Container()] as const)]);
  const layer=new RotatingSections(id=>roots.get(id),id=>roots.get(id),()=>{},id=>roots.get(id));
  for(let i=0;i<4;i++){const f=rotate(e);layer.update(vm(f.after),proj);layer.playEvents(f.events,f.after,false);layer.tick(SECTION_SPIN_MS,false);for(const u of e.state.units){const at=proj.getUnitAnchor(u.pos);expect(roots.get(u.id)!.x).toBeCloseTo(at.x,5);expect(roots.get(u.id)!.y).toBeCloseTo(at.y,5);}}
  expect(geometry(e.state)).toEqual(initial);
  layer.clear();expect(layer.busy).toBe(false);expect(e.state.units.every(u=>!layer.ownsPosition(u.id))).toBe(true);
  layer.destroy();expect(()=>layer.clear()).not.toThrow();expect(()=>layer.tick(16,false)).not.toThrow();
 });
});
