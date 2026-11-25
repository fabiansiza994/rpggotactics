import {freezeSpellGround} from '../cards/ice-terrain';
import {beastsEnabled} from '../combat/beasts-release';
import {applyTurtleBite} from '../statuses/turtle-bite';
import {ravenPursuit,weakenedPrey} from '../combat/raven';
import {wolfPursuit} from '../combat/blood-trail';
import {worldFrozen} from '../cards/world-frozen';
import { depthEnabled } from '../combat/qa-depth';
import {
  canEnter,
  effectiveMoveRange,
  isActionPrevented,
  isEmptyTile,
  isMovementPrevented,
  terrainDefAt,
  unitById,
} from '../board/occupancy';
import { hasLineOfSight } from '../board/line-of-sight';
import {scoutSiegeEnabled,drakeScorch} from '../combat/scout-siege';
import { applyStatus, cleanseUnit, removeStatus } from '../statuses/status-rules';
import { computeReachable, stepCost, truncatePath, type PathNode } from '../board/pathfinding';
import { comparePos } from '../core/position';
import { approach } from '../ai/ai';
import { dealDamage, defeatUnit } from '../combat/damage';
import { attackDamage, challenger } from '../combat/attack-modifiers';
import { walkUnit } from '../combat/movement';
import { requireDef, type GameContent, type SummonDef } from '../content';
import type { RuleContext } from '../context';
import { DIRECTIONS, DIRECTION_VECTORS, addPos, step, manhattan, samePos, type Pos } from '../core/position';
import { inBounds } from '../board/board';
import type { Unit } from '../entities/unit';
import { collectAlong } from '../objectives/collect-rules';
import type { GameState } from '../state';
import { holdsPlate } from '../mechanisms/mechanism-board';

export const summonUsage = (state: Readonly<GameState>, ownerId: string): number =>
  state.units.reduce((n, u) => n + (u.summon?.ownerId === ownerId ? u.summon.capacityCost : 0), 0);

/**
 * Effective summon capacity of `owner`: the hero's base capacity (content; a future Mastery
 * bonus belongs there too, through the battle's content) plus what this battle granted
 * (`Unit.summonCapacityBonus`). Additive, never capped: every capacity check reads this.
 */
export const summonCapacityOf = (content: Pick<GameContent, 'heroes'>, owner: Pick<Unit, 'defId' | 'summonCapacityBonus'>): number =>
  (content.heroes[owner.defId]?.summonCapacity ?? 0) + (owner.summonCapacityBonus ?? 0);

/** Per-owner field limit; climate only upgrades its own Snow Soldiers, never capacity. */
export const summonLimitFor = (def: Pick<SummonDef, 'id' | 'maxPerOwner'>, owner: Pick<Unit, 'statuses'>): number | undefined =>
  def.id === 'snow_soldier' && worldFrozen(owner) ? 2 : def.maxPerOwner;

export function spawnSummon(
  ctx: RuleContext,
  owner: Unit,
  summonId: string,
  pos: Pos,
  sourceCardUid?: string,
): Unit | null {
  const def = requireDef(ctx.content.summons ?? {}, summonId, 'summon');
  const limit = summonLimitFor(def, owner);
  if(limit !== undefined && ctx.state.units.filter(u=>u.defId===def.id&&u.summon?.ownerId===owner.id).length>=limit)return null;
  const capacity = summonCapacityOf(ctx.content, owner);
  if (!isEmptyTile(ctx, pos) || summonUsage(ctx.state, owner.id) + def.capacityCost > capacity)
    return null;
  const unit: Unit = {
    id: `summon-${ctx.state.nextId++}`,
    defId: def.id,
    name: def.name,
    kind: 'SUMMON',
    faction: owner.faction,
    pos: { ...pos },
    hp: def.maxHp,
    maxHp: def.maxHp,
    armor: def.armor,
    shield: 0,
    moveRange: def.id === 'pact_golem' && ctx.state.duel?.rankedPactGolem ? 3 : def.moveRange,
    statuses: [],
    targetPreference: 'HERO',
    summon: {
      ...(sourceCardUid ? { sourceCardUid } : {}),
      ownerId: owner.id,
      ...(sourceCardUid ? { sourceCardUid } : {}),
      ...(def.durationTurns ? { durationTurnsLeft: def.durationTurns } : {}),
      ...(def.capacityAura ? { capacityGranted: def.capacityAura } : {}),
      capacityCost: def.capacityCost,
      lastActedRound: 0,
      readyRound: ctx.state.round + 1,
      ...(def.meltTurns?{meltTurnsLeft:def.meltTurns}:{}),
    },
  };
  if (depthEnabled(ctx)) unit.combatFacing = unit.faction === 'PLAYER' ? 'RIGHT' : 'LEFT';
  ctx.state.units.push(unit);
  if (def.capacityAura) {
    const from = summonCapacityOf(ctx.content, owner);
    owner.summonCapacityBonus = (owner.summonCapacityBonus ?? 0) + def.capacityAura;
    ctx.emit({ type: 'SUMMON_CAPACITY_CHANGED', unitId: owner.id, from, to: summonCapacityOf(ctx.content, owner), bonus: owner.summonCapacityBonus });
  }
  ctx.emit({
    type: 'UNIT_SPAWNED',
    unitId: unit.id,
    faction: unit.faction,
    kind: unit.kind,
    pos: unit.pos,
  });
  collectAlong(ctx, unit, [unit.pos]);
  return unit;
}

