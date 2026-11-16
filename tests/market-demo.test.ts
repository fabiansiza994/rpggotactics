import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  freshDemo,
  simulatePurchase,
  offers,
  expansions,
  DEMO_KEY,
} from "../qa/market-20/demo-state";
describe("sessionless market lab isolation", () => {
  it("keeps the category strip bounded and disables background filtering only during card reveals", () => {
    const css = readFileSync("src/styles/arcane-market.css", "utf8");
    expect(css).toContain("grid-template-columns: repeat(2,minmax(0,1fr))");
    expect(css).toContain(".shop-dialog:has(.market-opening)::backdrop");
    expect(css).toContain("backdrop-filter: none");
  });
  it("uses the actual 40 card collection and starts independently of authentication", () => {
    expect(expansions[0]!.cardIds).toHaveLength(40);
    expect(freshDemo().balance).toBe(2000);
    expect(DEMO_KEY).toContain("qa-demo");
  });
  it("deducts exactly 200 and grants four copies only to a cloned demo draft", () => {
    const before = freshDemo(),
      snapshot = structuredClone(before),
      o = offers.find((o) => o.booster?.packs === 1 && !o.booster.freeGrant)!;
    const after = simulatePurchase(before, o.id, () => 0);
    expect(before).toEqual(snapshot);
    expect(after.balance).toBe(1800);
    expect(after.purchases).toHaveLength(1);
    const id = after.purchases[0]!.opening.cards[0]!.cardId;
    expect(
      after.profile.heroes.mage!.collection[id]!.copies -
        (before.profile.heroes.mage!.collection[id]?.copies ?? 0),
    ).toBe(4);
    expect(after.purchases[0]!.opening.cards).toHaveLength(4);
  });
  it("reset does not retain purchases or a mutated collection", () => {
    const initial = freshDemo();
    const after = simulatePurchase(
      initial,
      offers.find((o) => !o.booster?.freeGrant && o.booster?.packs === 1)!.id,
      () => 0,
    );
    expect(after.balance).not.toBe(initial.balance);
    expect(freshDemo()).toEqual(initial);
  });
  it("rejects insufficient balance without mutating state", () => {
    const state = freshDemo();
    state.balance = 199;
    expect(() =>
      simulatePurchase(
        state,
        offers.find((o) => !o.booster?.freeGrant && o.booster?.packs === 1)!.id,
      ),
    ).toThrow();
    expect(state.balance).toBe(199);
    expect(state.purchases).toHaveLength(0);
  });
  it("future collections never become demo purchase offers", () => {
    expect(
      offers.every((o) => o.booster?.expansionId === "origins_arcanos"),
    ).toBe(true);
    expect(() => simulatePurchase(freshDemo(), "furia_elemental")).toThrow();
  });
  it("lab blocks all backend requests and is outside production entrypoints", () => {
    const html = readFileSync("qa/market-20/demo.html", "utf8");
    expect(html).toContain("connect-src 'none'");
    expect(readFileSync("index.html", "utf8")).not.toContain("market-20");
    for (const dir of ["src/presentation/shop", "src/game/store"])
      for (const file of readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f)))
        expect(readFileSync(`${dir}/${file}`, "utf8")).not.toMatch(
          /qa\/market-20|qa-demo\.v1/,
        );
  });
});
