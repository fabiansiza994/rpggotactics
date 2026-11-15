import { starterDeck } from "../src/game/collection/profile";
import { it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { PVP_CONTENT } from "../server/src/pvp";
import { rankedBotCatalog } from "../server/src/rankedBotCatalog";
import { botDeck } from "../src/game/ai/ranked-bot-deck";
import { botIdentity } from "../src/game/ai/ranked-bot-policy";
import { validateDeck, copyLimit } from "../src/game/collection/deck-rules";
import { DECK_RULES } from "../src/game/data/rules";
import type { Env } from "../server/src/db";
it("exports a legal published owned QA player fixture, without combat/stat changes", () => {
  const content = rankedBotCatalog(PVP_CONTENT, {
    SHAPESHIFTER_ENABLED: "1",
    FREE_CATALOG_ENABLED: "1",
    TACTICAL_CARDS_ENABLED: "1",
    ARSENAL_CARDS_ENABLED: "1",
    SUMMONER_RITUALS_ENABLED: "1",
    PRIMORDIAL_DRAGON_ENABLED: "1",
    STORE_SHOWCASE_ENABLED: "1",
  } as Env);
  const b = {
    ...botIdentity("qa-player", 1500, 73721, 0),
    heroId: "mage" as const,
    personality: "AGGRESSIVE" as const,
  };
  const cards = botDeck(content, b);
  expect(
    validateDeck(
      cards,
      "mage",
      (id) => copyLimit(content.cards[id]!, DECK_RULES),
      content,
      DECK_RULES,
    ),
  ).toEqual([]);
  writeFileSync(
    "/private/tmp/ranked-closure-legal-qa-deck.json",
    JSON.stringify({
      fixture: true,
      heroId: "mage",
      cards,
      ownership: cards.map((e) => ({
        heroId: content.cards[e.cardId]!.heroId ? "mage" : "*",
        cardId: e.cardId,
        copies: e.count,
      })),
    }),
  );
  const profiles = [];
  for (const heroId of ["mage", "summoner", "shapeshifter"] as const)
    for (let level = 0; level <= 6; level++) {
      const bot = {
        ...botIdentity("deck-profile", 0, 73721, 0),
        heroId,
        level,
        personality:
          heroId === "summoner"
            ? ("SUMMONS" as const)
            : heroId === "shapeshifter"
              ? ("COMBOS" as const)
              : ("BALANCED" as const),
      };
      const deck = botDeck(content, bot),
        starter = starterDeck(content.heroes[heroId]!);
      const expanded = deck.flatMap((e) =>
        Array.from({ length: e.count }, () => content.cards[e.cardId]!),
      );
      const ids = new Set([...starter, ...deck].map((e) => e.cardId));
      const substitutions =
        [...ids].reduce(
          (n, id) =>
            n +
            Math.abs(
              (starter.find((e) => e.cardId === id)?.count ?? 0) -
                (deck.find((e) => e.cardId === id)?.count ?? 0),
            ),
          0,
        ) / 2;
      profiles.push({
        heroId,
        level,
        personality: bot.personality,
        substitutions,
        averageCost: expanded.reduce((n, c) => n + c.cost, 0) / 30,
        cheapCards: expanded.filter((c) => c.cost <= 2).length,
        categories: Object.fromEntries(
          [...new Set(expanded.map((c) => c.category))].map((category) => [
            category,
            expanded.filter((c) => c.category === category).length,
          ]),
        ),
        completeRituals: Object.values(content.rituals ?? {}).filter(
          (r) =>
            r.heroId === heroId &&
            r.pieces.every((id) => deck.some((e) => e.cardId === id)),
        ).length,
        cards: deck,
      });
      expect(expanded).toHaveLength(30);
    }
  mkdirSync("qa/ranked-bots-local", { recursive: true });
  writeFileSync(
    "qa/ranked-bots-local/deck-profiles.json",
    JSON.stringify(
      {
        seed: 73721,
        scope:
          "Same fixed seed and personality within each champion; curve/roles/rituals, no rarity as a power proxy",
        profiles,
      },
      null,
      2,
    ),
  );
}, 20_000);
