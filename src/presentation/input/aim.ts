import type { PairSelection } from './pairSelection';
import { samePos, type GameEngine, type Pos } from '../../game';

/**
 * One aimed tile feeds the board preview, whatever the input device:
 * - `hover`: a fine pointer resting over the tile (desktop). A click acts immediately.
 * - `tap`:   a touch/pen tap armed this tile. Only a second tap on it (or Confirm) acts.
 * The preview/validation itself is always the engine's (`previewCard`, `getLegalMoves`).
 */
export interface Aim {
  pos: Pos;
  source: 'hover' | 'tap';
}

type Queries = Pick<GameEngine, 'state' | 'heroId' | 'previewCard' | 'getLegalMoves' | 'selectionTargeting'> & Partial<Pick<GameEngine, 'getSecondaryTargets'>>;

/** Would acting on `pos` do something right now? Same engine queries the desktop preview uses. */
export function isActionableTile(
  engine: Queries,
  selectedCardUid: string | null,
  pos: Pos,
  pair?: PairSelection | null,
): boolean {
  if (engine.state.phase !== 'PLAYER') return false;
  if (!selectedCardUid) return engine.getLegalMoves().some((n) => samePos(n.pos, pos));
  if (pair?.cardUid === selectedCardUid && engine.getSecondaryTargets) {
    const hero=engine.state.units.find(u=>u.id===engine.heroId);
    const secondary=hero && samePos(hero.pos,pos)?null:pos;
    return engine.getSecondaryTargets(selectedCardUid,pair.first).some(p=>p===null?secondary===null:!!secondary&&samePos(p,secondary)) && engine.previewCard(selectedCardUid,pair.first,secondary).valid;
  }
  // A hand card or a ritual activation (see GameEngine selection keys).
  const targeting = engine.selectionTargeting(selectedCardUid);
  if (!targeting) return false;
  if (targeting.type === 'UNIT' && targeting.pairSwap && engine.getSecondaryTargets) return engine.getSecondaryTargets(selectedCardUid, pos).length > 0;
  if (targeting.type === 'SELF') {
    const hero = engine.state.units.find((u) => u.id === engine.heroId);
    return !!hero && samePos(hero.pos, pos) && engine.previewCard(selectedCardUid, null).valid;
  }
  return engine.previewCard(selectedCardUid, pos).valid;
}

/**
 * A touch lands on the ground tile and possibly on unit bodies standing in front of it.
 * Prefer the first candidate that is actionable (so tapping an enemy's body targets the enemy,
 * not the empty tile behind its head); otherwise keep the first candidate for feedback.
 */
export function resolveTapTarget(
  candidates: readonly Pos[],
  actionable: (p: Pos) => boolean,
): Pos | null {
  return candidates.find(actionable) ?? candidates[0] ?? null;
}

/** Unit cards pick the visible figure before the ground behind it; terrain and movement keep ground picking. */
export function resolveMouseTarget(
  ground: Pos | null,
  bodies: readonly Pos[],
  unitTargeting: boolean,
  legalTargets: readonly Pos[],
): Pos | null {
  return (
    (unitTargeting
      ? bodies.find((body) => legalTargets.some((target) => samePos(body, target)))
      : undefined) ?? ground
  );
}

export type TapDecision =
  { kind: 'clear' } | { kind: 'aim'; pos: Pos } | { kind: 'confirm'; pos: Pos };

/** First tap previews; a second tap on the same armed tile confirms; another tile moves the preview. */
export function decideTap(aim: Aim | null, pos: Pos | null): TapDecision {
  if (!pos) return { kind: 'clear' };
  if (aim?.source === 'tap' && samePos(aim.pos, pos)) return { kind: 'confirm', pos };
  return { kind: 'aim', pos };
}
