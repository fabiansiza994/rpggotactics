import { describe, expect, it } from 'vitest';
import { DARK_LIGHT_CARDS } from '../src/game/data/dark-light';
import { DARK_LIGHT_DRAFT_BOXES } from '../src/game/store/dark-light-draft';
import { MARKET_EXPANSIONS } from '../src/game/store/market-expansions';
import { boxTotal } from '../src/game/store/boxes';
import { DEFAULT_CONTENT, DECK_RULES } from '../src/game/data';
import { copyLimit } from '../src/game/collection/deck-rules';
describe('Two product-approved local commercial expansions', () => {
  it('registers fifteen real definitions per set, each capped at two', () => {
    expect(DARK_LIGHT_CARDS).toHaveLength(31);
    expect(new Set(DARK_LIGHT_CARDS.map(card => card.id)).size).toBe(31);
    for (const set of DARK_LIGHT_DRAFT_BOXES) {
      expect(set.cards).toHaveLength(set.id==='path_to_light'?16:15);
      expect(set.cards.filter(card => card.rarity === 'ULTRA')).toHaveLength(2);
      expect(boxTotal(set.initialStock)).toBe(80);
      expect(set.saleEnabled).toBe(true);
      expect(set.boostersEnabled).toBe(true);
      expect(MARKET_EXPANSIONS.some(existing => existing.id === set.id && existing.status === 'AVAILABLE')).toBe(true);
      for (const card of set.cards) {
        expect(DEFAULT_CONTENT.cards[card.id]).toBe(card);
        expect(copyLimit(card, DECK_RULES)).toBe(2);
        expect(card.unique).not.toBe(true);
        if (card.rarity === 'ULTRA') expect(set.initialStock[card.id]).toBe(1);
      }
    }
  });
});
