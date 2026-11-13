import { describe, it, expect } from 'vitest';
import { DEFAULT_CONTENT, SCENARIOS_BY_ID, GameEngine, createProfile, type GameState, type GameEvent } from '../src/game';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { dealDamage } from '../src/game/domain/combat/damage';
import { createDuel, applyDuel, duelView, validateLoadout, DUEL_SCENARIO } from '../src/game/pvp/duel';
import { PVP_CONTENT } from '../server/src/pvp';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { declareIntent, executeIntent } from '../src/game/domain/ai/ai';
import { spawnSummon, actSummons } from '../src/game/domain/summons/summons';
import { HealthBarAnimation } from '../src/presentation/pixi/HealthBarAnimation';
import { damageReaction } from '../src/presentation/vfx/hitReactions';
const content=withShapeshifterRelease(DEFAULT_CONTENT);
function fixture(form='bear') {
 const scenario={...SCENARIOS_BY_ID.first_blood!,hero:{...SCENARIOS_BY_ID.first_blood!.hero,heroId:'shapeshifter'}};
 const engine=new GameEngine(scenario,content,42), state=structuredClone(engine.state) as GameState;
 const hero=state.units.find(u=>u.id===state.player.heroId)!,enemy=state.units.find(u=>u.faction==='ENEMY')!;
 hero.activeForm=form;hero.pos={x:2,y:2};hero.hp=hero.maxHp=40;hero.armor=0;enemy.pos={x:3,y:2};enemy.hp=enemy.maxHp=40;enemy.armor=0;
 const events:GameEvent[]=[];
 return {hero,enemy,state,events,ctx:{state,content,emit:(e:GameEvent)=>events.push(e)}};
}
describe('published form counter, without experimental flags',()=>{
 it.each(['bear','minotaur'])('%s replies physically for base 1 without spending resources',form=>{
  const f=fixture(form),before=structuredClone(f.state.player);
  dealDamage(f.ctx,f.hero,3,f.enemy.id,'PHYSICAL','DIRECT_MELEE');
  expect(f.enemy.hp).toBe(39);expect(f.hero.hp).toBe(37);
  expect(f.events.filter(e=>e.type==='COUNTER_ATTACK')).toEqual([{type:'COUNTER_ATTACK',unitId:f.hero.id,targetId:f.enemy.id,amount:1}]);
  expect(f.state.player).toEqual(before);expect(f.ctx.content.qaCombatDepth).toBeUndefined();
 });
 it.each(['bear','minotaur'])('PvE enemy intent triggers the existing %s response',form=>{
  const f=fixture(form);const intent=declareIntent(f.ctx,f.enemy);expect(intent.kind).toBe('MELEE_ATTACK');executeIntent(f.ctx,intent);
  expect(f.events.filter(e=>e.type==='COUNTER_ATTACK')).toHaveLength(1);expect(f.enemy.hp).toBe(39);
 });
 it('physical summon contact also receives a single counter',()=>{
  const f=fixture();f.enemy.kind='HERO';f.enemy.defId='summoner';f.enemy.pos={x:4,y:2};
  const wolf=spawnSummon(f.ctx,f.enemy,'wolf',{x:3,y:2})!;expect(wolf).not.toBeNull();f.state.round=wolf.summon!.readyRound;wolf.armor=0;
  const before=wolf.hp;actSummons(f.ctx,f.enemy.id,wolf.id);
  expect(f.events.filter(e=>e.type==='COUNTER_ATTACK')).toHaveLength(1);expect(wolf.hp).toBe(before-1);
 });
 it.each(['FIRE','ICE','ARCANE','FORCE'] as const)('%s melee magic does not trigger innate counter',type=>{
  const f=fixture();dealDamage(f.ctx,f.hero,3,f.enemy.id,type,'DIRECT_MELEE');expect(f.enemy.hp).toBe(40);expect(f.events.some(e=>e.type==='COUNTER_ATTACK')).toBe(false);
 });
 it.each(['RANGED','DIRECT_RANGED','GROUND_HAZARD','COUNTER',undefined] as const)('excludes non-eligible physical hit %s',kind=>{
  const f=fixture();dealDamage(f.ctx,f.hero,3,f.enemy.id,'PHYSICAL',kind);expect(f.events.some(e=>e.type==='COUNTER_ATTACK')).toBe(false);
 });
 it('preserves armor and shield mitigation of the counter',()=>{
  for(const armor of [0,1]) {
   const f=fixture();f.enemy.armor=armor;f.enemy.shield=2;
   dealDamage(f.ctx,f.hero,3,f.enemy.id,'PHYSICAL','DIRECT_MELEE');
   expect(f.enemy.hp).toBe(40);expect(f.enemy.shield).toBe(armor?2:1);
  }
 });
 it('never recurses between bear and minotaur and reacts separately to consecutive attacks',()=>{
  const f=fixture();f.enemy.kind='HERO';f.enemy.defId='shapeshifter';f.enemy.activeForm='minotaur';
  for(let i=0;i<3;i++)dealDamage(f.ctx,f.hero,2,f.enemy.id,'PHYSICAL','DIRECT_MELEE');
  expect(f.events.filter(e=>e.type==='COUNTER_ATTACK')).toHaveLength(3);expect(f.enemy.hp).toBe(37);expect(f.hero.hp).toBe(34);
 });
 it.each(['humanoid','dead','range','structure','friendly'])('no response for %s',mode=>{
  const f=fixture();if(mode==='humanoid')delete f.hero.activeForm;if(mode==='dead')f.hero.hp=1;if(mode==='range')f.enemy.pos={x:4,y:2};if(mode==='structure')f.enemy.kind='STRUCTURE';if(mode==='friendly')f.enemy.faction=f.hero.faction;
  dealDamage(f.ctx,f.hero,3,f.enemy.id,'PHYSICAL','DIRECT_MELEE');expect(f.events.some(e=>e.type==='COUNTER_ATTACK')).toBe(false);
 });
});
describe('Worker shared authoritative path and presentation',()=>{
 it.each([false,true])('Casual/Ranked ranked=%s keeps HP and counter events consistent for both seats and restore',ranked=>{
  for(const form of ['bear','minotaur']) {
   const profile=createProfile(PVP_CONTENT);
   const state=createDuel([validateLoadout(profile,'warrior',PVP_CONTENT),validateLoadout(profile,'shapeshifter',PVP_CONTENT)],7,'DUEL','classic',PVP_CONTENT,ranked);
   const a=state.units.find(u=>u.id===state.player.heroId)!,b=state.units.find(u=>u.id===state.duel!.other.heroId)!;
   a.pos={x:2,y:2};b.pos={x:3,y:2};a.armor=b.armor=0;a.shield=b.shield=0;b.activeForm=form;
   state.player.hand=[{uid:'strike',cardId:'heavy_strike'}];state.player.energy=5;
   const command={type:'PLAY_CARD' as const,cardUid:'strike',target:b.pos};
   const result=applyDuel(state,command,PVP_CONTENT);
   expect(result.events.filter(e=>e.type==='COUNTER_ATTACK'),JSON.stringify(result.events)).toHaveLength(1);
   expect(result.state.units.find(u=>u.id===a.id)!.hp).toBe(a.hp-1);
   expect(result).toEqual(applyDuel(state,command,PVP_CONTENT));
   for(const seat of [0,1] as const) {
    const wire=JSON.parse(JSON.stringify(duelView(result.state,seat,PVP_CONTENT)));
    const restored=GameEngine.fromSnapshot(wire,PVP_CONTENT,DUEL_SCENARIO);
    expect(restored.state.units.map(u=>[u.id,u.hp,u.pos])).toEqual(wire.units.map((u:{id:string;hp:number;pos:unknown})=>[u.id,u.hp,u.pos]));
    expect(wire.units.find((u:{id:string})=>u.id===a.id).hp).toBe(a.hp-1);
   }
   const counter=result.events.find(e=>e.type==='COUNTER_ATTACK')!;
   const damage=result.events.find(e=>e.type==='UNIT_DAMAGED'&&e.sourceId===b.id)!;
   expect(damage.type==='UNIT_DAMAGED'&&damage.hpAfter).toBe(a.hp-1);
   if(damage.type==='UNIT_DAMAGED') {
    expect(damageReaction(damage)).toBe('physical');
    const hpBar=new HealthBarAnimation();hpBar.set(a.hp,a.maxHp,false);hpBar.set(damage.hpAfter,a.maxHp,true);hpBar.tick(1000,false);
    expect(hpBar.front).toBeCloseTo((a.hp-1)/a.maxHp);expect(hpBar.trail).toBeCloseTo(hpBar.front);
   }
   for(const reduced of [false,true]) {
    const timeline=compileTimeline(result.events,id=>PVP_CONTENT.cards[id]?.presentation.visualKey??'',reduced);
    const impact=timeline.cues.find(c=>c.event===counter&&c.kind==='attackImpact')!;
    const hp=timeline.cues.find(c=>c.event===damage&&c.kind==='event')!;
    expect(impact).toBeDefined();expect(hp).toBeDefined();expect(hp.at).toBeGreaterThanOrEqual(impact.at);
   }
  }
 });
});
