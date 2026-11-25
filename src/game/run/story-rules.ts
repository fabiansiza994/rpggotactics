import{universalBattle,universalDeck,universalVerify,universalSettle,universalCanonicalProof}from'../compat/universal-20261125.js';
import{legacyBattle,legacyDeck,legacyVerify,legacySettle,legacyCanonicalProof}from'../compat/pre-winter-b0e18cc8.js';
import{winterBattle,winterDeck,winterVerify,winterSettle,winterCanonicalProof}from'../compat/winter-a18c1d67.js';
import{DEFAULT_CONTENT,RITUAL_EXPANSION,PRIMORDIAL_EXPANSION,SHOWCASE_STORE_EXPANSION,ARSENAL_EXPANSION,TACTICAL_EXPANSION}from'../data';
import{FREE_CATALOG_EXPANSION}from'../data/free-catalog';
import{withArcher}from'../data/archer';
import{withShapeshifterRelease}from'../data/shapeshifter-release';
const roster=withShapeshifterRelease(withArcher(DEFAULT_CONTENT));
export const STORY_CONTENT={...roster,releasedExpansions:[...new Set([...roster.releasedExpansions??[],RITUAL_EXPANSION,PRIMORDIAL_EXPANSION,SHOWCASE_STORE_EXPANSION,ARSENAL_EXPANSION,TACTICAL_EXPANSION,FREE_CATALOG_EXPANSION])]};
import type{GameEngine}from'../engine/GameEngine';
import type{RunState}from'./run';
import type{GameContent}from'../domain/content';
import type{PlayerProfile}from'../collection/profile';
export const STORY_RULES_CURRENT='universal-cards-1';
export type StoryRules='pre-winter-b0e18cc8'|'winter-dominion-1'|typeof STORY_RULES_CURRENT;
export function isStoryRules(id:unknown):id is StoryRules{return id==='pre-winter-b0e18cc8'||id==='winter-dominion-1'||id===STORY_RULES_CURRENT;}
export function storyBattle(id:StoryRules,profile:PlayerProfile,run:RunState,seed:number):GameEngine{
 switch(id){case'pre-winter-b0e18cc8':return legacyBattle(profile,run,seed);case'winter-dominion-1':return winterBattle(profile,run,seed);case STORY_RULES_CURRENT:return universalBattle(profile,run,seed);default:throw Error('Unknown Story rules');}
}
export function storyDeck(id:StoryRules,profile:PlayerProfile,run:RunState){switch(id){case'pre-winter-b0e18cc8':return legacyDeck(profile,run);case'winter-dominion-1':return winterDeck(profile,run);case STORY_RULES_CURRENT:return universalDeck(profile,run);default:throw Error('Unknown Story rules');}}
export function storyVerify(id:StoryRules,profile:PlayerProfile,run:RunState,proof:unknown){switch(id){case'pre-winter-b0e18cc8':return legacyVerify(profile,run,proof);case'winter-dominion-1':return winterVerify(profile,run,proof);case STORY_RULES_CURRENT:return universalVerify(profile,run,proof);default:throw Error('Unknown Story rules');}}
export function storySettle(id:StoryRules,profile:PlayerProfile,run:RunState,currentRewardContent:GameContent=STORY_CONTENT){switch(id){case'pre-winter-b0e18cc8':return legacySettle(profile,run,run.currentEncounterId);case'winter-dominion-1':return winterSettle(profile,run,run.currentEncounterId);case STORY_RULES_CURRENT:return universalSettle(profile,run,run.currentEncounterId,currentRewardContent);default:throw Error('Unknown Story rules');}}
export function storyCanonicalProof(id:StoryRules,value:unknown):string|null{
 if(id==='pre-winter-b0e18cc8')return legacyCanonicalProof(value);if(id==='winter-dominion-1')return winterCanonicalProof(value);if(id!==STORY_RULES_CURRENT)throw Error('Unknown Story rules');
 return universalCanonicalProof(value);
}
