import { transform } from '../transformations/transformations';
import { activateSummonNow, spawnSummon, summonCapacityOf } from '../summons/summons';
import { areHostile } from '../board/occupancy';
import { addShield, breakShield, dealDamage, defeatUnit, healUnit } from '../combat/damage';
import { attackDamage } from '../combat/attack-modifiers';
import { declareIntent } from '../ai/ai';
import { pushUnit, swapUnits, teleportUnit, walkUnit } from '../combat/movement';
import { placeGlyph } from '../combat/glyphs';
import { gainMomentum } from '../combat/momentum';
import { gainFocus, inOptimalRange, isPreyOf, preyInLineOfSight, preyInOptimalRange } from '../combat/archery';
import { placeTrap, placeTrapNet } from '../combat/traps';
import { reboundChain } from '../combat/rebound';
import { tileAt } from '../board/board';
import type { RuleContext } from '../context';
import { alignedDirection, comparePos, DIRECTIONS, dominantDirection, manhattan, posKey, samePos, step, type Pos } from '../core/position';
import { canEnter, isEmptyTile, isMovementPrevented, unitAt } from '../board/occupancy';
import type { Unit } from '../entities/unit';
import { applyStatus, cleanseUnit, removeStatus } from '../statuses/status-rules';
import { createObstacle, createTerrain, removeHazard } from '../terrain/terrain-rules';
import type { EffectBonus, EffectCondition, EffectDef, EffectType, TileSelector, UnitSelector } from './card';
import { drawCards, setEnergy, setMovePoints } from './deck';
import type { ResolvedTarget } from './targeting';

/** Breadth-first walk (orthogonal steps, `canEnter` only) from the caster to `to`; deterministic. */
function stepPath(ctx: RuleContext, caster: Unit, to: Pos): Pos[] | null {
  const prev = new Map<string, Pos | null>([[posKey(caster.pos), null]]);
  let frontier = [caster.pos];
  while (frontier.length && !prev.has(posKey(to))) {
    const next: Pos[] = [];
    for (const from of frontier)
      for (const dir of DIRECTIONS) {
        const p = step(from, dir);
        if (prev.has(posKey(p)) || !canEnter(ctx, p, caster.id)) continue;
        prev.set(posKey(p), from);
        next.push(p);
      }
    frontier = next;
  }
  if (!prev.has(posKey(to))) return null;
  const path: Pos[] = [];
  for (let p: Pos | null = to; p && !samePos(p, caster.pos); p = prev.get(posKey(p)) ?? null) path.unshift(p);
  return path;
}

export interface EffectContext {
  ctx: RuleContext;
  caster: Unit;
  resolved: ResolvedTarget;
  directAttack?: 'DIRECT_MELEE' | 'DIRECT_RANGED';
  /** Card being resolved (absent for rituals): provenance of a granted cost discount. */
  cardId?: string;
}

/** Units currently standing inside the resolved area that match the selector. */
export function selectUnits(ectx: EffectContext, selector: UnitSelector): Unit[] {
  const { ctx, caster, resolved } = ectx;
  if (selector === 'CASTER') return ctx.state.units.includes(caster) ? [caster] : [];
  const area = new Set(resolved.affectedTiles.map(posKey));
  return ctx.state.units
    .filter((u) => area.has(posKey(u.pos)))
    .filter((u) => {
      if (selector === 'UNITS') return true;
      if (selector === 'SUMMONS') return u.summon?.ownerId === caster.id;
      return selector === 'ENEMIES' ? areHostile(caster, u) : !areHostile(caster, u);
    })
    .sort((a, b) => comparePos(a.pos, b.pos));
}

export function selectTiles(ectx: EffectContext, selector: TileSelector): Pos[] {
  return selector === 'IMPACT' ? [ectx.resolved.impact] : ectx.resolved.affectedTiles;
}

const casterAdjacentToEnemy = (e: EffectContext): boolean =>
  e.ctx.state.units.some((u) => u.kind !== 'STRUCTURE' && areHostile(e.caster, u) && manhattan(u.pos, e.caster.pos) === 1);

/**
 * One condition, for `unit` (the unit the effect is resolving on; absent for caster-only effects
 * such as GAIN_FOCUS: target-relative conditions are then false). Pure read of the battle state.
 */
