import { inBounds } from '../board/board';
import { canEnter, getHero, isActionPrevented, terrainDefAt, unitAt, unitById } from '../board/occupancy';
import { setEnergy } from '../cards/deck';
import { dealDamage } from '../combat/damage';
import type { RuleContext } from '../context';
import { comparePos, manhattan, samePos, type Pos } from '../core/position';
import { fail, OK, type RuleError, type RuleResult } from '../result';
import type { GameState } from '../state';
import { spawnEnemy } from '../turn/turn-flow';
import { applyStatus, removeStatus } from '../statuses/status-rules';
import { evaluateObjective } from '../objectives/objective-rules';
import type { MechanismAction, MechanismBoard, MechanismCue, MechanismObject, MechanismRuleDef, MechanismTriggerType, InteractionVerb } from './mechanism';
import { FORTIFIED_STATUS, INTERACTABLE_KINDS, RELIC_BURDEN_STATUS } from './mechanism';
import {
  acceptsOccupant,
  mechanismById,
  mechanismFloorAt,
  mechanismsAt,
  occupantClassOf,
  stateIsActive,
} from './mechanism-board';
import { advancePlatform, movePlatform, platformHome } from './mechanism-platforms';
import { applyTransform, checkRotation, nextOrientation, orientationOf, orientationState } from './mechanism-transform';
import type { Orientation } from './mechanism';

/**
 * Mechanism rules. Everything is resolved synchronously inside the command (or enemy action)
 * that caused it, from state alone: no timers, no randomness, deterministic order (objects and
 * rules in declaration order). Replays and reconnects therefore reproduce every switch, plate,
 * gate, bridge, statue, relic and trap.
 *
 * WHEN things are checked: `syncMechanisms` runs at the start of every `updateObjectives` — i.e.
 * after each player command, after summons act, after each enemy action and at every phase/round
 * step. So a plate reacts to where units END a move (walking across a plate does not press it).
 *
 * SAFETY (softlock): a gate never closes and a bridge never rises on a tile with a unit or statue;
 * the change waits (`pending`) and applies at the first sync where the tile is free. Statues can
 * never be pushed onto gates, bridges, exits, pickups or outside `allowedTiles`.
 */

/** Cascades (plate → bridge → plate …) settle within this many passes; more = authoring loop. */
const MAX_SYNC_PASSES = 8;

interface Trigger {
  type: MechanismTriggerType;
  sourceId?: string;
  /** ON_EXPOSE_END: the unit whose window closed. */
  unitId?: string;
  /** Aggregate edge (ON_ALL_ACTIVE / ON_ANY_ACTIVE): the rule that rose. */
  ruleId?: string;
}

const board = (state: GameState): MechanismBoard | null => (state.duel ? null : (state.mechanisms ?? null));

export function emitCue(
  ctx: RuleContext,
  o: MechanismObject,
  cue: MechanismCue,
  extra: {
    from?: Pos;
    causeId?: string;
    actorId?: string;
    carriedIds?: string[];
    rotation?: { from: Orientation; to: Orientation; turns: number; pivot: Pos; cells: Pos[] };
    reason?: string;
  } = {},
): void {
  ctx.emit({ type: 'MECHANISM_CHANGED', cue, mechanismId: o.def.id, kind: o.def.kind, state: o.state, pos: { ...o.pos }, ...extra });
}

/** Unit ids and statue ids on `p` (excluding `selfId`), sorted: the ENTER/EXIT bookkeeping. */
function occupantIds(state: GameState, p: Pos, selfId: string): string[] {
  const ids = state.units.filter((u) => samePos(u.pos, p)).map((u) => u.id);
  for (const o of state.mechanisms?.objects ?? [])
    if (o.def.kind === 'STATUE' && o.def.id !== selfId && samePos(o.pos, p)) ids.push(o.def.id);
  return ids.sort();
}

/** Nothing may close on a unit, a statue or a dropped relic (a relic must never be sealed away). */
const tileTaken = (state: GameState, p: Pos, selfId: string): boolean =>
  occupantIds(state, p, selfId).length > 0 ||
  !!state.mechanisms?.objects.some((o) => o.def.kind === 'RELIC' && o.state === 'DROPPED' && samePos(o.pos, p));

function occupantAccepted(ctx: RuleContext, o: MechanismObject, id: string): boolean {
  const statue = mechanismById(ctx.state, id);
  if (statue) return acceptsOccupant(o, 'MOVABLE_OBJECT');
  const unit = ctx.state.units.find((u) => u.id === id);
  return !!unit && acceptsOccupant(o, occupantClassOf(unit));
}

function setActive(o: MechanismObject, value: boolean): void {
  o.active = value;
  if (value) o.everActive = true;
}

/** Re-derives `active` after a state change (plates/statues/platforms are handled elsewhere). */
function refresh(o: MechanismObject): void {
  if (o.def.kind === 'PRESSURE_PLATE' || o.def.kind === 'STATUE' || o.def.kind === 'PLATFORM' || o.def.kind === 'REGION') return;
  // A carry relic is "active" while it is in the champion's hands or secured.
  if (o.def.kind === 'RELIC' && o.def.carry) setActive(o, o.state === 'CARRIED' || o.state === 'EXTRACTED');
  else setActive(o, stateIsActive(o.state));
}

const sourcesActive = (state: GameState, ids: readonly string[] | undefined, mode: 'all' | 'any'): boolean => {
  const list = (ids ?? []).map((id) => mechanismById(state, id));
  if (list.length === 0) return mode === 'all';
  return mode === 'all' ? list.every((o) => !!o?.active) : list.some((o) => !!o?.active);
};

function conditionHolds(state: GameState, rule: MechanismRuleDef): boolean {
  const c = rule.condition;
  if (!c) return true;
  return (!c.all || sourcesActive(state, c.all, 'all')) && (!c.any || c.any.length === 0 || sourcesActive(state, c.any, 'any'));
}

// ── Statue destinations ────────────────────────────────────────────────────

