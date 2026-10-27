import { clearBattleForms } from '../transformations/transformations';
import { getEnemies, getHero, unitById } from '../board/occupancy';
import type { RuleContext } from '../context';
import { samePos } from '../core/position';
import type { BattleOutcome, GameState } from '../state';
import type { ObjectiveDef, ObjectiveState } from './objective';
import { evaluateMechanismObjective } from '../mechanisms/mechanism-objectives';
import { syncMechanisms } from '../mechanisms/mechanism-rules';

type Evaluation = Omit<ObjectiveState, 'def'>;

/**
 * Strategy per objective type. Rounds: an objective with `rounds`/`roundLimit` = N is judged
 * when round N has fully ended (state.round becomes N + 1).
 */
export function evaluateObjective(state: GameState, def: ObjectiveDef): Evaluation {
  switch (def.type) {
    case 'ELIMINATE_ALL': {
      const pending = state.pendingWaves.some((w) => w.enemies.length > 0);
      const done = getEnemies(state).length === 0 && !pending;
      const failed = !done && def.roundLimit !== undefined && state.round > def.roundLimit;
      return {
        status: done ? 'COMPLETED' : failed ? 'FAILED' : 'IN_PROGRESS',
        current: state.stats.enemiesDefeated,
        target: state.stats.totalEnemies,
      };
    }
    case 'PROTECT_TARGET': {
      const alive = !!unitById(state, def.targetUnitId);
      const survived = Math.min(state.round - 1, def.rounds);
      return {
        status: !alive ? 'FAILED' : state.round > def.rounds ? 'COMPLETED' : 'IN_PROGRESS',
        current: survived,
        target: def.rounds,
      };
    }
    case 'DEFEAT_TARGET': {
      const pending = state.pendingWaves.some((w) => w.enemies.some((e) => e.id === def.targetUnitId));
      const done = !pending && !unitById(state, def.targetUnitId);
      const failed = !done && def.roundLimit !== undefined && state.round > def.roundLimit;
      return { status: done ? 'COMPLETED' : failed ? 'FAILED' : 'IN_PROGRESS', current: done ? 1 : 0, target: 1 };
    }
    case 'COLLECT_OBJECTS': {
      const items = state.collectibles.filter((c) => c.kind === def.kind);
      const got = items.filter((c) => c.collected).length;
      const done = got >= def.required;
      const failed = !done && def.roundLimit !== undefined && state.round > def.roundLimit;
      return {
        status: done ? 'COMPLETED' : failed ? 'FAILED' : 'IN_PROGRESS',
        current: Math.min(got, def.required),
        target: def.required,
      };
    }
    case 'SURVIVE_ROUNDS':
      return {
        status: state.round > def.rounds ? 'COMPLETED' : 'IN_PROGRESS',
        current: Math.min(state.round - 1, def.rounds),
        target: def.rounds,
      };
    case 'REACH_TILE': {
      const hero = getHero(state);
      const reached = !!hero && def.tiles.some((t) => samePos(t, hero.pos));
      return {
        status: reached ? 'COMPLETED' : state.round > def.roundLimit ? 'FAILED' : 'IN_PROGRESS',
        current: Math.min(state.round, def.roundLimit),
        target: def.roundLimit,
      };
    }
    case 'MECHANISM':
      return evaluateMechanismObjective(state, def);
  }
}

function lossReason(def: ObjectiveDef): BattleOutcome['reason'] {
  return def.type === 'PROTECT_TARGET' ? 'PROTECTED_TARGET_DESTROYED' : 'ROUND_LIMIT_REACHED';
}

/**
 * Re-evaluates every objective, emits OBJECTIVE_UPDATED on change, and settles the outcome:
 * hero dead or any FAILED → LOST; all COMPLETED → WON. Returns true if the battle ended.
 */
export function updateObjectives(ctx: RuleContext): boolean {
  const { state } = ctx;
  if (state.outcome) return true;
  if (state.duel) {
    const own = state.units.some(u => u.id === state.player.heroId);
    const rival = state.units.some(u => u.id === state.duel!.other.heroId);
    if (own && rival) return false;
    state.outcome = { result: own ? 'WON' : 'LOST', reason: 'HERO_DEFEATED' };
    state.phase = 'ENDED';
    clearBattleForms(state, ctx.content);
    ctx.emit({ type: own ? 'BATTLE_WON' : 'BATTLE_LOST', outcome: state.outcome });
    return true;
  }

  // Interactive battlefield first: plates/gates settle before objectives read them (PvE only).
  if (state.mechanisms) syncMechanisms(ctx);
  state.objectives.forEach((obj, index) => {
    const next = evaluateObjective(state, obj.def);
    if (next.status !== obj.status || next.current !== obj.current || next.target !== obj.target) {
      Object.assign(obj, next);
      ctx.emit({ type: 'OBJECTIVE_UPDATED', index, ...next });
    }
  });

  let outcome: BattleOutcome | null = null;
  const failed = state.objectives.find((o) => o.status === 'FAILED');
  if (!getHero(state)) outcome = { result: 'LOST', reason: 'HERO_DEFEATED' };
  else if (failed) outcome = { result: 'LOST', reason: lossReason(failed.def) };
  else if (state.objectives.every((o) => o.status === 'COMPLETED')) {
    outcome = { result: 'WON', reason: 'OBJECTIVES_COMPLETED' };
  }

  if (!outcome) return false;
  state.outcome = outcome;
  state.phase = 'ENDED';
  clearBattleForms(state, ctx.content);
  ctx.emit({ type: outcome.result === 'WON' ? 'BATTLE_WON' : 'BATTLE_LOST', outcome } as const);
  return true;
}
