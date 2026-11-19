import type {CardDefinition} from './card';
import type {Unit} from '../entities/unit';
import type {GameState} from '../state';
export const worldFrozen=(unit:Pick<Unit,'statuses'>|undefined):boolean=>!!unit?.statuses.some(s=>s.id==='ABSOLUTE_ZERO'&&s.turnsLeft>0);
/** A cast takes one deterministic snapshot of its upgrade BEFORE validation/payment. */
export function worldFrozenCard(card:CardDefinition,caster:Pick<Unit,'statuses'>|undefined):CardDefinition{
 if(!card.worldFrozenUpgrade||!worldFrozen(caster))return card;
 return {...card,...card.worldFrozenUpgrade,worldFrozenActive:true};
}

/** Live owner protection, not a persisted movement modifier. Summons use their exact
 * owner; other allied units use the engine's faction ownership (also in duelView). */
export function ignoresIceMovementPenalty(state:Pick<GameState,'units'>,unit:Unit):boolean{
 return state.units.some(owner=>owner.hp>0&&worldFrozen(owner)&&
  (unit.summon?owner.id===unit.summon.ownerId:owner.faction===unit.faction));
}
