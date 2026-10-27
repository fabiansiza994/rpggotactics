/**
 * Where a new battle's seed comes from. The game core is fully deterministic from its seed;
 * the entropy lives here, outside the core, so every battle start (and restart) gets a fresh
 * deck shuffle. Tests inject a fixed source; a future PvP server can hand out the seed instead.
 */
export type SeedSource = () => number;

/** Dev-only QA hook: e2e specs that need a known hand set `window.__RPGGO_SEED__` before boot. */
const pinnedSeed = (): number | undefined => {
  if (!import.meta.env.DEV) return undefined;
  const pinned = (globalThis as { __RPGGO_SEED__?: unknown }).__RPGGO_SEED__;
  return typeof pinned === 'number' ? pinned : undefined;
};

const entropy: SeedSource = () => {
  const pinned = pinnedSeed();
  if (pinned !== undefined) return pinned;
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0]!;
  } catch {
    return Math.floor(Math.random() * 0x1_0000_0000);
  }
};

let source: SeedSource = entropy;

export const freshBattleSeed = (): number => source() >>> 0;

/** Tests / QA inject a deterministic source; `undefined` restores real entropy. */
export function setBattleSeedSource(next: SeedSource | undefined): void {
  source = next ?? entropy;
}
