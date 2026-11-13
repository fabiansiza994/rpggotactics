import type { DrawMode } from "./drawRitual";
export const DRAW_MODE_KEY = "rpggo:draw-ritual-mode";
export function readDrawMode(): DrawMode {
  try {
    return localStorage.getItem(DRAW_MODE_KEY) === "automatic"
      ? "automatic"
      : "interactive";
  } catch {
    return "interactive";
  }
}
export function writeDrawMode(mode: DrawMode) {
  try {
    localStorage.setItem(DRAW_MODE_KEY, mode);
  } catch {
    /* device preference is optional */
  }
}
