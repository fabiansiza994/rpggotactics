import { inBounds } from '../board/board';
import type { RuleContext } from '../context';
import { addPos, samePos, type Pos } from '../core/position';
import type { MechanismObject } from './mechanism';
import { covers, footprint } from './mechanism-board';
import { emitCue } from './mechanism-rules';
import { applyTransform } from './mechanism-transform';

/**
 * Moving platforms (Act III phase 2): the TRANSLATE case of the transformable-region engine.
 * A platform is floor (occupancy.isStandable) on its footprint
 * and moves between named stops. The move is instant and deterministic; the presentation animates
 * it from the PLATFORM_MOVED cue (`from` → `pos`, `carriedIds`).
 *
 * Everything standing on the footprint travels with it, keeping its relative position, HP,
 * statuses, ownership and summon data: units (champion, summons, enemies), statues and dropped
 * relics. Nothing is ever destroyed or left over a chasm.
 *
 * SAFETY: a move whose destination footprint (outside the current one) is off the board or holds
 * anything else — unit, obstacle, any other mechanism (gate in any state, plate, trap, other
 * platform, relic, statue) — does not happen: PLATFORM_BLOCKED, state unchanged. No deferral, so
 * the player always sees the result of the lever pull immediately and may try again.
 */

const tilesAt = (o: MechanismObject, anchor: Pos): Pos[] => (o.def.shape ?? [{ x: 0, y: 0 }]).map((d) => addPos(anchor, d));

/** Why `o` cannot move to `anchor` (null = it can). */
export function platformBlockedAt(ctx: RuleContext, o: MechanismObject, anchor: Pos): string | null {
  const { state } = ctx;
  const here = footprint(o);
  for (const t of tilesAt(o, anchor)) {
    if (here.some((h) => samePos(h, t))) continue;
    if (!inBounds(state.board, t)) return 'Fuera del tablero.';
    if (state.obstacles.some((ob) => samePos(ob.pos, t))) return 'Hay un obstáculo.';
    if (state.units.some((u) => samePos(u.pos, t))) return 'Hay una unidad en el destino.';
    if (state.mechanisms!.objects.some((m) => m !== o && covers(m, t))) return 'Otro mecanismo ocupa el destino.';
  }
  return null;
}

export function movePlatform(ctx: RuleContext, o: MechanismObject, stop: string, causeId?: string): boolean {
  const anchor = o.def.stops?.[stop];
  if (!anchor || o.stop === stop) return false;
  const blocked = platformBlockedAt(ctx, o, anchor);
  if (blocked) {
    emitCue(ctx, o, 'PLATFORM_BLOCKED', { ...(causeId ? { causeId } : {}) });
    return false;
  }
  const delta = { x: anchor.x - o.pos.x, y: anchor.y - o.pos.y };
  const onBoard = (p: Pos) => covers(o, p);
  const units = ctx.state.units.filter((u) => onBoard(u.pos));
  const riders = ctx.state.mechanisms!.objects.filter(
    (m) => m !== o && (m.def.kind === 'STATUE' || (m.def.kind === 'RELIC' && m.state === 'DROPPED')) && onBoard(m.pos),
  );
  const from = o.pos;
  o.pos = { ...anchor };
  o.stop = stop;
  o.active = stop !== o.def.initialStop;
  if (o.active) o.everActive = true;
  // TRANSLATE through the shared transform (mechanism-transform.ts): riders keep relative positions.
  applyTransform(ctx.state, { to: (p) => addPos(p, delta), turns: 0, units, mechanisms: riders });
  emitCue(ctx, o, 'PLATFORM_MOVED', {
    from: { ...from },
    ...(causeId ? { causeId } : {}),
    carriedIds: [...units.map((u) => u.id), ...riders.map((m) => m.def.id)],
  });
  // Riders are moved by the floor, not by walking: presentation sees them like a teleport.
  for (const u of units) ctx.emit({ type: 'UNIT_TELEPORTED', unitId: u.id, from: addPos(u.pos, delta, -1), to: { ...u.pos }, sourceId: `mechanism:${o.def.id}` });
  return true;
}

/** Next stop in declaration order (cycles). */
export function advancePlatform(ctx: RuleContext, o: MechanismObject, causeId?: string): boolean {
  const names = Object.keys(o.def.stops ?? {});
  if (names.length < 2) return false;
  const next = names[(names.indexOf(o.stop ?? names[0]!) + 1) % names.length]!;
  return movePlatform(ctx, o, next, causeId);
}

/** RESET: back to the initial stop (blocked like any move). */
export function platformHome(ctx: RuleContext, o: MechanismObject, causeId?: string): boolean {
  return !!o.def.initialStop && movePlatform(ctx, o, o.def.initialStop, causeId);
}
