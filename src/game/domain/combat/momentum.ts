import { depthEnabled, type AttackKind } from './qa-depth';
import { attackDamage } from './attack-modifiers';
import { areHostile, unitById } from '../board/occupancy';
import type { RuleContext } from '../context';
import { manhattan, type Pos } from '../core/position';
import type { Unit } from '../entities/unit';
import type { GameState } from '../state';
import { removeStatus } from '../statuses/status-rules';
import { dealDamage } from './damage';

/**
 * Warrior signature rules: Momentum (Impulso) and Riposte (Contraataque). Both live in the
 * authoritative battle state (unit fields / statuses), so replays, PvP snapshots and
 * reconnects carry them like HP. Units without `momentum` are never affected.
 */

type MomentumReason = 'ENGAGE' | 'HIT' | 'CARD' | 'SPENT';

function setMomentum(ctx: RuleContext, unit: Unit, value: number, reason: MomentumReason): void {
  const m = unit.momentum;
  if (!m) return;
  const to = Math.max(0, Math.min(m.max, value));
  if (to === m.value) return;
  const from = m.value;
  m.value = to;
  ctx.emit({ type: 'MOMENTUM_CHANGED', unitId: unit.id, from, to, max: m.max, reason });
}

export function gainMomentum(ctx: RuleContext, unit: Unit, amount: number, reason: MomentumReason): void {
  if (unit.momentum && amount > 0) setMomentum(ctx, unit, unit.momentum.value + amount, reason);
}

/** Spends `cost` if available. Returns false (and changes nothing) when there is not enough. */
export function spendMomentum(ctx: RuleContext, unit: Unit, cost: number): boolean {
  if (!unit.momentum || unit.momentum.value < cost) return false;
  setMomentum(ctx, unit, unit.momentum.value - cost, 'SPENT');
  return true;
}

/** Hostile, non-structure units orthogonally adjacent to `p` (melee reach). */
export const hostileAdjacent = (ctx: RuleContext, unit: Unit, p: Pos): boolean =>
  ctx.state.units.some((u) => u !== unit && u.kind !== 'STRUCTURE' && areHostile(unit, u) && manhattan(u.pos, p) === 1);

/**
 * Engage: a walk or charge that ENDS next to an enemy the unit was not already next to grants
 * +1, at most once per round (each side has one turn per round, PvE and duel alike).
 */
export function onUnitMoved(ctx: RuleContext, unit: Unit, from: Pos): void {
  const m = unit.momentum;
  if (!m || m.engagedRound === ctx.state.round) return;
  if (hostileAdjacent(ctx, unit, from) || !hostileAdjacent(ctx, unit, unit.pos)) return;
  m.engagedRound = ctx.state.round;
  gainMomentum(ctx, unit, 1, 'ENGAGE');
}

/**
 * The engine's own turn identity, deterministic and serialized with the state: a duel counts every
 * side's turn (`duel.turns`); PvE has one player and one enemy turn per round.
 */
export const turnKey = (state: Readonly<GameState>): number =>
  state.duel ? state.duel.turns : state.round * 2 + (state.activeFaction === 'ENEMY' ? 1 : 0);

/** Paciencia del Muro: the first distant landed hit of each turn gives the extra Impulso. */
function onDistantHit(ctx: RuleContext, unit: Unit): void {
  const patience = unit.statuses.find((s) => ctx.content.statuses[s.id]?.distantHitMomentum);
  const m = unit.momentum;
  if (!patience || !m) return;
  const turn = turnKey(ctx.state);
  if (m.patienceTurn === turn) return;
  m.patienceTurn = turn;
  gainMomentum(ctx, unit, ctx.content.statuses[patience.id].distantHitMomentum!, 'HIT');
}

/**
 * After a hit lands on a living unit: hostile hits that got past armour (absorbed by Guard or
 * taken as HP) feed Momentum, then a pending Riposte answers an adjacent attacker once.
 */
export function onUnitHit(
  ctx: RuleContext,
  unit: Unit,
  sourceId: string,
  landed: number,
  attackKind: AttackKind | undefined,
): void {
  if (attackKind === 'GROUND_HAZARD' || !ctx.state.units.includes(unit)) return;
  const source = unitById(ctx.state, sourceId);
  if (!source || !areHostile(source, unit)) return;
  if (landed > 0) gainMomentum(ctx, unit, 1, 'HIT');
  if (landed > 0 && manhattan(source.pos, unit.pos) > 1) onDistantHit(ctx, unit);
  if (attackKind === 'COUNTER' || manhattan(source.pos, unit.pos) !== 1) return;
  const riposte = unit.statuses.find((s) => ctx.content.statuses[s.id]?.counterDamage);
  const passive = depthEnabled(ctx) && source.hp > 0 && source.kind !== 'STRUCTURE' && attackKind === 'DIRECT_MELEE' && unit.defId === 'shapeshifter' &&
    (unit.activeForm === 'bear' || unit.activeForm === 'minotaur') &&
    (ctx.content.qaCombatDepth!.formCounter === 'perHit' || unit.qaCounterRound !== ctx.state.round);
  if (!riposte && !passive) return;
  // One reaction, never stack an existing Riposte with the innate response.
  const amount = riposte ? ctx.content.statuses[riposte.id].counterDamage! : attackDamage(ctx, unit, source, 1);
  if (riposte) removeStatus(ctx, unit, riposte.id, 'CONSUMED');
  if (passive) unit.qaCounterRound = ctx.state.round;
  ctx.emit({ type: 'COUNTER_ATTACK', unitId: unit.id, targetId: source.id, amount });
  dealDamage(ctx, source, amount, unit.id, riposte ? ctx.content.statuses[riposte.id].counterDamageType ?? 'PHYSICAL' : 'PHYSICAL', 'COUNTER');
}
