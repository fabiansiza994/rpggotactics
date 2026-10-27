import type { CardDefinition } from '../game';
import { FORBIDDEN_BOND_EXPANSION } from '../game/data/forbidden-bond';

/**
 * Vínculo Prohibido has no unlock source yet: the collection hides it unless the player already
 * owns a copy (QA grants) or a content build releases its set. Same idea as primordialCardVisible.
 */
export const forbiddenBondCardVisible = (card: Pick<CardDefinition, 'expansion'>, owned: number, released: readonly string[] = []): boolean =>
  card.expansion !== FORBIDDEN_BOND_EXPANSION || owned > 0 || released.includes(FORBIDDEN_BOND_EXPANSION);
