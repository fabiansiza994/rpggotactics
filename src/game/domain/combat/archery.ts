import { hasLineOfSight } from '../board/line-of-sight';
import { areHostile } from '../board/occupancy';
import type { RuleContext } from '../context';
import { manhattan, type Pos } from '../core/position';
import type { GameState } from '../state';
import type { Unit } from '../entities/unit';

/**
 * Archer signature rules: Presa (one marked hostile per Archer, PREY status with `sourceId`),
 * Concentración (`Unit.focus`, 0..max, only card effects change it) and Distancia Óptima
 * (`HeroDef.focus.optimalRange`, Manhattan, inclusive). Everything is read from the authoritative
 * battle state, so replays, PvP snapshots and reconnects carry it like HP. No RNG anywhere.
 */

/** Status id of the Archer's Presa (see data/rules.ts STATUSES.PREY). */
export const PREY_STATUS = 'PREY' as const;

type Ctx = Pick<RuleContext, 'state' | 'content'>;

/** The champion's Distancia Óptima, or null for champions without Concentración. */
export function optimalRangeOf(ctx: Pick<RuleContext, 'content'>, unit: Unit): { min: number; max: number } | null {
  return ctx.content.heroes[unit.defId]?.focus?.optimalRange ?? null;
}

/** Pure distance test, so the UI can ask BEFORE acting (hover, tile previews). */
export function isOptimalDistance(range: { min: number; max: number } | null, distance: number): boolean {
  return !!range && distance >= range.min && distance <= range.max;
}

export function inOptimalRange(ctx: Pick<RuleContext, 'content'>, caster: Unit, p: Pos): boolean {
  return isOptimalDistance(optimalRangeOf(ctx, caster), manhattan(caster.pos, p));
}

export const isPreyOf = (unit: Unit, casterId: string): boolean =>
  unit.statuses.some((s) => s.id === PREY_STATUS && s.sourceId === casterId);

/** The living unit currently marked as `caster`'s Presa (at most one by the sourced-status rule). */
export function preyOf(state: Readonly<GameState>, casterId: string): Unit | undefined {
  return state.units.find((u) => isPreyOf(u, casterId));
}

export function preyInLineOfSight(ctx: Ctx, caster: Unit): boolean {
  const prey = preyOf(ctx.state, caster.id);
  return !!prey && hasLineOfSight(ctx as RuleContext, caster.pos, prey.pos);
}

export function preyInOptimalRange(ctx: Ctx, caster: Unit): boolean {
  const prey = preyOf(ctx.state, caster.id);
  return !!prey && inOptimalRange(ctx, caster, prey.pos);
}

/** Distance to the closest hostile non-structure unit (Infinity when none). */
export function nearestHostileDistance(state: Readonly<GameState>, unit: Unit, from: Pos = unit.pos): number {
  let best = Number.POSITIVE_INFINITY;
  for (const u of state.units)
    if (u !== unit && u.kind !== 'STRUCTURE' && areHostile(unit, u)) best = Math.min(best, manhattan(u.pos, from));
  return best;
}

function setFocus(ctx: RuleContext, unit: Unit, value: number, reason: 'CARD' | 'SPENT'): void {
  const f = unit.focus;
  if (!f) return;
  const to = Math.max(0, Math.min(f.max, value));
  if (to === f.value) return;
  const from = f.value;
  f.value = to;
  ctx.emit({ type: 'FOCUS_CHANGED', unitId: unit.id, from, to, max: f.max, reason });
}

/** Adds Concentración up to the cap (gains past the cap are lost). Units without focus: no-op. */
export function gainFocus(ctx: RuleContext, unit: Unit, amount: number): void {
  if (unit.focus && amount > 0) setFocus(ctx, unit, unit.focus.value + amount, 'CARD');
}

/** Spends `cost` if available. Returns false (and changes nothing) when there is not enough. */
export function spendFocus(ctx: RuleContext, unit: Unit, cost: number): boolean {
  if (!unit.focus || unit.focus.value < cost) return false;
  setFocus(ctx, unit, unit.focus.value - cost, 'SPENT');
  return true;
}
