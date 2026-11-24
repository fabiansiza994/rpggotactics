import type { CardDefinition } from './card';
import type { GameState } from '../state';
import { allCardEffects } from './form-effects';

/** Requirements follow effects, never a card-name allowlist or the PvP/PvE label. */
export function requiredRivalZones(def: CardDefinition): ('HAND' | 'DECK')[] {
  return [...new Set(allCardEffects(def).flatMap(effect =>
    effect.type === 'DISCARD_OPPONENT' ? [effect.from] :
    effect.type === 'CURSE_RANDOM_OPPONENT_DECK' ? ['DECK' as const] : []))];
}

/** Counts are available only in private client views. Authority uses real banks. */
export function missingRivalZone(state: Readonly<GameState>, def: CardDefinition, authoritative = false): 'HAND' | 'DECK' | undefined {
  return requiredRivalZones(def).find(zone => {
    if (state.duel) return !Array.isArray(zone === 'HAND' ? state.duel.other.hand : state.duel.other.deck);
    return authoritative || !state.pileCounts || !Number.isFinite(zone === 'HAND' ? state.pileCounts.opponentHand : state.pileCounts.opponentDeck);
  });
}
