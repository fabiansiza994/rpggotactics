/** Phase 2D experiments: private content adapter; Phase 2A baseline stays unchanged. */
import type { GameContent } from '../domain/content';
import {
  SHAPESHIFTER_QA_CARDS,
  SHAPESHIFTER_QA_DECKS,
  withShapeshifterQa,
} from './shapeshifter-qa';
export const SHAPESHIFTER_2D_DECKS = {
  ...SHAPESHIFTER_QA_DECKS,
  balanced8: SHAPESHIFTER_QA_DECKS.balanced.map((e) => ({
    ...e,
    count:
      e.count +
      (['qa_bear_form', 'qa_minotaur_form'].includes(e.cardId)
        ? 1
        : ['qa_bear_claw', 'qa_axe_sweep'].includes(e.cardId)
          ? -1
          : 0),
  })),
};
export const SHAPESHIFTER_2D_CARDS = SHAPESHIFTER_QA_CARDS.map((card) => {
  if (card.id === 'qa_hunter_step')
    return {
      ...card,
      cost: 0,
      rulesText: 'QA provisional 2D: camina hasta 2 casillas. Ensayo sin coste de energía.',
    };
  if (card.id === 'qa_brutal_charge')
    return {
      ...card,
      rulesText: card.rulesText + ' Recupera 1 punto de movimiento (ensayo 2D).',
      effects: [...card.effects, { type: 'GAIN_MOVE_POINTS' as const, amount: 1 }],
    };
  // CLEANSE currently removes ALL negative statuses. Do not pretend it cleanses just one.
  return card;
});
export function withShapeshifter2dQa(base: GameContent): GameContent {
  const content = withShapeshifterQa(base);
  return {
    ...content,
    cards: { ...content.cards, ...Object.fromEntries(SHAPESHIFTER_2D_CARDS.map((c) => [c.id, c])) },
  };
}
