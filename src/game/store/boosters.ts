import type { CardRarity } from "../collection/deck-rules";
/** Displayed from the server's exact policy; the browser never rolls rewards. */
export interface BoosterPolicy {
  revision: string;
  inventory?: "FINITE";
  box?: import("./boxes").BoxSnapshot;
  expansionId?: string;
  size: number;
  poolType?: "GENERAL" | "CHAMPION" | "THEMATIC";
  packs?: 1 | 5 | 10;
  freeGrant?: boolean;
  freeLimit?: number;
  weights: Record<CardRarity, number>;
  duplicates: true;
}
export const ARCANE_PACK_POLICY: BoosterPolicy = {
  revision: "arcane-four-box-v1",
  inventory: "FINITE",
  size: 4,
  duplicates: true,
  weights: { COMMON: 55, UNCOMMON: 30, RARE: 12, LEGENDARY: 3, ULTRA: 0 },
};
export const ARCANE_PACK_PRICE = 50;
export const BOOSTER_RARITIES = [
  "COMMON",
  "UNCOMMON",
  "RARE",
  "LEGENDARY",
  "ULTRA",
] as const;
