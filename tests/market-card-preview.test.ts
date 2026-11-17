import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { MarketCardPreview } from "../src/presentation/shop/MarketCardPreview";
it("shows one real card and one close button without duplicated descriptions or a Back action", () => {
  const html = renderToStaticMarkup(
    createElement(MarketCardPreview, { cardId: "fireball", onClose: () => {} }),
  );
  expect(html.match(/class="feature-card /g)).toHaveLength(1);
  expect(html.match(/class="fc-text"/g)).toHaveLength(1);
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain("Cerrar carta");
  expect(html).not.toContain("Volver");
  expect(html).not.toContain("<h3");
  expect(html).not.toContain("market-card-stats");
  expect(html).not.toContain("Cómo conseguir");
  expect(html).not.toContain("Ir a la expansión");
});
it("reserves an accessible close area and sizes the whole card to both viewport dimensions", () => {
  const css = readFileSync("src/styles/arcane-market.css", "utf8");
  expect(css).toContain("(100dvh - 100px) * 63 / 88 + 32px");
  expect(css).toContain(".market-card-preview-close");
  expect(css).toContain("padding:56px 16px 16px");
});