/** Why a statue cannot rest on `to` (null = it can). Shared by push, MOVE and RESET. */
export function statueBlockedAt(ctx: RuleContext, statue: MechanismObject, to: Pos, opts: { ignoreAllowed?: boolean } = {}): string | null {
  const { state } = ctx;
  if (!inBounds(state.board, to)) return 'Fuera del tablero.';
  if (!terrainDefAt(ctx, to)?.walkable && !mechanismFloorAt(state, to)) return 'El suelo no lo soporta.';
  if (state.obstacles.some((o) => samePos(o.pos, to) && ctx.content.obstacles[o.defId]?.blocksMovement)) return 'Hay un obstáculo.';
  if (unitAt(state, to)) return 'Hay una unidad.';
  for (const o of mechanismsAt(state, to)) {
    if (o === statue) continue;
    if (o.def.kind !== 'PRESSURE_PLATE' && o.def.kind !== 'PLATFORM') return 'Ese mecanismo no admite la estatua.';
  }
  if (state.collectibles.some((c) => !c.collected && samePos(c.pos, to))) return 'Taparía un objeto.';
  if (state.objectives.some((obj) => obj.def.type === 'REACH_TILE' && obj.def.tiles.some((t) => samePos(t, to))))
    return 'Taparía la salida.';
  if (!opts.ignoreAllowed && statue.def.allowedTiles && !statue.def.allowedTiles.some((t) => samePos(t, to)))
    return 'La estatua no puede ir ahí.';
  return null;
}

function moveStatue(ctx: RuleContext, statue: MechanismObject, to: Pos, cue: MechanismCue, extra: { causeId?: string; actorId?: string }): void {
  const from = statue.pos;
  statue.pos = { ...to };
  delete statue.pending;
  emitCue(ctx, statue, cue, { from: { ...from }, ...extra });
}

// ── Actions ────────────────────────────────────────────────────────────────

function closeOrDefer(ctx: RuleContext, o: MechanismObject, kind: 'CLOSE' | 'RAISE', causeId?: string): boolean {
  const closedState = kind === 'CLOSE' ? 'CLOSED' : 'RAISED';
  if (o.state === closedState) {
    delete o.pending;
    return false;
  }
  if (tileTaken(ctx.state, o.pos, o.def.id)) {
    if (o.pending?.action === kind) return false;
    o.pending = { action: kind };
    emitCue(ctx, o, kind === 'CLOSE' ? 'GATE_CLOSE_DEFERRED' : 'BRIDGE_RAISE_DEFERRED', { causeId });
    return true;
  }
  o.state = closedState;
  delete o.pending;
  refresh(o);
  emitCue(ctx, o, kind === 'CLOSE' ? 'GATE_CLOSED' : 'BRIDGE_RAISED', { causeId });
  return true;
}

function openState(ctx: RuleContext, o: MechanismObject, causeId?: string): boolean {
  const openValue = o.def.kind === 'GATE' ? 'OPEN' : 'LOWERED';
  const hadPending = !!o.pending;
  delete o.pending;
  if (o.state === openValue) return hadPending;
  o.state = openValue;
  refresh(o);
  emitCue(ctx, o, o.def.kind === 'GATE' ? 'GATE_OPENED' : 'BRIDGE_LOWERED', { causeId });
  return true;
}

function setSwitch(ctx: RuleContext, o: MechanismObject, on: boolean, causeId?: string, actorId?: string): boolean {
  const value = on ? 'ON' : 'OFF';
  if (o.state === value) return false;
  o.state = value;
  refresh(o);
  const b = ctx.state.mechanisms!;
  if (on && o.def.holdRounds) (b.timers ??= {})[o.def.id] = ctx.state.round + o.def.holdRounds - 1;
  else if (!on && b.timers) delete b.timers[o.def.id];
  emitCue(ctx, o, on ? 'SWITCH_ACTIVATED' : 'SWITCH_DEACTIVATED', { causeId, actorId });
  return true;
}

function setTrap(ctx: RuleContext, o: MechanismObject, enabled: boolean, causeId?: string): boolean {
  const value = enabled ? 'ENABLED' : 'DISABLED';
  if (o.state === value) return false;
  o.state = value;
  refresh(o);
  emitCue(ctx, o, enabled ? 'TRAP_ENABLED' : 'TRAP_DISABLED', { causeId });
  return true;
}

function setLocked(ctx: RuleContext, o: MechanismObject, locked: boolean, causeId?: string): boolean {
  if (!!o.locked === locked) return false;
  if (locked) o.locked = true;
  else delete o.locked;
  emitCue(ctx, o, locked ? 'MECHANISM_LOCKED' : 'MECHANISM_UNLOCKED', { causeId });
  return true;
}

