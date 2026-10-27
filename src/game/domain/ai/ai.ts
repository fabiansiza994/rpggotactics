import { depthEnabled } from '../combat/qa-depth';
import { terrainDefAt } from '../board/occupancy';
import { inBounds } from '../board/board';
import {
  canEnter,
  effectiveMoveRange,
  getHero,
  isActionPrevented,
  isMovementPrevented,
  unitAt,
  unitById,
} from '../board/occupancy';
import { computeReachable, stepCost, truncatePath, type PathNode } from '../board/pathfinding';
import { cutPathAtTrap } from '../combat/traps';
import { areaTiles } from '../cards/targeting';
import { dealDamage } from '../combat/damage';
import { attackDamage, challenger, ridersSuppressed } from '../combat/attack-modifiers';
import type { DamageType } from '../combat/damage-types';
import { pushUnit, walkUnit } from '../combat/movement';
import { requireDef, type EnemyDef, type EnemyPhaseDef } from '../content';
import type { RuleContext } from '../context';
import {
  alignedDirection,
  comparePos,
  dominantDirection,
  manhattan,
  samePos,
  step,
  type Direction,
  type Pos,
} from '../core/position';
import type { Unit } from '../entities/unit';
import { applyStatus } from '../statuses/status-rules';
import { createTerrain } from '../terrain/terrain-rules';
import type { BehaviorDef, EnemyIntent, HitRider } from './behavior';

/**
 * Concrete, fully computed consequence of an intent against the CURRENT state.
 * The exact same function drives the UI telegraph (preview) and the enemy phase (execution),
 * so what the player sees is what happens — unless the player changes the board first.
 */
export interface IntentPlan {
  enemyId: string;
  intent: EnemyIntent;
  /** Tiles walked, excluding the start. */
  path: Pos[];
  cost: number;
  end: Pos;
  /** Tiles that WILL be hit if nothing changes. */
  attackTiles: Pos[];
  /** Tiles the intent threatens (lane of a charge, locked area, melee tile). */
  threatTiles: Pos[];
  targetUnitIds: string[];
  damage: number;
  damageType: DamageType;
  /** What the attack does besides damage (push / status / terrain), for telegraphs. */
  onHit?: HitRider;
}

export const enemyDef = (ctx: RuleContext, enemy: Unit): EnemyDef =>
  requireDef(ctx.content.enemies, enemy.defId, 'enemy');

/** The phase this enemy is in (see `EnemyDef.phases`); null = its base behaviour. */
export function enemyPhase(def: EnemyDef, enemy: Pick<Unit, 'hp' | 'maxHp'>): EnemyPhaseDef | null {
  const reached = (def.phases ?? []).filter((p) => enemy.hp * 100 <= enemy.maxHp * p.belowHpPct);
  return reached.sort((a, b) => a.belowHpPct - b.belowHpPct)[0] ?? null;
}

/** The behaviour the enemy acts with right now (its phase's, else the base one). */
export function enemyBehavior(ctx: RuleContext, enemy: Unit): BehaviorDef {
  const def = enemyDef(ctx, enemy);
  return enemyPhase(def, enemy)?.behavior ?? def.behavior;
}

/** Whom the enemy goes after. Deterministic: preference, then distance, then id. */
export function chooseTarget(ctx: RuleContext, enemy: Unit): Unit | undefined {
  // Desafío: a challenged enemy goes after its challenger while that champion is alive.
  const challengedBy = challenger(ctx, enemy);
  if (challengedBy) return challengedBy;
  const hostiles = ctx.state.units.filter((u) => u.faction !== enemy.faction);
  const byDistance = (a: Unit, b: Unit) =>
    manhattan(enemy.pos, a.pos) - manhattan(enemy.pos, b.pos) || a.id.localeCompare(b.id);
  if (enemy.targetPreference === 'OBJECTIVE') {
    const structure = hostiles.filter((u) => u.kind === 'STRUCTURE').sort(byDistance)[0];
    if (structure) return structure;
  }
  const blocker = hostiles
    .filter((u) => u.kind === 'SUMMON' && manhattan(enemy.pos, u.pos) === 1)
    .sort(byDistance)[0];
  return blocker ?? getHero(ctx.state) ?? hostiles.sort(byDistance)[0];
}

