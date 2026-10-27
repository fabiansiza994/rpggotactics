/** Disposable reaction fixtures: all HP/shield/heal/death events come from the real rules. */
import { DEFAULT_CONTENT, GameEngine, type GameState, type GameEvent, type ScenarioDef } from '../../../game';
import { dealDamage, healUnit } from '../../../game/domain/combat/damage';
import type { DamageType } from '../../../game/domain/combat/damage-types';
export function universalReactionFixture(kind:string, receiver:string, outcome:string) {
 const scenario:ScenarioDef={id:'universal_reaction_qa',name:'Reacciones · reglas reales',description:'Sin persistencia',layout:Array(5).fill('.......'),legend:{'.':{}},hero:{heroId:'summoner',pos:{x:2,y:2}},structures:[],enemies:[{id:'target',enemyId:'orc_warrior',pos:{x:3,y:2}}],waves:[],objectives:[{type:'ELIMINATE_ALL'}],defaultSeed:42};
 const seed=new GameEngine(scenario,DEFAULT_CONTENT,42),initial=structuredClone(seed.state) as GameState;
 initial.player.energy=20;initial.player.hand=[{uid:'fox',cardId:'summon_fox'}];
 const prepared=GameEngine.fromSnapshot(initial,DEFAULT_CONTENT,scenario);
 const spawned=prepared.dispatch({type:'PLAY_CARD',cardUid:'fox',target:{x:2,y:3}});
 if(!spawned.ok)throw Error('Reaction fixture summon failed');
 const state=structuredClone(prepared.state) as GameState;
 state.player.hand=[];
 const hero=state.units.find(u=>u.id===state.player.heroId)!,enemy=state.units.find(u=>u.faction==='ENEMY')!;
 const target=receiver==='hero'?hero:receiver==='summon'?state.units.find(u=>u.kind==='SUMMON')!:enemy;
 const source=target.faction==='PLAYER'?enemy:hero;
 if(outcome==='shield')target.shield=10;
 if(outcome==='armor')target.armor=10;
 if(outcome==='death')target.hp=1;
 if(kind==='heal')target.hp=Math.max(1,target.maxHp-3);
 const before=structuredClone(state),events:GameEvent[]=[];
 const ctx={state,content:DEFAULT_CONTENT,emit:(e:GameEvent)=>events.push(e)};
 if(kind==='heal')healUnit(ctx,target,2,source.id);
 else {
  const type=({physical:'PHYSICAL',fire:'FIRE',ice:'ICE',arcane:'ARCANE',force:'FORCE'} as Record<string,DamageType>)[kind]!;
  dealDamage(ctx,target,1,source.id,type,type==='PHYSICAL'?'DIRECT_MELEE':'DIRECT_RANGED');
 }
 return {before,after:state,events,scenario,targetId:target.id};
}
