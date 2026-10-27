import type { GameState, Pos } from '../../game';
export type ArchitectureSpan = {
  asset: string;
  from: Pos;
  to: Pos;
  height: number;
  foreground?: boolean;
};
export type Dressing = { asset: string; at: Pos; width: number; tint?: number; behind?: boolean };
export type TempleComposition = {
  identity: string;
  abyss: boolean;
  walls: ArchitectureSpan[];
  dressing: Dressing[];
};
/**
 * Art direction only. ACT III DIRECTION RESET (2026-10-20): the temple returns to the FLOATING
 * TACTICAL BOARD. No repeated architecture or walls surround the grid; two small perimeter braziers supply warm light;
 * the act's identity comes from the mechanisms and from a board that changes shape (rotating and
 * sliding sections). What is kept per encounter: a named identity and whether its chasm reads as
 * an abyss (cliff faces under real BLOCKED tiles). Never enters occupancy or pathfinding.
 */
const IDENTITIES: Record<string, { identity: string; abyss: boolean }> = {
  w3_e01: { identity: 'ruined-temple-entrance', abyss: false },
  w3_e02: { identity: 'broken-bridge-over-ravine', abyss: true },
  w3_e03: { identity: 'three-seal-ritual-chamber', abyss: false },
  w3_e04: { identity: 'suspended-mechanical-chamber', abyss: true },
  w3_e05: { identity: 'guardian-conduit-sanctuary', abyss: false },
  w3_e06: { identity: 'sun-moon-relic-vault', abyss: false },
  w3_e07: { identity: 'counterweight-causeway', abyss: true },
  w3_e08: { identity: 'living-labyrinth', abyss: true },
  w3_e09: { identity: 'threshold-heart', abyss: true },
  w3_e10: { identity: 'architect-sanctuary', abyss: true },
};
export function templeComposition(state: Readonly<GameState>): TempleComposition | null {
  const known = IDENTITIES[state.scenarioId];
  return known
    ? {
        ...known,
        walls: [],
        dressing: [
          { asset: 'brazier', at: { x: -0.65, y: -0.6 }, width: 0.55, behind: true },
          {
            asset: 'brazier',
            at: { x: state.board.width - 0.35, y: -0.6 },
            width: 0.55,
            behind: true,
          },
        ],
      }
    : null;
}
export type CliffEdge = { from: Pos; to: Pos };
/** Merge adjacent bank edges into long faces, including the real bridge aperture. */
export function templeCliffEdges(state: Readonly<GameState>): CliffEdge[] {
  const { width: w, height: h, tiles } = state.board;
  const bridges = new Set(
    state.mechanisms?.objects
      .filter((o) => o.def.kind === 'BRIDGE')
      .map((o) => `${o.pos.x},${o.pos.y}`),
  );
  const voidAt = (x: number, y: number) =>
    x < 0 ||
    y < 0 ||
    x >= w ||
    y >= h ||
    tiles[y * w + x]?.terrain === 'BLOCKED' ||
    tiles[y * w + x]?.terrain === 'VOID' ||
    bridges.has(`${x},${y}`);
  const edges: CliffEdge[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (!voidAt(x, y)) {
        if (voidAt(x + 1, y)) edges.push({ from: { x: x + 1, y }, to: { x: x + 1, y: y + 1 } });
        if (voidAt(x - 1, y)) edges.push({ from: { x, y }, to: { x, y: y + 1 } });
        if (voidAt(x, y + 1)) edges.push({ from: { x, y: y + 1 }, to: { x: x + 1, y: y + 1 } });
        if (voidAt(x, y - 1)) edges.push({ from: { x, y }, to: { x: x + 1, y } });
      }
  const merged: CliffEdge[] = [];
  for (const edge of edges) {
    const prior = merged.find(
      (e) =>
        e.to.x === edge.from.x &&
        e.to.y === edge.from.y &&
        (e.from.x === e.to.x) === (edge.from.x === edge.to.x),
    );
    if (prior) prior.to = edge.to;
    else merged.push({ ...edge });
  }
  return merged;
}