/** Retreat uses only short legal paths; every traversed tile must be hazard-free.
 * Maximise minimum hostile distance, then prefer the shortest path and stable tile order.
 * No candidate that fails to improve safety can move the unit.
 */
export function retreatSummon(ctx: RuleContext, unit: Unit, steps: number): void {
  if (isMovementPrevented(ctx, unit) || steps <= 0) return;
  const hostiles = ctx.state.units.filter((u) => u.faction !== unit.faction);
  if (!hostiles.length) return;
  const distance = (pos: Pos) => Math.min(...hostiles.map((u) => manhattan(pos, u.pos)));
  const current = distance(unit.pos);
  // At most 4 + 16 path extensions: discard hazards during expansion, so a
  // hazardous shortest path cannot hide another legal safe route to the same tile.
  const nodes: PathNode[] = [];
  let frontier: PathNode[] = [{ pos: unit.pos, path: [], cost: 0 }];
  for (let depth = 0; depth < Math.min(2, steps); depth++) {
    const next: PathNode[] = [];
    for (const node of frontier)
      for (const dir of DIRECTIONS) {
        const pos = step(node.pos, dir),
          cost = node.cost + stepCost(ctx, node.pos, pos, unit);
        if (
          cost > 2 ||
          samePos(pos, unit.pos) ||
          node.path.some((p) => samePos(p, pos)) ||
          !canEnter(ctx, pos, unit.id) ||
          terrainDefAt(ctx, pos)?.isHazard
        )
          continue;
        next.push({ pos, cost, path: [...node.path, pos] });
      }
    nodes.push(...next);
    frontier = next;
  }
  const best = nodes
    .filter((n) => distance(n.pos) > current)
    .sort(
      (a, b) => distance(b.pos) - distance(a.pos) || a.cost - b.cost || comparePos(a.pos, b.pos),
    )[0];
  if (best) walkUnit(ctx, unit, best.path, best.cost);
}

/** The hostile unit its owner marked as prey (Marcar Presa), if it is still on the board. */
export function markedPrey(ctx: RuleContext, summon: Unit): Unit | undefined {
  const ownerId = summon.summon?.ownerId;
  if (!ownerId) return undefined;
  return ctx.state.units.find(
    (u) =>
      u.faction !== summon.faction &&
      u.statuses.some((s) => s.sourceId === ownerId && ctx.content.statuses[s.id]?.preyMark),
  );
}

/**
 * Where a summon must stand to attack its marked prey THIS activation, or null when it cannot
 * (then it keeps its normal behaviour). Only legal walks within its move range, never across or
 * onto hazards, never leaving a held objective (Tortuga) and respecting its attack band (the
 * Cuervo shoots from 2–3 with line of sight). Skirmishers still pick the least exposed tile.
 */
