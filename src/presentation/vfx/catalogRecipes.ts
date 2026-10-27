import { allCardEffects } from '../../game/domain/cards/form-effects';
export { allCardEffects } from '../../game/domain/cards/form-effects';
import type { EffectDef } from '../../game/domain/cards/card';
import type { CardDefinition, EventOfType, GameEvent } from '../../game';
import { isArrowVisual } from '../assets/archerHuntVisuals';
import { fireballPilotAllowed } from './fireballRecipe';

/** Local, non-persisted A/B switch. Never used by rules or sent to the Worker. */
export const catalogPilot = { enabled: true };
export const catalogPremiumEnabled = () => fireballPilotAllowed() && catalogPilot.enabled;
export type PremiumFamily =
  | 'physical'
  | 'force'
  | 'fire'
  | 'ice'
  | 'arcane'
  | 'defense'
  | 'heal'
  | 'movement'
  | 'summon'
  | 'transform'
  | 'tactic';
export type AtlasBank = 'bastion' | 'fireball' | 'mage-spells' | 'pact-summon' | 'wild-spirit';
export type CoverageClass = 'A' | 'B' | 'C' | 'D';
export interface CatalogRecipe {
  family: PremiumFamily;
  bank: AtlasBank;
  shape: 'contact' | 'area' | 'projectile' | 'pulse' | 'arrival' | 'transition';
  /** Charge/leap contacts are emitted only when the real damage event arrives. */
  contactOnDamage: boolean;
  tint: number;
  recall?: boolean;
  style?: 'volley' | 'ancestral';
}
export const BANK: Record<PremiumFamily, AtlasBank> = {
  physical: 'bastion',
  force: 'mage-spells',
  fire: 'fireball',
  ice: 'mage-spells',
  arcane: 'mage-spells',
  defense: 'bastion',
  heal: 'pact-summon',
  movement: 'mage-spells',
  summon: 'pact-summon',
  transform: 'wild-spirit',
  tactic: 'pact-summon',
};
const TINT: Record<PremiumFamily, number> = {
  physical: 0xffffff,
  force: 0xc6ebff,
  fire: 0xffffff,
  ice: 0xffffff,
  arcane: 0xffffff,
  defense: 0xe9dcae,
  heal: 0x94ecc1,
  movement: 0xb3e8ff,
  summon: 0xffffff,
  transform: 0x97e4d0,
  tactic: 0xc5c7f1,
};
export function elementalFamily(type: string | undefined): PremiumFamily {
  const families: Record<string, PremiumFamily> = {
    PHYSICAL: 'physical',
    FIRE: 'fire',
    ICE: 'ice',
    ARCANE: 'arcane',
    FORCE: 'force',
  };
  return type ? (families[type] ?? 'tactic') : 'tactic';
}
/** Five approved pilots are never intercepted. Existing arrow/ritual composition remains intact. */
export function usesPhysicalArrow(card: CardDefinition): boolean {
  return (
    card.heroId === 'archer' &&
    ['UNIT', 'LINE'].includes(card.targeting.type) &&
    allCardEffects(card).some((e) => e.type === 'DAMAGE')
  );
}
export function existingPresentation(card: CardDefinition): 'A' | 'C' | null {
  if (
    ['fireball', 'magic_missile', 'frost_nova', 'bastion_blow', 'summon_pact_golem'].includes(
      card.id,
    )
  )
    return 'A';
  if (isArrowVisual(card.id) || isArrowVisual(card.presentation.visualKey)) return 'C';
  if (
    [
      'forbidden_bond',
      'binder_strike',
      'binding_ward',
      'arcane_chain',
      'silence_seal',
      'alpha_instinct',
      'guard_breaker',
    ].includes(card.id)
  )
    return 'C';
  return null;
}
/** A static inventory hint, not resolution of an alternate form/empowered effect. */
export function authoredFamily(card: CardDefinition): PremiumFamily {
  const effects = allCardEffects(card),
    has = (type: EffectDef['type']) => effects.some((e) => e.type === type);
  if (has('TRANSFORM')) return 'transform';
  if (has('SUMMON')) return 'summon';
  const damage = effects.find(
    (e): e is Extract<EffectDef, { type: 'DAMAGE' }> => e.type === 'DAMAGE',
  );
  if (damage) return elementalFamily(damage.damageType);
  if (has('HEAL')) return 'heal';
  if (has('SHIELD')) return 'defense';
  if (
    effects.some((e) =>
      [
        'STEP_CASTER',
        'TELEPORT_CASTER',
        'CHARGE_CASTER',
        'GAIN_MOVE_POINTS',
        'PUSH',
        'PULL',
        'SWAP_WITH_TARGET',
        'SWAP_PAIR',
      ].includes(e.type),
    )
  )
    return 'movement';
  if (card.presentation.element === 'FIRE') return 'fire';
  if (card.presentation.element === 'ICE') return 'ice';
  return 'tactic';
}
/** Read outcomes, not text/name or a fixed list of beast forms. No authoritative state is mutated. */
export function cardRecipe(
  card: CardDefinition,
  events: readonly GameEvent[],
  casterId?: string,
): CatalogRecipe {
  const damage = events.find(
    (e): e is EventOfType<'UNIT_DAMAGED'> =>
      e.type === 'UNIT_DAMAGED' && (!casterId || e.sourceId === casterId),
  );
  const family: PremiumFamily = damage
    ? elementalFamily(damage.damageType)
    : events.some((e) => e.type === 'FORM_CHANGED')
      ? 'transform'
      : events.some((e) => e.type === 'UNIT_SPAWNED' && e.kind === 'SUMMON')
        ? 'summon'
        : events.some((e) => e.type === 'UNIT_HEALED' && e.amount > 0)
          ? 'heal'
          : events.some((e) => e.type === 'SHIELD_GAINED')
            ? 'defense'
            : events.some((e) =>
                  ['UNIT_MOVED', 'UNIT_PUSHED', 'UNIT_TELEPORTED', 'MOVE_POINTS_CHANGED'].includes(
                    e.type,
                  ),
                )
              ? 'movement'
              : events.length
                ? card.presentation.element === 'ICE'
                  ? 'ice'
                  : card.presentation.element === 'FIRE'
                    ? 'fire'
                    : 'tactic'
                : authoredFamily(card);
  const contactOnDamage =
    events.some((e) => e.type === 'UNIT_MOVED' && e.mode === 'CHARGE') ||
    (allCardEffects(card).some((e) => e.type === 'DAMAGE') &&
      events.some((e) => e.type === 'UNIT_TELEPORTED'));
  const area =
    (card.targeting.type === 'LINE' && card.targeting.pierce) ||
    ['SELF', 'AREA', 'CROSS'].includes(card.targeting.type) ||
    ('area' in card.targeting && !!card.targeting.area);
  const shape =
    family === 'summon'
      ? 'arrival'
      : family === 'transform'
        ? 'transition'
        : area
          ? ['physical', 'fire', 'ice', 'arcane', 'force'].includes(family)
            ? 'area'
            : 'pulse'
          : events.some((e) => e.type === 'PROJECTILE_LAUNCHED')
            ? 'projectile'
            : damage || ['physical', 'fire', 'ice', 'arcane', 'force'].includes(family)
              ? 'contact'
              : 'pulse';
  return {
    family,
    bank: card.id === 'arrow_rain' ? 'wild-spirit' : BANK[family],
    shape,
    contactOnDamage,
    tint: TINT[family],
    ...(card.id === 'arrow_rain'
      ? { style: 'volley' as const }
      : family === 'transform'
        ? { style: 'ancestral' as const }
        : {}),
    ...(allCardEffects(card).some((e) => e.type === 'RECALL_SUMMON') ? { recall: true } : {}),
  };
}
export function familyRecipe(
  family: PremiumFamily,
  shape: CatalogRecipe['shape'] = 'contact',
): CatalogRecipe {
  return {
    family,
    shape,
    bank: BANK[family],
    contactOnDamage: false,
    tint: TINT[family],
    ...(family === 'transform' ? { style: 'ancestral' as const } : {}),
  };
}
/** Associate each card/projectile/dash damage with its own causal batch, even when cards repeat. */
export function catalogBatch(
  events: readonly GameEvent[],
  lookup: (id: string) => CardDefinition | undefined,
): Map<GameEvent, CatalogRecipe> {
  const result = new Map<GameEvent, CatalogRecipe>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type !== 'CARD_PLAYED') continue;
    const card = lookup(e.cardId);
    if (!card || existingPresentation(card) || usesPhysicalArrow(card)) continue;
    let end = i + 1;
    while (end < events.length && !['CARD_RESOLVED', 'CARD_PLAYED'].includes(events[end]!.type))
      end++;
    const own = events.slice(i + 1, end),
      recipe = cardRecipe(card, own, e.casterId);
    result.set(e, recipe);
    for (const child of own)
      if (
        (recipe.recall && child.type === 'UNIT_DEFEATED') ||
        child.type === 'PROJECTILE_LAUNCHED' ||
        (recipe.contactOnDamage && child.type === 'UNIT_DAMAGED' && child.sourceId === e.casterId)
      )
        result.set(child, recipe);
  }
  return result;
}
/** Damage type is supplied by the actual attack/damage events, never inferred from a creature name. */
export function confirmedAttackFamily(
  events: readonly GameEvent[],
  attack: GameEvent,
): PremiumFamily {
  if (attack.type === 'ENEMY_ATTACKED') return elementalFamily(attack.damageType);
  const source =
    attack.type === 'SUMMON_ATTACKED' ||
    attack.type === 'SUMMON_BREATH' ||
    attack.type === 'COUNTER_ATTACK'
      ? attack.unitId
      : undefined;
  if (!source) return 'tactic';
  for (let i = events.indexOf(attack) + 1; i < events.length; i++) {
    const e = events[i]!;
    if (
      [
        'SUMMON_ATTACKED',
        'SUMMON_BREATH',
        'ENEMY_ACTION_STARTED',
        'COUNTER_ATTACK',
        'CARD_PLAYED',
      ].includes(e.type)
    )
      break;
    if (e.type === 'UNIT_DAMAGED' && e.sourceId === source) return elementalFamily(e.damageType);
  }
  return 'tactic'; // No confirmed elemental outcome: neutral magic-free contact signature.
}

