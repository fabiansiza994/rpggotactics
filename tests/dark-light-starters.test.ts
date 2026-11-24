import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, DECK_RULES } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { freshStarterDeck } from '../src/game/collection/fresh-starter';
import { validateDeck } from '../src/game/collection/deck-rules';
const content = withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
describe('Fresh accounts: forty-card starters without rewriting historical definitions', () => {
  for (const hero of Object.values(content.heroes)) it(hero.id, () => {
    const before = JSON.stringify(hero);
    const rules = { ...DECK_RULES, requiredSize: 40 };
    const deck = freshStarterDeck(hero, content, rules);
    expect(deck.reduce((total, card) => total + card.count, 0)).toBe(40);
    expect(validateDeck(deck, hero.id, id => deck.find(card => card.cardId === id)?.count ?? 0, content, rules)).toEqual([]);
    expect(JSON.stringify(hero)).toBe(before);
    expect(deck.some(card => card.cardId.startsWith('dark_') || card.cardId.startsWith('light_'))).toBe(false);
  });
});

import { createProfile, starterHeroProfile } from '../src/game/collection/profile';
it('fresh profiles receive forty while historical ownership floors stay unchanged', () => {
  const fresh = createProfile(content);
  for (const hero of Object.values(content.heroes)) {
    expect(fresh.heroes[hero.id]!.decks[0]!.cards.reduce((sum, entry) => sum + entry.count, 0)).toBe(40);
    expect(starterHeroProfile(hero, content).decks[0]!.cards).toEqual(hero.deck);
  }
});
