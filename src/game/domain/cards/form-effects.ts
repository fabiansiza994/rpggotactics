import type { CardDefinition, CostDiscountScope, EffectDef } from './card';
import type { GameContent } from '../content';
import type { Unit } from '../entities/unit';
import { formNature } from '../transformations/transformations';

/** Selection is deterministic, before payment and resolution; effects never switch mid-card. */
export function effectsForCard(content: GameContent, caster: Unit, card: CardDefinition): readonly EffectDef[] {
  if (card.empowered && (caster.momentum?.value ?? 0) >= card.empowered.momentum)
    return card.empowered.effects;
  const byForm = caster.activeForm ? card.formEffectsById?.[caster.activeForm] : undefined;
  if (byForm) return byForm;
  return card.formEffects?.[formNature(content, caster)] ?? card.effects;
}
/** Validate every possible transformation destination, as with existing empowered cards. */
export function allCardEffects(card: CardDefinition): readonly EffectDef[] {
  return [...card.effects, ...(card.empowered?.effects ?? []),
    ...(card.formEffects?.HUMAN ?? []), ...(card.formEffects?.BEAST ?? []),
    ...Object.values(card.formEffectsById ?? {}).flat()];
}

/** Scope a card's resolved effects fall under for a pending discount, or null (no discount applies). */
function discountScopes(content: GameContent, caster: Unit, card: CardDefinition): CostDiscountScope[] {
  if (card.cost < 1) return [];
  const changesForm = effectsForCard(content, caster, card).some((fx) => fx.type === 'TRANSFORM' && fx.formId !== null && fx.formId !== (caster.activeForm ?? null));
  return changesForm ? ['TRANSFORM', 'SPELL'] : ['SPELL'];
}

/**
 * What playing `card` costs the caster right now: the printed cost minus the first pending
 * discount (`Unit.costDiscounts`) that matches it, never below 0. TRANSFORM is checked first so a
 * transformation does not waste a generic SPELL discount when both are pending.
 */
export function effectiveCost(content: GameContent, caster: Unit, card: CardDefinition): { cost: number; discount: number; scope: CostDiscountScope | null } {
  const pending = caster.costDiscounts ?? [];
  for (const scope of discountScopes(content, caster, card)) {
    const d = pending.find((x) => x.scope === scope);
    if (d) return { cost: Math.max(0, card.cost - d.amount), discount: Math.min(card.cost, d.amount), scope };
  }
  return { cost: card.cost, discount: 0, scope: null };
}
