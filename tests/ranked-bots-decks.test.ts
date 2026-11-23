import { describe, it, expect } from "vitest";
import { PVP_CONTENT } from "../server/src/pvp";
import { rankedBotCatalog } from "../server/src/rankedBotCatalog";
import { botIdentity, BOT_LEVELS } from "../src/game/ai/ranked-bot-policy";
import { botDeck } from "../src/game/ai/ranked-bot-deck";
import { validateDeck, copyLimit } from "../src/game/collection/deck-rules";
import { COMPETITIVE_DECK_RULES as DECK_RULES } from "../src/game/collection/deck-formats";
import type { Env } from "../server/src/db";
const env = {
  SHAPESHIFTER_ENABLED: "1",
  RANKED_PRESEASON_ENABLED: "1",
  FREE_CATALOG_ENABLED: "1",
  TACTICAL_CARDS_ENABLED: "1",
  ARSENAL_CARDS_ENABLED: "1",
  SUMMONER_RITUALS_ENABLED: "1",
  PRIMORDIAL_DRAGON_ENABLED: "1",
  STORE_SHOWCASE_ENABLED: "1",
} as Env;
const content = rankedBotCatalog(PVP_CONTENT, env);
describe("published account-independent bot decks", () => {
  it("distributes identities across three champions and many names with independent encounter seeds", () => {
    const counts = { mage: 0, summoner: 0, shapeshifter: 0 },
      names = new Set<string>();
    let seed = 1;
    for (let i = 0; i < 900; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const b = botIdentity("b" + i, 600, seed);
      counts[b.heroId]++;
      names.add(b.name);
    }
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(220);
    expect(names.size).toBeGreaterThan(35);
  });
  it.each(["mage", "summoner", "shapeshifter"] as const)(
    "legal reproducible progressive decks for %s without account inventory",
    (heroId) => {
      const decks = [];
      for (let level = 0; level < BOT_LEVELS.length; level++) {
        const bot = {
          ...botIdentity("deck", level * 300, 59873),
          heroId,
          level,
        };
        const deck = botDeck(content, bot);
        decks.push(deck);
        expect(
          validateDeck(
            deck,
            heroId,
            (id) => copyLimit(content.cards[id]!, DECK_RULES),
            content,
            DECK_RULES,
          ),
        ).toEqual([]);
        expect(botDeck(content, bot)).toEqual(deck);
        expect(deck.reduce((n, e) => n + e.count, 0)).toBe(40);
        expect(
          deck.every((e) => !content.cards[e.cardId]!.tags.includes("nature")),
        ).toBe(true);
      }
      expect(decks[0]).not.toEqual(decks[5]);
      const starter = new Set(
        content.heroes[heroId]!.deck.map((e) => e.cardId),
      );
      expect(decks[5]!.some((e) => !starter.has(e.cardId))).toBe(true);
    },
    20_000, // Seven validated deck builds and reproducibility checks, not a per-decision CPU allowance.
  );
  it("does not let QA flags grant unpublished premium cards, Nature or disabled expansions", () => {
    const off = rankedBotCatalog(PVP_CONTENT, {
      RANKED_PREMIUM_QA: "1",
      SHAPESHIFTER_QA: "1",
    } as Env);
    expect(off.heroes.shapeshifter).toBeUndefined();
    expect(
      Object.values(off.cards).some(
        (c) => c.acquisition?.source === "RANKED_PREMIUM",
      ),
    ).toBe(false);
    expect(
      Object.values(off.cards).every(
        (c) => !c.expansion || off.releasedExpansions?.includes(c.expansion),
      ),
    ).toBe(true);
  });
  it("advanced summon/combo templates contain a complete published ritual package", () => {
    for (const personality of ["SUMMONS", "COMBOS"] as const) {
      const bot = {
        ...botIdentity("ritual", 1500, 73421),
        heroId: "summoner" as const,
        level: 5,
        personality,
      };
      const deck = botDeck(content, bot);
      const ids = new Set(deck.map((e) => e.cardId));
      expect(
        Object.values(content.rituals ?? {}).some(
          (r) => r.heroId === "summoner" && r.pieces.every((id) => ids.has(id)),
        ),
      ).toBe(true);
    }
  });
});
