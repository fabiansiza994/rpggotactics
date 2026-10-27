import { samePos, type Pos } from '../core/position';
import type { ObjectiveDef, ObjectiveStatus } from '../objectives/objective';
import { evaluateObjective } from '../objectives/objective-rules';
import type { GameState } from '../state';
import type { MechanismGoal } from './mechanism';
import { mechanismById } from './mechanism-board';
import { heldKey, stageKey } from './mechanism-rules';

/** The MECHANISM objective (objectives/objective.ts). Escape-after-unlock stays a plain REACH_TILE. */
export interface MechanismObjectiveDef {
  type: 'MECHANISM';
  goal: MechanismGoal;
  /** Switches/plates (ACTIVATE_N, KEEP_ACTIVE), gates (OPEN), relics, statues or flag names. */
  ids: string[];
  /** ACTIVATE_N / COLLECT_RELIC count (default: all ids); KEEP_ACTIVE rounds (default 1). */
  required?: number;
  /** MOVE_OBJECT: target tiles. */
  tiles?: Pos[];
  roundLimit?: number;
  /** Short Spanish objective title for the HUD ("Abre la puerta sellada"). */
  label?: string;
  /** STAGES: ordered sub-objectives, each with its own HUD label. */
  stages?: readonly { label: string; objective: ObjectiveDef }[];
}

/** Stages done (latched) of a STAGES objective, by its index in `state.objectives`. */
export function objectiveStage(state: Readonly<GameState>, objectiveIndex: number): number {
  return state.mechanisms?.stages?.[stageKey(objectiveIndex)] ?? 0;
}

/** Same rules as the other objectives: progress for the HUD, FAILED only by `roundLimit`. */
export function evaluateMechanismObjective(
  state: GameState,
  def: MechanismObjectiveDef,
): { status: ObjectiveStatus; current: number; target: number } {
  const objects = def.ids.map((id) => mechanismById(state, id));
  let current: number;
  let target: number;
  switch (def.goal) {
    case 'ACTIVATE_N':
      current = objects.filter((o) => o?.everActive).length;
      target = def.required ?? def.ids.length;
      break;
    case 'KEEP_ACTIVE':
      current = state.mechanisms?.held[heldKey(def.ids)] ?? 0;
      target = def.required ?? 1;
      break;
    case 'OPEN':
      current = objects.filter((o) => o?.state === 'OPEN' || o?.state === 'LOWERED').length;
      target = def.ids.length;
      break;
    case 'COLLECT_RELIC':
      current = objects.filter((o) => o?.state === 'COLLECTED').length;
      target = def.required ?? def.ids.length;
      break;
    case 'MOVE_OBJECT':
      current = objects.filter((o) => o && (def.tiles ?? []).some((t) => samePos(t, o.pos))).length;
      target = def.ids.length;
      break;
    case 'FLAG':
      current = def.ids.filter((f) => state.mechanisms?.flags.includes(f)).length;
      target = def.ids.length;
      break;
    case 'EXTRACT_RELIC':
      current = objects.filter((o) => o?.state === 'EXTRACTED').length;
      target = def.required ?? def.ids.length;
      break;
    case 'STAGES': {
      const stages = def.stages ?? [];
      const index = state.objectives.findIndex((o) => o.def === def);
      current = index >= 0 ? objectiveStage(state, index) : 0;
      target = stages.length;
      // The current stage failing (its own round limit) fails the mission.
      const now = stages[current];
      if (now && current < target && evaluateObjective(state, now.objective).status === 'FAILED')
        return { status: 'FAILED', current, target };
      break;
    }
  }
  const done = current >= target;
  const failed = !done && def.roundLimit !== undefined && state.round > def.roundLimit;
  return { status: done ? 'COMPLETED' : failed ? 'FAILED' : 'IN_PROGRESS', current: Math.min(current, target), target };
}
