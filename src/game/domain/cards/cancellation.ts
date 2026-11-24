import type { RuleContext } from '../context';
import type { PlayerState } from '../state';
import type { CardDefinition, CardInstance } from './card';
import type { Unit } from '../entities/unit';
import { loseHpTogether } from './hp-loss';

export function consumeCanceledCard(ctx: RuleContext, bank: PlayerState, card: CardInstance, definition: CardDefinition): void {
  bank.hand = bank.hand.filter(copy => copy.uid !== card.uid);
  if (definition.unique) {
    (bank.banished ??= []).push(card);
    ctx.emit({ type: 'CARD_BANISHED', cardUid: card.uid, cardId: card.cardId });
  } else {
    card.publicDiscard = true;
    bank.discard.push(card);
    ctx.emit({ type: 'CARD_DISCARDED', cardUid: card.uid, cardId: card.cardId, reason: 'PLAYED' });
  }
}

/** Curse precedes the response window and suppresses every original effect and extra selection. */
export function triggerCardCurse(ctx: RuleContext, bank: PlayerState, card: CardInstance, definition: CardDefinition, caster: Unit): void {
  delete card.twistedCurse;
  const hpLost = Math.min(5, caster.hp);
  ctx.emit({ type: 'CARD_CURSE_TRIGGERED', cardUid: card.uid, cardId: card.cardId, casterId: caster.id, pos: { ...caster.pos }, hpLost, hpAfter: caster.hp - hpLost });
  consumeCanceledCard(ctx, bank, card, definition);
  loseHpTogether(ctx, [caster], 5, 'twisted-curse');
  ctx.emit({ type: 'CARD_RESOLVED', cardUid: card.uid, cardId: card.cardId });
}
