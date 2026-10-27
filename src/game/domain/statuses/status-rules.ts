import { dealDamage } from '../combat/damage';
import type { RuleContext } from '../context';
import type { Unit } from '../entities/unit';
import { isSourcedStatus, type StatusId, type StatusTiming } from './status';

export function applyStatus(
  ctx: RuleContext,
  unit: Unit,
  statusId: StatusId,
  duration: number,
  sourceId: string,
  /** Sourced statuses: these units keep their instance from the same source (one multi-target effect). */
  keep?: readonly Unit[],
): void {
  if (duration <= 0 || !ctx.state.units.includes(unit)) return;
  const def = ctx.content.statuses[statusId];
  const sourced = isSourcedStatus(def);
  if (sourced)
    for (const other of ctx.state.units)
      if (other !== unit && !keep?.includes(other) && other.statuses.some((s) => s.id === statusId && s.sourceId === sourceId))
        removeStatus(ctx, other, statusId, 'CONSUMED');
  const existing = unit.statuses.find((s) => s.id === statusId);
  if (existing) {
    if (def.stacking === 'IGNORE') return;
    existing.turnsLeft =
      def.stacking === 'EXTEND'
        ? existing.turnsLeft + duration
        : Math.max(existing.turnsLeft, duration);
    // A counted trigger is re-armed by a new application (never above its charges).
    if (def.onFormChange) existing.charges = def.onFormChange.charges;
  } else {
    unit.statuses.push({ id: statusId, turnsLeft: duration, ...(def.onFormChange ? { charges: def.onFormChange.charges } : {}) });
  }
  // A unit only has hostile champions as possible markers: the latest one owns the mark.
  if (sourced) unit.statuses.find((s) => s.id === statusId)!.sourceId = sourceId;
  const turnsLeft = unit.statuses.find((s) => s.id === statusId)?.turnsLeft ?? duration;
  ctx.emit({ type: 'STATUS_APPLIED', unitId: unit.id, status: statusId, turnsLeft, sourceId });
}

export function removeStatus(
  ctx: RuleContext,
  unit: Unit,
  statusId: StatusId,
  reason: 'EXPIRED' | 'CLEANSED' | 'CONSUMED',
): void {
  const before = unit.statuses.length;
  unit.statuses = unit.statuses.filter((s) => s.id !== statusId);
  if (unit.statuses.length !== before) {
    ctx.emit({ type: 'STATUS_REMOVED', unitId: unit.id, status: statusId, reason });
  }
}

/** Removes every negative status. Returns how many were removed. */
export function cleanseUnit(ctx: RuleContext, unit: Unit): number {
  const negatives = unit.statuses.filter((s) => ctx.content.statuses[s.id].negative);
  for (const s of negatives) removeStatus(ctx, unit, s.id, 'CLEANSED');
  return negatives.length;
}

/** Fire per-turn status effects (e.g. BURNING damage) for the given timing. */
export function tickStatuses(ctx: RuleContext, unit: Unit, timing: StatusTiming): void {
  for (const instance of [...unit.statuses]) {
    const def = ctx.content.statuses[instance.id];
    if (def.tick !== timing || !def.tickDamage) continue;
    if (!ctx.state.units.includes(unit)) return;
    dealDamage(ctx, unit, def.tickDamage, `status:${def.id}`, def.tickDamageType ?? 'PHYSICAL', def.tickIgnoresArmor ? 'PIERCING' : undefined);
  }
}

/** Called at the end of the owner's turn: durations go down, expired statuses are removed. */
export function decrementStatuses(ctx: RuleContext, unit: Unit): void {
  for (const instance of [...unit.statuses]) {
    const def = ctx.content.statuses[instance.id];
    if (def.expiresAtOwnerTurnStart || def.permanent || def.summonActivationClock) continue;
    instance.turnsLeft -= 1;
    if (instance.turnsLeft <= 0) removeStatus(ctx, unit, instance.id, 'EXPIRED');
  }
}

/** Start of the owner's turn: statuses that only cover the opponent's turn (Riposte) end here. */
export function expireTurnStartStatuses(ctx: RuleContext, unit: Unit): void {
  for (const instance of [...unit.statuses])
    if (ctx.content.statuses[instance.id].expiresAtOwnerTurnStart) removeStatus(ctx, unit, instance.id, 'EXPIRED');
}
