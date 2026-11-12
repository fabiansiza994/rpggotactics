import type { Pos } from '../../game';
import type { FxGeometry } from './ElementEffects';

export const PULSE_TIMING = { cast: 280, travel: 300, aftermath: 360, read: 160 } as const;
/** Only the confirmed footprint is used; perspective comes from the current board projection. */
export function pulseFootprint(from: Pos, affected: readonly Pos[], geometry: FxGeometry) {
  const center = geometry.center(from), footprint = geometry.footprint(from);
  const tiles = [...new Map(affected.map(tile => [`${tile.x}:${tile.y}`, tile])).values()];
  return {
    center, tiles,
    rx: Math.max(footprint.w * 0.5, ...tiles.map(tile => Math.abs(geometry.center(tile).x - center.x))),
    ry: Math.max(footprint.h * 0.5, ...tiles.map(tile => Math.abs(geometry.center(tile).y - center.y))),
  };
}

