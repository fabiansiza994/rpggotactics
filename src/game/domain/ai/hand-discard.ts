import type { GameContent } from '../content';
import { discardRequired } from '../cards/hand-limit';
import type { GameState } from '../state';

/**
 * Cheap bot heuristic for the end-of-turn discard (no simulation): drop the card of lowest
 * estimated utility. Deterministic, a pure function of the hand:
 *   1. a ritual piece is kept while its champion has an altar (it can still be sealed);
 *   2. a copy of a card held twice or more goes first (keep the hand varied);
 *   3. then the most expensive card (hardest to play next turn);
 *   4. tie → the later card in the hand.
 * Returns null when no discard is required.
 */
export function suggestHandDiscard(state: Readonly<GameState>, content: GameContent): string | null {
  if (!discardRequired(state)) return null;
  const hand = state.player.hand;
  const copies = new Map<string, number>();
  for (const c of hand) copies.set(c.cardId, (copies.get(c.cardId) ?? 0) + 1);
  const keepPiece = !!state.player.altar;
  const score = (i: number): number => {
    const def = content.cards[hand[i]!.cardId];
    return (keepPiece && def?.ritualPiece ? 100 : 0) - (copies.get(hand[i]!.cardId)! > 1 ? 10 : 0) - (def?.cost ?? 0);
  };
  let best = hand.length - 1;
  for (let i = hand.length - 2; i >= 0; i--) if (score(i) < score(best)) best = i;
  return hand[best]?.uid ?? null;
}
