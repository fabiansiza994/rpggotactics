import {
  DEFAULT_CONTENT,
  COMPETITIVE_DECK_RULES,
  createProfile,
  heroProfile,
  copyLimit,
  validateDeck,
  ownedFor,
  deckSize,
} from "../../src/game";
const content = DEFAULT_CONTENT;
export function competitiveFixture(heroId = "mage") {
  const profile = createProfile(content),
    h = heroProfile(profile, heroId, content);
  for (const c of Object.values(content.cards).filter(
    (c) => c.heroId === heroId,
  ))
    h.collection[c.id] = {
      copies: copyLimit(c, COMPETITIVE_DECK_RULES),
      acquired: 0,
    };
  let cards = h.decks[0]!.cards.map((e) => ({ ...e }));
  for (const c of Object.values(content.cards).filter(
    (c) => c.heroId === heroId,
  )) {
    while (deckSize(cards) < 40) {
      const count = cards.find((e) => e.cardId === c.id)?.count ?? 0;
      if (count >= h.collection[c.id]!.copies) break;
      const trial = cards.map((e) => ({ ...e }));
      const existing = trial.find((e) => e.cardId === c.id);
      if (existing) existing.count++;
      else trial.push({ cardId: c.id, count: 1 });
      const issues = validateDeck(
        trial,
        heroId,
        ownedFor(profile, heroId, content),
        content,
        COMPETITIVE_DECK_RULES,
      ).filter((i) => i.code !== "DECK_INCOMPLETE");
      if (issues.length) break;
      cards = trial;
    }
  }
  h.decks.push({ id: "competitive", name: "QA40", cards });
  return { profile, cards };
}
