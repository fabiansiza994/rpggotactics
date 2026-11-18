import { copyLimit, DECK_RULES, type CardDefinition } from '../../game';
import type { BoxSnapshot } from '../../game/store/boxes';
/** Ownership, box stock and deck limit are independent facts. Unknown stock is never zero. */
export function marketCardIndicators(card: CardDefinition, owned: number, box?: BoxSnapshot) {
  const inBox = !!box && Object.hasOwn(box.initial, card.id) && Object.hasOwn(box.remaining, card.id);
  return { owned, remaining: inBox ? box.remaining[card.id]! : null, deckLimit: copyLimit(card, DECK_RULES) };
}
export function freePacksMessage(remaining: number): string | null {
  return remaining > 0 ? `Tienes ${remaining} ${remaining === 1 ? 'sobre gratis' : 'sobres gratis'}` : null;
}
