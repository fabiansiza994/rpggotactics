import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_CONTENT, COSMETICS, DECK_RULES } from "../src/game";
import { releasedContent } from "../server/src/ritualRelease";
import { boosterOffers } from "../server/src/boosters";
import { BoosterOdds } from "../src/presentation/shop/BoosterOdds";
import { marketOffers, MARKET_SECTIONS } from "../src/presentation/shop/market";
import { FramedPortrait } from "../src/presentation/shop/ProfileFrame";
import { PROFILE_FRAME_ART } from "../src/presentation/assets/profileFrames";
import { offerView, type StoreContext } from "../src/game/store/store";
import { STORE_CATALOG } from "../src/game/data/store-catalog";
import type { Env } from "../server/src/db";
import { existsSync, readFileSync } from "node:fs";
const ctx: StoreContext = {
  content: releasedContent(DEFAULT_CONTENT, {
    FREE_CATALOG_ENABLED: "1",
  } as Env),
  cosmetics: COSMETICS,
  rules: DECK_RULES,
};
const owned = { copies: () => 9, hasCosmetic: () => false, purchases: () => 0 };
const offers = [...boosterOffers(ctx), ...STORE_CATALOG].map((o) =>
  offerView(o, owned, ctx, Date.now()),
);
describe("market presentation and ownership-preserving frame stage", () => {
  it("has five independent sections and no duplicate offer ids", () => {
    expect(MARKET_SECTIONS.map((c) => c.id)).toEqual([
      "featured",
      "packs",
      "cards",
      "cosmetics",
      "crystals",
    ]);
    for (const s of MARKET_SECTIONS) {
      const rows = marketOffers([...offers, ...offers], s.id);
      expect(new Set(rows.map((o) => o.id)).size).toBe(rows.length);
    }
    expect(marketOffers(offers, "packs").every((o) => o.booster)).toBe(true);
    expect(marketOffers(offers, "cards").every((o) => o.type === "CARD")).toBe(
      true,
    );
  });
  it("filters only presentation, preserving all source prices and contents", () => {
    const copy = structuredClone(offers);
    expect(
      marketOffers(offers, "cards", "mage", "RARE", true).every(
        (o) => o.heroId === "mage" && o.availability.purchasable,
      ),
    ).toBe(true);
    expect(offers).toEqual(copy);
  });
  it("displays authoritative exact odds and replacement policy", () => {
    const o = offers.find((o) => o.booster)!;
    const html = renderToStaticMarkup(createElement(BoosterOdds, { offer: o }));
    for (const pct of ["55%", "30%", "12%", "3%", "0%"])
      expect(html).toContain(pct);
    expect(html).toContain("Sin rareza garantizada");
    expect(html).toContain("duplicados");
    expect(html).toContain("÷");
  });
  it.each(Object.keys(PROFILE_FRAME_ART))(
    "keeps frame %s in the bounded store stage",
    (frameId) => {
      const html = renderToStaticMarkup(
        createElement(FramedPortrait, { frameId, heroId: "mage" }),
      );
      expect(html).toContain("shop-frame-stage");
      expect(html).toContain("circular-frame-art");
      expect(html).toContain(PROFILE_FRAME_ART[frameId]);
      expect(existsSync("public" + PROFILE_FRAME_ART[frameId])).toBe(true);
    },
  );
  it("reserves enough space for external ornaments without changing equipped-avatar sizing", () => {
    const css = readFileSync("src/styles/store-frame-preview.css", "utf8");
    expect(css).toMatch(/\*\s*0?\.56/);
    expect(css).toContain("overflow: visible");
    expect(css).not.toContain(".ranked-player-avatar");
    expect(0.56 * 1.5625).toBeLessThan(1);
  });
});
