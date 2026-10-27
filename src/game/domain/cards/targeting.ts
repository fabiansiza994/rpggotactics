import { summonCanActNow } from '../summons/summons';
import { allPositions, inBounds, isPlayable, type Board } from '../board/board';
import { hasLineOfSight } from '../board/line-of-sight';
import {
  areHostile,
  blocksLineOfSightAt,
  canEnter,
  isEmptyTile,
  isMovementPrevented,
  terrainDefAt,
  unitAt,
} from '../board/occupancy';
import type { RuleContext } from '../context';
import {
  alignedDirection,
  chebyshev,
  comparePos,
  DIRECTIONS,
  dominantDirection,
  isHorizontal,
  manhattan,
  posKey,
  samePos,
  step,
  type Direction,
  type Pos,
} from '../core/position';
import type { Unit } from '../entities/unit';
import type { AreaDef, TargetingDef, TileFilter, UnitFilter } from './card';
import { isPreyOf, nearestHostileDistance } from '../combat/archery';

/**
 * Result of interpreting a targeting definition for a concrete selection. Used identically
 * for validation, preview (UI) and resolution (effects), so what the player sees is exactly
 * what resolves.
 */
export interface ResolvedTarget {
  /** Tile the player selected (null for SELF). */
  target: Pos | null;
  /** Anchor tile: end of a LINE, the chosen tile, or the caster tile for SELF. */
  impact: Pos;
  direction: Direction | null;
  affectedTiles: Pos[];
  /** LINE only: first unit the projectile hit (the second one for a focus pierce). */
  hitUnitId: string | null;
  /** LINE `focusPierce` chosen (the target is the unit behind the first): Concentración it spends. */
  focusSpent?: number;
  /** `pairSwap` only: tile of the unit that swaps with the target (the caster's tile, or a second summon's). */
  swapPartner?: Pos;
}

export function matchesUnitFilter(caster: Unit, unit: Unit, filter: UnitFilter): boolean {
  if (filter === 'ANY') return true;
  if (filter === 'SUMMON') return unit.kind === 'SUMMON' && unit.summon?.ownerId === caster.id;
  const hostile = areHostile(caster, unit);
  return filter === 'ENEMY' ? hostile : !hostile;
}

function matchesTileFilter(ctx: RuleContext, p: Pos, filter: TileFilter): boolean {
  switch (filter) {
    case 'ANY':
      return true;
    case 'EMPTY':
      return isEmptyTile(ctx, p);
    case 'NOT_BLOCKED':
      return terrainDefAt(ctx, p)?.type !== 'BLOCKED';
  }
}

/** Tiles of an area shape centred on `center`. `origin` orients directional shapes (WALL). */
export function areaTiles(
  board: Board,
  area: AreaDef | undefined,
  center: Pos,
  origin: Pos,
): Pos[] {
  const out: Pos[] = [];
  const shape = area ?? { shape: 'SINGLE' as const };
  switch (shape.shape) {
    case 'SINGLE':
      out.push(center);
      break;
    case 'CROSS':
      if (shape.includeCenter !== false) out.push(center);
      for (const dir of DIRECTIONS) {
        for (let i = 1; i <= shape.radius; i++) out.push(step(center, dir, i));
      }
      break;
    case 'SQUARE':
      for (let dy = -shape.radius; dy <= shape.radius; dy++) {
        for (let dx = -shape.radius; dx <= shape.radius; dx++) {
          const p = { x: center.x + dx, y: center.y + dy };
          if (samePos(p, center) && shape.includeCenter === false) continue;
          if (chebyshev(p, center) <= shape.radius) out.push(p);
        }
      }
      break;
    case 'WALL': {
      const axis = dominantDirection(origin, center) ?? 'UP';
      const [a, b]: [Direction, Direction] = isHorizontal(axis)
        ? ['UP', 'DOWN']
        : ['LEFT', 'RIGHT'];
      out.push(center);
      for (let i = 1; i <= shape.radius; i++) out.push(step(center, a, i), step(center, b, i));
      break;
    }
    case 'BLOCK':
      for (let dy = 0; dy < shape.size; dy++)
        for (let dx = 0; dx < shape.size; dx++) out.push({ x: center.x + dx, y: center.y + dy });
      break;
  }
  return out.filter((p) => isPlayable(board, p)).sort(comparePos);
}

