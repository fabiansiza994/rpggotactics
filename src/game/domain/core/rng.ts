/**
 * Seedable deterministic RNG (mulberry32). The whole RNG state is a single uint32 stored
 * inside GameState, so a battle is fully reproducible from (scenario, seed, commands).
 */
export interface RngHolder {
  rngState: number;
}

export function nextRandom(holder: RngHolder): number {
  holder.rngState = (holder.rngState + 0x6d2b79f5) >>> 0;
  let t = holder.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomInt(holder: RngHolder, maxExclusive: number): number {
  return Math.floor(nextRandom(holder) * maxExclusive);
}

/** In-place Fisher-Yates shuffle driven by the seeded RNG. */
export function shuffleInPlace<T>(holder: RngHolder, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(holder, i + 1);
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}
