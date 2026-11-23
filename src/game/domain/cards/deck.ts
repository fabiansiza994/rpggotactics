import {finishBattle} from '../objectives/objective-rules';
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
 * shuffled (seeded RNG) into a new deck. Story recycling never deals fatigue damage. Empty
 * deck + discard means no draw and no fatigue. Cards drawn with a full hand
 * go straight to the discard pile.
 */
export function drawCards(ctx: RuleContext, count: number): number {
  const { player } = ctx.state;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    if(ctx.state.duel?.competitiveRules&&ctx.state.outcome)break;
    if (!getHero(ctx.state)) break;
    if (player.deck.length === 0) {
      if(ctx.state.duel?.competitiveRules==='40_DECK_OUT_V1'){
        ctx.state.duel.winner=ctx.state.duel.active===0?1:0;
        finishBattle(ctx,{result:'LOST',reason:'DECK_OUT'});
        break;
      }
      if (player.discard.length === 0) break;
      // Recycle only real discard instances. Active summon sources stay reserved until removal.
      const reserved = new Set([...player.hand, ...(player.banished ?? []), ...(player.altar ?? [])].map(card => card.uid));
      for (const unit of ctx.state.units) if (unit.summon?.sourceCardUid) reserved.add(unit.summon.sourceCardUid);
      const seen = new Set<string>();
      const recyclable = player.discard.filter(card => {
        if (reserved.has(card.uid) || seen.has(card.uid)) return false;
        seen.add(card.uid); return true;
      });
      if (!recyclable.length) break;
      player.deck = shuffleInPlace(ctx.state, recyclable);
      player.discard = player.discard.filter(card => reserved.has(card.uid));
      ctx.emit({ type: 'DECK_RESHUFFLED', cardCount: player.deck.length });
      player.deckRecycles += 1;
      // Existing legacy PvP rooms keep their pinned fatigue semantics; Story never does.
      if (ctx.state.duel && !ctx.state.duel.competitiveRules && player.deckRecycles > 1) {
        const hero = getHero(ctx.state)!, amount = player.deckRecycles - 1;
        ctx.emit({type:'ARCANE_FATIGUE',unitId:hero.id,recycle:player.deckRecycles,amount});
        if (dealDamage(ctx, hero, amount, 'arcane-fatigue', 'ARCANE').defeated) break;
      }

    }
    const card = player.deck.shift();
    if (!card) break;
    delete card.publicDiscard;
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
