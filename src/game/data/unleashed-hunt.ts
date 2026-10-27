import type { CardDefinition } from '../domain/cards/card';
import type { GameContent } from '../domain/content';
/** Released mobility card set; ownership still follows normal acquisition rules. */
export const UNLEASHED_HUNT_EXPANSION = 'unleashed_hunt';
export const UNLEASHED_HUNT:CardDefinition = {
 id:'unleashed_hunt',name:'Cacería Desatada',heroId:'summoner',rarity:'RARE',cost:2,category:'UTILITY',
 expansion:UNLEASHED_HUNT_EXPANSION,tags:['summon-synergy','movement','hunt'],
 rulesText:'Una invocación aliada: +2 Movimiento por 3 activaciones. Al moverse y acabar a ≤2 casillas de un enemigo, prepara +1 para la siguiente. Rejugar renueva; no acumula.',
 targeting:{type:'UNIT',range:3,unitFilter:'SUMMON',requiresLineOfSight:true},
 effects:[{type:'APPLY_STATUS',status:'UNLEASHED_HUNT',duration:3,to:'SUMMONS'}],
 presentation:{visualKey:'unleashed_hunt',element:'ARCANE',castAnimation:'cast_support',premiumTreatment:'showcase'},
};
/** Loopback QA only: one owned rare copy, legal normal Deck Builder, starter deck untouched. */
export function withUnleashedHuntQa(content:GameContent):GameContent {
 const hero=content.heroes.summoner;if(!hero)return content;
 return {...content,releasedExpansions:[...new Set([...(content.releasedExpansions??[]),UNLEASHED_HUNT_EXPANSION])],
 heroes:{...content.heroes,summoner:{...hero,starterCollection:[...(hero.starterCollection??[]).filter(c=>c.cardId!==UNLEASHED_HUNT.id),{cardId:UNLEASHED_HUNT.id,count:1}]}}};
}
