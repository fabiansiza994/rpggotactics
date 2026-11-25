import type{GameEngine,PlayerProfile,RunState,DeckEntry}from'../index';
export const WINTER_RULES:'winter-dominion-1';
export function winterBattle(profile:PlayerProfile,run:RunState,seed:number):GameEngine;
export function winterDeck(profile:PlayerProfile,run:RunState):DeckEntry[];
export function winterVerify(profile:PlayerProfile,run:RunState,proof:unknown):{ok:true}|{ok:false;error:string};
export function winterSettle(profile:PlayerProfile,run:RunState,id:string):import('../run/run').VictoryResult;
export function winterCanonicalProof(proof:unknown):string|null;
