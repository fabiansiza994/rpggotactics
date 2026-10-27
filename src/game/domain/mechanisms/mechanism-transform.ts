import { inBounds } from '../board/board';
import { isStandable } from '../board/occupancy';
import type { RuleContext } from '../context';
import { DIRECTIONS, posKey, samePos, type Direction, type Pos } from '../core/position';
import type { Unit } from '../entities/unit';
import type { GameState } from '../state';
import type { MechanismObject, MechanismStateValue, Orientation, RegionDef } from './mechanism';
import { mechanismIsSolid } from './mechanism-board';

/**
 * TRANSFORMABLE REGIONS (Act III phase 3). One carry routine for every way the board itself moves:
 *
 *   TRANSLATE — a PLATFORM slides to another stop (mechanism-platforms.ts): its riders move by a delta.
 *   ROTATE    — a REGION turns about its pivot in quarter turns (here): its whole section is permuted.
 *
 * A transform is a cell map. Everything chosen to ride is moved through it in one step; nothing is
 * walked, so no plate, trap or card trap "sees" a unit enter or leave on the way. The grid stays the
 * source of truth: the presentation animates the change from the event, never the other way round.
 *
 * SAFETY: a rotation is first applied to a clone of the state and the result is checked (every unit
 * on standable floor, one unit / one obstacle / one solid mechanism per tile, nothing off the
 * board). Any failure refuses the whole turn (SECTION_ROTATION_BLOCKED) and leaves state untouched.
 */

/** What rides a transform. Positions are mapped with `to`; `turns` rotates facings (0 for slides). */
export interface TransformPlan {
  to: (p: Pos) => Pos;
  turns: number;
  units: readonly Unit[];
  mechanisms: readonly MechanismObject[];
  /** ROTATE with static objects: the cells whose floor, obstacles, card traps, glyphs and pickups ride. */
  staticCells?: readonly Pos[];
}

const rotateDirection = (d: Direction, turns: number): Direction => DIRECTIONS[(DIRECTIONS.indexOf(d) + ((turns % 4) + 4)) % 4]!;

/**
 * Applies `plan` to `state` (no events). Ids are looked up by id, so a plan built on one state can be
 * applied to a structured clone of it (the safety dry run).
 */
export function applyTransform(state: GameState, plan: TransformPlan): void {
  const unitIds = new Set(plan.units.map((u) => u.id));
  for (const u of state.units) {
    if (!unitIds.has(u.id)) continue;
    u.pos = plan.to(u.pos);
    if (u.combatFacing && plan.turns) u.combatFacing = rotateDirection(u.combatFacing, plan.turns);
  }
  // A telegraphed charge turns with the enemy that rides; tile-targeted areas stay on the ground.
  if (plan.turns)
    for (const intent of state.intents)
      if (intent.kind === 'CHARGE' && unitIds.has(intent.enemyId)) intent.direction = rotateDirection(intent.direction, plan.turns);
  const mechanismIds = new Set(plan.mechanisms.map((m) => m.def.id));
  for (const m of state.mechanisms?.objects ?? []) if (mechanismIds.has(m.def.id)) m.pos = plan.to(m.pos);

  const cells = plan.staticCells;
  if (!cells?.length) return;
  const inside = new Set(cells.map(posKey));
  const moves = (p: Pos) => inside.has(posKey(p));
  const { board } = state;
  const before = cells.map((c) => board.tiles[c.y * board.width + c.x]!);
  cells.forEach((c, i) => {
    const d = plan.to(c);
    board.tiles[d.y * board.width + d.x] = before[i]!;
  });
  for (const o of state.obstacles) if (moves(o.pos)) o.pos = plan.to(o.pos);
  for (const t of state.traps ?? []) if (moves(t.pos)) t.pos = plan.to(t.pos);
  for (const c of state.collectibles) if (moves(c.pos)) c.pos = plan.to(c.pos);
  for (const g of state.glyphs ?? []) g.tiles = g.tiles.map((t) => (moves(t) ? plan.to(t) : t));
}

/** Why the board would be impossible after a transform (null = fine). Checks only `cells`. */
export function transformedStateError(ctx: RuleContext, cells: readonly Pos[]): string | null {
  const { state } = ctx;
  const seen = new Set<string>();
  for (const c of cells) {
    const key = posKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!inBounds(state.board, c)) return 'Saldría del tablero.';
    const units = state.units.filter((u) => samePos(u.pos, c));
    if (units.length > 1) return 'Dos unidades acabarían en la misma casilla.';
    if (state.obstacles.filter((o) => samePos(o.pos, c)).length > 1) return 'Dos muros acabarían en la misma casilla.';
    const solids = (state.mechanisms?.objects ?? []).filter((m) => m.def.kind !== 'REGION' && samePos(m.pos, c) && mechanismIsSolid(m));
    if (solids.length > 1) return 'Dos mecanismos acabarían en la misma casilla.';
    if (units.length && !isStandable(ctx, c)) return 'Una unidad acabaría dentro de un muro o sobre el vacío.';
    if (solids.length && (state.obstacles.some((o) => samePos(o.pos, c)) || !ctx.content.terrain[state.board.tiles[c.y * state.board.width + c.x]!.terrain]?.walkable))
      return 'Un mecanismo acabaría dentro de un muro o sobre el vacío.';
  }
  return null;
}

// ── ROTATE ─────────────────────────────────────────────────────────────────

export const ORIENTATIONS: readonly Orientation[] = [0, 90, 180, 270];

export const orientationState = (o: Orientation): MechanismStateValue => `ORIENTATION_${o}` as MechanismStateValue;

export function orientationOf(state: MechanismStateValue | undefined): Orientation {
  const n = Number(String(state ?? '').replace('ORIENTATION_', ''));
  return (ORIENTATIONS as readonly number[]).includes(n) ? (n as Orientation) : 0;
}

