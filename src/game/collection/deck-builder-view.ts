import type { GameContent } from '../domain/content';
import {
  cardsForHero,
  collectionCardStatus,
  deckStatus,
  type CollectionCardStatus,
  type DeckEntry,
  type DeckRules,
  type DeckStatus,
} from './deck-rules';
import { ownedFor, type PlayerProfile } from './profile';

/**
 * Everything a Deck Builder screen needs for one champion and one deck list (usually the
 * unsaved draft): MI MAZO (`deck`) and COLECCIÓN DISPONIBLE (`collection`, every card of the
 * champion's pool in authored order, locked ones included with 0 owned copies). Plain data,
 * recomputed after each ADD_CARD / REMOVE_CARD (see `editDeck`).
 */
export interface DeckBuilderView {
  heroId: string;
  deck: DeckStatus & { cards: DeckEntry[] };
  collection: CollectionCardStatus[];
}

export function deckBuilderView(
  profile: PlayerProfile,
  heroId: string,
  cards: readonly DeckEntry[],
  content: GameContent,
  rules: DeckRules,
): DeckBuilderView {
  const owned = ownedFor(profile, heroId, content);
  return {
    heroId,
    deck: { ...deckStatus(cards, heroId, owned, content, rules), cards: cards.map((e) => ({ ...e })) },
    collection: cardsForHero(content, heroId).map((c) => collectionCardStatus(cards, c.id, heroId, owned, content, rules)),
  };
}
