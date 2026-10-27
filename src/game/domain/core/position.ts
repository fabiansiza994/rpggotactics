/** Logical grid coordinate. (0,0) is the top-left tile; x grows right, y grows down. */
export interface Pos {
  readonly x: number;
  readonly y: number;
}

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export const DIRECTIONS: readonly Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

export const DIRECTION_VECTORS: Readonly<Record<Direction, Pos>> = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

export const pos = (x: number, y: number): Pos => ({ x, y });

export const posKey = (p: Pos): string => `${p.x},${p.y}`;

export const samePos = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y;

export const addPos = (a: Pos, b: Pos, times = 1): Pos => ({
  x: a.x + b.x * times,
  y: a.y + b.y * times,
});

export const step = (p: Pos, dir: Direction, times = 1): Pos =>
  addPos(p, DIRECTION_VECTORS[dir], times);

export const manhattan = (a: Pos, b: Pos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export const chebyshev = (a: Pos, b: Pos): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Direction from `from` to `to` only when they share a row or column (and differ). */
export function alignedDirection(from: Pos, to: Pos): Direction | null {
  if (samePos(from, to)) return null;
  if (from.x === to.x) return to.y < from.y ? 'UP' : 'DOWN';
  if (from.y === to.y) return to.x < from.x ? 'LEFT' : 'RIGHT';
  return null;
}

/** Dominant orthogonal direction from `from` to `to`. Ties favour the horizontal axis. */
export function dominantDirection(from: Pos, to: Pos): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'LEFT' : 'RIGHT';
  return dy < 0 ? 'UP' : 'DOWN';
}

export const isHorizontal = (dir: Direction): boolean => dir === 'LEFT' || dir === 'RIGHT';

/** Stable ordering used everywhere a deterministic tie-break between tiles is needed. */
export const comparePos = (a: Pos, b: Pos): number => a.y - b.y || a.x - b.x;
