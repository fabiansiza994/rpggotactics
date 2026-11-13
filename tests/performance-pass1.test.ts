import {describe,it,expect,vi} from 'vitest';
import {AssetQueue} from '../src/presentation/loading/AssetQueue';
import {PresentationAssetGate} from '../src/presentation/loading/PresentationAssetGate';
import {PresentationClock} from '../src/presentation/motion/PresentationClock';
import {VisualQueue} from '../src/presentation/vfx/VisualQueue';
import {sceneAssetIds} from '../src/presentation/loading/sceneAssets';
import {cacheHeaders} from '../build/performanceBudget';
import {makeEngine} from './helpers';
import {DEFAULT_CONTENT,type GameState} from '../src/game';
import {replayBattle} from '../src/game/engine/replay';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
describe('performance pass 1 — local presentation contracts',()=>{
 it('loads actual units/materials, not catalog summons, waves or inactive forms',()=>{
  const e=makeEngine(),s=structuredClone(e.state) as GameState;
  const ids=sceneAssetIds(s);expect(ids).toContain('mage');expect(ids).toContain('orc_warrior');
  for(const id of ['war_drake','primordial_dragon','pact_golem','warrior','qa_form_bear'])expect(ids).not.toContain(id);
  s.units.push({...s.units[0]!,id:'new-dragon',defId:'primordial_dragon',kind:'SUMMON'});
  expect(sceneAssetIds(s)).toContain('primordial_dragon');
 });
 it('caps texture concurrency and releases a failed slot',async()=>{
  const q=new AssetQueue(2),release:(()=>void)[]=[],started:number[]=[];
  const jobs=Array.from({length:5},(_,i)=>q.run(()=>new Promise<number>((resolve,reject)=>{started.push(i);release.push(()=>i===1?reject(Error('transient')):resolve(i));})).catch(()=>-1));
  await flush();expect(started).toEqual([0,1]);release.shift()!();await flush();expect(started).toEqual([0,1,2]);release.shift()!();await flush();expect(started).toEqual([0,1,2,3]);
  while(release.length){release.shift()!();await flush();}expect(await Promise.all(jobs)).toEqual([0,-1,2,3,4]);
 });
 it('serializes local asset readiness, preserving event order and the lock',async()=>{
  const observed:string[]=[],changed=vi.fn(),gate=new PresentationAssetGate(changed);let ready!:()=>void;
  gate.enqueue(()=>new Promise<void>(r=>{ready=r;}),()=>observed.push('impact A'));
  gate.enqueue(async()=>{observed.push('load B');},()=>observed.push('impact B'));
  await flush();expect(gate.busy).toBe(true);expect(observed).toEqual([]);ready();await flush();
  expect(observed).toEqual(['impact A','load B','impact B']);expect(gate.busy).toBe(false);
 });
 it('reconnect/clear discards old pending presentation without delaying a fresh snapshot',async()=>{
  const gate=new PresentationAssetGate(()=>{}),present=vi.fn();let ready!:()=>void;
  gate.enqueue(()=>new Promise<void>(r=>{ready=r;}),present);await flush();gate.clear();
  gate.enqueue(async()=>{},()=>present('new'));await flush();expect(present).toHaveBeenCalledExactlyOnceWith('new');
  ready();await flush();expect(present).toHaveBeenCalledTimes(1);expect(gate.busy).toBe(false);
 });
 it('a failed load still presents fallback and releases the lock',async()=>{
  const gate=new PresentationAssetGate(()=>{}),present=vi.fn();gate.enqueue(async()=>{throw Error('offline');},present);
  await flush();expect(present).toHaveBeenCalledTimes(1);expect(gate.busy).toBe(false);
 });
 it.each([16,150,350,1100])('advances nominal 3s presentation in wall time at %ims frames without changing cue order',delta=>{
  const clock=new PresentationClock(),queue=new VisualQueue(),events:string[]=[];clock.setSuspended(false,0);let impact=false;
  queue.enqueue({duration:3000,begin:()=>events.push('cast'),update:t=>{if(!impact&&t>=1800){impact=true;events.push('impact');}},finish:()=>events.push('finish'),cancel:()=>events.push('cancel')});
  let now=0;while(queue.busy){now+=delta;queue.tick(clock.advance(now));}
  expect(now).toBeGreaterThanOrEqual(3000);expect(now).toBeLessThan(3000+delta);expect(events).toEqual(['cast','impact','finish']);
 });
 it('excludes actual suspension and huge discontinuities, preserving normal slow frames',()=>{
  const c=new PresentationClock();c.setSuspended(false,0);expect(c.advance(150)).toBe(150);
  c.setSuspended(true,150);expect(c.advance(20000)).toBe(0);c.setSuspended(false,22000);expect(c.advance(22150)).toBe(150);
  expect(c.advance(30000)).toBe(0);expect(c.advance(30150)).toBe(150);
 });
 it('leaves authoritative replay identical regardless of presentation clock speed',()=>{
  const e=makeEngine();expect(e.dispatch({type:'END_TURN'}).ok).toBe(true);
  const before=JSON.stringify(e.state),history=JSON.stringify(e.history);
  for(const frame of [16,150,1100]){const c=new PresentationClock();c.setSuspended(false,0);let elapsed=0;for(let now=frame;elapsed<3000;now+=frame)elapsed+=c.advance(now);}
  const replay=replayBattle(e.scenario,DEFAULT_CONTENT,e.seed,e.history);expect(replay.rejectedAt).toBeNull();expect(replay.state).toEqual(e.state);expect(JSON.stringify(e.state)).toBe(before);expect(JSON.stringify(e.history)).toBe(history);
 });
 it('emits immutable only for generated hashed files and preserves HTML revalidation',()=>{
  const h=cacheHeaders(['assets/App-AbCDef12.js','assets/theme-bCDef123.css','art/warrior.webp','assets/unversioned.js']);
  expect(h).toContain('/assets/App-AbCDef12.js\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable');expect(h).toContain('/index.html\n  Cache-Control: public, max-age=0, must-revalidate');expect(h).not.toContain('art/warrior');expect(h).not.toContain('unversioned');
 });
});


it('never caches an unknown asset fallback while known hashed assets keep immutable',()=>{
  const h=cacheHeaders(['assets/PvpScreen-Tg0HSvPZ.js','assets/index-D5N0Dk0-.js']);
  expect(h).toContain('/assets/*\n  Cache-Control: no-store');
  expect(h.indexOf('/assets/*')).toBeLessThan(h.indexOf('/assets/PvpScreen-Tg0HSvPZ.js'));
  for(const f of ['PvpScreen-Tg0HSvPZ.js','index-D5N0Dk0-.js']) expect(h).toContain(`/assets/${f}\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable`);
  expect(h).not.toContain('/assets/missing-old-chunk.js\n');
  expect(h).not.toContain('max-age=14400');
});
