export type ResultTone = 'victory' | 'defeat' | 'draw' | 'ended';
export const resultDuration = (tone: ResultTone) => (tone === 'draw' || tone === 'ended') ? 1200 : 2400;
/** Bounded cosmetic history; never contains rewards or authoritative result data. */
export function createResultHistory() {
  const objects = new WeakSet<object>();
  const keys = new Set<string>();
  return {
    has: (identity: object | string) => typeof identity === 'string' ? keys.has(identity) : objects.has(identity),
    mark(identity: object | string) {
      if (typeof identity !== 'string') { objects.add(identity); return; }
      keys.add(identity);
      if (keys.size > 128) keys.delete(keys.values().next().value!);
    },
  };
}
