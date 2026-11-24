import {worldFrozenCard} from './world-frozen';
import {isThunderCard} from './card-family';
import type { CardDefinition, CostDiscountScope, EffectDef } from './card';
import type { GameContent } from '../content';
import type { Unit } from '../entities/unit';
import { formNature } from '../transformations/transformations';

/** Selection is deterministic, before payment and resolution; effects never switch mid-card. */
export function effectsForCard(content: GameContent, caster: Unit, card: CardDefinition): readonly EffectDef[] {
  card=worldFrozenCard(card,caster);
  if (card.empowered && (caster.momentum?.value ?? 0) >= card.empowered.momentum)
    return card.empowered.effects;
  const byForm = caster.activeForm ? (card.formEffectsById?.[caster.activeForm] ?? card.formEffectsById?.[content.transformations?.[caster.activeForm]?.inheritsForm ?? '']) : undefined;
  if (byForm) return byForm;
  return card.formEffects?.[formNature(content, caster)] ?? card.effects;
}
/** Validate every possible transformation destination, as with existing empowered cards. */
export function allCardEffects(card: CardDefinition): readonly EffectDef[] {
  return [...card.effects, ...(card.worldFrozenUpgrade?.effects??[]), ...(card.empowered?.effects ?? []),
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
  const incarnation=caster.statuses.find(s=>content.statuses[s.id]?.thunderEconomy);
  const legendaryDiscount=incarnation && !incarnation.discountUsed && isThunderCard(card) ? 1 : 0;
  const pending = caster.costDiscounts ?? [];
  for (const scope of discountScopes(content, caster, card)) {
    const d = pending.find((x) => x.scope === scope);
    if (d) return { cost: Math.max(0, card.cost - d.amount - legendaryDiscount), discount: Math.min(card.cost, d.amount + legendaryDiscount), scope };
  }
  return { cost: Math.max(0,card.cost-legendaryDiscount), discount:Math.min(card.cost,legendaryDiscount), scope: null };
}