export function conditionHolds(e: EffectContext, when: EffectCondition, unit?: Unit): boolean {
  const { caster, ctx } = e;
  switch (when.type) {
    case 'OWN_SUMMON_ALIVE':
      return ctx.state.units.some((s) => s.summon?.ownerId === caster.id);
    case 'OWN_SUMMON_ADJACENT_TO_TARGET':
      return !!unit && ctx.state.units.some((s) => s.summon?.ownerId === caster.id && s.id !== unit.id && manhattan(s.pos, unit.pos) === 1);
    case 'CASTER_HP_AT_MOST_HALF':
      return caster.hp <= Math.floor(caster.maxHp / 2);
    case 'CASTER_ADJACENT_TO_ENEMY':
      return casterAdjacentToEnemy(e);
    case 'CASTER_NOT_ADJACENT_TO_ENEMY':
      return !casterAdjacentToEnemy(e);
    case 'TARGET_IS_PREY':
      return !!unit && isPreyOf(unit, caster.id);
    case 'TARGET_IN_OPTIMAL_RANGE':
      return !!unit && inOptimalRange(ctx, caster, unit.pos);
    case 'TARGET_HP_AT_MOST_PCT':
      // Integer test (no float rounding): hp / maxHp <= pct / 100.
      return !!unit && unit.hp * 100 <= unit.maxHp * when.pct;
    case 'PREY_IN_LINE_OF_SIGHT':
      return preyInLineOfSight(ctx, caster);
    case 'PREY_IN_OPTIMAL_RANGE':
      return preyInOptimalRange(ctx, caster);
    case 'TARGET_ON_TERRAIN': {
      // The real board tile under the unit at resolution time (not the targeted tile, not a cache).
      const terrain = unit ? tileAt(ctx.state.board, unit.pos)?.terrain : undefined;
      return terrain !== undefined && when.terrains.includes(terrain);
    }
    case 'TARGET_HAS_STATUS':
      return !!unit && unit.statuses.some((s) => when.statuses.includes(s.id));
    case 'ANY_OF':
      return when.conditions.some((c) => conditionHolds(e, c, unit));
  }
}

/** Ascenso Primordial (Minotauro): the caster's pending "next hit pushes" status, if any. */
function nextAttackPush(e: EffectContext): { id: import('../statuses/status').StatusId; distance: number } | null {
  for (const s of e.caster.statuses) {
    const distance = e.ctx.content.statuses[s.id]?.nextAttackPush;
    if (distance) return { id: s.id, distance };
  }
  return null;
}

export const conditionsHold = (e: EffectContext, when: EffectCondition | readonly EffectCondition[] | undefined, unit?: Unit): boolean =>
  !when || (Array.isArray(when) ? when : [when as EffectCondition]).every((c) => conditionHolds(e, c, unit));

/** Whether a flat bonus applies to `unit` (the unit the effect is resolving on). */
function bonusFor(e: EffectContext, bonus: EffectBonus | undefined, unit: Unit): number {
  return bonus && conditionsHold(e, bonus.when, unit) ? bonus.amount : 0;
}

type Handler<K extends EffectType> = (
  ectx: EffectContext,
  effect: Extract<EffectDef, { type: K }>,
) => void;

/**
 * One handler per effect PRIMITIVE (never per card). Adding a card = composing these in data.
 */
/** New thunder charges apply to each confirmed electrical recipient, including rebound hops. */
function consumeElectricalTargetBonus(e: EffectContext, target: Unit, electrical: boolean | undefined): number {
  if (!electrical) return 0;
  const mark = target.statuses.find(s => e.ctx.content.statuses[s.id].receivedElectricalBonus);
  const marked = mark ? e.ctx.content.statuses[mark.id].receivedElectricalBonus ?? 0 : 0;
  if (mark) removeStatus(e.ctx, target, mark.id, 'CONSUMED');
  return marked + e.caster.statuses.reduce((n,s) => n + (e.ctx.content.statuses[s.id].electricalDamageBonus ?? 0), 0);
}

