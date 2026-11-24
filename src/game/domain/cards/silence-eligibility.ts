import type { RuleContext } from '../context';
import { isActionPrevented } from '../board/occupancy';
import { effectiveCost } from './form-effects';
import { cardClassAllowed } from './hand-trade';
import { fail, type RuleResult } from '../result';

/** One validator for admission AND execution; never emits reasons into public events. */
export function checkSilenceResponse(ctx: RuleContext, sealUid: string, discardUid: string) {
  const defender = ctx.state.duel?.other;
  const caster = ctx.state.units.find(unit => unit.id === defender?.heroId);
  const seal = defender?.hand.find(card => card.uid === sealUid);
  const discard = defender?.hand.find(card => card.uid === discardUid && card.uid !== sealUid);
  const definition = seal ? ctx.content.cards[seal.cardId] : undefined;
  if (!defender || ctx.state.outcome || !caster || caster.hp <= 0 || isActionPrevented(ctx, caster) ||
      defender.pendingCardChoice || !seal || seal.cardId !== 'dark_silence_seal' || seal.unavailableThisTurn ||
      defender.searchBlockedCardIds?.includes(seal.cardId) || !discard || !definition || !cardClassAllowed(seal, definition, caster))
    return fail('INVALID_TARGET', 'La respuesta necesita un Sello válido y otra carta propia.') as Extract<RuleResult,{ok:false}>;
  const price = effectiveCost(ctx.content, caster, definition);
  if (defender.energy < price.cost) return fail('NOT_ENOUGH_ENERGY', 'No hay energía para el Sello.') as Extract<RuleResult,{ok:false}>;
  // Hidden curses do not affect this query: attempting a cursed Seal still uses its existing cancellation contract.
  return { ok: true as const, caster, seal, discard, definition, price };
}

export function hasLegalSilenceResponse(ctx: RuleContext): boolean {
  const hand = ctx.state.duel?.other.hand ?? [];
  return hand.some(seal => seal.cardId === 'dark_silence_seal' &&
    hand.some(discard => discard.uid !== seal.uid && checkSilenceResponse(ctx, seal.uid, discard.uid).ok));
}
