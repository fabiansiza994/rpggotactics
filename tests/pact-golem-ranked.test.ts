import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, createProfile, type GameEvent } from '../src/game';
import { createDuel, applyDuel, duelView, validateLoadout } from '../src/game/pvp/duel';
import { actSummons, spawnSummon } from '../src/game/domain/summons/summons';
import { tileAt } from '../src/game/domain/board/board';
import { endTurn } from './helpers';
const content=DEFAULT_CONTENT, load=validateLoadout(createProfile(content),'summoner');
function setup(ranked=true, seat:0|1=0) {
  let s=createDuel([load,load],7,'DUEL','classic',content,ranked);
  while(s.duel!.active!==seat)s=applyDuel(s,endTurn(s)).state;
  s.obstacles=[];
  const hero=s.units.find(u=>u.id===s.player.heroId)!;
  const rival=s.units.find(u=>u.id!==hero.id)!;
  hero.pos={x:0,y:2};rival.pos={x:8,y:2};
  s.player.hand=[{uid:'golem',cardId:'summon_pact_golem'}];s.player.energy=4;
  s=applyDuel(s,{type:'PLAY_CARD',cardUid:'golem',target:{x:1,y:2}}).state;
  return {s,id:s.units.find(u=>u.defId==='pact_golem')!.id,owner:hero.id};
}
for(const seat of [0,1] as const)it(`Ranked seat ${seat}: waits, pursues across rounds, wire views and replay agree`,()=>{
  const fixture=setup(true,seat), id=fixture.id;
  let s=fixture.s;
  const born=s.round;
  expect(s.units.find(u=>u.id===id)!.moveRange).toBe(3);
  s=applyDuel(s,endTurn(s)).state;
  expect(s.units.find(u=>u.id===id)!.pos).toEqual({x:1,y:2});
  s=applyDuel(s,endTurn(s)).state;
  const before=structuredClone(s),command=endTurn(s);
  const r=applyDuel(s,command);s=r.state;
  expect(s.units.find(u=>u.id===id)!.pos).toEqual({x:4,y:2});
  expect(s.units.find(u=>u.id===id)!.summon!.lastActedRound).toBe(born+1);
  expect(applyDuel(before,command)).toEqual(r);
  for(const viewer of [0,1] as const)expect(duelView(s,viewer).units.find(u=>u.id===id)!.pos).toEqual({x:4,y:2});
  s=applyDuel(s,endTurn(s)).state;
  s=applyDuel(s,endTurn(s)).state;
  expect(s.units.find(u=>u.id===id)!.pos).toEqual({x:7,y:2});
});
it('Casual and legacy snapshots keep movement 2 and radius 3',()=>{
 for(const legacy of [false,true]){
  const {s,id}=setup(false);if(legacy)delete s.duel!.rankedPactGolem;
  s.round++;const events:GameEvent[]=[];actSummons({state:s,content,emit:e=>events.push(e)},s.player.heroId);
  expect(s.units.find(u=>u.id===id)!.moveRange).toBe(2);
  expect(s.units.find(u=>u.id===id)!.pos).toEqual({x:1,y:2});
 }
 expect(createDuel([load,load],7,'DOMINION','classic',content,true).duel!.rankedPactGolem).toBeUndefined();
});
describe('Ranked legal paths and statuses',()=>{
 it('detours around a wall within movement budget; never crosses it',()=>{
  const {s,id}=setup();s.round++;
  tileAt(s.board,{x:2,y:2})!.terrain='BLOCKED';
  const events:GameEvent[]=[];actSummons({state:s,content,emit:e=>events.push(e)},s.player.heroId);
  const moves=events.filter(e=>e.type==='UNIT_MOVED'&&e.unitId===id);
  expect(moves).toHaveLength(1);
  for(const move of moves)if(move.type==='UNIT_MOVED'){
   expect(move.cost).toBeLessThanOrEqual(3);
   expect(move.path).not.toContainEqual({x:2,y:2});
   let previous=move.from;
   for(const step of move.path){expect(Math.abs(step.x-previous.x)+Math.abs(step.y-previous.y)).toBe(1);previous=step;}
  }
  const golem=s.units.find(u=>u.id===id)!;
  expect(golem.pos).not.toEqual({x:1,y:2});
  expect(golem.pos).not.toEqual({x:2,y:2});
 });
 it('unreachable champion: stays in place over repeated rounds',()=>{
  const {s,id}=setup();
  for(let y=0;y<s.board.height;y++)tileAt(s.board,{x:3,y})!.terrain='BLOCKED';
  for(let n=0;n<4;n++){
   s.round++;const events:GameEvent[]=[];actSummons({state:s,content,emit:e=>events.push(e)},s.player.heroId);
   expect(events.some(e=>e.type==='UNIT_MOVED'&&e.unitId===id)).toBe(false);
   expect(s.units.find(u=>u.id===id)!.pos).toEqual({x:1,y:2});
  }
 });
 for(const status of ['ROOTED','STUNNED'] as const)it(`${status} prevents pursuit`,()=>{
  const {s,id}=setup();s.round++;const golem=s.units.find(u=>u.id===id)!;
  golem.statuses=[{id:status,turnsLeft:2}];
  actSummons({state:s,content,emit:()=>{}},s.player.heroId);
  expect(golem.pos).toEqual({x:1,y:2});
 });
 it('without a unique champion uses reaction radius 5 and does not modify other summons',()=>{
  const {s,id,owner}=setup();s.round++;
  const rival=s.units.find(u=>u.kind==='HERO'&&u.id!==owner)!;rival.kind='ENEMY';rival.pos={x:6,y:2};
  s.units.find(u=>u.id===owner)!.summonCapacityBonus=1;
  const ctx={state:s,content,emit:()=>{}};
  const chicken=spawnSummon(ctx,s.units.find(u=>u.id===owner)!,'chicken',{x:0,y:3})!;
  expect(chicken.moveRange).toBe(content.summons!.chicken!.moveRange);
  actSummons(ctx,owner);expect(s.units.find(u=>u.id===id)!.pos).toEqual({x:4,y:2});
 });
});

it('continues pursuit when the sole champion retreats beyond five again',()=>{
 const {s,id,owner}=setup();const ctx={state:s,content,emit:()=>{}};
 s.round++;actSummons(ctx,owner);const golem=s.units.find(u=>u.id===id)!;
 expect(golem.pos).toEqual({x:4,y:2});
 s.units.find(u=>u.kind==='HERO'&&u.id!==owner)!.pos={x:8,y:5};
 s.round++;actSummons(ctx,owner);
 expect(golem.pos).not.toEqual({x:4,y:2});
 const after={...golem.pos};actSummons(ctx,owner);expect(golem.pos).toEqual(after);
});

it('reaction radius is five when there is no single valid enemy champion',()=>{
 const {s,id,owner}=setup();s.round++;
 const rival=s.units.find(u=>u.kind==='HERO'&&u.id!==owner)!;rival.kind='ENEMY';rival.pos={x:7,y:2};
 actSummons({state:s,content,emit:()=>{}},owner);
 expect(s.units.find(u=>u.id===id)!.pos).toEqual({x:1,y:2});
});
