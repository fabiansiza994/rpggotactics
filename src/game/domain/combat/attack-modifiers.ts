import { areHostile, unitById } from '../board/occupancy';
import type { RuleContext } from '../context';
import type { Unit } from '../entities/unit';
import { manhattan } from '../core/position';

/**
 * Status modifiers on ATTACKS («Arsenal I»): card DAMAGE effects, summon attacks and enemy
 * intents call this before `dealDamage`. Push collisions, Riposte, terrain and status ticks never
 * do, so a modifier can never chain or loop. Deterministic, read from the battle state only.
 *
 *   attacker SEALED      → −outgoingDamageReduction (never below 1)
 *   attacker CHALLENGED  → −tauntPenalty against anyone but the challenger (never below 1)
 *   target SMOKE_SCREEN  → −incomingDamageReduction from a hostile attacker (may reach 0)
 *   ally aura next to it → the same reduction, never added to a status one (biggest wins)
 */
export function attackDamage(ctx: RuleContext, attacker: Unit | undefined, target: Unit, amount: number): number {
  if (amount <= 0) return amount;
  let out = amount;
  if (attacker && areHostile(attacker, target)) {
    out += attacker.statuses.reduce((n, s) => n + (ctx.content.statuses[s.id]?.outgoingDamageBonus ?? 0), 0);
    out += target.statuses.reduce((n, s) => n + (ctx.content.statuses[s.id]?.incomingDamageBonus ?? 0), 0);
  }
  if (attacker) {
    let less = 0;
    for (const s of attacker.statuses) {
      const def = ctx.content.statuses[s.id];
      less += def?.outgoingDamageReduction ?? 0;
      if (def?.taunt && s.sourceId !== target.id && unitById(ctx.state, s.sourceId ?? '')) less += def.tauntPenalty ?? 0;
    }
    if (less > 0) out = Math.max(1, out - less);
  }
  if (attacker && areHostile(attacker, target)) {
    const fromStatuses = target.statuses.reduce((n, s) => n + (ctx.content.statuses[s.id]?.incomingDamageReduction ?? 0), 0);
    // An aura (Gólem del Pacto) never adds to a Cobertura: the bigger reduction applies.
    const less = Math.max(fromStatuses, auraReduction(ctx, target));
    out = Math.max(0, out - less);
  }
  return out;
}

/**
 * The biggest live aura reduction protecting `target` (Gólem del Pacto): a READY allied summon
 * with an aura, orthogonally next to it, never the target itself. Structures are not protected.
 */
export function auraReduction(ctx: RuleContext, target: Unit): number {
  if (target.kind === 'STRUCTURE') return 0;
  let best = 0;
  for (const u of ctx.state.units) {
    if (u === target || !u.summon || u.faction !== target.faction || manhattan(u.pos, target.pos) !== 1) continue;
    if (ctx.state.round < u.summon.readyRound) continue;
    best = Math.max(best, ctx.content.summons?.[u.defId]?.aura?.incomingDamageReduction ?? 0);
  }
  return best;
}

/** Sealed attackers lose their hit riders (push, status, scorch). */
export const ridersSuppressed = (ctx: RuleContext, attacker: Unit): boolean =>
  attacker.statuses.some((s) => ctx.content.statuses[s.id]?.suppressesHitRiders);

/** The living champion that challenged `unit` (Desafío), if any. */
export function challenger(ctx: RuleContext, unit: Unit): Unit | undefined {
  for (const s of unit.statuses)
    if (ctx.content.statuses[s.id]?.taunt && s.sourceId) {
      const source = unitById(ctx.state, s.sourceId);
      if (source && areHostile(source, unit)) return source;
    }
  return undefined;
}
