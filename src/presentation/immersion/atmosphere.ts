import type { GameState } from "../../game";
import { healthMood, healthSeverity } from "./combatImmersion";
import type { ImmersionSettings } from "./settings";
export type AtmosphereView = {
  hp: number;
  max: number;
  finished: boolean;
  rooted: boolean;
  terrain: "none" | "ice" | "fire";
};
export const EMPTY_ATMOSPHERE: AtmosphereView = {
  hp: 0,
  max: 0,
  finished: true,
  rooted: false,
  terrain: "none",
};
/** Exact local hero and row-major authoritative tile; no proximity, artwork or BURNING inference. */
export function atmosphereView(
  state: Readonly<GameState>,
  heroId: string,
): AtmosphereView {
  const hero = state.units.find((u) => u.id === heroId);
  if (!hero || hero.hp <= 0 || state.outcome) return { ...EMPTY_ATMOSPHERE };
  const p = hero.pos,
    b = state.board;
  const tile =
    p.x >= 0 && p.y >= 0 && p.x < b.width && p.y < b.height
      ? b.tiles[p.y * b.width + p.x]
      : undefined;
  return {
    hp: hero.hp,
    max: hero.maxHp,
    finished: false,
    rooted: hero.statuses.some((s) => s.id === "ROOTED" && s.turnsLeft > 0),
    terrain:
      tile?.terrain === "FIRE"
        ? "fire"
        : tile?.terrain === "ICE"
          ? "ice"
          : "none",
  };
}
export const MAX_ENVIRONMENT_OPACITY = 0.82;
/** Priority: health warning, restraint silhouette, then terrain. All retain a share of the edge budget. */
export function composeAtmosphere(
  view: AtmosphereView,
  settings: ImmersionSettings,
) {
  const active = settings.visuals && !view.finished;
  const mood = active ? healthMood(view.hp, view.max) : "normal";
  const health =
    mood === "normal"
      ? 0
      : mood === "alert"
        ? 0.12
        : 0.44 + healthSeverity(view.hp, view.max) * 0.28;
  const roots = active && view.rooted ? 0.72 : 0,
    terrain = active && view.terrain !== "none" ? 0.58 : 0;
  // Bound the actual over-composited alpha, not the sum: sparse corner materials
  // should remain recognizable together without making their overlap too opaque.
  const over = (scale: number) =>
    1 - (1 - health * scale) * (1 - roots * scale) * (1 - terrain * scale);
  let low = 0,
    high = 1;
  if (over(1) > MAX_ENVIRONMENT_OPACITY) {
    for (let n = 0; n < 18; n++) {
      const mid = (low + high) / 2;
      if (over(mid) <= MAX_ENVIRONMENT_OPACITY) low = mid;
      else high = mid;
    }
  } else low = 1;
  const scale = low * (settings.subtle ? 0.45 : 1);
  return {
    mood,
    rooted: active && view.rooted,
    terrain: active ? view.terrain : "none",
    healthOpacity: health * scale,
    rootOpacity: roots * scale,
    terrainOpacity: terrain * scale,
  };
}
