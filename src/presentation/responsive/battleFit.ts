export interface ArenaBounds { left: number; right: number; top: number; bottom: number }

/** Fit only the world-space arena, never DOM HUD/text or logical cells. */
export function fitBattlefield(width: number, height: number, bounds: ArenaBounds, padding = 20) {
  const inset = Math.min(padding, Math.max(0, width) * 0.02, Math.max(0, height) * 0.08);
  const scale = Math.max(0, Math.min(
    Math.max(0, width - inset * 2) / (bounds.right - bounds.left),
    Math.max(0, height - inset) / (bounds.bottom - bounds.top),
    2.4,
  ));
  return { scale, x: width / 2,
    y: inset / 2 + (height - inset - (bounds.bottom - bounds.top) * scale) / 2 - bounds.top * scale };
}
