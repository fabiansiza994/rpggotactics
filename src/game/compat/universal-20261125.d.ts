import type{GameEngine,PlayerProfile,RunState,DeckEntry}from'../index';
export const UNIVERSAL_RULES:'universal-cards-1';
export function universalBattle(profile:PlayerProfile,run:RunState,seed:number):GameEngine;
export function universalDeck(profile:PlayerProfile,run:RunState):DeckEntry[];
export function universalVerify(profile:PlayerProfile,run:RunState,proof:unknown):{ok:true}|{ok:false;error:string};
export function universalSettle(profile:PlayerProfile,run:RunState,id:string,rewardContent?:import('../domain/content').GameContent):import('../run/run').VictoryResult;
export function universalCanonicalProof(proof:unknown):string|null;
