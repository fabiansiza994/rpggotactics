/** Regions of the existing idle-0 painting, in normalized texture coordinates.
 * The wolf uses chest/foreleg regions instead of humanoid arms. No texture is cut or replaced.
 */
type Region = readonly [x: number, y: number, rx: number, ry: number];
interface Profile {
  head: Region;
  torso: Region;
  front: Region;
  back: Region;
  weapon?: { side: 'left' | 'right'; edge: number };
}
const PROFILES: Record<string, Profile> = {
  warrior: {
    head: [0.5, 0.22, 0.10, 0.13], torso: [0.5, 0.43, 0.16, 0.17],
    front: [0.4, 0.42, 0.09, 0.12], back: [0.6, 0.42, 0.09, 0.12],
  },
  qa_form_bear: {
    head: [0.65, 0.3, 0.14, 0.14], torso: [0.48, 0.46, 0.24, 0.18],
    front: [0.6, 0.5, 0.12, 0.12], back: [0.35, 0.5, 0.12, 0.12],
  },
  qa_form_minotaur: {
    head: [0.5, 0.22, 0.14, 0.14], torso: [0.5, 0.44, 0.22, 0.2],
    front: [0.3, 0.46, 0.12, 0.14], back: [0.7, 0.46, 0.12, 0.14],
  },
  chicken: {
    head: [0.67, 0.23, 0.2, 0.23],
    torso: [0.5, 0.55, 0.3, 0.25],
    front: [0.55, 0.55, 0.2, 0.2],
    back: [0.3, 0.5, 0.18, 0.2],
  },
  fox: {
    head: [0.73, 0.3, 0.18, 0.2],
    torso: [0.5, 0.53, 0.25, 0.2],
    front: [0.65, 0.55, 0.14, 0.2],
    back: [0.35, 0.6, 0.2, 0.15],
  },
  turtle: {
    head: [0.78, 0.5, 0.16, 0.16],
    torso: [0.5, 0.5, 0.27, 0.2],
    front: [0.7, 0.7, 0.12, 0.12],
    back: [0.3, 0.7, 0.12, 0.12],
  },
  raven: {
    head: [0.65, 0.2, 0.18, 0.2],
    torso: [0.5, 0.5, 0.2, 0.2],
    front: [0.65, 0.55, 0.2, 0.2],
    back: [0.3, 0.5, 0.2, 0.2],
  },
  wolf: {
    head: [0.75, 0.3, 0.18, 0.2],
    torso: [0.5, 0.5, 0.27, 0.2],
    front: [0.65, 0.55, 0.15, 0.2],
    back: [0.35, 0.5, 0.18, 0.2],
  },
  summoner: {
    head: [0.5, 0.18, 0.15, 0.14],
    torso: [0.5, 0.43, 0.2, 0.2],
    front: [0.3, 0.4, 0.18, 0.15],
    back: [0.7, 0.4, 0.15, 0.2],
  },
  mage: {
    head: [0.52, 0.25, 0.12, 0.12],
    torso: [0.51, 0.43, 0.16, 0.18],
    front: [0.4, 0.39, 0.13, 0.16],
    back: [0.66, 0.4, 0.12, 0.15],
    weapon: { side: 'right', edge: 0.68 },
  },
  orc_warrior: {
    head: [0.58, 0.25, 0.12, 0.14],
    torso: [0.58, 0.4, 0.16, 0.17],
    front: [0.37, 0.48, 0.14, 0.21],
    back: [0.73, 0.48, 0.12, 0.18],
    weapon: { side: 'left', edge: 0.28 },
  },
  dark_shaman: {
    head: [0.58, 0.31, 0.14, 0.16],
    torso: [0.55, 0.48, 0.15, 0.16],
    front: [0.44, 0.46, 0.13, 0.14],
    back: [0.69, 0.47, 0.11, 0.15],
    weapon: { side: 'right', edge: 0.68 },
  },
  stone_brute: {
    head: [0.65, 0.36, 0.11, 0.12],
    torso: [0.55, 0.46, 0.19, 0.19],
    front: [0.3, 0.56, 0.15, 0.22],
    back: [0.77, 0.56, 0.12, 0.22],
  },
  shadow_wolf: {
    head: [0.72, 0.6, 0.15, 0.13],
    torso: [0.55, 0.65, 0.22, 0.12],
    front: [0.68, 0.72, 0.09, 0.1],
    back: [0.49, 0.72, 0.09, 0.1],
  },
};
const smooth = (t: number) => {
  const v = Math.max(0, Math.min(1, t));
  return v * v * (3 - 2 * v);
};
const weight = (x: number, y: number, [cx, cy, rx, ry]: Region) =>
  1 - smooth(Math.hypot((x - cx) / rx, (y - cy) / ry));
const inhale = (phase: number) => (1 - Math.cos(phase)) * 0.5;

export function idleTiming(unitId: string): { periodMs: number; offsetMs: number } {
  let hash = 2166136261;
  for (const char of unitId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return { periodMs: 3400 + (hash % 5) * 100, offsetMs: ((hash % 997) / 997) * 3400 };
}

/** Continuous local-pixel displacement; lower body is exactly fixed, including feet.
 * Staff/axe shares its owning arm's phase, with a soft shoulder attachment.
 */
export function idleDisplacement(
  defId: string,
  x: number,
  y: number,
  phase: number,
): { x: number; y: number } {
  const p = PROFILES[defId];
  if (!p) return { x: 0, y: 0 };
  const upper = 1 - smooth((y - 0.72) / 0.06);
  const head = weight(x, y, p.head) * upper;
  const torso = weight(x, y, p.torso) * upper;
  let front = weight(x, y, p.front) * upper;
  let back = weight(x, y, p.back) * upper;
  if (p.weapon) {
    const weapon =
      p.weapon.side === 'left'
        ? 1 - smooth((x - p.weapon.edge) / 0.04)
        : smooth((x - p.weapon.edge) / 0.04);
    if (p.weapon.side === 'left') front = Math.max(front, weapon * upper);
    else back = Math.max(back, weapon * upper);
  }
  // Normalize overlapping weights so maximum displacement never exceeds 0.65 local px.
  const total = Math.max(1, head + torso + front + back);
  return {
    x: (front * 0.2 * inhale(phase - 0.18) - back * 0.15 * inhale(phase - 0.14)) / total,
    y:
      (-head * 0.65 * inhale(phase - 0.1) -
        torso * 0.2 * inhale(phase) +
        front * 0.45 * inhale(phase - 0.18) +
        back * 0.35 * inhale(phase - 0.14)) /
      total,
  };
}
