/** Local laboratory arrangements only. No live content, balances, flags or saves are changed. */
import { DEFAULT_CONTENT, GameEngine, type GameState, type ScenarioDef } from '../../../game';
import { createDuel, DUEL_SCENARIO } from '../../../game/pvp/duel';
export const BASTION_CASES = ['low', 'medium', 'high', 'combo', 'armor', 'pvp'] as const;
export type BastionCase = typeof BASTION_CASES[number];
export const BASTION_LABELS: Record<BastionCase,string> = {
 low:'Guardia baja · 1', medium:'Guardia media · 4', high:'Guardia alta · 9',
 combo:'Guardia → Golpe del Bastión', armor:'Objetivo con armadura · 2', pvp:'Duelo local contra Mago',
};
export const FINAL_QA_SCENARIO: ScenarioDef = {
 id:'free_catalog_final_qa', name:'Prueba local · Catálogo gratuito', description:'Sin progreso ni recompensas',
 layout:Array(5).fill('.........'), legend:{'.':{}}, hero:{heroId:'warrior',pos:{x:2,y:2}},
 enemies:[{id:'qa-target',enemyId:'orc_warrior',pos:{x:3,y:2}}], structures:[], waves:[], objectives:[{type:'ELIMINATE_ALL'}],defaultSeed:42,
};
export function bastionFixture(kind:BastionCase) {
 const state = kind==='pvp'
  ? createDuel([{heroId:'warrior',cards:[{cardId:'guard',count:15},{cardId:'bastion_blow',count:15}]},{heroId:'mage',cards:[{cardId:'fireball',count:30}]}],42)
  : structuredClone(new GameEngine(FINAL_QA_SCENARIO,DEFAULT_CONTENT,42).state) as GameState;
 if(state.duel && state.player.heroId !== state.duel.champions[0]) {
  [state.player,state.duel.other]=[state.duel.other,state.player]; state.duel.active=0;
 }
 const hero=state.units.find(u=>u.id===state.player.heroId)!;
 const target=state.units.find(u=>u.id!==hero.id)!;
 hero.pos={x:2,y:2}; target.pos={x:3,y:2}; target.maxHp=target.hp=30;
 target.moveRange=0; target.armor=kind==='armor'?2:0;
 hero.shield=kind==='low'?1:kind==='high'?9:kind==='combo'?0:4;
 state.player.energy=4;
 state.player.hand=(kind==='combo'?['guard','bastion_blow']:['bastion_blow']).map((cardId,i)=>({uid:`qa-card-${i}`,cardId}));
 return {state,scenario:kind==='pvp'?DUEL_SCENARIO:FINAL_QA_SCENARIO};
}
export function golemFixture() {
 const scenario={...FINAL_QA_SCENARIO,hero:{heroId:'summoner',pos:{x:2,y:2}}};
 const state=structuredClone(new GameEngine(scenario,DEFAULT_CONTENT,42).state) as GameState;
 state.player.energy=9; state.player.hand=[{uid:'qa-ultra',cardId:'summon_pact_golem'}];
 state.units.find(u=>u.id==='qa-target')!.pos={x:6,y:2};
 return {state,scenario};
}
