import { describe, it, expect } from "vitest";
import {
  advancePack,
  initialPackScene,
  restorePackScene,
  packSceneKey,
  type PackScene,
} from "../src/presentation/shop/packScene";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PackConfirmation } from "../src/presentation/shop/PackConfirmation";
import {
  offers,
  freshDemo,
  simulatePurchase,
} from "../qa/market-20/demo-state";
describe("deliberate pack discovery, no acquisition in animation", () => {
  it("waits sealed until explicit open and reaches four hidden cards without revealing them", () => {
    const sealed = initialPackScene();
    expect(advancePack(sealed, { type: "REVEAL", index: 0 })).toEqual(sealed);
    const opening = advancePack(sealed, { type: "OPEN", reduced: false });
    expect(opening).toEqual({ phase: "opening", mask: 0 });
    expect(advancePack(opening, { type: "OPENED" })).toEqual({
      phase: "reveal",
      mask: 0,
    });
  });
  it("reduced motion skips movement, never the explicit opening gesture or discovery", () => {
    expect(initialPackScene().phase).toBe("sealed");
    expect(
      advancePack(initialPackScene(), { type: "OPEN", reduced: true }),
    ).toEqual({ phase: "reveal", mask: 0 });
  });
  it("skip opens the envelope, not the reward faces", () => {
    expect(advancePack(initialPackScene(), { type: "SKIP" })).toEqual({
      phase: "reveal",
      mask: 0,
    });
  });
  it("reveals independent slots, remains idempotent, and requires all four before summary", () => {
    let s: PackScene = { phase: "reveal", mask: 0 };
    s = advancePack(s, { type: "REVEAL", index: 2 });
    expect(s.mask).toBe(4);
    expect(advancePack(s, { type: "REVEAL", index: 2 })).toEqual(s);
    expect(advancePack(s, { type: "CONTINUE" })).toEqual(s);
    s = advancePack(s, { type: "ALL" });
    expect(s.mask).toBe(15);
    expect(advancePack(s, { type: "CONTINUE" }).phase).toBe("summary");
  });
  it.each([-1, 4, NaN, 1.5])("ignores invalid reveal index %s", (index) => {
    const s: PackScene = { phase: "reveal", mask: 0 };
    expect(advancePack(s, { type: "REVEAL", index })).toEqual(s);
  });
  it("restores an interrupted animation safely and retains revealed positions", () => {
    expect(restorePackScene('{"phase":"opening","mask":0}')).toEqual({
      phase: "reveal",
      mask: 0,
    });
    expect(restorePackScene('{"phase":"reveal","mask":5}')).toEqual({
      phase: "reveal",
      mask: 5,
    });
    expect(packSceneKey("a")).not.toBe(packSceneKey("b"));
  });
  it.each([
    "broken",
    "null",
    '{"phase":"bad","mask":0}',
    '{"phase":"summary","mask":99}',
  ])("ignores corrupt visual storage %s", (raw) =>
    expect(restorePackScene(raw)).toEqual(initialPackScene()),
  );
  it("uses persisted totals to distinguish a first copy from duplicates", () => {
    const before = freshDemo();
    const o = offers.find(
      (o) => o.booster?.packs === 1 && !o.booster.freeGrant,
    )!;
    const id = simulatePurchase(before, o.id, () => 0).purchases[0]!.opening
      .cards[0]!.cardId;
    before.profile.heroes[
      simulatePurchase(
        before,
        o.id,
        () => 0,
      ).purchases[0]!.opening.cards[0]!.heroId
    ]!.collection[id] = { copies: 1, acquired: 0 };
    const receipt = simulatePurchase(before, o.id, () => 0).purchases[0]!;
    expect(receipt.opening.cards.map((c) => c.total)).toEqual([2, 3, 4, 5]);
    expect(receipt.opening.cards.every((c) => c.copies === 1)).toBe(true);
    const json = JSON.stringify(receipt);
    let s = advancePack(initialPackScene(), { type: "SKIP" });
    s = advancePack(s, { type: "ALL" });
    advancePack(s, { type: "CONTINUE" });
    expect(JSON.stringify(receipt)).toBe(json);
  });
  it("paid entry shows real offer price before the explicit confirmation step, without charging", () => {
    const o = offers.find(
      (o) => o.booster?.packs === 1 && !o.booster.freeGrant,
    )!;
    const html = renderToStaticMarkup(
      createElement(PackConfirmation, {
        offer: o,
        balance: 1800,
        busy: false,
        onConfirm: () => {
          throw Error("not called");
        },
        onCancel: () => {},
        demo: true,
      }),
    );
    for (const text of [
      "Orígenes Arcanos",
      "4 cartas",
      "COMPRAR Y ABRIR · 200",
      "Cancelar",
      "Demostración",
    ])
      expect(html).toContain(text);
  });
});