/** Projectile trace: stops before LoS blockers, and at the first unit unless piercing. */
export function traceLine(
  ctx: RuleContext,
  from: Pos,
  dir: Direction,
  range: number,
  pierce: boolean,
): { tiles: Pos[]; hitUnit: Unit | null } {
  const tiles: Pos[] = [];
  for (let i = 1; i <= range; i++) {
    const p = step(from, dir, i);
    if (!inBounds(ctx.state.board, p) || blocksLineOfSightAt(ctx, p)) break;
    tiles.push(p);
    const unit = unitAt(ctx.state, p);
    if (unit && !pierce) return { tiles, hitUnit: unit };
  }
  return { tiles, hitUnit: null };
}

/**
 * Focus pierce (LINE `focusPierce`): the shot goes through the first unit and stops at the second
 * one, which must be hostile to the caster. Null when there is no such pair in that direction.
 */
export function piercePair(
  ctx: RuleContext,
  caster: Unit,
  dir: Direction,
  range: number,
): { tiles: Pos[]; first: Unit; second: Unit } | null {
  const tiles: Pos[] = [];
  let first: Unit | null = null;
  for (let i = 1; i <= range; i++) {
    const p = step(caster.pos, dir, i);
    if (!inBounds(ctx.state.board, p) || blocksLineOfSightAt(ctx, p)) return null;
    tiles.push(p);
    const unit = unitAt(ctx.state, p);
    if (!unit) continue;
    if (!first) first = unit;
    else return areHostile(caster, unit) ? { tiles, first, second: unit } : null;
  }
  return null;
}

const canFocusPierce = (caster: Unit, targeting: Extract<TargetingDef, { type: 'LINE' }>): boolean =>
  !!targeting.focusPierce && (caster.focus?.value ?? 0) >= targeting.focusPierce;

/**
 * Charge lane from the caster to an aligned enemy: every tile in between must be enterable
 * (walkable terrain, no obstacle, no unit). Returns the tiles walked, ending next to the
 * target, or null when the charge is impossible.
 */
export function chargeLane(ctx: RuleContext, caster: Unit, target: Pos, range: number, minRange: number): Pos[] | null {
  const dir = alignedDirection(caster.pos, target);
  const distance = manhattan(caster.pos, target);
  if (!dir || distance < Math.max(2, minRange) || distance > range) return null;
  const lane: Pos[] = [];
  for (let i = 1; i < distance; i++) {
    const p = step(caster.pos, dir, i);
    if (!canEnter(ctx, p)) return null;
    lane.push(p);
  }
  return lane;
}

function inRange(caster: Unit, p: Pos, range: number, minRange = 0): boolean {
  const d = manhattan(caster.pos, p);
  return d >= minRange && d <= range;
}

/** Tiles the caster could walk into within `range` steps (STEP targeting), sorted. */
export function stepTiles(ctx: RuleContext, caster: Unit, range: number): Pos[] {
  if (isMovementPrevented(ctx, caster)) return [];
  const seen = new Map<string, Pos>([[posKey(caster.pos), caster.pos]]);
  let frontier = [caster.pos];
  for (let i = 0; i < range; i++) {
    const next: Pos[] = [];
    for (const from of frontier)
      for (const dir of DIRECTIONS) {
        const p = step(from, dir);
        if (seen.has(posKey(p)) || !canEnter(ctx, p, caster.id)) continue;
        seen.set(posKey(p), p);
        next.push(p);
      }
    frontier = next;
  }
  seen.delete(posKey(caster.pos));
  return [...seen.values()].sort(comparePos);
}

/** STEP `away`: only tiles strictly farther from the nearest hostile than the caster is now. */
function retreatTiles(ctx: RuleContext, caster: Unit, range: number): Pos[] {
  const now = nearestHostileDistance(ctx.state, caster);
  const tiles = stepTiles(ctx, caster, range);
  return now === Number.POSITIVE_INFINITY ? tiles : tiles.filter((p) => nearestHostileDistance(ctx.state, caster, p) > now);
}

/**
 * Leap anchor of a landing tile: the hostile non-structure unit next to `tile` that justifies the
 * leap (distance `minRange`..`maxRange` from the caster, line of sight if required). Closest to
 * the caster first, then board order. Null = not a legal landing tile.
 */