/** Walk a charge lane: empty tiles are traversed, the first unit within range is hit. */
function traceCharge(
  ctx: RuleContext,
  enemy: Unit,
  dir: Direction,
  range: number,
  canMove: boolean,
): { path: Pos[]; lane: Pos[]; hit: Unit | null } {
  const path: Pos[] = [];
  const lane: Pos[] = [];
  let current = enemy.pos;
  for (let i = 1; i <= range; i++) {
    const next = step(current, dir);
    if (!inBounds(ctx.state.board, next)) break;
    const occupant = unitAt(ctx.state, next);
    if (occupant) {
      lane.push(next);
      return { path, lane, hit: occupant };
    }
    if (!canEnter(ctx, next, enemy.id)) break;
    lane.push(next);
    if (!canMove) break;
    path.push(next);
    current = next;
  }
  return { path, lane, hit: null };
}

function chargeLaneHitsTarget(
  ctx: RuleContext,
  enemy: Unit,
  from: Pos,
  target: Unit,
  range: number,
): boolean {
  const dir = alignedDirection(from, target.pos);
  if (!dir) return false;
  const probe = { ...enemy, pos: from };
  const { hit } = traceCharge(ctx, probe, dir, range, true);
  return hit?.id === target.id;
}

/** Best tile to walk toward, given a goal test. Deterministic tie-breaks. */
export function approach(
  ctx: RuleContext,
  enemy: Unit,
  target: Pick<Unit, 'pos'>,
  isGoal: (p: Pos) => boolean,
): PathNode {
  const stay: PathNode = { pos: enemy.pos, cost: 0, path: [] };
  if (isMovementPrevented(ctx, enemy) || isGoal(enemy.pos)) return stay;

  const all = computeReachable(ctx, enemy);
  const goals = [...all.values()]
    .filter((n) => isGoal(n.pos))
    .sort(
      (a, b) =>
        (enemy.kind === 'SUMMON'
          ? a.path.filter((p) => terrainDefAt(ctx, p)?.isHazard).length -
            b.path.filter((p) => terrainDefAt(ctx, p)?.isHazard).length
          : 0) ||
        a.cost - b.cost ||
        comparePos(a.pos, b.pos),
    );
  const best = goals[0];
  if (best) return truncatePath(ctx, enemy.pos, best.path, effectiveMoveRange(ctx, enemy));

  // No goal reachable: get as close as possible (only if it actually gets closer).
  const inBudget = [...computeReachable(ctx, enemy, effectiveMoveRange(ctx, enemy)).values()].sort(
    (a, b) =>
      manhattan(a.pos, target.pos) - manhattan(b.pos, target.pos) ||
      a.cost - b.cost ||
      comparePos(a.pos, b.pos),
  );
  const closest = inBudget[0];
  if (closest && manhattan(closest.pos, target.pos) < manhattan(enemy.pos, target.pos))
    return closest;
  return stay;
}

/** Decide what the enemy will do this round. Pure function of the state. */
export function declareIntent(ctx: RuleContext, enemy: Unit): EnemyIntent {
  if (isActionPrevented(ctx, enemy)) return { kind: 'IDLE', enemyId: enemy.id, reason: 'STUNNED' };
  const target = chooseTarget(ctx, enemy);
  if (!target) return { kind: 'IDLE', enemyId: enemy.id, reason: 'NO_TARGET' };
  const behavior = enemyBehavior(ctx, enemy);

  switch (behavior.type) {
    case 'MELEE':
      return {
        kind: 'MELEE_ATTACK',
        enemyId: enemy.id,
        targetUnitId: target.id,
        damage: behavior.damage,
      };
    case 'CHARGE': {
      const dir = alignedDirection(enemy.pos, target.pos);
      if (dir && chargeLaneHitsTarget(ctx, enemy, enemy.pos, target, behavior.range)) {
        return {
          kind: 'CHARGE',
          enemyId: enemy.id,
          direction: dir,
          range: behavior.range,
          damage: behavior.damage,
        };
      }
      return { kind: 'APPROACH', enemyId: enemy.id, targetUnitId: target.id };
    }
    case 'AREA_CASTER': {
      if (manhattan(enemy.pos, target.pos) <= behavior.castRange) {
        return {
          kind: 'AREA_SPELL',
          enemyId: enemy.id,
          center: target.pos,
          tiles: areaTiles(ctx.state.board, behavior.area, target.pos, enemy.pos),
          damage: behavior.damage,
        };
      }
      return { kind: 'APPROACH', enemyId: enemy.id, targetUnitId: target.id };
    }
  }
}

