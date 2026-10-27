import type { Pos } from '../../game';

/**
 * Single source of truth for battlefield geometry (presentation only).
 *
 *   logical cell (x, y)  →  GridProjection  →  world point  →  world container  →  screen
 *
 * The encounter-sized logical board is mapped onto a symmetric trapezoid with a true 2D homography, i.e. a
 * pinhole camera looking down at the board from an elevated 3/4 position. Straight grid lines stay
 * straight, back rows are narrower *and* shallower than front rows, and the mapping is exactly
 * invertible, so picking uses the same math as drawing.
 *
 * World units: the average tile width is `tile` (96). Origin: centre of the board's back edge.
 * The Core never sees any of these numbers.
 */
export interface Point {
  x: number;
  y: number;
}

export interface ProjectionConfig {
  cols: number;
  rows: number;
  /** Average projected tile width in world units. */
  tile: number;
  /** Front-row width ÷ back-row width. 1 = orthographic. */
  perspective: number;
  /** Board depth ÷ board average width, per tile (vertical compression of the ground plane). */
  depth: number;
  /** Presentation-only camera shear; zero preserves the standard board camera. */
  oblique?: number;
}

/** Tuned against reference/gameplay_concept.png (front/back width ≈ 1.18, depth ≈ 0.66). */
export const DESKTOP_PROJECTION = { perspective: 1.18, depth: 0.66 } as const;
/** Narrow/portrait viewports keep the perspective but soften it to keep back rows clickable. */
export const COMPACT_PROJECTION = { perspective: 1.1, depth: 0.74 } as const;

export function projectionPreset(width: number, height: number) {
  return width < 900 || height > width ? COMPACT_PROJECTION : DESKTOP_PROJECTION;
}

/** Depth scale is attenuated: the perspective is reinforced, never a mechanical size change. */
const DEPTH_SCALE_STRENGTH = 0.5;

export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

export class GridProjection {
  readonly cols: number;
  readonly rows: number;
  readonly tile: number;
  readonly perspective: number;
  readonly depthRatio: number;
  readonly oblique: number;
  readonly backWidth: number;
  readonly frontWidth: number;
  readonly height: number;
  // Forward homography (unit square → trapezoid) and its inverse, row-major 3×3.
  private readonly m: readonly number[];
  private readonly inv: readonly number[];
  // Static geometry, computed once per projection (viewport / board / config change).
  private readonly polygons: Point[][] = [];
  private readonly centers: Point[] = [];

