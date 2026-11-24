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
  if(target===80 && cards.some(c=>c.id==='dark_goblin_barter')) {
    const stock:BoxStock={dark_crypt_whisper:7,dark_ash_mark:7,dark_umbral_step:6,dark_rusty_dagger:4,dark_cursed_fragment:4,dark_blood_offering:4,dark_reanimated_bones:4,dark_dread_mist:4,dark_shadow_skin:4,dark_goblin_barter:4,dark_shadow_hand:5,dark_profane_burial:5,dark_abyss_gaze:4,dark_minor_drain:4,dark_twisted_curse:2,dark_despair_tribute:2,dark_silence_seal:2,dark_warrior_pact:2,dark_serpent_king:1,dark_the_reaper:1,dark_executioner_call:1,dark_abyssal_minotaur:1,dark_dark_world:1,dark_scorpion_king:1};
    if(cards.length!==24 || cards.some(c=>!stock[c.id]) || boxTotal(stock)!==80)throw Error('Expanded Darkness requires its complete approved 24-card pool');
    return stock;
  }
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
