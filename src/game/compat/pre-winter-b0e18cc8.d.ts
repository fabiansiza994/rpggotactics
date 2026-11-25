import type {GameEngine,PlayerProfile,RunState,DeckEntry} from '../index';
export const LEGACY_RULES:'pre-winter-b0e18cc8';
export function legacyBattle(profile:PlayerProfile,run:RunState,seed:number):GameEngine;
export function legacyVerify(profile:PlayerProfile,run:RunState,proof:unknown):{ok:true}|{ok:false;error:string};
export function legacyDeck(profile:PlayerProfile,run:RunState):DeckEntry[];

export function legacySettle(profile:PlayerProfile,run:RunState,encounterId:string):import('../run/run').VictoryResult;

export function legacyCanonicalProof(proof:unknown):string|null;
export function legacyRunFingerprint(run:RunState):string;
