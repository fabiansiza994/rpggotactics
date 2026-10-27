import { getHero, unitAt } from '../board/occupancy';
import { hasLineOfSight } from '../board/line-of-sight';
import { inOptimalRange, isOptimalDistance, isPreyOf, nearestHostileDistance, optimalRangeOf, preyOf } from '../combat/archery';
import type { GameContent } from '../content';
import { queryContext } from '../context';
import { manhattan, type Pos } from '../core/position';
import type { GameState } from '../state';

/**
 * Minimal Archer bot knowledge (phase 1, deliberately simple). Two pure functions a greedy bot
 * adds to its own evaluation; neither changes any rule:
 *   - `archerPositionScore`: having a Presa, standing at Distancia Óptima from it with line of
 *     sight, banked Concentración, and NOT standing next to an enemy are worth something;
 *   - `archerHoldsCard`: never spend Tiro al Corazón unless its condition (Presa + optimal) is
 *     met or the 4 base damage is lethal.
 * Non-Archer states score 0 / hold nothing.
 */
export function archerPositionScore(state: Readonly<GameState>, content: GameContent): number {
  const hero = getHero(state as GameState);
  const range = hero && optimalRangeOf({ content }, hero);
  if (!hero?.focus || !range) return 0;
  const ctx = queryContext(state as GameState, content);
  let score = hero.focus.value * 1.5;
  const prey = preyOf(state, hero.id);
  if (prey) {
    score += 2;
    if (isOptimalDistance(range, manhattan(hero.pos, prey.pos))) score += 1.5;
    if (hasLineOfSight(ctx, hero.pos, prey.pos)) score += 0.5;
  }
  const nearest = nearestHostileDistance(state, hero);
  if (nearest === 1) score -= 3;
  else if (isOptimalDistance(range, nearest)) score += 1;
  return score;
}

export function archerHoldsCard(state: Readonly<GameState>, content: GameContent, cardId: string, target: Pos | null): boolean {
  if (cardId !== 'heart_shot' || !target) return false;
  const hero = getHero(state as GameState);
  const victim = unitAt(state as GameState, target);
  if (!hero || !victim) return true;
  const ctx = queryContext(state as GameState, content);
  const empowered = isPreyOf(victim, hero.id) && inOptimalRange(ctx, hero, victim.pos);
  return !empowered && victim.hp + victim.shield > 4;
}