/** One action on one target. Returns true when something changed. */
function applyToTarget(ctx: RuleContext, action: MechanismAction, o: MechanismObject, causeId?: string): boolean {
  const kind = o.def.kind;
  switch (action.type) {
    case 'OPEN':
    case 'LOWER':
      return kind === 'GATE' || kind === 'BRIDGE' ? openState(ctx, o, causeId) : kind === 'SWITCH' ? setSwitch(ctx, o, true, causeId) : false;
    case 'CLOSE':
    case 'RAISE':
      if (kind === 'GATE') return closeOrDefer(ctx, o, 'CLOSE', causeId);
      if (kind === 'BRIDGE') return closeOrDefer(ctx, o, 'RAISE', causeId);
      return kind === 'SWITCH' ? setSwitch(ctx, o, false, causeId) : false;
    case 'TOGGLE':
      if (kind === 'GATE' || kind === 'BRIDGE') {
        // A pending close counts as "closing": toggling it cancels the close (stays open).
        const open = o.state === 'OPEN' || o.state === 'LOWERED';
        if (open && o.pending) return openState(ctx, o, causeId);
        return open ? closeOrDefer(ctx, o, kind === 'GATE' ? 'CLOSE' : 'RAISE', causeId) : openState(ctx, o, causeId);
      }
      if (kind === 'SWITCH') return setSwitch(ctx, o, o.state !== 'ON', causeId);
      if (kind === 'TRAP') return setTrap(ctx, o, o.state !== 'ENABLED', causeId);
      return false;
    case 'ENABLE':
      return kind === 'TRAP' ? setTrap(ctx, o, true, causeId) : setLocked(ctx, o, false, causeId);
    case 'DISABLE':
      return kind === 'TRAP' ? setTrap(ctx, o, false, causeId) : setLocked(ctx, o, true, causeId);
    case 'ADVANCE': {
      if (kind === 'REGION') {
        const next = nextOrientation(o);
        return next !== null && rotateRegion(ctx, o, next, causeId, 1);
      }
      return kind === 'PLATFORM' ? advancePlatform(ctx, o, causeId) : false;
    }
    case 'ROTATE': {
      if (kind !== 'REGION') return false;
      const turns = action.turns ?? 1;
      if (((turns % 4) + 4) % 4 === 0) return false;
      const to = ((((orientationOf(o.state) + 90 * turns) % 360) + 360) % 360) as Orientation;
      return rotateRegion(ctx, o, to, causeId, Math.sign(turns));
    }
    case 'MOVE': {
      if (kind === 'REGION') return action.orientation !== undefined && rotateRegion(ctx, o, action.orientation, causeId);
      if (kind === 'PLATFORM') return !!action.stop && movePlatform(ctx, o, action.stop, causeId);
      if (kind !== 'STATUE' || !action.to || samePos(o.pos, action.to)) return false;
      if (statueBlockedAt(ctx, o, action.to, { ignoreAllowed: true })) {
        o.pending = { action: 'MOVE', to: { ...action.to } };
        return false;
      }
      moveStatue(ctx, o, action.to, 'STATUE_MOVED', { causeId });
      return true;
    }
    case 'RESET':
      return resetObject(ctx, o, causeId);
    case 'DAMAGE': {
      let hit = false;
      for (const unit of ctx.state.units.filter((u) => samePos(u.pos, o.pos))) {
        dealDamage(ctx, unit, action.damage ?? 1, `mechanism:${o.def.id}`, action.damageType ?? 'PHYSICAL');
        hit = true;
      }
      return hit;
    }
    case 'SPAWN':
    case 'COMPLETE_OBJECTIVE':
    case 'FORTIFY':
    case 'EXPOSE':
    case 'CYCLE':
      return false;
  }
}

function resetObject(ctx: RuleContext, o: MechanismObject, causeId?: string): boolean {
  const initial = o.def.initial;
  const changed = setLocked(ctx, o, false, causeId);
  switch (o.def.kind) {
    case 'STATUE': {
      const home = o.def.pos;
      if (samePos(o.pos, home)) return changed;
      if (statueBlockedAt(ctx, o, home, { ignoreAllowed: true })) {
        o.pending = { action: 'RESET' };
        return changed;
      }
      moveStatue(ctx, o, home, 'MECHANISM_RESET', { causeId });
      return true;
    }
    case 'GATE':
      return (initial === 'OPEN' ? openState(ctx, o, causeId) : closeOrDefer(ctx, o, 'CLOSE', causeId)) || changed;
    case 'BRIDGE':
      return (initial === 'LOWERED' ? openState(ctx, o, causeId) : closeOrDefer(ctx, o, 'RAISE', causeId)) || changed;
    case 'SWITCH':
      return setSwitch(ctx, o, initial === 'ON', causeId) || changed;
    case 'TRAP':
      return setTrap(ctx, o, initial !== 'DISABLED', causeId) || changed;
    case 'PLATFORM':
      return platformHome(ctx, o, causeId) || changed;
    case 'REGION':
      return rotateRegion(ctx, o, orientationOf(o.def.initial ?? 'ORIENTATION_0'), causeId) || changed;
    case 'PRESSURE_PLATE':
    case 'RELIC':
      // Plates follow occupancy; a collected relic stays collected (never take progress away).
      return changed;
  }
}

// ── Rotating sections (REGION) ─────────────────────────────────────────────

/**
 * Turns region `o` to orientation `to` (shortest clockwise count of quarter turns from where it is).
 * Validated on a clone first (mechanism-transform.checkRotation): a refused turn emits
 * SECTION_ROTATION_BLOCKED and changes nothing. Riders are moved, never walked: like a platform,
 * riding units get UNIT_TELEPORTED (sourceId `mechanism:<id>`) so the presentation can carry them.
 */
function rotateRegion(ctx: RuleContext, o: MechanismObject, to: Orientation, causeId?: string, direction?: number): boolean {
  const region = o.def.region!;
  const result = checkRotation(ctx, o, to);
  // Signed quarter turns for the presentation (−1 = counter-clockwise); gameplay uses only `to`.
  const signed = direction !== undefined && direction < 0 ? result.turns - 4 : result.turns === 3 && direction === undefined ? -1 : result.turns;
  const rotation = { from: result.from, to: result.to, turns: signed, pivot: { ...region.pivot }, cells: region.cells.map((c) => ({ ...c })) };
  if (result.turns === 0) return false;
  if (!result.ok) {
    emitCue(ctx, o, 'SECTION_ROTATION_BLOCKED', { rotation, reason: result.reason, ...(causeId ? { causeId } : {}) });
    return false;
  }
  const { plan } = result;
  const fromUnits = new Map(plan.units.map((u) => [u.id, { ...u.pos }]));
  const inside = new Set(region.cells.map((c) => `${c.x},${c.y}`));
  const obstacleIds = plan.staticCells ? ctx.state.obstacles.filter((ob) => inside.has(`${ob.pos.x},${ob.pos.y}`)).map((ob) => ob.id) : [];
  applyTransform(ctx.state, plan);
  o.state = orientationState(to);
  o.active = o.state !== (o.def.initial ?? 'ORIENTATION_0');
  if (o.active) o.everActive = true;
  emitCue(ctx, o, 'SECTION_ROTATED', {
    rotation,
    ...(causeId ? { causeId } : {}),
    carriedIds: [...plan.units.map((u) => u.id), ...plan.mechanisms.map((m) => m.def.id), ...obstacleIds],
  });
  for (const u of plan.units) ctx.emit({ type: 'UNIT_TELEPORTED', unitId: u.id, from: fromUnits.get(u.id)!, to: { ...u.pos }, sourceId: `mechanism:${o.def.id}` });
  return true;
}

