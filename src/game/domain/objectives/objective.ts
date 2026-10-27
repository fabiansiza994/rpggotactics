import type { Pos } from '../core/position';
import type { CollectibleKind } from '../entities/collectible';
import type { MechanismObjectiveDef } from '../mechanisms/mechanism-objectives';

/**
 * Data-driven objectives. A scenario lists one or more; the battle is WON when all are
 * COMPLETED and LOST as soon as any is FAILED (or the hero dies). Composition is a list:
 * e.g. [COLLECT_OBJECTS, DEFEAT_TARGET] needs both.
 */
export type ObjectiveDef =
  | { type: 'ELIMINATE_ALL'; roundLimit?: number }
  | { type: 'PROTECT_TARGET'; targetUnitId: string; rounds: number }
  | { type: 'REACH_TILE'; tiles: Pos[]; roundLimit: number }
  /** Defeat one specific enemy (mini-boss / boss); the rest of its force may remain. */
  | { type: 'DEFEAT_TARGET'; targetUnitId: string; roundLimit?: number }
  /** Pick up `required` of the scenario's collectibles of `kind` (hero walks onto them). */
  | { type: 'COLLECT_OBJECTS'; kind: CollectibleKind; required: number; roundLimit?: number }
  /** Keep the hero alive until `rounds` full rounds have ended. Fails only by hero death. */
  | { type: 'SURVIVE_ROUNDS'; rounds: number }
  /** Interactive battlefield goals (Act III): switches, plates, gates, relics, statues. */
  | MechanismObjectiveDef;

export type ObjectiveType = ObjectiveDef['type'];

export type ObjectiveStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface ObjectiveState {
  def: ObjectiveDef;
  status: ObjectiveStatus;
  /** Generic progress for UI: e.g. enemies defeated / total, rounds survived / required. */
  current: number;
  target: number;
}
