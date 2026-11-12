/** Presentation geometry only. No combat RNG, targets or state are queried here. */
export type ThunderPoint = { x: number; y: number };
export type ThunderVariant = 'thunder_discharge' | 'tempest_judgment';
export const THUNDER_TIMING = {
  thunder_discharge: { cast: 240, travel: 180, aftermath: 360, read: 180 },
  tempest_judgment: { cast: 520, travel: 120, aftermath: 560, read: 160 },
} as const;
export const isThunderPremium = (key: string | undefined): key is ThunderVariant =>
  key === 'thunder_discharge' || key === 'tempest_judgment';

/** Screen-space lengths, so perspective/zoom never change the destination or produce a fixed-size shot. */
export function thunderConnection(from: ThunderPoint, to: ThunderPoint, tileWidth: number, reduced = false, mobile = false) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const span = distance / Math.max(1, tileWidth);
  const tier = span < 1.5 ? 'short' : span < 3 ? 'medium' : 'long';
  const count = reduced ? 1 : Math.min(mobile ? 4 : 6, Math.max(2, Math.ceil(span * 1.6)));
  const nx = distance ? -(to.y - from.y) / distance : 0;
  const ny = distance ? (to.x - from.x) / distance : 0;
  const amplitude = Math.min(tileWidth * 0.17, distance * 0.1);
  const points = Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    const offset = i === 0 || i === count || reduced ? 0 : Math.sin(i * 7.13 + 0.8) * amplitude;
    return { x: from.x + (to.x - from.x) * t + nx * offset, y: from.y + (to.y - from.y) * t + ny * offset };
  });
  return { distance, tier, points, branches: reduced ? 0 : tier === 'short' ? 1 : mobile ? 2 : tier === 'medium' ? 3 : 4 };
}

/** Capped, deterministic variation; never a screen-flashing strobe. */
export const thunderEnvelope = (t: number, reduced: boolean) =>
  Math.max(0, Math.min(1, (reduced ? 0.44 : 0.8 + 0.12 * Math.sin(t * Math.PI * 5)) * Math.min(1, (1 - t) * 5)));
