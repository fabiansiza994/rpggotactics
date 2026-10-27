import type { GameContent } from '../content';
import type { EffectDef } from '../cards/card';
import type { GameState } from '../state';
import { summonCapacityOf, summonUsage } from './summons';

/** One living summon and the capacity points it holds. */
export interface CapacityOccupant {
  unitId: string;
  defId: string;
  name: string;
  cost: number;
}

/**
 * Read-only capacity summary for the UI (02_MVP_RULES §17.1). Derived from the state on every
 * call — `used` IS `summonUsage`, never a separate counter — so it cannot drift from the rules.
 */
export interface SummonCapacityView {
  used: number;
  /** Base + this battle's bonus (`summonCapacityOf`). */
  max: number;
  /** Part of `max` granted during this battle (Vínculo Prohibido); 0 without one. */
  bonus: number;
  free: number;
  occupants: CapacityOccupant[];
}

export function summonCapacityView(
  state: Readonly<GameState>,
  content: GameContent,
  ownerId: string,
): SummonCapacityView {
  const owner = state.units.find((u) => u.id === ownerId);
  const max = owner ? summonCapacityOf(content, owner) : 0;
  const used = summonUsage(state, ownerId);
  const occupants = state.units
    .filter((u) => u.summon?.ownerId === ownerId)
    .map((u) => ({ unitId: u.id, defId: u.defId, name: u.name, cost: u.summon!.capacityCost }));
  return { used, max, bonus: owner?.summonCapacityBonus ?? 0, free: Math.max(0, max - used), occupants };
}

/** Capacity points a card or ritual result needs (same sum `checkPlayability` validates). */
export const capacityNeeded = (content: GameContent, effects: readonly EffectDef[]): number =>
  effects.reduce(
    (n, fx) => n + (fx.type === 'SUMMON' ? (content.summons?.[fx.summonId]?.capacityCost ?? Infinity) : 0),
    0,
  );