export function leapAnchor(
  ctx: RuleContext,
  caster: Unit,
  rule: { minRange: number; maxRange: number; requiresLineOfSight?: boolean },
  tile: Pos,
): Unit | null {
  return (
    ctx.state.units
      .filter((u) => u.kind !== 'STRUCTURE' && areHostile(caster, u) && manhattan(u.pos, tile) === 1)
      .filter((u) => inRange(caster, u.pos, rule.maxRange, rule.minRange))
      .filter((u) => !rule.requiresLineOfSight || hasLineOfSight(ctx, caster.pos, u.pos))
      .sort((a, b) => manhattan(caster.pos, a.pos) - manhattan(caster.pos, b.pos) || comparePos(a.pos, b.pos))[0] ?? null
  );
}

type UnitTargeting = Extract<TargetingDef, { type: 'UNIT' }>;

/**
 * Pacto de la Doble Luna (`pairSwap`): the partners a chosen own summon may swap with — the caster
 * itself (`null`) and/or the tiles of other own summons in range. A ROOTED unit never moves (the
 * swap is a teleport, but rooting is the counterplay), structures are never summons.
 */
export function pairSwapPartners(ctx: RuleContext, caster: Unit, targeting: UnitTargeting, first: Unit): (Pos | null)[] {
  const rule = targeting.pairSwap;
  if (!rule || isMovementPrevented(ctx, first)) return [];
  const out: (Pos | null)[] = isMovementPrevented(ctx, caster) ? [] : [null];
  for (const u of ctx.state.units) {
    if (u === first || !matchesUnitFilter(caster, u, 'SUMMON') || isMovementPrevented(ctx, u)) continue;
    if (!inRange(caster, u.pos, rule.range) || (rule.requiresLineOfSight && !hasLineOfSight(ctx, caster.pos, u.pos))) continue;
    out.push(u.pos);
  }
  return out.sort((a, b) => (a === null ? -1 : b === null ? 1 : comparePos(a, b)));
}

/** Every tile the player may click for this targeting definition. Sorted, no duplicates. */
export function getValidTargets(ctx: RuleContext, caster: Unit, targeting: TargetingDef): Pos[] {
  const board = ctx.state.board;
  switch (targeting.type) {
    case 'SELF':
      return [caster.pos];
    case 'LINE': {
      const out = new Map<string, Pos>();
      for (const dir of DIRECTIONS) {
        for (const p of traceLine(ctx, caster.pos, dir, targeting.range, targeting.pierce).tiles) {
          if (isPlayable(board, p)) out.set(posKey(p), p);
        }
        const pair = canFocusPierce(caster, targeting) ? piercePair(ctx, caster, dir, targeting.range) : null;
        if (pair && isPlayable(board, pair.second.pos)) out.set(posKey(pair.second.pos), pair.second.pos);
      }
      return [...out.values()].sort(comparePos);
    }
    case 'UNIT':
      if (targeting.casterMustMove && isMovementPrevented(ctx, caster)) return [];
      return ctx.state.units
        .filter((u) => matchesUnitFilter(caster, u, targeting.unitFilter))
        .filter((u) => !targeting.excludeStructures || u.kind !== 'STRUCTURE')
        .filter((u) => !targeting.preyOnly || isPreyOf(u, caster.id))
        .filter((u) => !targeting.readySummon || summonCanActNow(ctx.state, u))
        .filter((u) => !targeting.pairSwap || pairSwapPartners(ctx, caster, targeting, u).length > 0)
        .map((u) => u.pos)
        .filter((p) => inRange(caster, p, targeting.range, targeting.minRange))
        .filter((p) => !targeting.requiresLineOfSight || hasLineOfSight(ctx, caster.pos, p))
        .sort(comparePos);
    case 'TILE':
      if (targeting.casterMustMove && isMovementPrevented(ctx, caster)) return [];
      return allPositions(board)
        .filter((p) => isPlayable(board, p))
        .filter((p) => inRange(caster, p, targeting.range, targeting.minRange))
        .filter((p) => matchesTileFilter(ctx, p, targeting.tileFilter))
        .filter((p) => !targeting.requiresLineOfSight || hasLineOfSight(ctx, caster.pos, p))
        .filter((p) => !targeting.leapAnchor || leapAnchor(ctx, caster, targeting.leapAnchor, p) !== null);
    case 'CHARGE':
      if (isMovementPrevented(ctx, caster)) return [];
      return ctx.state.units
        .filter((u) => areHostile(caster, u))
        .map((u) => u.pos)
        .filter((p) => chargeLane(ctx, caster, p, targeting.range, targeting.minRange))
        .sort(comparePos);
    case 'STEP':
      return targeting.away ? retreatTiles(ctx, caster, targeting.range) : stepTiles(ctx, caster, targeting.range);
    case 'CROSS':
    case 'AREA':
      return allPositions(board)
        .filter((p) => isPlayable(board, p))
        .filter((p) => inRange(caster, p, targeting.range))
        .filter((p) => !targeting.requiresLineOfSight || hasLineOfSight(ctx, caster.pos, p));
  }
}

