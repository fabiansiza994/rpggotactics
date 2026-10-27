import { getHero } from '../board/occupancy';
import { checkPlayability } from '../cards/play-card';
import type { RuleContext } from '../context';
import { summonCapacityOf, summonUsage } from '../summons/summons';
import { planIntent } from './ai';

/** Same shape as the engine's PLAY_CARD command (the domain does not import the engine). */
export type CapacityBondAction = { type: 'PLAY_CARD'; cardUid: string; target: null };

/**
 * Simple, legal use of a capacity card (Vínculo Prohibido: SACRIFICE_HP + GAIN_SUMMON_CAPACITY)
 * for bots and any future AI-controlled Summoner. Not a planner — play it only when:
 * 1. it is playable (the rules refuse it at 1 HP, a second copy, no energy…);
 * 2. the capacity is what blocks a summon card in hand right now, the gained points make it fit
 *    and there is still energy to cast that summon this turn (a real use for the new slot);
 * 3. the champion keeps a margin after paying: at least a quarter of its max HP (min 4), and more
 *    than the damage the enemies have announced against it for their next turn.
 * Every suggestion is re-validated by the rules when dispatched.
 */
export function suggestCapacityBond(ctx: RuleContext): CapacityBondAction | null {
  const hero = getHero(ctx.state);
  if (!hero) return null;
  const { hand, energy } = ctx.state.player;
  const effectsOf = (cardId: string) => ctx.content.cards[cardId]?.effects ?? [];
  const bond = hand.find((c) => effectsOf(c.cardId).some((fx) => fx.type === 'GAIN_SUMMON_CAPACITY'));
  if (!bond) return null;
  const check = checkPlayability(ctx, bond.uid);
  if (!check.ok) return null;

  let hpAfter = hero.hp,
    gain = 0;
  for (const fx of check.def.effects) {
    if (fx.type === 'SACRIFICE_HP') hpAfter -= Math.min(Math.floor((hpAfter * fx.percentOfCurrent) / 100), hpAfter - 1);
    if (fx.type === 'GAIN_SUMMON_CAPACITY') gain += fx.amount;
  }
  const incoming = ctx.state.intents.reduce((n, intent) => {
    const plan = planIntent(ctx, intent);
    return n + (plan?.targetUnitIds.includes(hero.id) ? plan.damage : 0);
  }, 0);
  if (hpAfter < Math.max(4, Math.ceil(hero.maxHp / 4)) || incoming >= hpAfter) return null;

  const free = summonCapacityOf(ctx.content, hero) - summonUsage(ctx.state, hero.id);
  const energyLeft = energy - check.def.cost;
  const unlocks = hand.some((c) => {
    if (c.uid === bond.uid) return false;
    const def = ctx.content.cards[c.cardId];
    const needed = effectsOf(c.cardId).reduce((n, fx) => n + (fx.type === 'SUMMON' ? (ctx.content.summons?.[fx.summonId]?.capacityCost ?? Infinity) : 0), 0);
    return !!def && needed > free && needed <= free + gain && def.cost <= energyLeft && !c.unavailableThisTurn;
  });
  return unlocks ? { type: 'PLAY_CARD', cardUid: bond.uid, target: null } : null;
}
