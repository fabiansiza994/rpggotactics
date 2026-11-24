import type { RuleContext } from '../context';
import type { Unit } from '../entities/unit';
import { manhattan } from '../core/position';
import { hasLineOfSight } from '../board/line-of-sight';
import { isActionPrevented } from '../board/occupancy';
import { addShield, defeatUnit, healUnit } from '../combat/damage';
import { fail, OK } from '../result';
export const REDEMPTION_SPIRIT = 'light_redemption_spirit';
export type RedemptionAction = 'HEAL' | 'PROTECT';
/** Pure shared preview. Only the confirmed command spends HP or the activation. */
export function redemptionOptions(ctx: RuleContext, spiritId: string, action: RedemptionAction) {
  const spirit = ctx.state.units.find(u => u.id === spiritId);
  if (!spirit || spirit.defId !== REDEMPTION_SPIRIT || !spirit.summon || spirit.hp <= 0 ||
      spirit.summon.ownerId !== ctx.state.player.heroId || ctx.state.phase !== 'PLAYER' || ctx.state.outcome ||
      ctx.state.pendingCast || ctx.state.player.pendingCardChoice || ctx.state.round < spirit.summon.readyRound ||
      spirit.summon.lastActedRound === ctx.state.round || isActionPrevented(ctx, spirit)) return [];
  const owner = ctx.state.units.find(u => u.id === spirit.summon!.ownerId);
  if (!owner) return [];
  const bonus = owner.statuses.some(s => s.id === 'LIGHT_WORLD' && s.turnsLeft > 0) ? 1 : 0;
  return ctx.state.units.flatMap(target => {
    if (target.id === spirit.id || target.faction !== spirit.faction || target.hp <= 0 ||
        manhattan(spirit.pos, target.pos) > 2 || !hasLineOfSight(ctx, spirit.pos, target.pos)) return [];
    if (action === 'PROTECT') return target.shield === 0 && spirit.hp >= 2 ? [{target, cost:2, amount:2+bonus}] : [];
    if (target.defId === REDEMPTION_SPIRIT) return [];
    const missing = target.maxHp - target.hp;
    const base = Math.min(2, spirit.hp, missing);
    return base > 0 ? [{target, cost:base, amount:Math.min(missing,base+bonus)}] : [];
  });
}
export function redemptionSupport(ctx: RuleContext, spiritId: string, targetId: string, action: RedemptionAction) {
  const option = redemptionOptions(ctx, spiritId, action).find(o => o.target.id === targetId);
  const spirit = ctx.state.units.find(u => u.id === spiritId);
  if (!option || !spirit?.summon) return fail('INVALID_TARGET', 'Apoyo no disponible o aliado inválido.');
  spirit.summon.lastActedRound = ctx.state.round;
  ctx.emit({type:'REDEMPTION_SUPPORT',unitId:spirit.id,targetId,action,from:{...spirit.pos},to:{...option.target.pos},cost:option.cost});
  if (action === 'HEAL') healUnit(ctx, option.target, option.amount, spirit.id);
  else addShield(ctx, option.target, option.amount, spirit.id);
  spirit.hp -= option.cost;
  ctx.emit({type:'HP_SACRIFICED',unitId:spirit.id,cardId:REDEMPTION_SPIRIT,amount:option.cost,hpAfter:spirit.hp});
  if (spirit.hp === 0) defeatUnit(ctx, spirit);
  return OK;
}
export const isRedemptionSpirit = (unit: Pick<Unit,'defId'>) => unit.defId === REDEMPTION_SPIRIT;
