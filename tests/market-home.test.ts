import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketHome } from "../src/presentation/shop/MarketHome";
import {
  freshDemo,
  expansions,
  offers,
  demoShowcase,
} from "../qa/market-20/demo-state";
const render = (remaining = 5) =>
  renderToStaticMarkup(
    createElement(MarketHome, {
      expansions,
      offers: [
        ...offers.map((o) => ({ ...o, freeRemaining: remaining })),
        ...demoShowcase,
      ],
      profile: freshDemo().profile,
      heroId: "mage",
      onExpansion: () => {},
      onCategory: () => {},
      onOffer: () => {},
    }),
  );
it("leads with the real expansion and collection, without selling packs on Home", () => {
  const html = render();
  expect(html).toContain("Expansión destacada");
  expect(html).toContain("Explorar expansión");
  expect(html).toContain("Colección: 6/22");
  expect(html).toContain("5 sobres gratis disponibles");
  expect(html).not.toContain("Abrir sobre GRATIS");
  expect(html).not.toContain("Comprar x");
  expect(html).not.toContain("Compras simuladas");
  expect(html).not.toContain("Probabilidades");
  expect(render(0)).not.toContain("sobres gratis disponibles");
});
it("uses only existing expansions and at most three real purchasable products", () => {
  const html = render();
  expect(demoShowcase.some((o) => o.type === "CARD")).toBe(true);
  expect(demoShowcase.some((o) => o.type === "COSMETIC")).toBe(true);
  expect(html.match(/class="market-home-expansion"/g)).toHaveLength(
    expansions.length,
  );
  const count = (html.match(/class="market-home-product"/g) ?? []).length;
  expect(count).toBeGreaterThanOrEqual(2);
  expect(count).toBeLessThanOrEqual(3);
  expect(html).toContain("PRÓXIMAMENTE");
  expect(html).toContain("Ver todas las expansiones");
  expect(html).toContain("Accesos del mercado");
});
