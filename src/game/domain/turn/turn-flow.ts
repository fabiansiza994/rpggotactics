import { actSummons } from '../summons/summons';
import { declareAllIntents, executeIntent, planIntent, type IntentPlan } from '../ai/ai';
import { canEnter, effectiveMoveRange, getHero, terrainDefAt, unitAt } from '../board/occupancy';
import { drawCards, setEnergy, setMovePoints } from '../cards/deck';
import { expireShield } from '../combat/damage';
import { resolveGlyphs } from '../combat/glyphs';
import { requireDef } from '../content';
import type { RuleContext } from '../context';
import { comparePos, manhattan } from '../core/position';
import type { Faction, Unit } from '../entities/unit';
import { updateObjectives } from '../objectives/objective-rules';
import type { EnemySpawnDef } from '../scenario';
import { decrementStatuses, expireTurnStartStatuses, tickStatuses } from '../statuses/status-rules';
import { allPositions } from '../board/board';
import { applyEndTurnTerrain, tickBoardDurations } from '../terrain/terrain-rules';
import { fireRoundTrigger } from '../mechanisms/mechanism-rules';

/**
 * Round structure (02_MVP_RULES §2):
 *   Player turn start → start effects → draw → restore resources → [player actions]
 *   → player turn end (terrain + status durations) → enemy turn (intents resolve)
 *   → enemy turn end → board durations tick → win/lose check → next round (waves spawn).
 */

const unitsOf = (ctx: RuleContext, faction: Faction): Unit[] =>
  ctx.state.units.filter((u) => u.faction === faction);

export function startFactionTurn(ctx: RuleContext, faction: Faction): void {
  ctx.state.activeFaction = faction;
  ctx.state.phase = faction;
  ctx.emit({ type: 'TURN_STARTED', faction, round: ctx.state.round });
  for (const unit of unitsOf(ctx, faction)) {
    expireShield(ctx, unit);
    expireTurnStartStatuses(ctx, unit);
    tickStatuses(ctx, unit, 'TURN_START');
  }
  resolveGlyphs(ctx, faction);
}

export function endFactionTurn(ctx: RuleContext, faction: Faction): void {
  for (const unit of unitsOf(ctx, faction)) {
    applyEndTurnTerrain(ctx, unit);
    if (!ctx.state.units.includes(unit)) continue;
    tickStatuses(ctx, unit, 'TURN_END');
    if (!ctx.state.units.includes(unit)) continue;
    decrementStatuses(ctx, unit);
  }
  ctx.emit({ type: 'TURN_ENDED', faction, round: ctx.state.round });
}

export function spawnEnemy(ctx: RuleContext, spawn: EnemySpawnDef): Unit | null {
  const def = requireDef(ctx.content.enemies, spawn.enemyId, 'enemy');
  // Occupied spawn tile: use the closest free tile (deterministic).
  const tile = canEnter(ctx, spawn.pos)
    ? spawn.pos
    : allPositions(ctx.state.board)
        .filter((p) => canEnter(ctx, p) && !unitAt(ctx.state, p))
        .sort((a, b) => manhattan(a, spawn.pos) - manhattan(b, spawn.pos) || comparePos(a, b))[0];
  if (!tile) return null;
  const unit: Unit = {
    id: spawn.id,
    defId: def.id,
    name: def.name,
    faction: 'ENEMY',
    kind: 'ENEMY',
    pos: tile,
    hp: def.maxHp,
    maxHp: def.maxHp,
    shield: 0,
    armor: def.armor,
    moveRange: def.moveRange,
    statuses: [],
    targetPreference: spawn.targetPreference ?? 'HERO',
  };
  ctx.state.units.push(unit);
  ctx.emit({
    type: 'UNIT_SPAWNED',
    unitId: unit.id,
    faction: 'ENEMY',
    kind: 'ENEMY',
    pos: unit.pos,
  });
  return unit;
}

