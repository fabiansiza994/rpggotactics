import { areHostile } from '../board/occupancy';
import { comparePos, manhattan } from '../core/position';
import type { Unit } from '../entities/unit';
import type { GameState } from '../state';

/**
 * Flecha de Rebote: the units a rebounding arrow hits after `first`, in order. Pure and
 * deterministic (no RNG), computed from the board BEFORE any damage, so the preview, the client
 * and the server always agree and a first target that dies still passes the arrow on.
 *
 * Each bounce goes to a unit hostile to the caster (never an ally, the caster or a structure),
 * orthogonally adjacent (distance 1) to the unit hit just before, and not hit yet. Several
 * candidates: closest to the first target, then board order (`comparePos`, the engine's stable
 * order). Stops after `bounces` or when nothing qualifies.
 */
export function reboundChain(state: Readonly<GameState>, caster: Unit, first: Unit, bounces: number): Unit[] {
  const hit = new Set([first.id]);
  const chain: Unit[] = [];
  let from = first;
  for (let i = 0; i < bounces; i++) {
    const next = state.units
      .filter((u) => !hit.has(u.id) && u.kind !== 'STRUCTURE' && areHostile(caster, u) && manhattan(u.pos, from.pos) === 1)
      .sort((a, b) => manhattan(a.pos, first.pos) - manhattan(b.pos, first.pos) || comparePos(a.pos, b.pos))[0];
    if (!next) break;
    chain.push(next);
    hit.add(next.id);
    from = next;
  }
  return chain;
}