/** The walk cut at a hostile trap (the enemy stops on it, so the telegraph matches execution). */
function stopAtTrap(ctx: RuleContext, enemy: Unit, node: PathNode): PathNode {
  const path = cutPathAtTrap(ctx, enemy, node.path);
  if (path.length === node.path.length) return node;
  let cost = 0;
  path.forEach((p, i) => (cost += stepCost(ctx, i === 0 ? enemy.pos : path[i - 1]!, p)));
  return { pos: path[path.length - 1] ?? enemy.pos, cost, path };
}

export function planIntent(ctx: RuleContext, intent: EnemyIntent): IntentPlan | null {
  const enemy = unitById(ctx.state, intent.enemyId);
  if (!enemy) return null;
  const behavior = enemyBehavior(ctx, enemy);
  // Telegraph = execution: attack modifiers (Sellado, Humo…) against the intent's main target.
  const raw = 'damage' in intent ? intent.damage : 0;
  const mainTarget =
    ('targetUnitId' in intent ? unitById(ctx.state, intent.targetUnitId) : undefined) ?? getHero(ctx.state);
  const base: IntentPlan = {
    enemyId: enemy.id,
    intent,
    path: [],
    cost: 0,
    end: enemy.pos,
    attackTiles: [],
    threatTiles: [],
    targetUnitIds: [],
    damage: mainTarget ? attackDamage(ctx, enemy, mainTarget, raw) : raw,
    damageType: behavior.damageType,
    ...(behavior.onHit && !ridersSuppressed(ctx, enemy) ? { onHit: behavior.onHit } : {}),
  };
  if (isActionPrevented(ctx, enemy) || intent.kind === 'IDLE') return base;
  const canMove = !isMovementPrevented(ctx, enemy);

  switch (intent.kind) {
    case 'MELEE_ATTACK': {
      const target = unitById(ctx.state, intent.targetUnitId);
      if (!target) return base;
      const node = stopAtTrap(ctx, enemy, approach(ctx, enemy, target, (p) => manhattan(p, target.pos) === 1));
      const adjacent = manhattan(node.pos, target.pos) === 1;
      return {
        ...base,
        path: node.path,
        cost: node.cost,
        end: node.pos,
        attackTiles: adjacent ? [target.pos] : [],
        threatTiles: [target.pos],
        targetUnitIds: adjacent ? [target.id] : [],
        damage: attackDamage(ctx, enemy, target, raw),
      };
    }
    case 'APPROACH': {
      const target = unitById(ctx.state, intent.targetUnitId);
      if (!target) return base;
      const goal =
        behavior.type === 'CHARGE'
          ? (p: Pos) => chargeLaneHitsTarget(ctx, enemy, p, target, behavior.range)
          : behavior.type === 'AREA_CASTER'
            ? (p: Pos) => manhattan(p, target.pos) <= behavior.castRange
            : (p: Pos) => manhattan(p, target.pos) === 1;
      const node = stopAtTrap(ctx, enemy, approach(ctx, enemy, target, goal));
      return { ...base, path: node.path, cost: node.cost, end: node.pos, damage: 0 };
    }
    case 'CHARGE': {
      const full = traceCharge(ctx, enemy, intent.direction, intent.range, canMove);
      // A trap in the lane stops the charge on it: no impact.
      const path = cutPathAtTrap(ctx, enemy, full.path);
      const trace = path.length === full.path.length ? full : { ...full, path, hit: null };
      const end = trace.path[trace.path.length - 1] ?? enemy.pos;
      return {
        ...base,
        ...(trace.hit ? { damage: attackDamage(ctx, enemy, trace.hit, raw) } : {}),
        path: trace.path,
        cost: trace.path.length,
        end,
        attackTiles: trace.hit ? [trace.hit.pos] : [],
        threatTiles: trace.lane,
        targetUnitIds: trace.hit ? [trace.hit.id] : [],
      };
    }
    case 'AREA_SPELL': {
      const tiles = intent.tiles;
      const victims = ctx.state.units.filter(
        (u) => u.faction !== enemy.faction && tiles.some((t) => samePos(t, u.pos)),
      );
      return {
        ...base,
        attackTiles: tiles,
        threatTiles: tiles,
        targetUnitIds: victims.map((u) => u.id),
      };
    }
  }
}

