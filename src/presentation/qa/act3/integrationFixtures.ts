/** QA checkpoints of shipping encounters / local duel. Never saves or touches accounts. */
import { DEFAULT_CONTENT, GameEngine, SCENARIOS_BY_ID, createProfile, type GameState, type ScenarioDef } from '../../../game';
import { createDuel, validateLoadout, DUEL_SCENARIO } from '../../../game/pvp/duel';
export function encounterCheckpoint(mode: string, champion: string): {state:GameState;scenario:ScenarioDef} | null {
 if(mode==='lab')return null;
 if(mode==='duel'){
  const profile=createProfile(DEFAULT_CONTENT);
  const state=createDuel([validateLoadout(profile,champion),validateLoadout(profile,'warrior')],42);
  if(state.duel && state.player.heroId!==state.duel.champions[0]){[state.player,state.duel.other]=[state.duel.other,state.player];state.duel.active=0;for(const u of state.units)u.faction=u.faction==='PLAYER'?'ENEMY':'PLAYER';}
  state.units.find(u=>u.id===state.player.heroId)!.pos={x:4,y:2};
  state.units.find(u=>u.id!==state.player.heroId)!.pos={x:5,y:2};
  return {state,scenario:DUEL_SCENARIO};
 }
 const original=SCENARIOS_BY_ID[mode]!;
 const scenario={...original,hero:{...original.hero,heroId:champion}};
 const state=structuredClone(new GameEngine(scenario,DEFAULT_CONTENT,original.defaultSeed).state) as GameState;
 // Prepared mid-encounter checkpoint: shipping layout/enemies/objectives/AI, adjacent to first enemy.
 state.units.find(u=>u.id===state.player.heroId)!.pos={x:4,y:1};
 return {state,scenario};
}
