import { getHero } from '../board/occupancy';
import { getValidTargets } from '../cards/targeting';
import type { RuleContext } from '../context';
import { comparePos, manhattan, type Pos } from '../core/position';
import { checkCommit, checkRitual, nextSealCost, resolveRitualTarget, ritualCreature, ritualProgress } from '../rituals/ritual-rules';
import { isEmptyTile } from '../board/occupancy';

/** Same shapes as the engine's ritual commands (the domain does not import the engine). */
export type RitualAction =
  | { type: 'COMMIT_RITUAL_PIECE'; cardUid: string }
  | { type: 'ACTIVATE_RITUAL'; ritualId: string; target: Pos | null };

/**
 * Simple, legal ritual play for bots (balance probes) and any future AI-controlled champion.
 * Not a planner:
 * 1. Activate a complete ritual when it is obviously useful: a summon result that fits (the rules
 *    already check capacity/energy) and, for rituals that dismiss the current summons, only when
 *    those summons are worth less than the creature. Summons land on the legal tile closest to
 *    an enemy. (A non-summon result needs at least one own summon on the board.)
 * 2. Otherwise seal: the free seal of the turn always (the ritual with the most sealed pieces
 *    first); a paid seal when the pieces in hand finish that ritual this turn with energy left
 *    to activate it, or whenever paying still leaves 2 energy for cards.
 * Every suggestion is re-validated by the rules when dispatched; nothing here bypasses them.
 */
export function suggestRitualAction(ctx: RuleContext): RitualAction | null {
  const hero = getHero(ctx.state);
  if (!hero) return null;
  const progress = ritualProgress(ctx.content, hero.defId, ctx.state.player);
  const enemies = ctx.state.units.filter((u) => u.faction !== hero.faction);
  const own = ctx.state.units.filter((u) => u.summon?.ownerId === hero.id);
  const worth = (hp: number, damage: number) => hp + damage * 2;
  const ownWorth = own.reduce((n, u) => n + worth(u.hp, ctx.content.summons?.[u.defId]?.damage ?? 0), 0);
  for (const p of progress.filter((x) => x.complete)) {
    const check = checkRitual(ctx, p.ritual.id);
    if (!check.ok) continue;
    const summons = p.ritual.result.effects.some((fx) => fx.type === 'SUMMON');
    if (!summons && own.length === 0) continue;
    const creature = ritualCreature(ctx.content, p.ritual);
    if (p.ritual.dismissSummons && creature && ownWorth >= worth(creature.maxHp, creature.damage)) continue;
    if (p.ritual.targeting.type === 'SELF') return { type: 'ACTIVATE_RITUAL', ritualId: p.ritual.id, target: null };
    const near = (pos: Pos) => (enemies.length ? Math.min(...enemies.map((e) => manhattan(e.pos, pos))) : 0);
    const target = getValidTargets(ctx, hero, p.ritual.targeting)
      .filter((pos) => !summons || isEmptyTile(ctx, pos))
      .filter((pos) => resolveRitualTarget(ctx, check, pos))
      .sort((a, b) => near(a) - near(b) || comparePos(a, b))[0];
    if (target) return { type: 'ACTIVATE_RITUAL', ritualId: p.ritual.id, target };
  }
  const { player } = ctx.state;
  const sealedFor = (cardId: string) => Math.max(0, ...progress.filter((p) => p.ritual.pieces.includes(cardId)).map((p) => p.sealed.length));
  const sealable = player.hand.filter((c) => checkCommit(ctx, c.uid).ok).sort((a, b) => sealedFor(b.cardId) - sealedFor(a.cardId));
  const cost = nextSealCost(ctx.content, hero.defId, player);
  if (cost === 0) return sealable[0] ? { type: 'COMMIT_RITUAL_PIECE', cardUid: sealable[0].uid } : null;
  const inHand = new Set(sealable.map((c) => c.cardId));
  const finishable = progress.find(
    (p) => !p.complete && p.missing.every((id) => inHand.has(id)) && player.energy >= p.missing.length * cost + p.ritual.energyCost,
  );
  const piece = finishable && sealable.find((c) => finishable.missing.includes(c.cardId));
  if (piece) return { type: 'COMMIT_RITUAL_PIECE', cardUid: piece.uid };
  // Spare energy: seal now rather than hold a piece in a 4-card hand (keep 2 energy for cards).
  return sealable[0] && player.energy - cost >= 2 ? { type: 'COMMIT_RITUAL_PIECE', cardUid: sealable[0].uid } : null;
}
