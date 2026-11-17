import { withArcher } from '../../game/data/archer';
import { PRESENTATION_CONTENT } from '../qa/shapeshifter/runtime';
/** Presentation metadata only: commercial receipts may outlive champion/build gates.
 * Reuses the published champion composer; never grants, unlocks or authorizes a sale.
 */
export const CARD_PRESENTATION_CONTENT = withArcher(PRESENTATION_CONTENT);
/** Unknown historic IDs stay unknown. Do not invent economic rarity/eligibility. */
export const resolvePresentationCard = (cardId: string) =>
  Object.hasOwn(CARD_PRESENTATION_CONTENT.cards, cardId) ? CARD_PRESENTATION_CONTENT.cards[cardId] : undefined;
