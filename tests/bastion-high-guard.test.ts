import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, GameEngine, type GameState } from '../src/game';
import { makeEngine, mutable, unit, setHand, p, ofType } from './helpers';
import { bastionFixture } from '../src/presentation/qa/freeCatalog/finalCleanupFixtures';

function setup(shield=4, layout=Array(5).fill('.......'), edge=false, blocker=false) {
 const engine=makeEngine({layout,hero:{heroId:'warrior',pos:p(edge?5:1,2)},enemies:[{id:'target',enemyId:'orc_warrior',pos:p(edge?6:2,2)},...(blocker?[{id:'blocker',enemyId:'orc_warrior',pos:p(3,2)}]:[])]});
 const hero=unit(engine,engine.heroId);hero.shield=shield;
 unit(engine,'target').maxHp=unit(engine,'target').hp=40;
 mutable(engine).player.energy=4;mutable(engine).player.movePoints=0;
 const ids=setHand(engine,['bastion_blow','bastion_blow']);
 return {engine,hero,ids};
}
function play(engine:GameEngine, uid:string) {return engine.dispatch({type:'PLAY_CARD',cardUid:uid,target:unit(engine,'target').pos});}

describe('Bastion high-Guard reward: authoritative, paid, no dash',()=>{
 it.each([0,1,3,4,6,9])('Guardia %i: pre-consumption threshold, unchanged scaling',guard=>{
  const {engine,hero,ids}=setup(guard);const before={...hero.pos};const result=play(engine,ids[0]!);
  expect(result.ok).toBe(true);if(!result.ok)return;
  expect(unit(engine,'target').hp).toBe(40-(guard?Math.min(guard,6):1));
  expect(hero.pos).toEqual(before); // references are old after atomic dispatch; also check committed unit
  expect(unit(engine,engine.heroId).pos).toEqual(before);
  expect(unit(engine,engine.heroId).shield).toBe(Math.max(0,guard-6));
  expect(unit(engine,'target').pos).toEqual(p(guard>=4?3:2,2));
  expect(engine.state.player.movePoints).toBe(guard>=4?1:0);
  const damage=result.events.findIndex(e=>e.type==='UNIT_DAMAGED');
  const push=result.events.findIndex(e=>e.type==='UNIT_PUSHED');
  if(guard>=4)expect(push).toBeGreaterThan(damage);
 });
 it.each(['OBSTACLE','BLOCKED_TERRAIN','UNIT','EDGE'] as const)('push respects %s without bonus collision damage',collision=>{
  const layout=Array(5).fill('.......');if(collision==='OBSTACLE')layout[2]='...#...';if(collision==='BLOCKED_TERRAIN')layout[2]='...x...';
  const {engine,ids}=setup(4,layout,collision==='EDGE',collision==='UNIT');const before={...unit(engine,'target').pos};
  const r=play(engine,ids[0]!);expect(r.ok).toBe(true);if(!r.ok)return;
  expect(ofType(r.events,'UNIT_PUSHED')[0]?.collision).toBe(collision);
  expect(unit(engine,'target').pos).toEqual(before);expect(unit(engine,'target').hp).toBe(36);
  expect(engine.state.player.movePoints).toBe(1);
  if(collision==='UNIT')expect(unit(engine,'blocker').hp).toBe(8);
 });
 it('armor still mitigates the hit; dead targets are not pushed, reward remains once',()=>{
  for(const killed of [false,true]) {
   const {engine,ids}=setup();unit(engine,'target').armor=killed?0:9;
   if(killed)unit(engine,'target').hp=1;
   const r=play(engine,ids[0]!);expect(r.ok).toBe(true);if(!r.ok)return;
   expect(ofType(r.events,'UNIT_PUSHED')).toHaveLength(killed?0:1);
   expect(engine.state.player.movePoints).toBe(1);
   if(!killed)expect(unit(engine,'target').hp).toBe(40);
  }
 });
 it('cannot refund endlessly: card/energy consumed, follow-up movement paid, leftover Guardia <4 gives no second refund',()=>{
  const {engine,ids}=setup(9);
  expect(play(engine,ids[0]!).ok).toBe(true);const after=structuredClone(engine.state);
  expect(play(engine,ids[0]!).ok).toBe(false);expect(engine.state).toEqual(after);
  // Now two tiles away: no free extra range, step forward using exactly the recovered MP.
  expect(play(engine,ids[1]!).ok).toBe(false);
  expect(engine.dispatch({type:'MOVE_UNIT',unitId:engine.heroId,to:p(2,2)}).ok).toBe(true);
  expect(engine.state.player.movePoints).toBe(0);
  expect(play(engine,ids[1]!).ok).toBe(true);
  expect(engine.state.player.energy).toBe(0);expect(engine.state.player.movePoints).toBe(0);
  expect(unit(engine,'target').pos).toEqual(p(3,2));expect(unit(engine,'target').hp).toBe(31);
  expect(engine.dispatch({type:'MOVE_UNIT',unitId:engine.heroId,to:p(1,2)}).ok).toBe(false);
 });
 it('multiple high-guard cards still require finite energy/cards, never create another card or energy',()=>{
  const {engine,ids}=setup(20);
  expect(play(engine,ids[0]!).ok).toBe(true);
  expect(engine.dispatch({type:'MOVE_UNIT',unitId:engine.heroId,to:p(2,2)}).ok).toBe(true);
  expect(play(engine,ids[1]!).ok).toBe(true);
  expect(engine.state.player.energy).toBe(0);expect(engine.state.player.hand).toHaveLength(0);
  expect(engine.state.player.movePoints).toBe(1);
 });
 it('restored snapshots and replay emit identical push and MP events',()=>{
  const {engine,ids}=setup(4);const initial=JSON.parse(JSON.stringify(engine.state)) as GameState;
  const restored=GameEngine.fromSnapshot(initial,DEFAULT_CONTENT,engine.scenario);
  const a=play(engine,ids[0]!),b=play(restored,ids[0]!);expect(a).toEqual(b);expect(engine.state).toEqual(restored.state);
 });
 it('local authoritative PvP uses the same bonus',()=>{
  const f=bastionFixture('pvp'),engine=GameEngine.fromSnapshot(f.state,DEFAULT_CONTENT,f.scenario);
  const before=engine.state.player.movePoints,target=engine.state.units.find(u=>u.id!==engine.heroId)!;
  expect(engine.dispatch({type:'PLAY_CARD',cardUid:'qa-card-0',target:target.pos}).ok).toBe(true);
  expect(engine.state.player.movePoints).toBe(before+1);
  expect(engine.state.units.find(u=>u.id===target.id)!.pos).toEqual(p(4,2));
 });
});
