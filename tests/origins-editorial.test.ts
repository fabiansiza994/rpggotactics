import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import {
  ORIGINAL_ORIGINS_CARD_IDS,
  ORIGINS_CARD_IDS,
  MARKET_EXPANSIONS,
} from "../src/game/store/market-expansions";
import { context, packs } from "../qa/market-20/demo-state";
import { rarityOf } from "../src/game";
it("curates exactly40 from the original96, retains56 in the game and preserves real rarities", () => {
  expect(ORIGINAL_ORIGINS_CARD_IDS).toHaveLength(96);
  expect(ORIGINS_CARD_IDS).toHaveLength(40);
  expect(new Set(ORIGINS_CARD_IDS).size).toBe(40);
  expect(
    ORIGINS_CARD_IDS.every((id) => ORIGINAL_ORIGINS_CARD_IDS.includes(id)),
  ).toBe(true);
  const excluded = ORIGINAL_ORIGINS_CARD_IDS.filter(
    (id) => !ORIGINS_CARD_IDS.includes(id),
  );
  expect(excluded).toHaveLength(56);
  expect(excluded.every((id) => !!context.content.cards[id])).toBe(true);
  const selected = ORIGINS_CARD_IDS.map((id) => context.content.cards[id]!);
  const count = (f: (c: (typeof selected)[number]) => string) =>
    selected.reduce(
      (a, c) => {
        const x = f(c);
        a[x] = (a[x] ?? 0) + 1;
        return a;
      },
      {} as Record<string, number>,
    );
  expect(count((c) => c.heroId!)).toEqual({
    mage: 14,
    summoner: 14,
    warrior: 12,
  });
  expect(count((c) => rarityOf(c))).toEqual({
    COMMON: 14,
    UNCOMMON: 12,
    RARE: 11,
    LEGENDARY: 3,
  });
  expect(new Set(selected.map((c) => c.category)).size).toBe(6);
  expect(packs.every((o) => o.contents.length === 40)).toBe(true);
  expect(MARKET_EXPANSIONS[0]!.freePacksPerPlayer).toBe(5);
  expect(
    MARKET_EXPANSIONS.slice(1).every((e) => e.freePacksPerPlayer === undefined),
  ).toBe(true);
  writeFileSync(
    "/private/tmp/origins-editorial-selection.json",
    JSON.stringify(
      {
        selected: selected.map((c) => ({
          id: c.id,
          name: c.name,
          hero: c.heroId,
          rarity: rarityOf(c),
          type: c.category,
          cost: c.cost,
        })),
        excluded: excluded.map((id) => {
          const c = context.content.cards[id]!;
          return { id, name: c.name, hero: c.heroId, rarity: rarityOf(c) };
        }),
        byHero: count((c) => c.heroId!),
        byRarity: count((c) => rarityOf(c)),
      },
      null,
      2,
    ),
  );
});
