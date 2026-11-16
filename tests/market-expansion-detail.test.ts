import { afterEach, describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createProfile,
  DEFAULT_CONTENT,
  COSMETICS,
  DECK_RULES,
  offerView,
} from "../src/game";
import { ExpansionCatalog } from "../src/presentation/shop/ExpansionCatalog";
import { PackOpening } from "../src/presentation/shop/PackOpening";
import { releasedContent } from "../server/src/ritualRelease";
import {
  boosterOffers,
  expansionViews,
  rollBooster,
} from "../server/src/boosters";
import type { Env } from "../server/src/db";
const ctx = {
  content: releasedContent(DEFAULT_CONTENT, {
    FREE_CATALOG_ENABLED: "1",
    ARSENAL_CARDS_ENABLED: "1",
    TACTICAL_CARDS_ENABLED: "1",
    STORE_SHOWCASE_ENABLED: "1",
  } as Env),
  cosmetics: COSMETICS,
  rules: DECK_RULES,
};
const owned = { copies: () => 0, hasCosmetic: () => false, purchases: () => 0 };
const packs = boosterOffers(ctx),
  views = expansionViews(ctx, packs),
  offers = packs.map((o) => offerView(o, owned, ctx, Date.now()));
const base = {
  expansions: views,
  offers,
  onSelect: () => {},
  profile: createProfile(ctx.content),
  heroId: "mage",
  onHero: () => {},
  onInspect: () => {},
  onBuy: () => {},
  balance: 1000,
  busy: false,
};
afterEach(() => vi.unstubAllGlobals());
describe("expansion detail and deterministic receipt presentation", () => {
  it("shows an index first, then the full current catalog, editorial highlights and the real purchase conditions", () => {
    const index = renderToStaticMarkup(
      createElement(ExpansionCatalog, { ...base, selectedId: null }),
    );
    expect(index).toContain("Colecciones de la arena");
    expect(index).not.toContain("Comprar x1");
    expect(index).toContain("poseídas");
    expect(index).toContain("<progress");
    const html = renderToStaticMarkup(
      createElement(ExpansionCatalog, {
        ...base,
        selectedId: "origins_arcanos",
      }),
    );
    for (const text of [
      "Cartas de la expansión",
      "200 Cristales",
      "55%",
      "30%",
      "12%",
      "3%",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("Ver cartas del sobre");
    expect(html).not.toContain("<progress");
    expect(html).not.toContain("market-content-tabs");
    expect(html).not.toContain("market-expansion-cover");
    expect(html).toContain("Frost Nova");
    expect(html).toContain("Invocar Lobo");
    expect(html).toContain("Glacial Field");
    expect(html).not.toContain("market-filters");
    expect(html).not.toContain("con los filtros actuales");
    expect(html).toContain("market-copy-indicator");
    expect(html).toContain("límite por mazo");
  });
  it("orders every card by real rarity then name and updates uncapped ownership badges", () => {
    const profile = createProfile(ctx.content);
    profile.heroes.mage!.collection.elemental_detonation = {
      copies: 5,
      acquired: 5,
    };
    const render = () =>
      renderToStaticMarkup(
        createElement(ExpansionCatalog, {
          ...base,
          profile,
          selectedId: "origins_arcanos",
        }),
      );
    const html = render();
    const ids = views.find((v) => v.id === "origins_arcanos")!.cardIds;
    const ranks = ["COMMON", "UNCOMMON", "RARE", "LEGENDARY", "ULTRA"];
    const expected = ids
      .map((id) => ctx.content.cards[id]!)
      .sort(
        (a, b) =>
          ranks.indexOf(b.rarity ?? "COMMON") -
            ranks.indexOf(a.rarity ?? "COMMON") ||
          a.name.localeCompare(b.name, "es") ||
          a.id.localeCompare(b.id),
      );
    const labels = [...html.matchAll(/aria-label="Consultar ([^;]+);/g)].map(
      (m) => m[1],
    );
    expect(labels).toEqual(expected.map((c) => c.name));
    expect(html).toContain("5/1</span>");
    profile.heroes.mage!.collection.elemental_detonation.copies = 6;
    expect(render()).toContain("6/1</span>");
    expect(html).not.toContain("<select");
    expect(labels).toHaveLength(ids.length);
  });
  it.each(["furia_elemental", "guerra_psicologica", "pactos_bestias"])(
    "never offers a buy action or fabricated cards for %s",
    (selectedId) => {
      const html = renderToStaticMarkup(
        createElement(ExpansionCatalog, { ...base, selectedId }),
      );
      expect(html).toContain("Próximamente");
      expect(html).not.toContain("Comprar sobre");
      expect(html).not.toContain("market-expansion-cards");
      expect(html).not.toContain("market-highlight-carousel");
    },
  );
  it("editorial combinations refer to implemented control and summon mechanics", () => {
    const ice = ctx.content.cards.glacial_field!,
      nova = ctx.content.cards.frost_nova!,
      wolf = ctx.content.cards.summon_wolf!,
      root = ctx.content.cards.entangle!;
    expect(
      ice.effects.some(
        (e) => e.type === "CREATE_TERRAIN" && e.terrain === "ICE",
      ),
    ).toBe(true);
    expect(
      nova.effects.some(
        (e) => e.type === "APPLY_STATUS" && e.status === "ROOTED",
      ),
    ).toBe(true);
    expect(wolf.effects.some((e) => e.type === "SUMMON")).toBe(true);
    expect(
      root.effects.some(
        (e) => e.type === "APPLY_STATUS" && e.status === "ROOTED",
      ),
    ).toBe(true);
    for (const h of views[0]!.highlights ?? [])
      expect(views[0]!.cardIds).toContain(h.cardId);
  });
  it.each([false, true])(
    "reduced motion=%s reveals only the saved receipt, no random reward generation",
    (reduced) => {
      vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
      const opening = rollBooster(
        packs[0]!,
        owned,
        ctx,
        Date.now(),
        () => 0,
      ).opening!;
      const html = renderToStaticMarkup(
        createElement(PackOpening, { opening, onInspect: () => {} }),
      );
      expect(html).toContain("Abrir sobre");
      expect(html).not.toContain("market-reveal-card");
      expect(html).toContain('data-phase="sealed"');
      expect(html).not.toContain("Revelar todas");
    },
  );
});
