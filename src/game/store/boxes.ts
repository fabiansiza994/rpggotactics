import type { CardDefinition } from "../domain/cards/card";
import { rarityOf } from "../collection/deck-rules";
export type BoxStock = Record<string, number>;
export interface BoxSnapshot {
  generation: number;
  version: number;
  revision: string;
  initial: BoxStock;
  remaining: BoxStock;
}
export const boxTotal = (stock: BoxStock) =>
  Object.values(stock).reduce((n, v) => n + v, 0);
/** A deterministic authored distribution, not a random prize pool. Each Ultra has exactly one slot. */
export function createBoxStock(
  cards: readonly CardDefinition[],
  target = 80,
): BoxStock {
  if (
    !cards.length ||
    new Set(cards.map((c) => c.id)).size !== cards.length ||
    cards.filter((c) => rarityOf(c) === "ULTRA").length < 2
  )
    throw Error("Box requires a unique legal pool and at least two Ultras");
  if (!Number.isSafeInteger(target) || target < cards.length || target % 4)
    throw Error("Invalid box size");
  if (target === 80 && cards.some(c => c.id === 'light_redemption_spirit')) {
    const stock = createBoxStock(cards.filter(c => c.id !== 'light_redemption_spirit'), target);
    stock.light_minor_blessing!--;
    stock.light_dawn_shield!--;
    stock.light_redemption_spirit = 2;
    return stock;
  }
  const sorted = [...cards].sort((a, b) => a.id.localeCompare(b.id)),
    stock: BoxStock = Object.fromEntries(sorted.map((c) => [c.id, 1]));
  const weight = { COMMON: 8, UNCOMMON: 5, RARE: 2, LEGENDARY: 1, ULTRA: 0 };
  for (let n = cards.length; n < target; n++) {
    const candidates = sorted.filter((c) => weight[rarityOf(c)] > 0);
    candidates.sort(
      (a, b) =>
        stock[a.id]! / weight[rarityOf(a)] -
          stock[b.id]! / weight[rarityOf(b)] || a.id.localeCompare(b.id),
    );
    if (!candidates[0]) throw Error("No repeatable cards");
    stock[candidates[0].id]!++;
  }
  return stock;
}
export function drawBox(
  stock: BoxStock,
  count: number,
  below: (bound: number) => number,
): { slots: string[]; remaining: BoxStock } {
  if (!Number.isSafeInteger(count) || count < 1 || count > boxTotal(stock))
    throw Error("Insufficient box stock");
  const remaining = { ...stock },
    slots: string[] = [];
  for (let i = 0; i < count; i++) {
    const total = boxTotal(remaining);
    let roll = below(total);
    if (!Number.isSafeInteger(roll) || roll < 0 || roll >= total)
      throw Error("Invalid random result");
    const id = Object.keys(remaining)
      .sort()
      .find((id) => {
        roll -= remaining[id]!;
        return roll < 0;
      });
    if (!id) throw Error("Invalid stock");
    remaining[id]!--;
    slots.push(id);
  }
  return { slots, remaining };
}
export function validBoxSnapshot(box: BoxSnapshot): boolean {
  return (
    Number.isSafeInteger(box.generation) &&
    box.generation > 0 &&
    Number.isSafeInteger(box.version) &&
    box.version >= 0 &&
    !!box.revision &&
    Object.keys(box.initial).length > 0 &&
    Object.keys(box.initial).length === Object.keys(box.remaining).length &&
    Object.entries(box.initial).every(
      ([id, n]) =>
        Number.isSafeInteger(n) &&
        n > 0 &&
        Number.isSafeInteger(box.remaining[id]) &&
        box.remaining[id]! >= 0 &&
        box.remaining[id]! <= n,
    )
  );
}
