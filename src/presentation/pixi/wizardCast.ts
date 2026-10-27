export type DirectionalCastView = 'front3q' | 'side' | 'back3q' | 'back';
export interface CastPose {
  anticipation: number;
  release: number;
}
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Same wind-up as the spell cue; release hold and recovery fit the existing 195 ms tail. */
export function wizardCastPose(elapsed: number, releaseMs: number, reduced = false): CastPose {
  if (reduced)
    return { anticipation: 0, release: elapsed >= releaseMs && elapsed < releaseMs + 100 ? 1 : 0 };
  if (elapsed < releaseMs) {
    const progress = elapsed / Math.max(1, releaseMs);
    const release = smooth((progress - 0.5) / 0.5);
    return { anticipation: smooth(progress / 0.5) * (1 - release), release };
  }
  return { anticipation: 0, release: 1 - smooth((elapsed - releaseMs - 45) / 135) };
}

const PROFILES: Record<
  DirectionalCastView,
  { hand: [number, number]; staff: number; forward: number }
> = {
  front3q: { hand: [0.4, 0.36], staff: 0.7, forward: 0.7 },
  side: { hand: [0.48, 0.38], staff: 0.64, forward: 1 },
  back3q: { hand: [0.74, 0.35], staff: 0.33, forward: 0.7 },
  back: { hand: [0.68, 0.38], staff: 0.29, forward: 0 },
};
const region = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  1 - smooth(Math.hypot((x - cx) / rx, (y - cy) / ry));

/** Local world units on the existing mesh; no whole-sprite scale/rotation or foot movement. */
export function wizardCastDisplacement(
  view: DirectionalCastView,
  x: number,
  y: number,
  pose: CastPose,
): { x: number; y: number } {
  const p = PROFILES[view];
  const upper = 1 - smooth((y - 0.72) / 0.07);
  const hand = region(x, y, p.hand[0], p.hand[1], 0.17, 0.2) * upper;
  const torso = region(x, y, 0.52, 0.44, 0.2, 0.24) * upper;
  const staff = (1 - smooth(Math.abs(x - p.staff) / 0.065)) * upper;
  const lift = pose.release * 10 + pose.anticipation * 3;
  const reach = pose.release * 7 - pose.anticipation * 3;
  // Staff tilts about its lower end; arm movement fades through the shoulder attachment.
  const staffTilt = Math.max(0, 0.85 - y) * 5 * pose.release;
  return {
    x:
      hand * reach * p.forward +
      torso * pose.release * p.forward * 1.2 +
      staff * staffTilt * p.forward,
    y: -hand * lift - torso * pose.release * 0.7 - staff * pose.release * 2,
  };
}

/** Normalized hand position in the reused full-body paintings / original release frame. */
export function wizardCastHand(view: DirectionalCastView | 'front'): { x: number; y: number } {
  if (view === 'front') return { x: 0.835, y: 0.365 };
  const [x, y] = PROFILES[view].hand;
  return { x, y };
}
