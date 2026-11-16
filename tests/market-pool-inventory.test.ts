import { writeFileSync, mkdirSync } from "node:fs";
import { it, expect } from "vitest";
import { DEFAULT_CONTENT, COSMETICS, DECK_RULES, rarityOf } from "../src/game";
import { releasedContent } from "../server/src/ritualRelease";
import { boosterOffers } from "../server/src/boosters";
import type { Env } from "../server/src/db";
it("verifies real eligible buckets in the released catalog", () => {
  const content = releasedContent(DEFAULT_CONTENT, {
    FREE_CATALOG_ENABLED: "1",
    SHAPESHIFTER_ENABLED: "1",
    WARRIOR_ENABLED: "1",
    ARCHER_ENABLED: "1",
    SUMMONER_RITUALS_ENABLED: "1",
    PRIMORDIAL_DRAGON_ENABLED: "1",
    ARSENAL_CARDS_ENABLED: "1",
    TACTICAL_CARDS_ENABLED: "1",
    STORE_SHOWCASE_ENABLED: "1",
  } as Env);
  const offers = boosterOffers({
    content,
    cosmetics: COSMETICS,
    rules: DECK_RULES,
  });
  const inventory = offers.map((o) => ({
    hero: o.heroId,
    ids: o.contents.flatMap(c=>c.kind==='CARD'?[c.cardId]:[]),
    pool: o.contents.reduce(
      (a, c) => {
        if (c.kind === "CARD") {
          const r = rarityOf(content.cards[c.cardId]!);
          a[r] = (a[r] ?? 0) + 1;
        }
        return a;
      },
      {} as Record<string, number>,
    ),
  }));
  mkdirSync("/private/tmp/arcane-market-evidence", { recursive: true });
  writeFileSync(
    "/private/tmp/arcane-market-evidence/pool.json",
    JSON.stringify(inventory, null, 2),
  );
  expect(offers.some((o) => o.booster?.packs === 1)).toBe(true);
  expect(offers.some((o) => o.booster?.poolType === "GENERAL")).toBe(true);
});
