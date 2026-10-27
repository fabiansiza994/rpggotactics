import type { Pos } from '../core/position';
import type { TerrainType } from '../terrain/terrain';

export interface Tile {
  terrain: TerrainType;
  /** Terrain the tile reverts to when temporary terrain expires. */
  baseTerrain: TerrainType;
  /** Rounds left for temporary terrain. `null` = permanent. */
  terrainTurnsLeft: number | null;
}

export interface Board {
  width: number;
  height: number;
  /** Row-major: index = y * width + x. */
  tiles: Tile[];
}

export function createBoard(width: number, height: number): Board {
  const tiles: Tile[] = [];
  for (let i = 0; i < width * height; i++) {
    tiles.push({ terrain: 'NORMAL', baseTerrain: 'NORMAL', terrainTurnsLeft: null });
  }
  return { width, height, tiles };
}

export const inBounds = (board: Board, p: Pos): boolean =>
  p.x >= 0 && p.y >= 0 && p.x < board.width && p.y < board.height;

export function tileAt(board: Board, p: Pos): Tile | undefined {
  if (!inBounds(board, p)) return undefined;
  return board.tiles[p.y * board.width + p.x];
}

/** Playable ground; VOID remains in logical coordinates for projectile traversal. */
export const isPlayable = (board: Board, p: Pos): boolean =>
  !!tileAt(board, p) && tileAt(board, p)?.terrain !== 'VOID';

export function allPositions(board: Board): Pos[] {
  const out: Pos[] = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) out.push({ x, y });
  }
  return out;
}