/** Enemy phase: move, then attack, exactly as `planIntent` predicts for the current state. */
export function executeIntent(ctx: RuleContext, intent: EnemyIntent): void {
  const enemy = unitById(ctx.state, intent.enemyId);
  if (!enemy) return;
  ctx.emit({ type: 'ENEMY_ACTION_STARTED', enemyId: enemy.id, intent });
  const plan = planIntent(ctx, intent);
  if (plan) {
    if (plan.path.length > 0) {
      walkUnit(ctx, enemy, plan.path, plan.cost, intent.kind === 'CHARGE' ? 'CHARGE' : 'WALK');
    }
    if (plan.targetUnitIds.length > 0 || plan.attackTiles.length > 0) {
      ctx.emit({
        type: 'ENEMY_ATTACKED',
        enemyId: enemy.id,
        intentKind: intent.kind,
        tiles: plan.attackTiles,
        targetUnitIds: plan.targetUnitIds,
        damageType: plan.damageType,
      });
      const raw = 'damage' in intent ? intent.damage : 0;
      for (const id of plan.targetUnitIds) {
        const victim = unitById(ctx.state, id);
        if (victim) dealDamage(ctx, victim, attackDamage(ctx, enemy, victim, raw), enemy.id, plan.damageType, depthEnabled(ctx) && intent.kind === 'MELEE_ATTACK' ? 'DIRECT_MELEE' : undefined);
      }
      if (plan.onHit) applyHitRider(ctx, enemy, intent, plan, plan.onHit);
    }
  }
  ctx.emit({ type: 'ENEMY_ACTION_ENDED', enemyId: enemy.id });
}

export function declareAllIntents(ctx: RuleContext): void {
  ctx.state.intents = ctx.state.units
    .filter((u) => u.kind === 'ENEMY')
    .map((enemy) => declareIntent(ctx, enemy));
  for (const intent of ctx.state.intents) ctx.emit({ type: 'ENEMY_INTENT_DECLARED', intent });
}

/** See HitRider. Deterministic: victims in plan order, tiles in plan order. */
function applyHitRider(ctx: RuleContext, enemy: Unit, intent: EnemyIntent, plan: IntentPlan, rider: HitRider): void {
  const area = intent.kind === 'AREA_SPELL';
  const hitTiles: Pos[] = [];
  for (const id of plan.targetUnitIds) {
    const victim = unitById(ctx.state, id);
    if (!victim) continue;
    hitTiles.push(victim.pos);
    if (rider.push && victim.kind !== 'STRUCTURE') {
      const origin = area && !samePos(intent.center, victim.pos) ? intent.center : enemy.pos;
      const dir = alignedDirection(origin, victim.pos) ?? dominantDirection(origin, victim.pos);
      if (dir) pushUnit(ctx, victim, dir, rider.push.distance, rider.push.collisionDamage, enemy.id);
    }
    if (rider.status && victim.kind !== 'STRUCTURE' && ctx.state.units.includes(victim))
      applyStatus(ctx, victim, rider.status.status, rider.status.duration, enemy.id);
  }
  if (!rider.scorch) return;
  const tiles = area
    ? rider.scorch.tiles === 'AREA'
      ? plan.attackTiles
      : [intent.center]
    : rider.scorch.tiles === 'AREA'
      ? plan.attackTiles
      : hitTiles;
  for (const p of tiles) createTerrain(ctx, p, rider.scorch.terrain, rider.scorch.turns, enemy.id);
}