const HANDLERS: { [K in EffectType]: Handler<K> } = {
  TRANSFORM: (e, fx) => transform(e.ctx, e.caster, fx.formId),
  DAMAGE: (e, fx) => {
    // Snapshot before the hit spends Guardia; later effects must not test the depleted shield.
    const highGuard = fx.fromCasterShield?.highGuard;
    const guardReward = highGuard && e.caster.shield >= highGuard.atLeast ? highGuard : null;
    const charge = nextAttackPush(e);
    let focus = 0;
    const electrical = fx.electrical ? e.caster.statuses.find(s => e.ctx.content.statuses[s.id].nextElectricalDamage) : undefined;
    const electricalBonus = electrical ? e.ctx.content.statuses[electrical.id].nextElectricalDamage ?? 0 : 0;
    if (electrical) removeStatus(e.ctx, e.caster, electrical.id, 'CONSUMED');
    const targets = fx.impactOnly ? selectUnits(e, fx.to).filter((u) => samePos(u.pos, e.resolved.impact)) : selectUnits(e, fx.to);
    // Decided from the board before any damage (a first target that dies still passes it on).
    const first = targets[0];
    const bounces = fx.rebound && first ? reboundChain(e.ctx.state, e.caster, first, fx.rebound.bounces) : [];
    for (const u of targets) {
      // Decided before the hit: killing the Presa still counts as hitting it.
      if (fx.focusGain && conditionsHold(e, fx.focusGain.when, u)) focus = fx.focusGain.amount;
      if (e.directAttack && !e.ctx.state.units.includes(e.caster)) break;
      const finisher = fx.finisher && u.hp <= fx.finisher.hpAtMost ? fx.finisher : null;
      if (finisher)
        e.ctx.emit({ type: 'FINISHER_TRIGGERED', unitId: u.id, casterId: e.caster.id, hpAtMost: finisher.hpAtMost, amount: finisher.amount });
      // Golpe del Bastión: the caster's shield NOW (read per hit, after any earlier effect).
      const guard = fx.fromCasterShield ? Math.min(e.caster.shield, fx.fromCasterShield.max) : 0;
      const base = finisher ? finisher.amount : guard > 0 ? guard : fx.amount;
      const amount = base + bonusFor(e, fx.bonus, u) + electricalBonus + consumeElectricalTargetBonus(e, u, fx.electrical);
      if (fx.shieldBreak) breakShield(e.ctx, u, fx.shieldBreak, e.caster.id);
      if (guard > 0) breakShield(e.ctx, e.caster, fx.fromCasterShield!.consumeAll ? e.caster.shield : guard, e.caster.id);
      dealDamage(e.ctx, u, attackDamage(e.ctx, e.caster, u, amount), e.caster.id, fx.damageType, fx.attackKind, fx.attackKind === 'RANGED' && e.directAttack ? 'DIRECT_RANGED' : e.directAttack);
    }
    let from = first?.pos;
    bounces.forEach((u, i) => {
      if (!fx.rebound || !from || !e.ctx.state.units.includes(u) || !e.ctx.state.units.includes(e.caster)) return;
      e.ctx.emit({ type: 'ARROW_REBOUNDED', casterId: e.caster.id, fromPos: { ...from }, unitId: u.id, pos: { ...u.pos }, bounce: i + 1, ...(fx.electrical ? { element: 'THUNDER' as const } : {}) });
      from = u.pos;
      dealDamage(e.ctx, u, attackDamage(e.ctx, e.caster, u, fx.rebound.amount + electricalBonus + consumeElectricalTargetBonus(e, u, fx.electrical)), e.caster.id, fx.damageType, fx.attackKind);
    });
    if (guardReward && targets.length && e.ctx.state.units.includes(e.caster)) {
      // Exact original targets only; dead units are not pushed. No extra collision damage.
      for (const u of targets) {
        if (!e.ctx.state.units.includes(u)) continue;
        const dir = dominantDirection(e.caster.pos, u.pos);
        if (dir) pushUnit(e.ctx, u, dir, guardReward.pushDistance, 0, e.caster.id);
      }
      if (e.ctx.state.units.includes(e.caster))
        applyEffect(e, { type: 'GAIN_MOVE_POINTS', amount: guardReward.movePoints });
    }
    if (charge && targets.length && e.ctx.state.units.includes(e.caster)) {
      // Spent by the first card hit that lands on someone; survivors are pushed, no collision damage.
      removeStatus(e.ctx, e.caster, charge.id, 'CONSUMED');
      for (const u of targets) {
        if (u.kind === 'STRUCTURE' || !e.ctx.state.units.includes(u)) continue;
        const dir = dominantDirection(e.caster.pos, u.pos);
        if (dir) pushUnit(e.ctx, u, dir, charge.distance, 0, e.caster.id);
      }
    }
    if (focus && e.ctx.state.units.includes(e.caster)) gainFocus(e.ctx, e.caster, focus);
  },
  HEAL: (e, fx) => {
    for (const u of selectUnits(e, fx.to)) healUnit(e.ctx, u, fx.amount + bonusFor(e, fx.bonus, u), e.caster.id);
  },
  SHIELD: (e, fx) => {
    for (const u of selectUnits(e, fx.to)) addShield(e.ctx, u, fx.amount + bonusFor(e, fx.bonus, u), e.caster.id);
  },
  APPLY_STATUS: (e, fx) => {
    const marked: Unit[] = [];
    for (const u of selectUnits(e, fx.to)) {
      applyStatus(e.ctx, u, fx.status, fx.duration, e.caster.id, fx.everyTarget ? marked : undefined);
      marked.push(u);
      // A challenged enemy re-declares its (public) intent at once: the telegraph shows the new target.
      if (e.ctx.content.statuses[fx.status].taunt && u.kind === 'ENEMY' && e.ctx.state.units.includes(u)) {
        const i = e.ctx.state.intents.findIndex((x) => x.enemyId === u.id);
        if (i >= 0) {
          const intent = declareIntent(e.ctx, u);
          e.ctx.state.intents[i] = intent;
          e.ctx.emit({ type: 'ENEMY_INTENT_DECLARED', intent });
        }
      }
    }
  },
  CLEANSE: (e, fx) => {
    for (const u of selectUnits(e, fx.to)) cleanseUnit(e.ctx, u);
  },
  PUSH: (e, fx) => {
    // Farthest first so units in a row do not block each other.
    const units = selectUnits(e, fx.to).sort(
      (a, b) => manhattan(e.caster.pos, b.pos) - manhattan(e.caster.pos, a.pos),
    );
    for (const u of units) {
      if (!e.ctx.state.units.includes(u)) continue;
      const dir = dominantDirection(e.caster.pos, u.pos);
      if (dir) pushUnit(e.ctx, u, dir, fx.distance, fx.collisionDamage, e.caster.id);
    }
  },
  PULL: (e, fx) => {
    // Closest first so a unit pulled in front never blocks one behind it.
    const units = selectUnits(e, fx.to)
      .filter((u) => u.kind !== 'STRUCTURE')
      .sort((a, b) => manhattan(e.caster.pos, a.pos) - manhattan(e.caster.pos, b.pos));
    for (const u of units) {
      if (!e.ctx.state.units.includes(u)) continue;
      const dir = dominantDirection(u.pos, e.caster.pos);
      if (dir) pushUnit(e.ctx, u, dir, fx.distance, 0, e.caster.id);
    }
  },
  TELEPORT_CASTER: (e) => {
    teleportUnit(e.ctx, e.caster, e.resolved.impact, e.caster.id);
  },
  CHARGE_CASTER: (e) => {
    const { caster, ctx } = e;
    const dir = alignedDirection(caster.pos, e.resolved.impact);
    if (!dir) return;
    const path: Pos[] = [];
    for (let i = 1; i <= manhattan(caster.pos, e.resolved.impact); i++) {
      const p = step(caster.pos, dir, i);
      if (!canEnter(ctx, p, caster.id)) break;
      path.push(p);
    }
    if (path.length) walkUnit(ctx, caster, path, 0, 'CHARGE');
  },
  STEP_CASTER: (e) => {
    const { caster, ctx } = e;
    const to = e.resolved.impact;
    if (samePos(caster.pos, to) || isMovementPrevented(ctx, caster)) return;
    // Shortest walk to the chosen tile (STEP targeting already proved one exists).
    const path = stepPath(ctx, caster, to);
    if (path) walkUnit(ctx, caster, path, 0);
  },
  GAIN_MOMENTUM: (e, fx) => {
    gainMomentum(e.ctx, e.caster, fx.amount, 'CARD');
  },
  GAIN_FOCUS: (e, fx) => {
    if (conditionsHold(e, fx.when)) gainFocus(e.ctx, e.caster, fx.amount);
  },
  PLACE_TRAP: (e, fx) => {
    if (!fx.net && (fx.on ?? 'IMPACT') === 'IMPACT') {
      placeTrap(e.ctx, e.caster, e.resolved.impact, fx.trapId, fx.damage, fx.rounds, fx.damageType, fx.rootOnTrigger);
      return;
    }
    const tiles = selectTiles(e, fx.on ?? 'IMPACT').filter((p) => isEmptyTile(e.ctx, p));
    placeTrapNet(e.ctx, e.caster, tiles, fx.trapId, fx.damage, fx.rounds, fx.net, fx.damageType, fx.rootOnTrigger);
  },
  CREATE_TERRAIN: (e, fx) => {
    for (const p of selectTiles(e, fx.on)) {
      if (fx.emptyOnly && unitAt(e.ctx.state, p)) continue;
      const current = tileAt(e.ctx.state.board, p)?.terrain;
      if (fx.replaceOnly && (!current || !fx.replaceOnly.includes(current))) continue;
      createTerrain(e.ctx, p, fx.terrain, fx.duration, e.caster.id);
    }
  },
  REMOVE_HAZARDS: (e, fx) => {
    for (const p of selectTiles(e, fx.on)) removeHazard(e.ctx, p);
  },
  CREATE_OBSTACLE: (e, fx) => {
    for (const p of selectTiles(e, fx.on))
      createObstacle(e.ctx, p, fx.obstacleId, fx.duration, e.caster.id);
  },
  ACTIVATE_SUMMON: (e) => {
    for (const u of selectUnits(e, 'SUMMONS')) activateSummonNow(e.ctx, u.id);
  },
  RECALL_SUMMON: (e) => {
    for (const u of selectUnits(e, 'SUMMONS')) defeatUnit(e.ctx, u);
  },
  SUMMON: (e, fx) => {
    spawnSummon(e.ctx, e.caster, fx.summonId, e.resolved.impact);
  },
  SACRIFICE_HP: (e, fx) => {
    // floor(14 / 2) = 7, floor(3 / 2) = 1; capped so the caster always keeps at least 1 HP.
    const amount = Math.min(Math.floor((e.caster.hp * fx.percentOfCurrent) / 100), e.caster.hp - 1);
    if (amount <= 0) return;
    e.caster.hp -= amount;
    e.ctx.emit({ type: 'HP_SACRIFICED', unitId: e.caster.id, ...(e.cardId ? { cardId: e.cardId } : {}), amount, hpAfter: e.caster.hp });
  },
  GAIN_SUMMON_CAPACITY: (e, fx) => {
    const from = summonCapacityOf(e.ctx.content, e.caster);
    e.caster.summonCapacityBonus = (e.caster.summonCapacityBonus ?? 0) + fx.amount;
    e.ctx.emit({
      type: 'SUMMON_CAPACITY_CHANGED',
      unitId: e.caster.id,
      ...(e.cardId ? { cardId: e.cardId } : {}),
      from,
      to: summonCapacityOf(e.ctx.content, e.caster),
      bonus: e.caster.summonCapacityBonus,
    });
  },
  DRAW: (e, fx) => {
    drawCards(e.ctx, fx.count);
  },
  GAIN_ENERGY: (e, fx) => {
    setEnergy(e.ctx, e.ctx.state.player.energy + fx.amount);
  },
  GAIN_MOVE_POINTS: (e, fx) => {
    setMovePoints(e.ctx, e.ctx.state.player.movePoints + fx.amount);
  },
  SWAP_WITH_TARGET: (e) => {
    const other = unitAt(e.ctx.state, e.resolved.impact);
    if (other && other !== e.caster && other.kind !== 'STRUCTURE') swapUnits(e.ctx, e.caster, other, e.caster.id);
  },
  SWAP_PAIR: (e) => {
    const partner = e.resolved.swapPartner;
    const a = unitAt(e.ctx.state, e.resolved.impact),
      b = partner ? unitAt(e.ctx.state, partner) : undefined;
    if (a && b && a !== b && a.kind !== 'STRUCTURE' && b.kind !== 'STRUCTURE') swapUnits(e.ctx, a, b, e.caster.id);
  },
  GRANT_COST_DISCOUNT: (e, fx) => {
    if (fx.minEnemiesInArea && selectUnits(e, 'ENEMIES').filter((u) => u.kind !== 'STRUCTURE').length < fx.minEnemiesInArea) return;
    const pending = (e.caster.costDiscounts ??= []);
    if (pending.some((d) => d.scope === fx.scope)) return;
    pending.push({ scope: fx.scope, amount: fx.amount, sourceCardId: e.cardId ?? '' });
    e.ctx.emit({ type: 'COST_DISCOUNT_GRANTED', unitId: e.caster.id, scope: fx.scope, amount: fx.amount });
  },
  PLACE_GLYPH: (e, fx) => {
    placeGlyph(e.ctx, e.caster, e.resolved.affectedTiles, fx.glyphId, fx.damage, fx.damageType, fx.activations, fx.maxTargets, fx.activations !== undefined ? e.resolved.impact : undefined);
  },
};


export function applyEffect(ectx: EffectContext, effect: EffectDef): void {
  (HANDLERS[effect.type] as Handler<typeof effect.type>)(ectx, effect as never);
}

/** Effects resolve in order; unit selection is re-evaluated per effect (after pushes, deaths…). */
export function applyEffects(ectx: EffectContext, effects: readonly EffectDef[]): void {
  for (const effect of effects) {
    if (!ectx.ctx.state.units.includes(ectx.caster)) break;
    applyEffect(ectx, effect);
  }
}