/** On-demand atlas list for this batch, including non-card enemy/creature reactions. */
export function catalogEventRecipes(
  events: readonly GameEvent[],
  lookup: (id: string) => CardDefinition | undefined,
): CatalogRecipe[] {
  const recipes = [...catalogBatch(events, lookup).values()];
  for (const e of events) {
    if (['ENEMY_ATTACKED', 'SUMMON_ATTACKED', 'SUMMON_BREATH', 'COUNTER_ATTACK'].includes(e.type))
      recipes.push(familyRecipe(confirmedAttackFamily(events, e)));
    if (e.type === 'UNIT_SPAWNED' && e.kind === 'SUMMON') recipes.push(familyRecipe('summon'));
    if (e.type === 'FORM_CHANGED') recipes.push(familyRecipe('transform'));
    if (e.type === 'SHIELD_SHATTERED' || e.type === 'DEATH_PREVENTED')
      recipes.push(familyRecipe('defense'));
    if (['FORM_TRIGGER', 'SUMMON_ORDERED', 'COST_DISCOUNT_GRANTED'].includes(e.type))
      recipes.push(familyRecipe('tactic'));
    if (
      e.type === 'STATUS_APPLIED' &&
      !['UNLEASHED_HUNT', 'HUNT_PURSUIT', 'MARKED_PREY', 'PREY'].includes(e.status)
    )
      recipes.push(familyRecipe('tactic'));
  }
  return recipes;
}
