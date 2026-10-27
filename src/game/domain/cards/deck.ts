import { getHero } from '../board/occupancy';
import { dealDamage } from '../combat/damage';
import type { RuleContext } from '../context';
import { shuffleInPlace, type RngHolder } from '../core/rng';
import type { CardInstance } from './card';

/**
 * A battle's draw pile: fresh card instances built from the deck list (one per copy, so
 * duplicates weigh their count), then shuffled once with the battle's seeded RNG. The deck
 * list itself is never touched — it is composition, not order. Uids come from `nextUid`.
 */
export function createDrawPile(
  rng: RngHolder,
  entries: readonly { cardId: string; count: number }[],
  nextUid: () => string,
): CardInstance[] {
  const pile: CardInstance[] = [];
  for (const entry of entries) for (let i = 0; i < entry.count; i++) pile.push({ uid: nextUid(), cardId: entry.cardId });
  return shuffleInPlace(rng, pile);
}

/**
 * Draw `count` cards from the top of the deck. When the deck is empty the discard pile is
 * shuffled (seeded RNG) into a new deck. First recycle is free; later recycles deal
 * progressive arcane damage (1, 2, 3…) through normal armor/shield rules. Empty
 * deck + discard means no draw and no fatigue. Cards drawn with a full hand
 * go straight to the discard pile.
 */
export function drawCards(ctx: RuleContext, count: number): number {
  const { player } = ctx.state;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    if (!getHero(ctx.state)) break;
    if (player.deck.length === 0) {
      if (player.discard.length === 0) break;
      player.deck = shuffleInPlace(ctx.state, player.discard);
      player.discard = [];
      ctx.emit({ type: 'DECK_RESHUFFLED', cardCount: player.deck.length });
      player.deckRecycles += 1;
      const amount = player.deckRecycles - 1;
      if (amount > 0) {
        const hero = getHero(ctx.state)!;
        ctx.emit({ type: 'ARCANE_FATIGUE', unitId: hero.id, recycle: player.deckRecycles, amount });
        if (dealDamage(ctx, hero, amount, 'arcane-fatigue', 'ARCANE').defeated) break;
      }
    }
    const card = player.deck.shift();
    if (!card) break;
    ctx.emit({ type: 'CARD_DRAWN', cardUid: card.uid, cardId: card.cardId });
    if (player.hand.length >= player.maxHandSize) {
      player.discard.push(card);
      ctx.emit({ type: 'CARD_DISCARDED', cardUid: card.uid, cardId: card.cardId, reason: 'HAND_FULL' });
    } else {
      player.hand.push(card);
      drawn++;
    }
  }
  return drawn;
}

export function setEnergy(ctx: RuleContext, value: number): void {
  const { player } = ctx.state;
  const to = Math.max(0, value);
  if (to === player.energy) return;
  const from = player.energy;
  player.energy = to;
  ctx.emit({ type: 'ENERGY_CHANGED', from, to, max: player.maxEnergy });
}

export function setMovePoints(ctx: RuleContext, value: number): void {
  const { player } = ctx.state;
  const to = Math.max(0, value);
  if (to === player.movePoints) return;
  const from = player.movePoints;
  player.movePoints = to;
  ctx.emit({ type: 'MOVE_POINTS_CHANGED', from, to, max: player.maxMovePoints });
}