export function preyStrike(ctx: RuleContext, unit: Unit, def: SummonDef, prey: Unit, holding: boolean): PathNode | null {
  const range = def.attackRange ?? 1;
  const minRange = def.behavior === 'RANGED' ? 2 : 1;
  const canStrike = (pos: Pos) =>
    manhattan(pos, prey.pos) <= range && manhattan(pos, prey.pos) >= minRange && hasLineOfSight(ctx, pos, prey.pos);
  if (canStrike(unit.pos)) return { pos: unit.pos, cost: 0, path: [] };
  if (isMovementPrevented(ctx, unit) || (def.behavior === 'GUARD' && holding)) return null;
  const threats = (pos: Pos) =>
    ctx.state.units.filter((u) => u.faction !== unit.faction && manhattan(pos, u.pos) === 1).length;
  return (
    [...computeReachable(ctx, unit, effectiveMoveRange(ctx, unit)).values()]
      .filter((n) => n.path.length > 0 && canStrike(n.pos) && n.path.every((p) => !terrainDefAt(ctx, p)?.isHazard))
      .sort(
        (a, b) =>
          (def.behavior === 'SKIRMISHER' ? threats(a.pos) - threats(b.pos) : 0) || a.cost - b.cost || comparePos(a.pos, b.pos),
      )[0] ?? null
  );
}

/**
 * Pursuit of the marked prey when it cannot be struck THIS activation: the first step (within this
 * turn's move) of the cheapest legal route to a tile it could strike from — never across or onto a
 * hazard, never through units or walls. Null = keep the normal behaviour: no such route exists,
 * the summon cannot move, or it is holding an objective/plate (those rules come first).
 */
export function preyPursuit(ctx: RuleContext, unit: Unit, def: SummonDef, prey: Unit, holding: boolean): PathNode | null {
  if (isMovementPrevented(ctx, unit) || holding) return null;
  const range = def.attackRange ?? 1;
  const minRange = def.behavior === 'RANGED' ? 2 : 1;
  const canStrike = (pos: Pos) =>
    manhattan(pos, prey.pos) <= range && manhattan(pos, prey.pos) >= minRange && hasLineOfSight(ctx, pos, prey.pos);
  const route = [...computeReachable(ctx, unit).values()]
    .filter((n) => n.path.length > 0 && canStrike(n.pos) && n.path.every((p) => !terrainDefAt(ctx, p)?.isHazard))
    .sort((a, b) => a.cost - b.cost || comparePos(a.pos, b.pos))[0];
  if (!route) return null;
  const leg = truncatePath(ctx, unit.pos, route.path, effectiveMoveRange(ctx, unit));
  return leg.cost > 0 ? leg : null;
}

/** Can act this round: ready (`readyRound`) and not acted yet (`lastActedRound`). */
export const summonCanActNow = (state: Readonly<GameState>, unit: Unit): boolean =>
  !!unit.summon && state.round >= unit.summon.readyRound && unit.summon.lastActedRound !== state.round;

/**
 * Orden del Vinculador: this round's activation of one summon, now. It is the same `actSummons`
 * step (same AI, Presa, Desafío, hazards), so it records `lastActedRound` and the end-of-turn
 * pass skips the unit: a summon never acts twice in a round.
 */
export function activateSummonNow(ctx: RuleContext, unitId: string): void {
  const unit = unitById(ctx.state, unitId);
  if (!unit || !summonCanActNow(ctx.state, unit)) return;
  ctx.emit({ type: 'SUMMON_ORDERED', unitId });
  actSummons(ctx, unit.summon!.ownerId, unitId);
}

export interface BreathCone {
  direction: Pos;
  tiles: Pos[];
  targets: Unit[];
}

/**
 * The best cone of a summon's breath from where it stands (most hostiles hit, then a hit on a
 * champion, then direction order), or null when no cone reaches a hostile. Pure read.
 */
export function breathCone(ctx: RuleContext, unit: Unit, def: SummonDef): BreathCone | null {
  const breath = def.breath;
  if (!breath) return null;
  let best: BreathCone | null = null;
  for (const dir of DIRECTIONS) {
    const v = DIRECTION_VECTORS[dir],
      side = { x: v.y, y: v.x },
      first = addPos(unit.pos, v);
    const tiles = [
      ...Array.from({ length: breath.range }, (_, i) => addPos(unit.pos, v, i + 1)),
      addPos(first, side),
      addPos(first, side, -1),
    ].filter((t) => inBounds(ctx.state.board, t) && hasLineOfSight(ctx, unit.pos, t));
    const targets = ctx.state.units
      .filter((u) => u.faction !== unit.faction && tiles.some((t) => samePos(t, u.pos)))
      .sort((a, b) => manhattan(unit.pos, a.pos) - manhattan(unit.pos, b.pos) || a.id.localeCompare(b.id));
    const heroHit = (c: BreathCone | null) => Number(!!c?.targets.some((u) => u.kind === 'HERO'));
    const cone = { direction: v, tiles, targets };
    if (
      targets.length &&
      (!best ||
        targets.length > best.targets.length ||
        (targets.length === best.targets.length && heroHit(cone) > heroHit(best)))
    )
      best = cone;
  }
  return best;
}

