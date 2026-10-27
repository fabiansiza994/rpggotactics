import { VfxDirector, type DirectorHost } from '../src/presentation/vfx/VfxDirector';
import type { ElementEffects } from '../src/presentation/vfx/ElementEffects';
import {describe,it,expect,vi}from'vitest';
import{GameEngine,DEFAULT_CONTENT,type GameState,type ScenarioDef}from'../src/game';
import{compileTimeline}from'../src/presentation/vfx/spellTimeline';
import{presentPublicRitual,usePublicCast}from'../src/presentation/cards/publicCast';
const scenario:ScenarioDef={id:'ritual-cinematic-test',name:'QA',description:'',layout:Array(5).fill('.......'),legend:{'.':{}},hero:{heroId:'summoner',pos:{x:0,y:2}},structures:[],enemies:[{id:'enemy',enemyId:'orc_warrior',pos:{x:6,y:2}}],waves:[],objectives:[{type:'ELIMINATE_ALL'}],defaultSeed:42};
function activate(){const e=new GameEngine(scenario,DEFAULT_CONTENT,42);const s=structuredClone(e.state)as GameState;s.player.energy=20;s.player.altar=['seal_claw','seal_fang','seal_wing','seal_heart'].map(cardId=>({uid:'qa-'+cardId,cardId}));const prepared=GameEngine.fromSnapshot(s,DEFAULT_CONTENT,scenario);const result=prepared.dispatch({type:'ACTIVATE_RITUAL',ritualId:'primordial_dragon',target:{x:1,y:2}});if(!result.ok)throw Error(result.error);return result.events;}
describe('four-piece ritual presentation',()=>{
 it.each([false,true])('orders public reveal, convergence circle, emergence and reading pause (reduced=%s)',reduced=>{
  const events=activate(),before=JSON.stringify(events),p=compileTimeline(events,id=>id,reduced);
  const reveal=p.cues.find(c=>c.event.type==='RITUAL_ACTIVATED'&&c.kind==='event')!;
  const circle=p.cues.find(c=>c.kind==='ritualCircle')!;
  const spawn=p.cues.find(c=>c.event.type==='UNIT_SPAWNED')!;
  const end=p.cues.find(c=>c.event.type==='RITUAL_RESOLVED')!;
  expect(reveal.at).toBeLessThan(circle.at);expect(circle.at).toBeLessThan(spawn.at);expect(spawn.at+spawn.duration).toBeLessThan(end.at);
  expect(p.duration).toBe(reduced?900:3000);expect(JSON.stringify(events)).toBe(before);expect(compileTimeline(JSON.parse(before),id=>id,reduced)).toEqual(p);
 });
 it('clears the cinematic on cancellation/reconnect without touching authoritative state',()=>{
  const e=activate().find(e=>e.type==='RITUAL_ACTIVATED')!;if(e.type!=='RITUAL_ACTIVATED')throw Error('missing');
  presentPublicRitual(e);const busy=vi.fn();const effects={clear:vi.fn()} as unknown as ElementEffects;
  const host={busy,castCard:vi.fn(),enemyAction:vi.fn()} as unknown as DirectorHost;
  const director=new VfxDirector(effects,host);director.clear();
  expect(usePublicCast.getState().ritual).toBeNull();expect(director.busy).toBe(false);expect(busy).toHaveBeenLastCalledWith(false);
 });
 it('publishes only activated pieces and clears on completion',()=>{
  const e=activate().find(e=>e.type==='RITUAL_ACTIVATED')!;if(e.type!=='RITUAL_ACTIVATED')throw Error('missing activation');
  presentPublicRitual(e);expect(usePublicCast.getState().ritual?.pieces).toHaveLength(4);presentPublicRitual(null);expect(usePublicCast.getState().ritual).toBeNull();
 });
});
