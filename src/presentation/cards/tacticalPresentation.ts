import type { Pos, Unit } from '../../game';
/** Derived display state only; no targeting or summon policy calls. */
export const markedPrey = (unit: Pick<Unit, 'hp' | 'statuses'>): boolean =>
  unit.hp > 0 && unit.statuses.some((s) => s.id === 'MARKED_PREY');
export function bondCompanion(
  units: readonly Unit[],
  casterId: string,
  target: Pos,
): Unit | undefined {
  const caster = units.find((u) => u.id === casterId);
  return (
    caster &&
    units.find(
      (u) =>
        u.kind === 'SUMMON' &&
        u.summon?.ownerId === casterId &&
        u.faction === caster.faction &&
        u.hp > 0 &&
        Math.abs(u.pos.x - target.x) + Math.abs(u.pos.y - target.y) === 1,
    )
  );
}
export function attackingMarkedPrey(
  units: readonly Unit[],
  summonId: string,
  targetId: string,
): boolean {
  const summon = units.find((u) => u.id === summonId),
    target = units.find((u) => u.id === targetId);
  return (
    !!summon &&
    !!target &&
    markedPrey(target) &&
    target.statuses.some((s) => s.id === 'MARKED_PREY' && s.sourceId === summon.summon?.ownerId)
  );
}
