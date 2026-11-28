import type { RuleContext } from '../context';
import type { Pos } from '../core/position';
import type { WallOrientation } from './targeting';
import { playCard } from './play-card';
import {checkSilenceResponse} from './silence-eligibility';
import { consumeCanceledCard, triggerCardCurse } from './cancellation';
import { updateObjectives } from '../objectives/objective-rules';
import { fail, OK, type RuleResult } from '../result';

export const SILENCE_RESPONSE_MS = 5000;
export interface PendingCast {
  id: string;
  cardUid: string;
  cardId: string;
  casterId: string;
  respondingHeroId: string;
  target: Pos | null;
  searchUid?: string;
  sacrificeHp?:number;
  secondary?: Pos | null;
  wallOrientation?: WallOrientation;
  paidEnergy: number;
  /** Server supplies its own clock once; reconnect never rewrites this value. */
  deadline: number;
  /** Public announcement captured by the authoritative engine, never a rival hand projection. */
  announcement?: { card: import('./card').CardDefinition; paidEnergy: number; target: Pos | null; secondary?: Pos | null };
  durationMs?: number;
}
export type SilenceResponse = { type: 'SILENCE_RESPONSE'; windowId: string; pass: true } | { type: 'SILENCE_RESPONSE'; windowId: string; pass: false; sealUid: string; discardUid: string };

export function resolveSilence(ctx: RuleContext, response: SilenceResponse): RuleResult {
  const pending = ctx.state.pendingCast;
  const other = ctx.state.duel?.other;
  if (!pending || pending.id !== response.windowId || !other || other.heroId !== pending.respondingHeroId) return fail('INVALID_TARGET', 'La ventana de respuesta ya no existe.');
  let negate = false;
  if (!response.pass) {
    const check = checkSilenceResponse(ctx, response.sealUid, response.discardUid);
    if (!check.ok) return check;
    const {caster, seal, discard, definition, price} = check;
    const from = other.energy;
    other.energy -= price.cost;
    ctx.emit({ type: 'ENERGY_CHANGED', unitId: caster.id, from, to: other.energy, max: other.maxEnergy });
    if (price.scope) { caster.costDiscounts = caster.costDiscounts?.filter(discount => discount.scope !== price.scope); if (!caster.costDiscounts?.length) delete caster.costDiscounts; }
    ctx.state.stats.cardsPlayed++;
    if (seal.twistedCurse) triggerCardCurse(ctx, other, seal, definition, caster);
    else {
      other.hand = other.hand.filter(card => card.uid !== seal.uid && card.uid !== discard.uid);
      delete discard.publicDiscard;
      other.discard.push(discard);
      ctx.emit({ type: 'CARD_DISCARDED', cardUid: discard.uid, cardId: discard.cardId, reason: 'EFFECT' });
      ctx.emit({ type: 'CARD_PLAYED', cardUid: seal.uid, cardId: seal.cardId, casterId: caster.id, target: null, impact: { ...caster.pos }, affectedTiles: [{ ...caster.pos }], direction: null });
      consumeCanceledCard(ctx, other, seal, definition);
      ctx.emit({ type: 'CARD_NEGATED', cardUid: pending.cardUid, cardId: pending.cardId, casterId: pending.casterId, responderId: caster.id });
      ctx.emit({ type: 'CARD_RESOLVED', cardUid: seal.uid, cardId: seal.cardId });
      negate = true;
    }
  }
  delete ctx.state.pendingCast;
  updateObjectives(ctx);
  const card = ctx.state.player.hand.find(card => card.uid === pending.cardUid);
  const definition = card ? ctx.content.cards[card.cardId] : undefined;
  if (!card || !definition) return fail('INVALID_TARGET', 'La carta reservada ya no existe.');
  if (negate || ctx.state.outcome) {
    consumeCanceledCard(ctx, ctx.state.player, card, definition);
    ctx.emit({ type: 'CARD_RESOLVED', cardUid: card.uid, cardId: card.cardId });
    return OK;
  }
  const result=playCard(ctx,pending.cardUid,pending.target,pending.searchUid,pending.secondary,pending.wallOrientation,'PREPAID',pending.sacrificeHp);
  if(!result.ok&&definition.effects.some(fx=>fx.type==='SUMMON_SCORPION_SACRIFICE')){consumeCanceledCard(ctx,ctx.state.player,card,definition);ctx.emit({type:'CARD_RESOLVED',cardUid:card.uid,cardId:card.cardId});return OK;}
  return result;
}