  constructor(config: ProjectionConfig) {
    this.cols = config.cols;
    this.rows = config.rows;
    this.tile = config.tile;
    this.perspective = config.perspective;
    this.depthRatio = config.depth;
    this.oblique = config.oblique ?? 0;
    const average = config.cols * config.tile;
    this.backWidth = (2 * average) / (1 + config.perspective);
    this.frontWidth = this.backWidth * config.perspective;
    this.height = config.rows * config.tile * config.depth;
    const shift = (this.oblique * this.height) / 2;
    const [x0, y0] = [-this.backWidth / 2 - shift, 0];
    const [x1, y1] = [this.backWidth / 2 - shift, 0];
    const [x2, y2] = [this.frontWidth / 2 + shift, this.height];
    const [x3, y3] = [-this.frontWidth / 2 + shift, this.height];
    // Heckbert square→quad; corners are (0,0) (1,0) (1,1) (0,1).
    const dx1 = x1 - x2,
      dx2 = x3 - x2,
      dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2,
      dy2 = y3 - y2,
      dy3 = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1;
    const g = (dx3 * dy2 - dx2 * dy3) / den;
    const h = (dx1 * dy3 - dx3 * dy1) / den;
    const a = x1 - x0 + g * x1,
      b = x3 - x0 + h * x3,
      c = x0,
      d = y1 - y0 + g * y1,
      e = y3 - y0 + h * y3,
      f = y0;
    this.m = [a, b, c, d, e, f, g, h, 1];
    // Adjugate / determinant (last element is 1).
    const A = e - f * h,
      B = -(d - f * g),
      C = d * h - e * g;
    const det = a * A + b * B + c * C;
    this.inv = [
      A / det,
      -(b - c * h) / det,
      (b * f - c * e) / det,
      B / det,
      (a - c * g) / det,
      -(a * f - c * d) / det,
      C / det,
      -(a * h - b * g) / det,
      (a * e - b * d) / det,
    ];
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++) {
        this.polygons.push([
          this.project(x, y),
          this.project(x + 1, y),
          this.project(x + 1, y + 1),
          this.project(x, y + 1),
        ]);
        this.centers.push(this.project(x + 0.5, y + 0.5));
      }
  }

  /** Continuous logical coordinates (cell units, may lie outside the board) → world point. */
  project(u: number, v: number): Point {
    const s = u / this.cols,
      t = v / this.rows,
      m = this.m;
    const w = m[6]! * s + m[7]! * t + m[8]!;
    return { x: (m[0]! * s + m[1]! * t + m[2]!) / w, y: (m[3]! * s + m[4]! * t + m[5]!) / w };
  }

  /** World point → continuous logical coordinates (no bounds check). */
  unproject(p: Point): { u: number; v: number } {
    const n = this.inv;
    const w = n[6]! * p.x + n[7]! * p.y + n[8]!;
    return {
      u: ((n[0]! * p.x + n[1]! * p.y + n[2]!) / w) * this.cols,
      v: ((n[3]! * p.x + n[4]! * p.y + n[5]!) / w) * this.rows,
    };
  }

  contains(cell: Pos): boolean {
    return cell.x >= 0 && cell.y >= 0 && cell.x < this.cols && cell.y < this.rows;
  }

  /** Perspective-correct centre of the projected tile surface. */
  getTileCenter(cell: Pos): Point {
    const c =
      Number.isInteger(cell.x) && Number.isInteger(cell.y) && this.contains(cell)
        ? this.centers[cell.y * this.cols + cell.x]
        : undefined;
    return c ? { ...c } : this.project(cell.x + 0.5, cell.y + 0.5);
  }

  gridToScreen(cell: Pos): Point {
    return this.getTileCenter(cell);
  }

  /** Ground contact of anything standing on the cell: characters' feet, obstacle bases. */
  getUnitAnchor(cell: Pos): Point {
    return this.getTileCenter(cell);
  }

  /** TL, TR, BR, BL of the projected tile. */
  getTilePolygon(cell: Pos): readonly Point[] {
    return (
      (Number.isInteger(cell.x) && Number.isInteger(cell.y) && this.contains(cell)
        ? this.polygons[cell.y * this.cols + cell.x]
        : undefined) ?? [
        this.project(cell.x, cell.y),
        this.project(cell.x + 1, cell.y),
        this.project(cell.x + 1, cell.y + 1),
        this.project(cell.x, cell.y + 1),
      ]
    );
  }

  /** Tile polygon shrunk inside the surface by a fraction of a cell (overlay rims). */
  getInsetPolygon(cell: Pos, inset: number): Point[] {
    const { x, y } = cell;
    return [
      this.project(x + inset, y + inset),
      this.project(x + 1 - inset, y + inset),
      this.project(x + 1 - inset, y + 1 - inset),
      this.project(x + inset, y + 1 - inset),
    ];
  }

  /** Exact picking: inverse homography, confirmed (and corrected on edges) by point-in-polygon. */
  screenToGrid(p: Point): Pos | null {
    const { u, v } = this.unproject(p);
    if (!(u >= 0 && v >= 0 && u < this.cols && v < this.rows)) return null;
    const cx = Math.floor(u),
      cy = Math.floor(v);
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const cell = { x: cx + dx, y: cy + dy };
      if (this.contains(cell) && pointInPolygon(p, this.getTilePolygon(cell))) return cell;
    }
    return this.contains({ x: cx, y: cy }) ? { x: cx, y: cy } : null;
  }

  /**
   * Touch-tolerant picking: exact tile when inside, else the nearest edge tile if the point is
   * within `tolerance` cells of the board (a fingertip just past the outer edge still counts).
   */
  screenToGridNear(p: Point, tolerance: number): Pos | null {
    const exact = this.screenToGrid(p);
    if (exact) return exact;
    const { u, v } = this.unproject(p);
    if (!(
      u >= -tolerance &&
      v >= -tolerance &&
      u < this.cols + tolerance &&
      v < this.rows + tolerance
    ))
      return null;
    return {
      x: Math.max(0, Math.min(this.cols - 1, Math.floor(u))),
      y: Math.max(0, Math.min(this.rows - 1, Math.floor(v))),
    };
  }

  /** Projected width of one tile at world y (linear on a symmetric trapezoid). */
  tileWidthAtY(y: number): number {
    const t = Math.max(-0.5, Math.min(1.5, y / this.height));
    return (this.backWidth + (this.frontWidth - this.backWidth) * t) / this.cols;
  }

  /** Local projected size of a cell (width at its centre, depth of its row). */
  footprint(cell: Pos): { w: number; h: number } {
    const poly = this.getTilePolygon(cell);
    return { w: this.tileWidthAtY(this.getTileCenter(cell).y), h: poly[3]!.y - poly[0]!.y };
  }

  /** Subtle per-row size reinforcement for actors standing at world y (≈ ±4 %). */
  scaleAtY(y: number): number {
    return 1 + (this.tileWidthAtY(y) / this.tile - 1) * DEPTH_SCALE_STRENGTH;
  }

  getProjectedScale(row: number): number {
    return this.scaleAtY(this.project(this.cols / 2, row + 0.5).y);
  }

  /** Draw order for actors: further down the screen = closer to the camera = drawn later. */
  getDepth(cell: Pos): number {
    return this.depthAtPoint(this.getUnitAnchor(cell));
  }

  depthAtPoint(p: Point): number {
    return p.y + p.x * 1e-4;
  }

  /** Outer rectangle of the playable surface in world units. */
  get surfaceBounds(): { left: number; right: number; top: number; bottom: number } {
    return {
      left: -this.frontWidth / 2 - (Math.abs(this.oblique) * this.height) / 2,
      right: this.frontWidth / 2 + (Math.abs(this.oblique) * this.height) / 2,
      top: 0,
      bottom: this.height,
    };
  }
}