function startRound(ctx: RuleContext): void {
  const { state } = ctx;
  ctx.emit({ type: 'ROUND_STARTED', round: state.round });
  const due = state.pendingWaves.filter((w) => w.round <= state.round);
  state.pendingWaves = state.pendingWaves.filter((w) => w.round > state.round);
  for (const wave of due) for (const spawn of wave.enemies) spawnEnemy(ctx, spawn);
  if (state.mechanisms) fireRoundTrigger(ctx, 'ON_ROUND_START');
}

/** Restore once at turn initialization, never during snapshots/reconnect. */
export function restoreTurnEnergy(ctx: RuleContext): void {
  const hero = getHero(ctx.state);
  const bonus = hero?.kind === 'HERO' ? (terrainDefAt(ctx, hero.pos)?.startEnergyBonus ?? 0) : 0;
  setEnergy(ctx, ctx.state.player.maxEnergy + bonus);
}

/** Per-turn limits of the active player (altar seals priced per turn). Turn initialization only. */
export function resetTurnLimits(ctx: RuleContext): void {
  const p = ctx.state.player;
  for (const card of [...p.hand,...p.deck,...p.discard,...(p.altar ?? [])]) delete card.unavailableThisTurn;
  if (ctx.state.player.altarSeals) ctx.state.player.altarSeals = 0;
}

export function startPlayerTurn(ctx: RuleContext, isFirstTurn: boolean): void {
  startFactionTurn(ctx, 'PLAYER');
  if (!getHero(ctx.state)) return;
  const { player } = ctx.state;
  restoreTurnEnergy(ctx);
  resetTurnLimits(ctx);
  setMovePoints(ctx, effectiveMoveRange(ctx, getHero(ctx.state)!, player.maxMovePoints));
  // The opening hand already holds `startingHandSize` cards: no extra draw on round 1.
  if (!isFirstTurn) drawCards(ctx, player.drawPerTurn);
  if (updateObjectives(ctx)) return;
  declareAllIntents(ctx);
}

/** Starts the battle: round 1, player turn. Called once after the initial state is built. */
export function beginBattle(ctx: RuleContext): void {
  startRound(ctx);
  startPlayerTurn(ctx, true);
  updateObjectives(ctx);
}

/**
 * Player turn end → enemy turn → enemy turn end. Returns true if the battle ended.
 *
 * `onPlan` observes each enemy's plan right before it executes. The engine runs this on a
 * cloned state to build the intent telegraphs, so previews account for enemies acting in
 * sequence (an earlier enemy blocking a later one's path) and always match execution.
 */
export function resolveEnemyPhase(ctx: RuleContext, onPlan?: (plan: IntentPlan) => void): boolean {
  actSummons(ctx);
  if (updateObjectives(ctx)) return true;
  endFactionTurn(ctx, 'PLAYER');
  if (updateObjectives(ctx)) return true;

  startFactionTurn(ctx, 'ENEMY');
  if (updateObjectives(ctx)) return true;
  const order = ctx.state.units.filter((u) => u.kind === 'ENEMY').map((u) => u.id);
  for (const enemyId of order) {
    const intent = ctx.state.intents.find((i) => i.enemyId === enemyId);
    if (!intent) continue;
    if (onPlan) {
      const plan = planIntent(ctx, intent);
      if (plan) onPlan(plan);
    }
    executeIntent(ctx, intent);
    if (updateObjectives(ctx)) return true;
  }
  ctx.state.intents = [];
  endFactionTurn(ctx, 'ENEMY');
  return updateObjectives(ctx);
}

/**
 * Resolves END_TURN completely and synchronously: player end → enemy phase → round end →
 * next player turn. Stops as soon as the battle is decided.
 */
export function endPlayerTurnAndRunRound(ctx: RuleContext): void {
  if (resolveEnemyPhase(ctx)) return;

  tickBoardDurations(ctx);
  if (ctx.state.mechanisms) fireRoundTrigger(ctx, 'ON_ROUND_END');
  ctx.state.round += 1;
  if (updateObjectives(ctx)) return;

  startRound(ctx);
  startPlayerTurn(ctx, false);
  updateObjectives(ctx);
}