/**
 * Turns section `id` to `orientation` outside the rule machine, with the same validation, riders and
 * events as a ROTATE action, then settles the board. For scripted board control (the XXX boss is
 * expected to drive it) and the DEV rotation lab. Returns false when nothing turned.
 */
export function rotateSection(ctx: RuleContext, id: string, orientation: Orientation, direction?: number): boolean {
  const o = mechanismById(ctx.state, id);
  if (!o || o.def.kind !== 'REGION' || !board(ctx.state)) return false;
  const turned = rotateRegion(ctx, o, orientation, undefined, direction);
  syncMechanisms(ctx);
  return turned;
}

// ── Mechanical Guardian (FORTIFY / EXPOSE) ─────────────────────────────────

/** Plated right now: under FORTIFY rules and outside any EXPOSE window (see EXPOSE). */
const plated = (b: MechanismBoard, unitId: string, round: number): boolean =>
  !!b.armored?.includes(unitId) && !((b.exposed?.[unitId] ?? 0) >= round);

function guardianAction(ctx: RuleContext, action: MechanismAction, causeId?: string): boolean {
  const b = ctx.state.mechanisms!;
  let changed = false;
  for (const unitId of action.unitIds ?? []) {
    if (!unitById(ctx.state, unitId)) continue;
    if (action.type === 'FORTIFY') {
      const fresh = !b.armored?.includes(unitId);
      if (fresh) (b.armored ??= []).push(unitId);
      if (b.exposed?.[unitId] !== undefined) delete b.exposed[unitId];
      else if (!fresh) continue;
      ctx.emit({ type: 'GUARDIAN_STATE', cue: fresh ? 'GUARDIAN_FORTIFIED' : 'GUARDIAN_REFORTIFIED', unitId, ...(causeId ? { causeId } : {}) });
      changed = true;
    } else {
      if (!b.armored?.includes(unitId)) continue;
      const until = ctx.state.round + Math.max(1, action.rounds ?? 2) - 1;
      (b.exposed ??= {})[unitId] = Math.max(b.exposed[unitId] ?? 0, until);
      ctx.emit({ type: 'GUARDIAN_STATE', cue: 'GUARDIAN_EXPOSED', unitId, untilRound: b.exposed[unitId]!, ...(causeId ? { causeId } : {}) });
      changed = true;
    }
  }
  syncStatuses(ctx, b);
  return changed;
}

/**
 * Board-owned statuses follow board state on every sync, so they can never be cleansed away, left
 * behind or stuck: FORTIFIED on plated guardians, RELIC_BURDEN on the champion carrying a relic.
 */
function syncStatuses(ctx: RuleContext, b: MechanismBoard): void {
  for (const unitId of b.armored ?? []) {
    const unit = unitById(ctx.state, unitId);
    if (!unit) continue;
    const want = plated(b, unitId, ctx.state.round);
    const has = unit.statuses.some((s) => s.id === FORTIFIED_STATUS);
    if (want && !has) applyStatus(ctx, unit, FORTIFIED_STATUS, 1, 'mechanism');
    else if (!want && has) removeStatus(ctx, unit, FORTIFIED_STATUS, 'CONSUMED');
  }
  const carriers = new Set(b.objects.filter((o) => o.state === 'CARRIED' && o.carrier).map((o) => o.carrier!));
  for (const unit of ctx.state.units) {
    if (unit.kind !== 'HERO') continue;
    const has = unit.statuses.some((s) => s.id === RELIC_BURDEN_STATUS);
    if (carriers.has(unit.id) && !has) applyStatus(ctx, unit, RELIC_BURDEN_STATUS, 1, 'mechanism');
    else if (!carriers.has(unit.id) && has) removeStatus(ctx, unit, RELIC_BURDEN_STATUS, 'CONSUMED');
  }
}

/** Carried relics follow their carrier; a carrier that left the board drops it where it last stood. */
function syncRelics(ctx: RuleContext, b: MechanismBoard): boolean {
  let changed = false;
  for (const o of b.objects) {
    if (o.def.kind !== 'RELIC' || o.state !== 'CARRIED') continue;
    const carrier = o.carrier ? unitById(ctx.state, o.carrier) : undefined;
    if (carrier) {
      if (!samePos(o.pos, carrier.pos)) o.pos = { ...carrier.pos };
      continue;
    }
    o.state = 'DROPPED';
    delete o.carrier;
    refresh(o);
    emitCue(ctx, o, 'RELIC_DROPPED');
    changed = true;
  }
  return changed;
}

// ── Relocating controls (CYCLE) ────────────────────────────────────────────

export const cycleKey = (ids: readonly string[]): string => ids.join('+');

/**
 * The champion could not stand next to `o` right now: every orthogonal neighbour is out of bounds,
 * unwalkable, walled, a solid mechanism or taken by another unit. Such a candidate is skipped.
 */
