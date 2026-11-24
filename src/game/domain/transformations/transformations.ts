import type { RuleContext } from '../context';
import type { GameContent } from '../content';
import type { Unit } from '../entities/unit';
import type { GameState } from '../state';
import { fail, OK, type RuleResult } from '../result';
import { addShield } from '../combat/damage';
import { setMovePoints } from '../cards/deck';
import { removeStatus } from '../statuses/status-rules';

export type FormNature = 'HUMAN' | 'BEAST';

/** Nature is content-owned, never inferred from visual names or a fixed list of ids.
 * Untransformed/unregistered forms fail closed to HUMAN; legacy registered forms are BEAST. */
export function formNature(content: GameContent, unit: Unit): FormNature {
  const id = unit.activeForm;
  const form = id ? content.transformations?.[id] : undefined;
  return form && form.id === id ? (form.nature ?? 'BEAST') : 'HUMAN';
}

/** Content ids, not a closed enum: new forms require data, never a new engine branch. */
export interface TransformationDef {
  id: string;
  name: string;
  /** Registered transformations default to BEAST for legacy snapshots/content. */
  nature?: FormNature;
  /** Phase 1 sandbox values; additive so changing form preserves other armor modifiers. */
  armorBonus: number;
  inheritsForm?: string;
  moveBonus?: number;
  directDamageBonus?: number;
  upkeepHp?: number;
  darkUpkeepHp?: number;
  provisional?: boolean;
}
export const activeForm = (unit: Unit): string | null => unit.activeForm ?? null;

export function checkFormRequirement(
  unit: Unit,
  requiredForms?: readonly (string | null)[],
  content?: GameContent,
): RuleResult {
  return requiredForms && !requiredForms.includes(activeForm(unit)) && !(unit.activeForm && content?.transformations?.[unit.activeForm]?.inheritsForm && requiredForms.includes(content.transformations[unit.activeForm]!.inheritsForm!))
    ? fail('FORM_REQUIRED', 'Esta carta requiere otra forma activa.')
    : OK;
}

export function checkTransformation(
  content: GameContent,
  unit: Unit,
  formId: string | null,
): RuleResult {
  const allowed = content.heroes[unit.defId]?.transformationForms;
  if (unit.kind !== 'HERO' || !allowed?.length)
    return fail('INVALID_TRANSFORMATION', 'Este campeón no puede transformarse.');
  if (formId === null) return OK;
  const def = content.transformations?.[formId];
  if (
    !allowed.includes(formId) ||
    !def ||
    def.id !== formId ||
    !Number.isSafeInteger(def.armorBonus) ||
    def.armorBonus < 0
  )
    return fail('INVALID_TRANSFORMATION', 'Forma no disponible para este campeón.');
  return OK;
}

/** Validate all destinations before paying, including alternate/empowered effects. */
export function transform(ctx: RuleContext, unit: Unit, formId: string | null): void {
  const valid = checkTransformation(ctx.content, unit, formId);
  if (!valid.ok) throw new Error(valid.message);
  const previous = activeForm(unit);
  if (previous === formId) return;
  const oldBonus = previous ? (ctx.content.transformations?.[previous]?.armorBonus ?? 0) : 0;
  const nextBonus = formId ? ctx.content.transformations![formId]!.armorBonus : 0;
  unit.armor = Math.max(0, unit.armor - oldBonus + nextBonus);
  const mobility = (formId ? ctx.content.transformations?.[formId]?.moveBonus ?? 0 : 0) - (previous ? ctx.content.transformations?.[previous]?.moveBonus ?? 0 : 0);
  adjustFormMobility(ctx.state, unit, mobility);
  if (mobility && ctx.state.player.heroId === unit.id) ctx.emit({ type: 'MOVE_POINTS_CHANGED', from: Math.max(0, ctx.state.player.movePoints - mobility), to: ctx.state.player.movePoints, max: ctx.state.player.maxMovePoints });
  if (formId === null) delete unit.activeForm;
  else unit.activeForm = formId;
  // No HP, maxHP, shield, statuses, energy or movement refresh.
  ctx.emit({ type: 'FORM_CHANGED', unitId: unit.id, from: previous, to: formId });
  onFormChanged(ctx, unit);
}

/**
 * «Al cambiar de forma» triggers (Danza de las Formas): any change of form, whatever the forms
 * are (content ids, never a fixed list). Each instance pays out at most its `charges`.
 */
function onFormChanged(ctx: RuleContext, unit: Unit): void {
  for (const instance of [...unit.statuses]) {
    const trigger = ctx.content.statuses[instance.id]?.onFormChange;
    if (!trigger) continue;
    const left = instance.charges ?? trigger.charges;
    if (left <= 0) continue;
    instance.charges = left - 1;
    if (trigger.shield > 0) addShield(ctx, unit, trigger.shield, unit.id);
    // Move points belong to the active champion's turn only.
    if (trigger.movePoints > 0 && ctx.state.player.heroId === unit.id && ctx.state.activeFaction === unit.faction)
      setMovePoints(ctx, ctx.state.player.movePoints + trigger.movePoints);
    ctx.emit({ type: 'FORM_TRIGGER', unitId: unit.id, status: instance.id, shield: trigger.shield, movePoints: trigger.movePoints, chargesLeft: instance.charges });
    if (instance.charges <= 0) removeStatus(ctx, unit, instance.id, 'CONSUMED');
  }
}

/** Finished battles do not retain an active form, even when both PvP heroes remain alive. */
export function clearBattleForms(state: GameState, content: GameContent): void {
  for (const unit of state.units) {
    if (!unit.activeForm) continue;
    unit.armor = Math.max(
      0,
      unit.armor - (content.transformations?.[unit.activeForm]?.armorBonus ?? 0),
    );
    adjustFormMobility(state, unit, -(content.transformations?.[unit.activeForm]?.moveBonus ?? 0));
    delete unit.activeForm;
  }
}


function adjustFormMobility(state: GameState, unit: Unit, delta: number): void {
  if (!delta) return;
  unit.moveRange = Math.max(1, unit.moveRange + delta);
  const bank = state.player.heroId === unit.id ? state.player : state.duel?.other.heroId === unit.id ? state.duel.other : undefined;
  if (bank) { bank.maxMovePoints = Math.max(1, bank.maxMovePoints + delta); bank.movePoints = Math.max(0, bank.movePoints + delta); }
}

/** Runs after field expiration and only at a real owner turn start. */
export function payFormUpkeep(ctx: RuleContext, unit: Unit): void {
  const definition = unit.activeForm ? ctx.content.transformations?.[unit.activeForm] : undefined;
  if (!definition?.upkeepHp) return;
  const dark = unit.statuses.some(status => status.id === 'DARK_WORLD' && status.turnsLeft > 0);
  const amount = dark ? definition.darkUpkeepHp ?? definition.upkeepHp : definition.upkeepHp;
  if (unit.hp <= amount) { transform(ctx, unit, null); return; }
  unit.hp -= amount;
  ctx.emit({ type: 'HP_SACRIFICED', unitId: unit.id, cardId: 'dark_abyssal_minotaur', amount, hpAfter: unit.hp });
}
