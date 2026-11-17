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
    ARCHER_ENABLED: "1",
    SHAPESHIFTER_ENABLED: "1",
    ARSENAL_CARDS_ENABLED: "1",
    TACTICAL_CARDS_ENABLED: "1",
    STORE_SHOWCASE_ENABLED: "1",
    SUMMONER_RITUALS_ENABLED: "1",
    PRIMORDIAL_DRAGON_ENABLED: "1",
  } as Env),
  cosmetics: COSMETICS,
  rules: DECK_RULES,
};
it('registers six approved pack families and clean future metadata without empty pools',()=>{
 for(const e of MARKET_EXPANSIONS)expect(existsSync('public'+e.art)).toBe(true);
 const packs=boosterOffers(ctx);expect(packs).toHaveLength(24);
 expect(ORIGINS_CARD_IDS).toHaveLength(34);
 expect(expansionViews(ctx,packs)[0]!.packs).toHaveLength(4);
 expect(expansionViews(ctx,packs)[1]!.packs).toHaveLength(4);
 expect(packs.every(p=>['origins_arcanos','thunder_god','antarctic_magic','pack_pact','warrior_promise','reserva_cazador'].includes(p.booster!.expansionId!))).toBe(true);
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
      (e) => e.packs.length === 0,
    ),
  ).toBe(true);
});
it('cloning expansion metadata alone cannot duplicate another primary pool',()=>{
 const extension={...MARKET_EXPANSIONS[0]!,id:'future_test_collection',name:'QA metadata'};
 expect(boosterOffers(ctx,undefined,undefined,[extension])).toEqual([]);
});