function areaFor(targeting: TargetingDef): AreaDef | undefined {
  switch (targeting.type) {
    case 'SELF':
    case 'UNIT':
    case 'TILE':
      return targeting.area;
    case 'CROSS':
      return { shape: 'CROSS', radius: targeting.radius, includeCenter: targeting.includeCenter };
    case 'AREA':
      return { shape: 'SQUARE', radius: targeting.radius, includeCenter: targeting.includeCenter };
    case 'LINE':
    case 'CHARGE':
    case 'STEP':
      return undefined;
  }
}

/**
 * Validates `target` and computes the full affected area. Returns null when the selection is
 * illegal — an invalid target never resolves. `secondary` exists only for `pairSwap` targeting
 * (any other card given one is illegal).
 */
export function resolveTarget(
  ctx: RuleContext,
  caster: Unit,
  targeting: TargetingDef,
  target: Pos | null,
  secondary?: Pos | null,
): ResolvedTarget | null {
  const board = ctx.state.board;
  const pairSwap = targeting.type === 'UNIT' && !!targeting.pairSwap;
  if (secondary && !pairSwap) return null;

  if (targeting.type === 'SELF') {
    if (target && !samePos(target, caster.pos)) return null;
    return {
      target: null,
      impact: caster.pos,
      direction: null,
      affectedTiles: areaTiles(board, targeting.area, caster.pos, caster.pos),
      hitUnitId: null,
    };
  }

  if (!target) return null;
  const valid = getValidTargets(ctx, caster, targeting).some((p) => samePos(p, target));
  if (!valid) return null;

  if (targeting.type === 'LINE') {
    const direction = alignedDirection(caster.pos, target);
    if (!direction) return null;
    const trace = traceLine(ctx, caster.pos, direction, targeting.range, targeting.pierce);
    if (!trace.tiles.some((p) => samePos(p, target))) {
      // Only reachable as a valid target through a focus pierce: aim at the unit behind.
      const pair = canFocusPierce(caster, targeting) ? piercePair(ctx, caster, direction, targeting.range) : null;
      if (!pair || !samePos(pair.second.pos, target)) return null;
      return { target, impact: target, direction, affectedTiles: pair.tiles, hitUnitId: pair.second.id, focusSpent: targeting.focusPierce };
    }
    const impact = trace.tiles[trace.tiles.length - 1];
    if (!impact) return null;
    return {
      target,
      impact,
      direction,
      affectedTiles: trace.tiles,
      hitUnitId: trace.hitUnit?.id ?? null,
    };
  }

  if (targeting.type === 'CHARGE') {
    const lane = chargeLane(ctx, caster, target, targeting.range, targeting.minRange);
    const impact = lane?.[lane.length - 1];
    if (!impact) return null;
    return {
      target,
      impact,
      direction: alignedDirection(caster.pos, target),
      affectedTiles: [target],
      hitUnitId: unitAt(ctx.state, target)?.id ?? null,
    };
  }

  if (targeting.type === 'UNIT' && targeting.pairSwap) {
    const first = unitAt(ctx.state, target)!;
    const partner = secondary ?? null;
    if (!pairSwapPartners(ctx, caster, targeting, first).some((p) => (p === null ? partner === null : !!partner && samePos(p, partner)))) return null;
    const other = partner ?? caster.pos;
    return { target, impact: target, direction: alignedDirection(caster.pos, target), affectedTiles: [target, other].sort(comparePos), hitUnitId: first.id, swapPartner: other };
  }

  if (targeting.type === 'TILE' && targeting.leapAnchor) {
    const anchor = leapAnchor(ctx, caster, targeting.leapAnchor, target);
    if (!anchor) return null;
    return { target, impact: target, direction: alignedDirection(caster.pos, target), affectedTiles: [anchor.pos], hitUnitId: anchor.id };
  }

  return {
    target,
    impact: target,
    direction: alignedDirection(caster.pos, target),
    affectedTiles: areaTiles(board, areaFor(targeting), target, caster.pos),
    hitUnitId: null,
  };
}