/** Cell reached by `turns` clockwise quarter turns of cell `c` about `pivot` (x right, y down). */
export function rotateCell(c: Pos, pivot: Pos, turns: number): Pos {
  let dx = c.x + 0.5 - pivot.x,
    dy = c.y + 0.5 - pivot.y;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) [dx, dy] = [-dy, dx];
  // Snap away float noise; validation guarantees the result is a whole cell of the region.
  return { x: Math.round(pivot.x + dx - 0.5), y: Math.round(pivot.y + dy - 0.5) };
}

/**
 * The cells are a permutation of themselves under `turns` quarter turns about the pivot, and every
 * cell centre lands exactly on another cell centre (a pivot off the shape's centre fails).
 */
export function regionClosedUnder(region: Pick<RegionDef, 'cells' | 'pivot'>, turns: number): boolean {
  const keys = new Set(region.cells.map(posKey));
  return region.cells.every((c) => {
    let dx = c.x + 0.5 - region.pivot.x,
      dy = c.y + 0.5 - region.pivot.y;
    for (let i = 0; i < ((turns % 4) + 4) % 4; i++) [dx, dy] = [-dy, dx];
    const x = region.pivot.x + dx - 0.5,
      y = region.pivot.y + dy - 0.5;
    return Math.abs(x - Math.round(x)) < 1e-9 && Math.abs(y - Math.round(y)) < 1e-9 && keys.has(posKey({ x: Math.round(x), y: Math.round(y) }));
  });
}

export const allowedOrientations = (region: RegionDef): readonly Orientation[] => region.allowedOrientations ?? ORIENTATIONS;

const inRegion = (region: RegionDef) => {
  const keys = new Set(region.cells.map(posKey));
  return (p: Pos) => keys.has(posKey(p));
};

/** Plan of a `turns` rotation of `o` on `state` (riders chosen by the region's flags). */
export function regionPlan(state: GameState, o: MechanismObject, turns: number): TransformPlan {
  const region = o.def.region!;
  const inside = inRegion(region);
  const q = ((turns % 4) + 4) % 4;
  return {
    to: (p) => (inside(p) ? rotateCell(p, region.pivot, q) : p),
    turns: q,
    units: region.occupantsMoveWithRegion === false ? [] : state.units.filter((u) => inside(u.pos)),
    mechanisms:
      region.mechanismsMoveWithRegion === false
        ? []
        : (state.mechanisms?.objects ?? []).filter(
            (m) => m !== o && m.def.kind !== 'REGION' && m.def.kind !== 'PLATFORM' && m.state !== 'CARRIED' && inside(m.pos),
          ),
    ...(region.staticObjectsMoveWithRegion === false ? {} : { staticCells: region.cells }),
  };
}

export type RotationResult =
  | { ok: true; from: Orientation; to: Orientation; turns: number; plan: TransformPlan }
  | { ok: false; from: Orientation; to: Orientation; turns: number; reason: string };

/** Validates turning region `o` to orientation `to` (dry run on a clone). Nothing changes. */
export function checkRotation(ctx: RuleContext, o: MechanismObject, to: Orientation): RotationResult {
  const region = o.def.region!;
  const from = orientationOf(o.state);
  const turns = (((to - from) / 90) % 4 + 4) % 4;
  const refuse = (reason: string): RotationResult => ({ ok: false, from, to, turns, reason });
  if (o.locked) return refuse('La sección está bloqueada.');
  if (!allowedOrientations(region).includes(to)) return refuse('El mecanismo no admite esa orientación.');
  if (region.blockedByOccupancy && ctx.state.units.some((u) => region.cells.some((c) => samePos(c, u.pos))))
    return refuse('La sección no gira con alguien encima.');
  const plan = regionPlan(ctx.state, o, turns);
  const dry = structuredClone(ctx.state);
  applyTransform(dry, plan);
  const error = transformedStateError({ ...ctx, state: dry, emit: () => undefined }, region.cells);
  return error ? refuse(error) : { ok: true, from, to, turns, plan };
}

/** Next allowed orientation clockwise (ADVANCE), or null when the region has a single one. */
export function nextOrientation(o: MechanismObject, direction: 1 | -1 = 1): Orientation | null {
  const allowed = allowedOrientations(o.def.region!);
  const from = orientationOf(o.state);
  for (let k = 1; k <= 4; k++) {
    const candidate = ORIENTATIONS[(ORIENTATIONS.indexOf(from) + direction * k + 8) % 4]!;
    if (candidate !== from && allowed.includes(candidate)) return candidate;
  }
  return null;
}

/** Where the section's walls, solid mechanisms, walkable floor and riders would be after `turns` (UI preview). */
export function rotationPreview(state: GameState, o: MechanismObject, turns: number): { walls: Pos[]; floor: Pos[]; units: { id: string; to: Pos }[] } {
  const plan = regionPlan(state, o, turns);
  const region = o.def.region!;
  const inside = inRegion(region);
  const moves = (p: Pos) => inside(p) && !!plan.staticCells;
  return {
    walls: [
      ...state.obstacles.filter((ob) => inside(ob.pos)).map((ob) => (moves(ob.pos) ? plan.to(ob.pos) : ob.pos)),
      ...plan.mechanisms.filter(mechanismIsSolid).map((m) => plan.to(m.pos)),
    ],
    floor: region.cells
      .filter((c) => !['BLOCKED', 'VOID'].includes(state.board.tiles[c.y * state.board.width + c.x]?.terrain ?? 'BLOCKED'))
      .map((c) => (moves(c) ? plan.to(c) : c)),
    units: plan.units.map((u) => ({ id: u.id, to: plan.to(u.pos) })),
  };
}
