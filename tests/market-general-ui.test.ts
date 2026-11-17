import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  readMarketNavigation,
  marketNavigationUrl,
} from "../src/presentation/shop/marketNavigation";
import { restoreBatch } from "../src/presentation/shop/PackBatchOpening";
import { ExpansionCatalog } from "../src/presentation/shop/ExpansionCatalog";
import {
  offers,
  expansions,
  freshDemo,
  simulatePurchase,
} from "../qa/market-20/demo-state";
it("preserves the game route and other URL parameters across all market levels", () => {
  let u = "https://qa.test/play?mode=store&invite=abc";
  u = "https://qa.test" + marketNavigationUrl(u, "packs", null);
  expect(readMarketNavigation(new URL(u).search)).toEqual({
    category: "packs",
    expansionId: null,
  });
  u = "https://qa.test" + marketNavigationUrl(u, "packs", "origins_arcanos");
  expect(readMarketNavigation(new URL(u).search).expansionId).toBe(
    "origins_arcanos",
  );
  expect(u).toContain("mode=store");
  expect(u).toContain("invite=abc");
  expect(marketNavigationUrl(u, "featured", null)).toBe(
    "/play?mode=store&invite=abc",
  );
});
it("offers x1 and x5, blocks x10 at400, and never renders a champion purchase selector", () => {
  const html = renderToStaticMarkup(
    createElement(ExpansionCatalog, {
      expansions,
      offers: offers.map((o) => ({ ...o, freeRemaining: 0 })),
      selectedId: "origins_arcanos",
      onSelect: () => {},
      profile: freshDemo().profile,
      onInspect: () => {},
      onBuy: () => {},
      balance: 400,
      busy: false,
    }),
  );
  expect(html).not.toContain("Campeón del sobre");
  expect(html).not.toContain("Sobre general");
  expect(html).toContain("Comprar x1");
  expect(html).toContain("Comprar x5");
  expect(html).toContain("Comprar x10");
  expect(html).toContain("Saldo insuficiente");
  expect(html).toMatch(/disabled=""[^>]*>Comprar x10/);
  expect(html).not.toContain("Ideas para combinar");
});
it.each([1, 5, 10] as const)(
  "demo x%s is also a single persisted order with separate packs",
  (qty) => {
    const q = offers.find(
      (o) => o.booster?.packs === qty && !o.booster.freeGrant,
    )!;
    const before = freshDemo();
    const after = simulatePurchase(before, q.id, () => 0);
    expect(after.purchases).toHaveLength(1);
    expect(after.purchases[0]!.openings).toHaveLength(qty);
    expect(after.purchases[0]!.openings!.flatMap((o) => o.cards)).toHaveLength(
      qty * 4,
    );
    expect(after.balance).toBe(2000 - qty * 50);
    expect(before.balance).toBe(2000);
  },
);
it("batch recovery retains the current pack and treats open-all as presentation only", () => {
  expect(restoreBatch('{"index":4,"summary":false}', 10)).toEqual({
    index: 4,
    summary: false,
  });
  expect(restoreBatch('{"index":0,"summary":true}', 10)).toEqual({
    index: 0,
    summary: true,
  });
  expect(restoreBatch('{"index":11,"summary":false}', 10)).toEqual({
    index: 0,
    summary: false,
  });
});

it("preserves five Origins free packs, shows remaining counter and hides paid controls until exhausted", () => {
  for (const remaining of [5, 1]) {
    const html = renderToStaticMarkup(
      createElement(ExpansionCatalog, {
        expansions,
        offers: offers.map((o) => ({
          ...o,
          freeRemaining: o.booster?.freeGrant ? remaining : undefined,
        })),
        selectedId: "origins_arcanos",
        onSelect: () => {},
        profile: freshDemo().profile,
        onInspect: () => {},
        onBuy: () => {},
        balance: 0,
        busy: false,
      }),
    );
    expect(html).toContain("Sobres gratuitos restantes: "+remaining+"/5");
    expect(html).toContain("ABRIR SOBRE GRATIS");
    expect(html).not.toContain("Comprar x5");
  }
});