function controlBlocked(ctx: RuleContext, o: MechanismObject): boolean {
  const heroId = getHero(ctx.state)?.id;
  return ![{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].some((d) => canEnter(ctx, { x: o.pos.x + d.x, y: o.pos.y + d.y }, heroId));
}

/** CYCLE: the live control of the ring moves to the next free candidate (see MechanismActionType). */
function cycleControls(ctx: RuleContext, ids: readonly string[]): boolean {
  const b = ctx.state.mechanisms!;
  const ring = ids.map((id) => mechanismById(ctx.state, id)).filter((o): o is MechanismObject => !!o);
  if (ring.length < 2) return false;
  const key = cycleKey(ids);
  const from = (b.cycles?.[key] ?? 0) % ring.length;
  let to = from;
  for (let step = 1; step < ring.length; step++) {
    const i = (from + step) % ring.length;
    if (!controlBlocked(ctx, ring[i]!)) {
      to = i;
      break;
    }
  }
  const current = ring[from]!,
    next = ring[to]!;
  (b.cycles ??= {})[key] = to;
  if (to === from) return setLocked(ctx, current, false);
  if (current.def.kind === 'SWITCH' && current.state === 'ON') setSwitch(ctx, current, false, current.def.id);
  setLocked(ctx, current, true, current.def.id);
  setLocked(ctx, next, false, current.def.id);
  emitCue(ctx, next, 'CONTROL_RELOCATED', { from: { ...current.pos }, causeId: current.def.id });
  return true;
}

// ── Multi-stage objectives ─────────────────────────────────────────────────

/** Latches each STAGES objective's progress: a finished stage never un-finishes. */
function advanceStages(ctx: RuleContext, b: MechanismBoard): void {
  ctx.state.objectives.forEach((obj, index) => {
    const def = obj.def;
    if (def.type !== 'MECHANISM' || def.goal !== 'STAGES' || !def.stages?.length) return;
    const key = stageKey(index);
    let stage = b.stages?.[key] ?? 0;
    const start = stage;
    while (stage < def.stages.length && evaluateObjective(ctx.state, def.stages[stage]!.objective).status === 'COMPLETED') stage++;
    if (stage === start) return;
    (b.stages ??= {})[key] = stage;
    ctx.emit({
      type: 'OBJECTIVE_STAGE_CHANGED',
      index,
      stage,
      total: def.stages.length,
      label: def.stages[stage]?.label ?? null,
    });
  });
}

export const stageKey = (objectiveIndex: number): string => `objective:${objectiveIndex}`;

function runAction(ctx: RuleContext, action: MechanismAction, causeId?: string): boolean {
  const b = ctx.state.mechanisms!;
  if (action.type === 'SPAWN') {
    let spawned = false;
    for (const spawn of action.enemies ?? []) {
      if (ctx.state.units.some((u) => u.id === spawn.id)) continue;
      if (spawnEnemy(ctx, structuredClone(spawn))) {
        ctx.state.stats.totalEnemies += 1;
        spawned = true;
      }
    }
    return spawned;
  }
  if (action.type === 'FORTIFY' || action.type === 'EXPOSE') return guardianAction(ctx, action, causeId);
  if (action.type === 'CYCLE') return cycleControls(ctx, action.targets ?? []);
  if (action.type === 'COMPLETE_OBJECTIVE') {
    if (!action.flag || b.flags.includes(action.flag)) return false;
    b.flags.push(action.flag);
    const source = causeId ? mechanismById(ctx.state, causeId) : undefined;
    if (source) emitCue(ctx, source, 'OBJECTIVE_FLAG', { causeId });
    return true;
  }
  let changed = false;
  for (const id of action.targets ?? []) {
    const o = mechanismById(ctx.state, id);
    if (o) changed = applyToTarget(ctx, action, o, causeId) || changed;
  }
  return changed;
}

/** Round rules with `every` fire on rounds offset, offset + every, … (offset defaults to every). */
export function onSchedule(rule: MechanismRuleDef, round: number): boolean {
  const { every, offset } = rule.trigger;
  if (!every || (rule.trigger.type !== 'ON_ROUND_START' && rule.trigger.type !== 'ON_ROUND_END')) return true;
  const first = offset ?? every;
  return round >= first && (round - first) % every === 0;
}

/** Fires every rule matching `trigger` (declaration order). True when an action changed something. */
function runTrigger(ctx: RuleContext, trigger: Trigger): boolean {
  const b = ctx.state.mechanisms!;
  let changed = false;
  for (const rule of b.rules) {
    if (rule.trigger.type !== trigger.type) continue;
    if (trigger.ruleId ? rule.id !== trigger.ruleId : trigger.sourceId && !(rule.trigger.sources ?? []).includes(trigger.sourceId)) continue;
    if (rule.trigger.type === 'ON_SEQUENCE' && !trigger.ruleId) continue;
    if (trigger.unitId && rule.trigger.unitIds && !rule.trigger.unitIds.includes(trigger.unitId)) continue;
    if (!onSchedule(rule, ctx.state.round)) continue;
    if (rule.whileAlive?.some((id) => !unitById(ctx.state, id))) continue;
    if (rule.once && b.fired.includes(rule.id)) continue;
    if (!conditionHolds(ctx.state, rule)) continue;
    if (rule.once) b.fired.push(rule.id);
    const cause = trigger.sourceId ?? rule.trigger.sources?.[0];
    for (const action of rule.actions) changed = runAction(ctx, action, cause) || changed;
    if (!ctx.state.mechanisms) break;
  }
  return changed;
}

// ── Sync ───────────────────────────────────────────────────────────────────

function retryPending(ctx: RuleContext, b: MechanismBoard): boolean {
  let changed = false;
  for (const o of b.objects) {
    const p = o.pending;
    if (!p) continue;
    if (p.action === 'CLOSE' || p.action === 'RAISE') {
      if (!tileTaken(ctx.state, o.pos, o.def.id)) {
        delete o.pending;
        changed = closeOrDefer(ctx, o, p.action) || changed;
      }
    } else {
      const to = p.action === 'RESET' ? o.def.pos : p.to!;
      if (!statueBlockedAt(ctx, o, to, { ignoreAllowed: true })) {
        moveStatue(ctx, o, to, p.action === 'RESET' ? 'MECHANISM_RESET' : 'STATUE_MOVED', {});
        changed = true;
      }
    }
  }
  return changed;
}

function springMechanismTrap(ctx: RuleContext, trap: MechanismObject, unitId: string): void {
  const unit = ctx.state.units.find((u) => u.id === unitId);
  if (!unit || trap.state !== 'ENABLED' || !trap.def.trap || !acceptsOccupant(trap, occupantClassOf(unit))) return;
  emitCue(ctx, trap, 'TRAP_FIRED', { actorId: unitId });
  dealDamage(ctx, unit, trap.def.trap.damage, `mechanism:${trap.def.id}`, trap.def.trap.damageType);
}

/**
 * Brings the machine up to date with the board: pending closes, plate pressure, tile ENTER/EXIT,
 * traps, ALL/ANY edges, then the actions those fire — repeated until nothing changes.
 */
export function syncMechanisms(ctx: RuleContext): void {
  const b = board(ctx.state);
  if (!b) return;
  for (let pass = 0; pass < MAX_SYNC_PASSES; pass++) {
    const triggers: Trigger[] = [];
    let changed = retryPending(ctx, b) || syncRelics(ctx, b);

    for (const o of b.objects) {
      if (o.def.kind === 'PLATFORM' || o.def.kind === 'RELIC' || o.def.kind === 'REGION') continue;
      const now = occupantIds(ctx.state, o.pos, o.def.id);
      const entered = now.filter((id) => !o.occupants.includes(id));
      const exited = o.occupants.filter((id) => !now.includes(id));
      o.occupants = now;
      triggers.push(...exited.map((): Trigger => ({ type: 'ON_EXIT_TILE', sourceId: o.def.id })));
      for (const id of entered) {
        triggers.push({ type: 'ON_ENTER_TILE', sourceId: o.def.id });
        if (o.def.kind === 'TRAP') springMechanismTrap(ctx, o, id);
      }
      if (o.def.kind === 'PRESSURE_PLATE' && !o.locked) {
        const pressed = now.some((id) => occupantAccepted(ctx, o, id));
        if (pressed !== o.active) {
          setActive(o, pressed);
          emitCue(ctx, o, pressed ? 'PLATE_PRESSED' : 'PLATE_RELEASED');
          triggers.push({ type: pressed ? 'ON_OCCUPIED' : 'ON_VACATED', sourceId: o.def.id });
          changed = true;
        }
      }
    }

    for (const rule of b.rules) {
      const t = rule.trigger.type;
      if (t !== 'ON_ALL_ACTIVE' && t !== 'ON_ANY_ACTIVE') continue;
      const value = sourcesActive(ctx.state, rule.trigger.sources, t === 'ON_ALL_ACTIVE' ? 'all' : 'any');
      const before = b.edges[rule.id] ?? false;
      b.edges[rule.id] = value;
      if (value && !before) triggers.push({ type: t, ruleId: rule.id });
    }

    for (const trigger of triggers) changed = runTrigger(ctx, trigger) || changed;
    if (!changed) break;
  }
  syncStatuses(ctx, b);
  advanceStages(ctx, b);
}

/** Round hooks (turn-flow): ON_ROUND_START / ON_ROUND_END rules, KEEP_ACTIVE counters at round end. */
export function fireRoundTrigger(ctx: RuleContext, type: 'ON_ROUND_START' | 'ON_ROUND_END'): void {
  const b = board(ctx.state);
  if (!b) return;
  syncMechanisms(ctx);
  if (type === 'ON_ROUND_END') {
    const round = ctx.state.round;
    // Timed switches turn themselves off; EXPOSE windows close (plating returns).
    for (const [id, last] of Object.entries(b.timers ?? {})) {
      const o = mechanismById(ctx.state, id);
      if (last <= round && o) setSwitch(ctx, o, false, 'timer');
    }
    const closed: string[] = [];
    for (const [unitId, last] of Object.entries(b.exposed ?? {}))
      if (last <= round) {
        delete b.exposed![unitId];
        (b.exposureCycles ??= {})[unitId] = (b.exposureCycles[unitId] ?? 0) + 1;
        if (unitById(ctx.state, unitId)) {
          ctx.emit({ type: 'GUARDIAN_STATE', cue: 'GUARDIAN_REFORTIFIED', unitId });
          closed.push(unitId);
        }
      }
    syncStatuses(ctx, b);
    // The core is shut again: only now may the board move its controls (never mid-window).
    for (const unitId of closed) if (runTrigger(ctx, { type: 'ON_EXPOSE_END', unitId })) syncMechanisms(ctx);
  }
  if (type === 'ON_ROUND_END')
    for (const obj of ctx.state.objectives) {
      const def = obj.def;
      if (def.type !== 'MECHANISM' || def.goal !== 'KEEP_ACTIVE') continue;
      if (sourcesActive(ctx.state, def.ids, 'all')) b.held[heldKey(def.ids)] = (b.held[heldKey(def.ids)] ?? 0) + 1;
    }
  if (runTrigger(ctx, { type })) syncMechanisms(ctx);
}

export const heldKey = (ids: readonly string[]): string => ids.join('+');

// ── Interaction (INTERACT command) ─────────────────────────────────────────

/** One contextual board action the UI can show as a button (the engine validates again on use). */
export interface InteractionOption {
  mechanismId: string;
  kind: MechanismObject['def']['kind'];
  verb: InteractionVerb;
  pos: Pos;
  /**
   * INTERACT is legal from here: orthogonally adjacent; for a dropped relic also its own tile, and
   * always while carrying it (SOLTAR / ASEGURAR).
   */
  adjacent: boolean;
  allowed: boolean;
  reason?: RuleError;
  message?: string;
  /** STATUE: where the push would put it. */
  pushTo?: Pos;
  energyCost: number;
  label?: string;
}

/** Champion stands on one of the relic's extraction tiles. */
const onExtraction = (o: MechanismObject, at: Pos): boolean => !!o.def.carry?.extraction.some((t) => samePos(t, at));

function verbFor(o: MechanismObject, hero?: Pos): InteractionVerb {
  if (o.def.kind === 'RELIC' && o.state === 'CARRIED') return hero && onExtraction(o, hero) ? 'ASEGURAR' : 'SOLTAR';
  if (o.def.prompt) return o.def.prompt;
  if (o.def.kind === 'STATUE') return 'EMPUJAR';
  if (o.def.kind === 'RELIC') return 'RECOGER';
  if (o.def.kind === 'SWITCH') return o.state === 'ON' ? 'DESACTIVAR' : 'ACTIVAR';
  return 'INTERACTUAR';
}

function pushTarget(hero: Pos, statue: Pos): Pos {
  return { x: statue.x + (statue.x - hero.x), y: statue.y + (statue.y - hero.y) };
}

/** Full validation of an INTERACT on `mechanismId`, without changing anything. */
export function checkInteraction(ctx: RuleContext, mechanismId: string): InteractionOption | { error: RuleError; message: string } {
  const b = board(ctx.state);
  if (!b) return { error: 'UNKNOWN_MECHANISM', message: 'No hay mecanismos en este campo.' };
  const o = mechanismById(ctx.state, mechanismId);
  if (!o) return { error: 'UNKNOWN_MECHANISM', message: `Mecanismo desconocido "${mechanismId}".` };
  if (!INTERACTABLE_KINDS.includes(o.def.kind)) return { error: 'NOT_INTERACTABLE', message: 'No se puede usar directamente.' };
  const hero = getHero(ctx.state);
  const energyCost = o.def.energyCost ?? 0;
  const carriedByHero = o.state === 'CARRIED' && !!hero && o.carrier === hero.id;
  const reach = !hero ? false : carriedByHero ? true : o.state === 'DROPPED' ? manhattan(hero.pos, o.pos) <= 1 : manhattan(hero.pos, o.pos) === 1;
  const option: InteractionOption = {
    mechanismId,
    kind: o.def.kind,
    verb: verbFor(o, hero?.pos),
    pos: { ...o.pos },
    adjacent: reach,
    allowed: false,
    energyCost,
    ...(o.def.label ? { label: o.def.label } : {}),
  };
  const deny = (reason: RuleError, message: string) => ({ ...option, reason, message });
  if (!hero) return deny('UNKNOWN_UNIT', 'Sin campeón.');
  if (ctx.state.phase !== 'PLAYER') return deny('NOT_PLAYER_TURN', 'No es tu turno.');
  if (o.def.kind === 'STATUE') option.pushTo = pushTarget(hero.pos, o.pos);
  if (o.locked) return deny('NOT_INTERACTABLE', 'Mecanismo bloqueado.');
  if (o.def.kind === 'SWITCH' && o.def.toggle === false && o.state === 'ON') return deny('NOT_INTERACTABLE', 'Ya está activado.');
  if (o.def.kind === 'RELIC' && o.state === 'COLLECTED') return deny('NOT_INTERACTABLE', 'Ya la recogiste.');
  if (o.def.kind === 'RELIC' && o.state === 'EXTRACTED') return deny('NOT_INTERACTABLE', 'La reliquia ya está asegurada.');
  if (o.def.kind === 'RELIC' && o.state === 'CARRIED' && !carriedByHero) return deny('NOT_INTERACTABLE', 'Otra unidad la lleva.');
  if (!option.adjacent) return deny('NOT_ADJACENT', 'Acércate a una casilla adyacente.');
  if (isActionPrevented(ctx, hero)) return deny('CASTER_INCAPACITATED', `${hero.name} no puede actuar.`);
  if (b.interactedRound === ctx.state.round && !freeControl(b, mechanismId) && !(b.lastInteractionId === mechanismId && safeRepeatableControl(b, mechanismId)))
    return deny('INTERACTION_USED', 'Ya interactuaste este turno.');
  if (ctx.state.player.energy < energyCost) return deny('NOT_ENOUGH_ENERGY', 'No tienes energía suficiente.');
  if (o.def.kind === 'STATUE') {
    const blocked = statueBlockedAt(ctx, o, option.pushTo!);
    if (blocked) return deny('PUSH_BLOCKED', blocked);
  }
  return { ...option, allowed: true };
}

/** Geometry-only actions: they move the board (platforms, sections) and can award nothing. */
const GEOMETRY_ACTIONS: ReadonlySet<MechanismAction['type']> = new Set(['ADVANCE', 'RESET', 'ROTATE', 'MOVE']);

const geometryOnly = (b: MechanismBoard, r: MechanismRuleDef): boolean =>
  r.actions.length > 0 &&
  r.actions.every(
    (a) =>
      GEOMETRY_ACTIONS.has(a.type) &&
      !!a.targets?.length &&
      a.targets.every((t) => b.objects.some((o) => o.def.id === t && (o.def.kind === 'PLATFORM' || o.def.kind === 'REGION'))),
  );

/** Triggers geometry can never fire: player interactions, sequences, the round clock, exposure windows. */
const CLOCK_OR_PLAYER_TRIGGERS: ReadonlySet<MechanismTriggerType> = new Set(['ON_INTERACT', 'ON_SEQUENCE', 'ON_ROUND_START', 'ON_ROUND_END', 'ON_EXPOSE_END']);

/** Every tile the geometry `rules` can move something on or off (section cells, every platform stop). */
function geometryReach(b: MechanismBoard, rules: readonly MechanismRuleDef[]): Set<string> {
  const cells = new Set<string>();
  for (const r of rules)
    for (const a of r.actions)
      for (const id of a.targets ?? []) {
        const o = b.objects.find((x) => x.def.id === id);
        if (o?.def.region) for (const c of o.def.region.cells) cells.add(`${c.x},${c.y}`);
        if (o?.def.kind === 'PLATFORM')
          for (const anchor of Object.values(o.def.stops ?? {}))
            for (const d of o.def.shape ?? [{ x: 0, y: 0 }]) cells.add(`${anchor.x + d.x},${anchor.y + d.y}`);
      }
  return cells;
}

/**
 * Fail closed: repeatability cannot trigger rewards, spawns, relics or other puzzles. The control's
 * own rules must be pure geometry (platforms / sections), and every OTHER rule of the board must be
 * geometry too or insulated from it: fired only by the player or the clock, or by occupancy/edges
 * of objects that stand where that geometry can never move anything (XXIX: the plate and the gate
 * are outside the section, so turning it can press or open nothing).
 */
export function safeRepeatableControl(b: MechanismBoard, id: string): boolean {
  const control = b.objects.find((o) => o.def.id === id);
  if (!(control?.def.repeatableControl || control?.def.interactionMode === 'REPEATABLE_CONTROL') || control.def.kind !== 'SWITCH' || !control.def.momentary) return false;
  const own = b.rules.filter((r) => r.trigger.sources?.includes(id));
  if (own.length === 0 || !own.every((r) => geometryOnly(b, r))) return false;
  const reach = geometryReach(b, own);
  const insulated = (r: MechanismRuleDef) =>
    CLOCK_OR_PLAYER_TRIGGERS.has(r.trigger.type) ||
    (r.trigger.sources ?? []).every((s) => {
      const o = b.objects.find((x) => x.def.id === s);
      return !!o && o.def.kind !== 'PLATFORM' && o.def.kind !== 'REGION' && !reach.has(`${o.def.pos.x},${o.def.pos.y}`) && !reach.has(`${o.pos.x},${o.pos.y}`);
    });
  return b.rules.every((r) => geometryOnly(b, r) || insulated(r));
}

/** REPEATABLE_CONTROL: never limited by, and never spends, the turn's one interaction. */
const freeControl = (b: MechanismBoard, id: string): boolean =>
  b.objects.find((o) => o.def.id === id)?.def.interactionMode === 'REPEATABLE_CONTROL' && safeRepeatableControl(b, id);

/** Every interactable object with its prompt state (adjacent first, then board order). */
export function interactionOptions(ctx: RuleContext): InteractionOption[] {
  const b = board(ctx.state);
  if (!b) return [];
  return b.objects
    .filter((o) => INTERACTABLE_KINDS.includes(o.def.kind))
    .map((o) => checkInteraction(ctx, o.def.id))
    .filter((r): r is InteractionOption => 'mechanismId' in r)
    .sort((a, c) => Number(c.adjacent) - Number(a.adjacent) || comparePos(a.pos, c.pos));
}

/**
 * INTERACT: the champion's one board action per turn. Costs no energy (unless the object says
 * so) and no movement; cards stay playable. Fires ON_INTERACT rules of that object.
 */
export function interact(ctx: RuleContext, mechanismId: string): RuleResult {
  const check = checkInteraction(ctx, mechanismId);
  if (!('mechanismId' in check)) return fail(check.error, check.message);
  if (!check.allowed) return fail(check.reason!, check.message!);
  const b = ctx.state.mechanisms!;
  const o = mechanismById(ctx.state, mechanismId)!;
  const hero = getHero(ctx.state)!;
  if (!freeControl(b, mechanismId)) {
    b.interactedRound = ctx.state.round;
    if (o.def.repeatableControl) b.lastInteractionId = mechanismId;
    else delete b.lastInteractionId;
  }
  if (check.energyCost > 0) setEnergy(ctx, ctx.state.player.energy - check.energyCost);
  switch (o.def.kind) {
    case 'SWITCH':
      if (o.def.momentary) emitCue(ctx, o, 'SWITCH_ACTIVATED', { actorId: hero.id });
      else setSwitch(ctx, o, o.state !== 'ON', undefined, hero.id);
      break;
    case 'RELIC':
      if (!o.def.carry) {
        o.state = 'COLLECTED';
        refresh(o);
        emitCue(ctx, o, 'RELIC_COLLECTED', { actorId: hero.id });
      } else if (o.state === 'CARRIED') {
        const secure = onExtraction(o, hero.pos);
        o.state = secure ? 'EXTRACTED' : 'DROPPED';
        o.pos = { ...hero.pos };
        delete o.carrier;
        refresh(o);
        emitCue(ctx, o, secure ? 'RELIC_EXTRACTED' : 'RELIC_DROPPED', { actorId: hero.id });
      } else {
        const from = o.pos;
        o.state = 'CARRIED';
        o.carrier = hero.id;
        o.pos = { ...hero.pos };
        refresh(o);
        emitCue(ctx, o, 'RELIC_PICKED_UP', { actorId: hero.id, from: { ...from } });
      }
      syncStatuses(ctx, b);
      break;
    case 'STATUE':
      moveStatue(ctx, o, check.pushTo!, 'STATUE_PUSHED', { actorId: hero.id });
      break;
    default:
      break;
  }
  runTrigger(ctx, { type: 'ON_INTERACT', sourceId: o.def.id });
  advanceSequences(ctx, b, o);
  return OK;
}

/** ON_SEQUENCE rules: the right source advances, a wrong one restarts (or starts) the sequence. */
function advanceSequences(ctx: RuleContext, b: MechanismBoard, o: MechanismObject): void {
  for (const rule of b.rules) {
    const sources = rule.trigger.sources ?? [];
    if (rule.trigger.type !== 'ON_SEQUENCE' || !sources.includes(o.def.id)) continue;
    if (rule.once && b.fired.includes(rule.id)) continue;
    const progress = (b.sequences ??= {});
    const done = progress[rule.id] ?? 0;
    const next = sources[done] === o.def.id ? done + 1 : sources[0] === o.def.id ? 1 : 0;
    if (next === sources.length) {
      progress[rule.id] = 0;
      emitCue(ctx, o, 'SEQUENCE_PROGRESS', { causeId: rule.id });
      runTrigger(ctx, { type: 'ON_SEQUENCE', ruleId: rule.id, sourceId: o.def.id });
    } else {
      progress[rule.id] = next;
      emitCue(ctx, o, next > done ? 'SEQUENCE_PROGRESS' : 'SEQUENCE_RESET', { causeId: rule.id });
    }
  }
}

/** Ids of every mechanism a rule can change from this source (UI "connected" lines). */
export function mechanismLinks(b: Pick<MechanismBoard, 'rules'>): { from: string; to: string; ruleId: string }[] {
  const out: { from: string; to: string; ruleId: string }[] = [];
  for (const rule of b.rules)
    for (const from of [...(rule.trigger.sources ?? []), ...(rule.condition?.all ?? []), ...(rule.condition?.any ?? [])])
      for (const action of rule.actions)
        for (const to of action.targets ?? [])
          if (from !== to && !out.some((l) => l.from === from && l.to === to)) out.push({ from, to, ruleId: rule.id });
  return out;
}
