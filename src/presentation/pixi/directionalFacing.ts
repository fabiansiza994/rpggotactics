import type { Pos } from '../../game';
export const FACING_SECTORS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;
export type DirectionalFacing = (typeof FACING_SECTORS)[number];
export type CardinalView = 'front' | 'back' | 'left' | 'right';
export const FACING_TOLERANCE = (8 * Math.PI) / 180;
export interface FacingTargets {
  attack?: Pos | null;
  preview?: Pos | null;
  pointer?: Pos | null;
  inside: boolean;
}
export function resolvedFacingTarget(targets: FacingTargets): Pos | null {
  return targets.attack ?? targets.preview ?? (targets.inside ? targets.pointer : null) ?? null;
}
/** Grid intent, not screen x: moving toward -y always selects the back. */
export function directionalFacing(
  origin: Pos,
  target: Pos | null,
  current: DirectionalFacing,
  locked = false,
): DirectionalFacing {
  if (!target || (target.x === origin.x && target.y === origin.y)) return current;
  const angle = Math.atan2(target.y - origin.y, target.x - origin.x),
    center = (FACING_SECTORS.indexOf(current) * Math.PI) / 4;
  const distance = Math.abs(Math.atan2(Math.sin(angle - center), Math.cos(angle - center)));
  if (!locked && distance <= Math.PI / 8 + FACING_TOLERANCE) return current;
  return FACING_SECTORS[(Math.round(angle / (Math.PI / 4)) + 8) % 8]!;
}
/** Independently authored sides; diagonals never turn a northbound actor toward the camera. */
export function cardinalView(facing: DirectionalFacing): CardinalView {
  return facing === 'N' || facing === 'NE' || facing === 'NW'
    ? 'back'
    : facing === 'S' || facing === 'SE' || facing === 'SW'
      ? 'front'
      : facing === 'W'
        ? 'left'
        : 'right';
}
/** Legacy Mage artwork resolver retained exactly, including its deliberate mirroring. */
export function mageView(facing: DirectionalFacing): { view: string; mirror: boolean } {
  const views = {
    N: 'back',
    NE: 'back3q',
    E: 'side',
    SE: 'front3q',
    S: 'front',
    SW: 'front3q',
    W: 'side',
    NW: 'back3q',
  };
  return { view: views[facing], mirror: facing === 'W' || facing === 'SW' || facing === 'NW' };
}
