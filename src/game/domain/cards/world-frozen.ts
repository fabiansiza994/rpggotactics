import type {CardDefinition} from './card';
import type {Unit} from '../entities/unit';
export const worldFrozen=(unit:Pick<Unit,'statuses'>|undefined):boolean=>!!unit?.statuses.some(s=>s.id==='ABSOLUTE_ZERO'&&s.turnsLeft>0);
/** A cast takes one deterministic snapshot of its upgrade BEFORE validation/payment. */
export function worldFrozenCard(card:CardDefinition,caster:Pick<Unit,'statuses'>|undefined):CardDefinition{
 if(!card.worldFrozenUpgrade||!worldFrozen(caster))return card;
 return {...card,...card.worldFrozenUpgrade,worldFrozenActive:true};
}
