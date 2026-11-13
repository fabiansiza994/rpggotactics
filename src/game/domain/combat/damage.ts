import { behind, depthEnabled, type AttackKind } from './qa-depth';
import { unitById, areHostile } from '../board/occupancy';
import { terrainDefAt } from '../board/occupancy';
import type { RuleContext } from '../context';
import type { Unit } from '../entities/unit';
import type { DamageType } from './damage-types';
import { onUnitHit } from './momentum';

export interface DamageResult {
  armorMitigated: number;
  shieldAbsorbed: number;
  hpLost: number;
  defeated: boolean;
}

/**
 * MVP damage model:
 *   afterArmor = max(0, amount - armor)
 *   shield absorbs first, the rest reduces HP.
 */
export function computeDamage(unit: Unit, amount: number): Omit<DamageResult, 'defeated'> {
  const afterArmor = Math.max(0, amount - unit.armor);
  const armorMitigated = amount - afterArmor;
  const shieldAbsorbed = Math.min(unit.shield, afterArmor);
  const hpLost = Math.min(unit.hp, afterArmor - shieldAbsorbed);
  return { armorMitigated, shieldAbsorbed, hpLost };
}

export function dealDamage(
  ctx: RuleContext,
  unit: Unit,
  amount: number,
  sourceId: string,
  damageType: DamageType,
  /** COUNTER = Riposte damage: never answered by another Riposte (no chains). PIERCING ignores armor. */
  attackKind?: AttackKind,
  directAttack?: 'DIRECT_MELEE' | 'DIRECT_RANGED',
): DamageResult {
  if (!ctx.state.units.includes(unit) || amount <= 0) {
    return { armorMitigated: 0, shieldAbsorbed: 0, hpLost: 0, defeated: false };
  }
  const cover = (attackKind === 'RANGED' || attackKind === 'DIRECT_RANGED') ? (terrainDefAt(ctx, unit.pos)?.rangedReduction ?? 0) : 0;
  const direct = directAttack ?? (attackKind === 'DIRECT_MELEE' || attackKind === 'DIRECT_RANGED' ? attackKind : undefined);
  const attacker = unitById(ctx.state, sourceId);
  const backstab = depthEnabled(ctx) && ctx.content.qaCombatDepth!.backstab &&
    !!direct &&
    attacker && areHostile(attacker, unit) && behind(attacker, unit) ? 1 : 0;
  const result = computeDamage(
    attackKind === 'GROUND_HAZARD' || attackKind === 'PIERCING' ? { ...unit, armor: 0 } : unit,
    Math.max(0, amount - cover),
  );
  if (backstab) {
    // +1 after armor/cover, still absorbed by shields. The base attack is otherwise unchanged.
    const extraShield = Math.min(Math.max(0, unit.shield - result.shieldAbsorbed), 1);
    result.shieldAbsorbed += extraShield;
    result.hpLost = Math.min(unit.hp, result.hpLost + 1 - extraShield);
    ctx.emit({ type: 'BACKSTAB', unitId: unit.id, sourceId, pos: unit.pos, bonus: 1 });
  }
  // Último Bastión: no hit (attack, multi-hit, collision, terrain, tick) goes below the floor.
  const floor = hpFloor(ctx, unit);
  if (floor > 0 && unit.hp - result.hpLost < floor) {
    const prevented = result.hpLost - Math.max(0, unit.hp - floor);
    result.hpLost -= prevented;
    if (prevented > 0) ctx.emit({ type: 'DEATH_PREVENTED', unitId: unit.id, sourceId, prevented, hpAfter: unit.hp - result.hpLost });
  }
  const hadShield = unit.shield > 0;
  unit.shield -= result.shieldAbsorbed;
  unit.hp -= result.hpLost;

  ctx.emit({
    type: 'UNIT_DAMAGED',
    unitId: unit.id,
    sourceId,
    damageType,
    pos: unit.pos,
    rawAmount: amount,
    armorMitigated: result.armorMitigated,
    ...(cover > 0 ? { coverMitigated: Math.min(amount, cover) } : {}),
    shieldAbsorbed: result.shieldAbsorbed,
    hpLost: result.hpLost,
    hpAfter: unit.hp,
  });
  if (hadShield && unit.shield === 0) ctx.emit({ type: 'SHIELD_BROKEN', unitId: unit.id });

  const defeated = unit.hp <= 0;
  if (defeated) defeatUnit(ctx, unit);
  else onUnitHit(ctx, unit, sourceId, result.shieldAbsorbed + result.hpLost, direct ?? attackKind, damageType);
  return { ...result, defeated };
}

/** Highest HP floor among the unit's statuses (0 = none). */
const hpFloor = (ctx: RuleContext, unit: Unit): number =>
  unit.statuses.reduce((n, s) => Math.max(n, ctx.content.statuses[s.id]?.hpFloor ?? 0), 0);

export function defeatUnit(ctx: RuleContext, unit: Unit): void {
  const { state } = ctx;
  if (!state.units.includes(unit)) return;
  state.units = state.units.filter((u) => u !== unit);
  state.intents = state.intents.filter((i) => i.enemyId !== unit.id);
  if (unit.faction === 'ENEMY') state.stats.enemiesDefeated += 1;
  ctx.emit({
    type: 'UNIT_DEFEATED',
    unitId: unit.id,
    faction: unit.faction,
    kind: unit.kind,
    pos: unit.pos,
  });
  for (const ally of [...state.units]) if (ally.summon?.ownerId === unit.id) defeatUnit(ctx, ally);
}

export function healUnit(ctx: RuleContext, unit: Unit, amount: number, sourceId: string): number {
  const healed = Math.max(0, Math.min(amount, unit.maxHp - unit.hp));
  if (healed === 0) return 0;
  unit.hp += healed;
  ctx.emit({ type: 'UNIT_HEALED', unitId: unit.id, sourceId, amount: healed, hpAfter: unit.hp });
  return healed;
}

/** Removes up to `amount` shield (Rompeguardia's shield break). Returns how much was removed. */
export function breakShield(ctx: RuleContext, unit: Unit, amount: number, sourceId: string): number {
  const removed = Math.min(unit.shield, Math.max(0, amount));
  if (removed === 0 || !ctx.state.units.includes(unit)) return 0;
  unit.shield -= removed;
  ctx.emit({ type: 'SHIELD_SHATTERED', unitId: unit.id, sourceId, amount: removed, total: unit.shield });
  if (unit.shield === 0) ctx.emit({ type: 'SHIELD_BROKEN', unitId: unit.id });
  return removed;
}

/** Shields stack additively until they expire at the start of the owner's next turn. */
export function addShield(ctx: RuleContext, unit: Unit, amount: number, sourceId: string): void {
  if (amount <= 0) return;
  unit.shield += amount;
  ctx.emit({ type: 'SHIELD_GAINED', unitId: unit.id, sourceId, amount, total: unit.shield });
}

export function expireShield(ctx: RuleContext, unit: Unit): void {
  if (unit.shield <= 0) return;
  const amount = unit.shield;
  unit.shield = 0;
  ctx.emit({ type: 'SHIELD_EXPIRED', unitId: unit.id, amount });
}
