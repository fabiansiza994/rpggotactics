import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  DEFAULT_CONTENT,
  DECK_RULES,
  copyLimit,
  validateDeck,
} from "../src/game";
import { withShapeshifterRelease } from "../src/game/data/shapeshifter-release";
import { generateDeck, type DeckStyle } from "../src/game/collection/auto-deck";
it("generates reproducible examples and bounded desktop measurements", () => {
  const content = withShapeshifterRelease(DEFAULT_CONTENT),
    results = [];
  const own = (id: string) =>
    content.cards[id] ? copyLimit(content.cards[id]!, DECK_RULES) : 0;
  for (const [hero, style] of [
    ["mage", "AGGRESSIVE"],
    ["summoner", "COMBOS"],
    ["shapeshifter", "BALANCED"],
  ] as [string, DeckStyle][]) {
    const start = performance.now(),
      r = generateDeck(content, hero, own, DECK_RULES, style, 20261115),
      elapsedMs = performance.now() - start;
    expect(r.ok).toBe(true);
    if (!r.ok) continue;
    expect(validateDeck(r.cards, hero, own, content, DECK_RULES)).toEqual([]);
    results.push({
      hero,
      style,
      elapsedMs,
      cards: r.cards.map((e) => ({
        ...e,
        name: content.cards[e.cardId]!.name,
      })),
      analysis: r.analysis,
    });
  }
  if (process.env.AUTO_DECK_REPORT)
    writeFileSync(
      process.env.AUTO_DECK_REPORT,
      JSON.stringify(
        {
          fixture:
            "Catalog copies up to per-deck limits; demonstration only, no player inventory modified",
          runtime: "local Node/Vitest; not Android",
          results,
        },
        null,
        2,
      ),
    );
});