/** One deterministic move + peck per mature summon at player end, using normal combat rules.
 * Summons prefer uncollected mission pickups, otherwise the nearest hostile. No manual/free repeat actions.
 */
export function actSummons(ctx: RuleContext, ownerId?: string, onlyUnitId?: string): void {
  const order = ctx.state.units
    .filter((u) => u.kind === 'SUMMON' && (!ownerId || u.summon?.ownerId === ownerId) && (!onlyUnitId || u.id === onlyUnitId))
    .map((u) => u.id);
  for (const id of order) {
    const unit = unitById(ctx.state, id);
    if (
      !unit?.summon ||
      ctx.state.round < unit.summon.readyRound ||
      unit.summon.lastActedRound === ctx.state.round
    )
      continue;
    if (!unitById(ctx.state, unit.summon.ownerId)) {
      defeatUnit(ctx, unit);
      continue;
    }
    if (unit.defId === 'light_redemption_spirit') continue; // Manual support only; never auto-consume its activation.
    unit.summon.lastActedRound = ctx.state.round;
    const hunting=unit.statuses.find(s=>s.id==='UNLEASHED_HUNT');
    const pursuit=unit.statuses.some(s=>s.id==='HUNT_PURSUIT');
    let moved=false,pursuitQualified=false;
    const nearHostile=()=>ctx.state.units.some(enemy=>enemy.faction!==unit.faction && manhattan(unit.pos,enemy.pos)<=2);
    // Consume last activation's prepared bonus once; it is included in this activation's budget.
    if(pursuit)removeStatus(ctx,unit,'HUNT_PURSUIT','CONSUMED');
    try {
    if (isActionPrevented(ctx, unit)) continue;
    const baseDef = requireDef(ctx.content.summons ?? {}, unit.defId, 'summon');
    const snowball=unit.defId==='snow_soldier'&&worldFrozen(unitById(ctx.state,unit.summon.ownerId));
    const owner = unitById(ctx.state, unit.summon.ownerId);
    const loyalReaper = unit.defId === 'dark_the_reaper' && !!owner?.statuses.some(status => status.id === 'DARK_WORLD' && status.turnsLeft > 0);
    const betraying = unit.defId === 'dark_the_reaper' && !!owner && !loyalReaper && owner.hp * 10 <= owner.maxHp;
    if (unit.defId === 'dark_the_reaper') {
      const disposition = loyalReaper ? 'LOYAL' : betraying ? 'REBEL' : 'ALLY';
      if (unit.summon.reaperDisposition !== disposition) { unit.summon.reaperDisposition = disposition; ctx.emit({ type: 'REAPER_DISPOSITION', unitId: unit.id, ownerId: unit.summon.ownerId, disposition }); }
    }
    const def=snowball?{...baseDef,damageType:'ICE' as const}:loyalReaper?{...baseDef,attackRange:2}:baseDef;
    const statusSum = (key: 'summonDamageBonus' | 'summonMoveBonus' | 'summonPreyDamageBonus') =>
      unit.statuses.reduce((n, s) => n + (ctx.content.statuses[s.id]?.[key] ?? 0), 0);
    // Llamado de la Manada: planning sees the longer reach; the walk itself is the real unit's.
    const siege=scoutSiegeEnabled(ctx.state)&&unit.defId==='war_drake';
    const wings=siege&&(unit.summon.wingsReadyRound??0)<=ctx.state.round;
    const ordinaryMoveBonus=statusSum('summonMoveBonus')+(pursuit?1:0);
    const wingBonus=wings?Math.max(0,3-unit.moveRange-ordinaryMoveBonus):0;
    const moveBonus = wingBonus + ordinaryMoveBonus;
    const mover: Unit = moveBonus ? { ...unit, moveRange: unit.moveRange + moveBonus } : unit;
    const planner = beastsEnabled(ctx.state) && unit.defId==='raven' && mover.moveRange>4 ? {...mover,moveRange:4} : mover;
    const walk=(path:Pos[],cost:number)=>{
      const ordinaryBudget=effectiveMoveRange(ctx,{...planner,moveRange:planner.moveRange-wingBonus});
      // Quote before moving: ice costs and interrupted paths must not spend a free wing charge.
      const costs=wingBonus>0?path.map((_,i)=>truncatePath(ctx,unit.pos,path.slice(0,i+1),Infinity).cost):[];
      const walked=walkUnit(ctx,unit,path,cost);if(cost>0)moved=true;
      if(cost>0)pursuitQualified=nearHostile();
      if(wingBonus>0&&(costs[walked.length-1]??0)>ordinaryBudget&&ctx.state.units.includes(unit)){
        unit.summon!.wingsReadyRound=ctx.state.round+3;
        ctx.emit({type:'DRAKE_WINGS',unitId:unit.id,pos:unit.pos,readyRound:unit.summon!.wingsReadyRound});
      }
    };
    const taunter = betraying ? undefined : challenger(ctx, unit);
    const closest = (a: { pos: Pos; id: string }, b: { pos: Pos; id: string }) =>
      manhattan(unit.pos, a.pos) - manhattan(unit.pos, b.pos) || a.id.localeCompare(b.id);
    const pickup =
      def.behavior === 'SCOUT' || !def.behavior
        ? ctx.state.collectibles.filter((c) => !c.collected).sort(closest)[0]
        : undefined;
    const rankedGolem = unit.defId === 'pact_golem' && ctx.state.duel?.rankedPactGolem === true;
    const enemyChampions = rankedGolem ? ctx.state.units.filter(
      u => u.kind === 'HERO' && u.hp > 0 && u.faction !== unit.faction && ctx.state.duel!.champions.includes(u.id),
    ) : [];
    // In Ranked 1v1 the sole living rival is a pursuit target even outside the reaction radius.
    const pursuitTarget = enemyChampions.length === 1 ? enemyChampions[0] : undefined;
    const target = betraying ? owner : taunter ?? pursuitTarget ?? ctx.state.units.filter((u) => u.faction !== unit.faction).sort(closest)[0];
    const objective = ctx.state.dominion?.nodes
      .filter(
        (n) => !ctx.state.units.some((u) => samePos(u.pos, n.pos) && u.faction === unit.faction),
      )
      .sort(
        (a, b) =>
          manhattan(unit.pos, a.pos) - manhattan(unit.pos, b.pos) || a.id.localeCompare(b.id),
      )[0];
    // Act III: any summon on a plate that accepts it keeps the plate pressed (attacks, never walks off).
    const plateHold = !betraying && !!ctx.state.mechanisms && holdsPlate(ctx.state, unit);
    const holding = !betraying && (ctx.state.dominion?.nodes.some((n) => samePos(n.pos, unit.pos)) || plateHold);
    const objectiveGoal =
      objective && !betraying && (!target || manhattan(unit.pos, target.pos) > 3) && !holding
        ? objective.pos
        : undefined;
    const goal = pickup?.pos ?? objectiveGoal ?? target?.pos;
    const range = def.attackRange ?? 1;
    const prey = betraying ? undefined : markedPrey(ctx, unit);
    const preyRoute = prey && !taunter && !plateHold && preyStrike(ctx, planner, def, prey, !!holding);
    // Out of reach this activation: close in along a safe route (Marcar Presa lasts 3 turns).
    const preyChase = prey && !taunter && !plateHold && !preyRoute ? preyPursuit(ctx, planner, def, prey, !!holding) : null;
    const bloodRoute = !taunter && !holding && !pickup && !objectiveGoal ? wolfPursuit(ctx, mover, prey) : null;
    const carrionRoute = !taunter && !holding && !pickup && !objectiveGoal ? ravenPursuit(ctx, planner, prey) : null;
    const siegeTargets=siege&&!plateHold&&!pickup&&!objectiveGoal?(taunter?[taunter]:ctx.state.units.filter(u=>u.faction!==unit.faction).sort(closest)):[];
    const siegeRoutes=siegeTargets.map(t=>({strike:preyStrike(ctx,planner,def,t,!!holding),chase:preyPursuit(ctx,planner,def,t,!!holding)}));
    const siegeRoute=preyRoute||preyChase||siegeRoutes.find(r=>r.strike)?.strike||siegeRoutes.find(r=>r.chase)?.chase;
    if(siege && siegeTargets.length){
      if(siegeRoute&&siegeRoute.cost>0){
        walk(siegeRoute.path,siegeRoute.cost);
      }
    } else if(carrionRoute){
      const walked=walkUnit(ctx,unit,carrionRoute.node.path,carrionRoute.node.cost);moved=walked.length>0;pursuitQualified=moved&&nearHostile();
      if(walked.length===carrionRoute.node.path.length)ctx.emit({type:'RAVEN_SCAVENGER',unitId:unit.id,preyId:carrionRoute.prey.id,pos:unit.pos,kind:'MOVE'});
    } else if (bloodRoute) {
      const walked = walkUnit(ctx, unit, bloodRoute.node.path, bloodRoute.node.cost);
      moved = walked.length > 0; pursuitQualified = moved && nearHostile();
      if (walked.length === bloodRoute.node.path.length) ctx.emit({type:'WOLF_PURSUIT',unitId:unit.id,preyId:bloodRoute.prey.id,pos:unit.pos,bonus:1});
    } else if (preyRoute) {
      if (preyRoute.cost > 0) walk(preyRoute.path, preyRoute.cost);
    } else if (preyChase) {
      walk(preyChase.path, preyChase.cost);
    } else if (rankedGolem) {
      // No greedy fallback: only walk a prefix of a complete legal route to attack range.
      // An unreachable rival never makes this guard oscillate between partial approaches.
      if (target && !holding && (pursuitTarget || manhattan(unit.pos, target.pos) <= 5)) {
        const route = preyStrike(ctx, planner, def, target, !!holding)
          ?? preyPursuit(ctx, planner, def, target, !!holding);
        if (route && route.cost > 0) walk(route.path, route.cost);
      }
    } else if (
      goal &&
      !plateHold &&
      !isMovementPrevented(ctx, unit) &&
      (def.behavior !== 'GUARD' || !!objectiveGoal || (!holding && manhattan(unit.pos, goal) <= 3))
    ) {
      const inRange = (pos: Pos) =>
        pickup || objectiveGoal
          ? samePos(pos, goal)
          : manhattan(pos, goal) <= range &&
            manhattan(pos, goal) >= (def.behavior === 'RANGED' ? 2 : 1) &&
            hasLineOfSight(ctx, pos, goal);
      // Flank within this turn's reachable cells, avoiding exposure and hazardous routes.
      const flank =
        def.behavior === 'SKIRMISHER'
          ? [...computeReachable(ctx, planner, effectiveMoveRange(ctx, planner)).values()]
              .filter((n) => inRange(n.pos) && n.path.every((p) => !terrainDefAt(ctx, p)?.isHazard))
              .sort((a, b) => {
                const threats = (pos: Pos) =>
                  ctx.state.units.filter(
                    (u) => u.faction !== unit.faction && manhattan(pos, u.pos) === 1,
                  ).length;
                return (
                  threats(a.pos) - threats(b.pos) || a.cost - b.cost || comparePos(a.pos, b.pos)
                );
              })[0]
          : undefined;
      const best = flank ?? approach(ctx, planner, { pos: goal }, inRange);
      if (best.cost > 0) walk(best.path, best.cost);
    }
    if (!ctx.state.units.includes(unit)) continue; // hazards can kill during movement
    collectAlong(ctx, unit, [unit.pos]);
    const adjacent = ctx.state.units
      .filter(
        (u) =>
          (betraying ? u.id === owner?.id : u.faction !== unit.faction) &&
          manhattan(unit.pos, u.pos) <= range &&
          hasLineOfSight(ctx, unit.pos, u.pos),
      )
      // A challenger first (Desafío), then the marked prey whenever it is in reach, then the closest.
      .sort(
        (a, b) =>
          Number(b === taunter) - Number(a === taunter) || Number(b === prey) - Number(a === prey) || closest(a, b),
      )[0];
    // Signature breath (cooldown) replaces the basic attack when it is worth more than one bite.
    const breath = def.breath;
    const cone =
      breath && (unit.summon.breathReadyRound ?? 0) <= ctx.state.round ? breathCone(ctx, unit, def) : null;
    if (breath && cone && (cone.targets.length >= 2 || !adjacent)) {
      unit.summon.breathReadyRound = ctx.state.round + breath.cooldownRounds;
      ctx.emit({
        type: 'SUMMON_BREATH',
        unitId: unit.id,
        name: breath.name,
        from: { ...unit.pos },
        direction: cone.direction,
        tiles: cone.tiles,
        targetIds: cone.targets.map((u) => u.id),
      });
      for (const target of cone.targets)
        if (ctx.state.units.includes(target))
          dealDamage(ctx, target, attackDamage(ctx, unit, target, breath.damage), unit.id, breath.damageType);
      continue;
    }
    if (adjacent) {
      ctx.emit({
        type: 'SUMMON_ATTACKED',
        unitId: unit.id,
        targetId: adjacent.id,
        from: { ...unit.pos },
        to: { ...adjacent.pos },
        ranged: range > 1 || snowball,
      });
      if(snowball)ctx.emit({type:'SNOWBALL_FIRED',unitId:unit.id,targetId:adjacent.id,from:unit.pos,to:adjacent.pos,global:false});
      // Temporary empowerment (Manada Ancestral's PACK_FURY, Instinto Alfa) adds to the base attack.
      const bonus = statusSum('summonDamageBonus') + (adjacent === prey ? statusSum('summonPreyDamageBonus') : 0);
      const scavenging=beastsEnabled(ctx.state)&&unit.defId==='raven'&&weakenedPrey(adjacent);
      if(scavenging)ctx.emit({type:'RAVEN_SCAVENGER',unitId:unit.id,preyId:adjacent.id,pos:unit.pos,kind:'ATTACK'});
      const bite = dealDamage(
        ctx,
        adjacent,
        attackDamage(ctx, unit, adjacent, (scavenging ? 3 : def.damage) + bonus + (unit.defId === 'dark_serpent_king' && adjacent.statuses.some(status => status.id === 'POISONED') ? 1 : 0)),
        unit.id,
        def.damageType ?? (range > 1 ? 'ARCANE' : 'PHYSICAL'),
        snowball?'DIRECT_RANGED':range > 1 ? (depthEnabled(ctx) ? 'DIRECT_RANGED' : 'RANGED') : 'DIRECT_MELEE',
      );
      if(snowball)freezeSpellGround(ctx,[adjacent.pos],unit.summon.ownerId);
      if(siege){
        drakeScorch(ctx,unit,adjacent.pos);
        if(bite.hpLost>0&&adjacent.kind!=='STRUCTURE'&&ctx.state.units.includes(adjacent))applyStatus(ctx,adjacent,'DRAKE_BURN',1,unit.id);
      }
      if(beastsEnabled(ctx.state)&&unit.defId==='turtle' && range===1 && bite.hpLost>0)applyTurtleBite(ctx,adjacent,unit.id);
      if (beastsEnabled(ctx.state) && unit.defId === 'wolf' && range === 1 && bite.hpLost > 0 && adjacent.kind !== 'STRUCTURE' && ctx.state.units.includes(adjacent))
        applyStatus(ctx, adjacent, 'BLEEDING', 2, unit.id);
      if (def.onHitStatus && (!['dark_serpent_king', 'dark_scorpion_king'].includes(unit.defId) || bite.hpLost > 0) && adjacent.kind !== 'STRUCTURE' && ctx.state.units.includes(adjacent))
        applyStatus(ctx, adjacent, def.onHitStatus.status, def.onHitStatus.duration, unit.id);
      if (def.behavior === 'RANGED') {
        const ally = ctx.state.units
          .filter(
            (u) =>
              u.faction === unit.faction &&
              u.statuses.some((s) => ctx.content.statuses[s.id]?.negative) &&
              manhattan(unit.pos, u.pos) <= 2,
          )
          .sort(closest)[0];
        if (ally) cleanseUnit(ctx, ally);
      }
      if (def.retreatSteps && !plateHold && ctx.state.units.includes(unit))
        { const before={...unit.pos};retreatSummon(ctx, unit, def.retreatSteps);if(!samePos(before,unit.pos)){moved=true;pursuitQualified=nearHostile();} }
    }
    } finally {
      if(hunting && ctx.state.units.includes(unit)) {
        // One pending +1, even after the final buffed activation; never renew without the base buff.
        if(moved && pursuitQualified)
          applyStatus(ctx,unit,'HUNT_PURSUIT',1,unit.id);
        hunting.turnsLeft--;
        if(hunting.turnsLeft<=0)removeStatus(ctx,unit,'UNLEASHED_HUNT','EXPIRED');
      }
    }
  }
}
