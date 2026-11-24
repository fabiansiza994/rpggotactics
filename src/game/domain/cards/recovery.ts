import { randomInt, shuffleInPlace } from '../core/rng';
import type { CardDefinition, CardInstance } from './card';
import type { GameContent } from '../content';
import type { GameState } from '../state';
import type { RuleContext } from '../context';

/** Checks actual owned instances, never a client-provided card definition or cardId. */
export function recoveryChoices(state: Readonly<GameState>, content: GameContent, search: CardDefinition['discardSearch'] = 'ANY_ONCE'): CardInstance[] {
  const player = state.player;
  const occupied = new Set([
    ...player.hand, ...player.deck, ...(player.altar ?? []), ...(player.banished ?? []),
  ].map(card => card.uid));
  // Provenance can survive an earlier death/recycle of the same concrete instance.
  // Only this owner's living creatures occupy its UIDs; opposing decks may reuse identifiers.
  for (const unit of state.units) {
    if (unit.hp <= 0 || unit.summon?.ownerId !== player.heroId) continue;
    if (unit.summon.sourceCardUid) occupied.add(unit.summon.sourceCardUid);
    if (unit.summon.recoveredCard) occupied.add(unit.summon.recoveredCard.uid);
  }
  return player.discard.filter(card => {
    const definition = content.cards[card.cardId];
    return !!definition && !definition.unique && !card.recoveredThisBattle && !occupied.has(card.uid)
      && player.discard.filter(other => other.uid === card.uid).length === 1
      && (search !== 'RITUAL_PIECE' || !!definition.ritualPiece);
  }).slice().reverse();
}

/** Called after selection validation. A rejected recovery never mutates zones or flags. */
export function recoverToHand(ctx: RuleContext, uid: string, search: CardDefinition['discardSearch'], lockUntilNextTurn = false): CardInstance | undefined {
  const card = recoveryChoices(ctx.state, ctx.content, search).find(candidate => candidate.uid === uid);
  if (!card) return undefined;
  ctx.state.player.discard = ctx.state.player.discard.filter(candidate => candidate.uid !== uid);
  card.recoveredThisBattle = true;
  delete card.publicDiscard;
  if (lockUntilNextTurn) card.unavailableThisTurn = true;
  ctx.state.player.hand.push(card);
  ctx.emit({ type: 'CARD_DRAWN', cardUid: card.uid, cardId: card.cardId });
  return card;
}

/** Random selection without replacement; flags are consumed before the cards re-enter the deck. */
export function recoverRandomToDeck(ctx: RuleContext, count: number): number {
  const candidates = recoveryChoices(ctx.state, ctx.content);
  const picked: CardInstance[] = [];
  while (candidates.length && picked.length < count) {
    const [card] = candidates.splice(randomInt(ctx.state, candidates.length), 1);
    if (card) picked.push(card);
  }
  const selected = new Set(picked.map(card => card.uid));
  ctx.state.player.discard = ctx.state.player.discard.filter(card => !selected.has(card.uid));
  for (const card of picked) {
    card.recoveredThisBattle = true;
    delete card.publicDiscard;
    ctx.state.player.deck.push(card);
  }
  if (picked.length) shuffleInPlace(ctx.state, ctx.state.player.deck);
  return picked.length;
}
