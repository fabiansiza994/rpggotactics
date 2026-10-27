import { areHostile, unitById } from '../board/occupancy';
import type { RuleContext } from '../context';
import { samePos, type Pos } from '../core/position';
import type { Trap } from '../entities/trap';
import type { Unit } from '../entities/unit';
import type { GameState } from '../state';
import { applyStatus } from '../statuses/status-rules';
import { dealDamage } from './damage';
import { gainFocus, isPreyOf } from './archery';

/**
 * Traps (Archer: Trampa de Zarzas). A trap never blocks movement or sight. The first unit hostile
 * to the trap's living owner that ENTERS the tile (walk, charge, push, pull, teleport) stops there,
 * takes the trap damage and is ROOTED through the existing root status (no second immobilisation
 * rule). Structures never trigger it. Public state: both seats see every trap.
 *
 * Root length: a unit caught during its OWN side's turn gets 2 (the status counts down at the end
 * of that turn, so it still covers its next turn); caught on the other side's turn it gets 1.
 */

export const trapAt = (state: Readonly<GameState>, p: Pos): Trap | undefined =>
  state.traps?.find((t) => samePos(t.pos, p));

/** The trap at `p` that `unit` would spring, if any. */
export function hostileTrapAt(ctx: Pick<RuleContext, 'state'>, unit: Unit, p: Pos): Trap | undefined {
  const trap = trapAt(ctx.state, p);
  if (!trap || unit.kind === 'STRUCTURE') return undefined;
  const owner = unitById(ctx.state, trap.ownerId);
  return owner && areHostile(owner, unit) ? trap : undefined;
}

/**
 * A walking path cut at the first hostile trap (inclusive): the unit stops on the trap. Used by
 * movement AND by the enemy intent planner, so the telegraph shows the stop that will happen.
 */
export function cutPathAtTrap(ctx: Pick<RuleContext, 'state'>, unit: Unit, path: readonly Pos[]): Pos[] {
  if (!ctx.state.traps?.length) return [...path];
  const i = path.findIndex((p) => hostileTrapAt(ctx, unit, p));
  return i < 0 ? [...path] : path.slice(0, i + 1);
}

export function placeTrap(ctx: RuleContext, owner: Unit, pos: Pos, kind: string, damage: number, rounds: number): void {
  const traps = (ctx.state.traps ??= []);
  const old = trapAt(ctx.state, pos);
  if (old) {
    ctx.state.traps = traps.filter((t) => t !== old);
    ctx.emit({ type: 'TRAP_REMOVED', trapId: old.id, kind: old.trapId, pos: old.pos, reason: 'REPLACED' });
  }
  const trap: Trap = { id: `trap-${ctx.state.nextId++}`, trapId: kind, ownerId: owner.id, pos, damage, turnsLeft: rounds };
  ctx.state.traps!.push(trap);
  ctx.emit({ type: 'TRAP_PLACED', trapId: trap.id, kind, ownerId: owner.id, pos, turnsLeft: rounds });
}

/**
 * Red del Cazador: one trap per given tile, linked by a shared `netId`. The owner keeps a single
 * net of this kind: its previous one (untriggered traps of the same kind and owner) is replaced.
 * Without `net` the traps are independent (same as placing them one by one).
 */
export function placeTrapNet(
  ctx: RuleContext,
  owner: Unit,
  tiles: readonly Pos[],
  kind: string,
  damage: number,
  rounds: number,
  net?: { preyFocus: number },
): void {
  if (net)
    for (const old of (ctx.state.traps ?? []).filter((t) => t.netId && t.ownerId === owner.id && t.trapId === kind)) {
      ctx.state.traps = ctx.state.traps!.filter((t) => t !== old);
      ctx.emit({ type: 'TRAP_REMOVED', trapId: old.id, kind: old.trapId, pos: old.pos, reason: 'REPLACED' });
    }
  const netId = net ? `net-${ctx.state.nextId++}` : undefined;
  for (const pos of tiles) {
    placeTrap(ctx, owner, pos, kind, damage, rounds);
    if (!net) continue;
    const trap = ctx.state.traps!.at(-1)!;
    trap.netId = netId;
    if (net.preyFocus) trap.preyFocus = net.preyFocus;
  }
}

/** Call after a unit's position changed: springs a hostile trap under it. Returns true if it did. */
export function springTrap(ctx: RuleContext, unit: Unit): boolean {
  const trap = hostileTrapAt(ctx, unit, unit.pos);
  if (!trap || !ctx.state.units.includes(unit)) return false;
  ctx.state.traps = ctx.state.traps!.filter((t) => t !== trap);
  ctx.emit({ type: 'TRAP_TRIGGERED', trapId: trap.id, kind: trap.trapId, ownerId: trap.ownerId, unitId: unit.id, pos: trap.pos, damage: trap.damage });
  // A net closes on its first catch: the linked traps go, so it can never root twice.
  if (trap.netId)
    for (const linked of ctx.state.traps.filter((t) => t.netId === trap.netId)) {
      ctx.state.traps = ctx.state.traps.filter((t) => t !== linked);
      ctx.emit({ type: 'TRAP_REMOVED', trapId: linked.id, kind: linked.trapId, pos: linked.pos, reason: 'NET_CLOSED' });
    }
  // Decided before the hit (catching the Presa counts even if the trap finishes it).
  const owner = trap.preyFocus ? unitById(ctx.state, trap.ownerId) : undefined;
  const preyCaught = !!owner && isPreyOf(unit, owner.id);
  dealDamage(ctx, unit, trap.damage, trap.ownerId, 'PHYSICAL');
  if (ctx.state.units.includes(unit))
    applyStatus(ctx, unit, 'ROOTED', unit.faction === ctx.state.activeFaction ? 2 : 1, trap.ownerId);
  if (preyCaught && ctx.state.units.includes(owner!)) gainFocus(ctx, owner!, trap.preyFocus!);
  return true;
}

/** End of round (with temporary terrain): untriggered traps lose one round and may expire. */
export function tickTraps(ctx: RuleContext): void {
  for (const t of [...(ctx.state.traps ?? [])]) {
    t.turnsLeft -= 1;
    if (t.turnsLeft > 0) continue;
    ctx.state.traps = ctx.state.traps!.filter((x) => x !== t);
    ctx.emit({ type: 'TRAP_REMOVED', trapId: t.id, kind: t.trapId, pos: t.pos, reason: 'EXPIRED' });
  }
}
