import type { CardDefinition } from '../domain/cards/card';

/**
 * Deck-building family of a card (Deck Builder filters, card details). Derived from rules data,
 * never stored: a ritual piece is `ritualPiece`, a direct summon has a SUMMON effect.
 * Rituals themselves are not cards (see `GameContent.rituals`).
 * - SUMMON:       direct summon (one card → one creature)
 * - RITUAL_PIECE: sealed on the altar for a ritual (or played for its weak secondary action)
 * - CONTROL:      attacks, roots, displacement aimed at enemies
 * - SUPPORT:      everything else (healing, shields, movement, draw, summon commands)
 */
export type CardFamily = 'SUMMON' | 'RITUAL_PIECE' | 'SUPPORT' | 'CONTROL';

export const CARD_FAMILIES: readonly CardFamily[] = ['SUMMON', 'RITUAL_PIECE', 'SUPPORT', 'CONTROL'];

export function cardFamily(card: CardDefinition): CardFamily {
  if (card.ritualPiece) return 'RITUAL_PIECE';
  if (card.effects.some((fx) => fx.type === 'SUMMON')) return 'SUMMON';
  return card.category === 'CONTROL' || card.category === 'ATTACK' ? 'CONTROL' : 'SUPPORT';
}
