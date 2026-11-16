/** Presentation progress only. Never contains or computes rewards. */
export type PackPhase = "sealed" | "opening" | "reveal" | "summary";
export interface PackScene {
  phase: PackPhase;
  mask: number;
}
export const initialPackScene = (): PackScene => ({ phase: "sealed", mask: 0 });
export type PackAction =
  | { type: "OPEN"; reduced: boolean }
  | { type: "OPENED" }
  | { type: "SKIP" }
  | { type: "REVEAL"; index: number }
  | { type: "ALL" }
  | { type: "CONTINUE" };
export function advancePack(state: PackScene, action: PackAction): PackScene {
  switch (action.type) {
    case "OPEN":
      return state.phase === "sealed"
        ? { ...state, phase: action.reduced ? "reveal" : "opening" }
        : state;
    case "OPENED":
    case "SKIP":
      return state.phase === "sealed" || state.phase === "opening"
        ? { ...state, phase: "reveal" }
        : state;
    case "REVEAL":
      return state.phase === "reveal" &&
        Number.isInteger(action.index) &&
        action.index >= 0 &&
        action.index < 4
        ? { ...state, mask: state.mask | (1 << action.index) }
        : state;
    case "ALL":
      return state.phase === "reveal" ? { ...state, mask: 15 } : state;
    case "CONTINUE":
      return state.phase === "reveal" && state.mask === 15
        ? { ...state, phase: "summary" }
        : state;
  }
}
export function restorePackScene(raw: string | null): PackScene {
  try {
    const x = JSON.parse(raw ?? "null");
    if (
      x &&
      Number.isInteger(x.mask) &&
      x.mask >= 0 &&
      x.mask <= 15 &&
      ["sealed", "opening", "reveal", "summary"].includes(x.phase)
    )
      return {
        phase:
          x.phase === "opening"
            ? "reveal"
            : x.phase === "summary" && x.mask !== 15
              ? "reveal"
              : x.phase,
        mask: x.mask,
      };
  } catch {
    /* Corrupt visual progress cannot affect the receipt. */
  }
  return initialPackScene();
}
export const packSceneKey = (id: string) => `rpggo.pack-scene.v1:${id}`;
