import { it, expect } from "vitest";
import { existsSync } from "node:fs";
import {
  MARKET_EXPANSIONS,
  ORIGINS_CARD_IDS,
} from "../src/game/store/market-expansions";
import { boosterOffers, expansionViews } from "../server/src/boosters";
import { DEFAULT_CONTENT, COSMETICS, DECK_RULES } from "../src/game";
import { releasedContent } from "../server/src/ritualRelease";
import type { Env } from "../server/src/db";
const ctx = {
  content: releasedContent(DEFAULT_CONTENT, {
    FREE_CATALOG_ENABLED: "1",
    ARSENAL_CARDS_ENABLED: "1",
    TACTICAL_CARDS_ENABLED: "1",
    STORE_SHOWCASE_ENABLED: "1",
    SUMMONER_RITUALS_ENABLED: "1",
    PRIMORDIAL_DRAGON_ENABLED: "1",
  } as Env),
  cosmetics: COSMETICS,
  rules: DECK_RULES,
};
it("has four stable identities and existing project art without inventing future content", () => {
  expect(MARKET_EXPANSIONS.map((e) => e.id)).toEqual([
    "origins_arcanos",
    "furia_elemental",
    "guerra_psicologica",
    "pactos_bestias",
  ]);
  for (const e of MARKET_EXPANSIONS)
    expect(existsSync("public" + e.art)).toBe(true);
  for (const e of MARKET_EXPANSIONS.slice(1)) {
    expect(e.status).toBe("COMING_SOON");
    expect(e.cardIds).toEqual([]);
    expect(e.pack).toBeUndefined();
  }
});
it("Origins is useful: three general quantity offers with real commons, uncommons, rares and legendary cards", () => {
  const packs = boosterOffers(ctx);
  expect(packs).toHaveLength(4);
  expect(ORIGINS_CARD_IDS.length).toBe(40);
  for (const p of packs) {
    expect(p.contents.length).toBeGreaterThanOrEqual(20);
    expect(
      p.contents.every(
        (c) => c.kind === "CARD" && ORIGINS_CARD_IDS.includes(c.cardId),
      ),
    ).toBe(true);
    expect(p.booster!.expansionId).toBe("origins_arcanos");
  }
  const views = expansionViews(ctx, packs);
  expect(views[0]!.packs).toHaveLength(4);
  expect(
    views
      .slice(1)
      .every(
        (e) =>
          e.packs.length === 0 &&
          e.cardIds.length === 0 &&
          e.status === "COMING_SOON",
      ),
  ).toBe(true);
});
it("newly published cards do not silently enter the first edition", () => {
  const sample = Object.values(ctx.content.cards).find(
    (c) => c.heroId === "mage" && c.rarity === "COMMON",
  )!;
  const expanded = {
    ...ctx,
    content: {
      ...ctx.content,
      cards: {
        ...ctx.content.cards,
        new_future_card: { ...sample, id: "new_future_card" },
      },
    },
  };
  expect(
    boosterOffers(expanded).every((o) =>
      o.contents.every(
        (c) => c.kind !== "CARD" || c.cardId !== "new_future_card",
      ),
    ),
  ).toBe(true);
});
it("an incomplete or empty collection never creates a buyable box or redistributes odds", () => {
  expect(
    boosterOffers(ctx, undefined, undefined, [
      { ...MARKET_EXPANSIONS[0]!, cardIds: [] },
    ]),
  ).toEqual([]);
  expect(
    expansionViews(ctx, []).every(
      (e) => e.packs.length === 0 && e.status === "COMING_SOON",
    ),
  ).toBe(true);
});
it("a new authored collection can be added through metadata using the same pack infrastructure", () => {
  const extension = {
    ...MARKET_EXPANSIONS[0]!,
    id: "future_test_collection",
    name: "QA metadata",
  };
  expect(
    boosterOffers(ctx, undefined, undefined, [extension]).every(
      (p) =>
        p.booster!.expansionId === extension.id &&
        p.id.startsWith("booster_future_test_collection_"),
    ),
  ).toBe(true);
});
