/** Bounded presentation-only light. No filters, RNG, extra textures or game state. */
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function lightEnvelope(remaining: number, duration: number): number {
  const t = clamp(remaining / Math.max(1, duration));
  return t * t * (3 - 2 * t);
}
export function litTint(base: number, color: number, strength: number): number {
  const amount = clamp(strength) * 0.16;
  let result = 0;
  for (const shift of [16, 8, 0]) {
    const channel = (base >> shift) & 255;
    result |= Math.round(channel * (1 - amount + amount * ((color >> shift) & 255) / 255)) << shift;
  }
  return result;
}
/** Contact stays on the floor while the body lifts; tactical rings are never transformed. */
export function contactShadow(lift: number, reduced: boolean) {
  const height = reduced ? 0 : Math.max(0, Math.min(20, lift));
  return { scale: 1 - height * 0.006, alpha: 1 - height * 0.018 };
}
/** Same four corner lamps used by EncounterAmbience; no invented in-board torch positions. */
export function cornerLight(x: number, y: number, cols: number, rows: number): number {
  const distance = Math.min(...[-0.15, cols + 0.15].flatMap(u =>
    [-0.15, rows + 0.15].map(v => Math.hypot(x - u, y - v))));
  const falloff = clamp(1 - distance / 2.5);
  return falloff * falloff * 0.42;
}

export function blendLight(ambient: number, pulse: number, amount: number): number {
  const t = clamp(amount);
  let result = 0;
  for (const shift of [16, 8, 0]) {
    const a = (ambient >> shift) & 255, b = (pulse >> shift) & 255;
    result |= Math.round(a + (b - a) * t) << shift;
  }
  return result;
}
