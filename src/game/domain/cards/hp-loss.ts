import type { RuleContext } from '../context';
import type { Unit } from '../entities/unit';
import { defeatUnit } from '../combat/damage';

/** Simultaneous HP loss: no armour/shield conversion, no intermediate win check. */
export function loseHpTogether(ctx: RuleContext, targets: readonly Unit[], amount: number, sourceId: string): void {
  for (const target of targets) {
    const lost = Math.min(target.hp, amount);
    target.hp -= lost;
    ctx.emit({ type: 'UNIT_DAMAGED', unitId: target.id, sourceId, damageType: 'ARCANE', pos: { ...target.pos }, rawAmount: amount, armorMitigated: 0, shieldAbsorbed: 0, hpLost: lost, hpAfter: target.hp });
  }
  for (const target of targets) if (target.hp <= 0 && ctx.state.units.includes(target)) defeatUnit(ctx, target);
}
