import { planIntent } from '../../src/game/domain/ai/ai';
import { computeReachable } from '../../src/game/domain/board/pathfinding';
import { getHero } from '../../src/game/domain/board/occupancy';
import { playCard } from '../../src/game/domain/cards/play-card';
import { queryContext } from '../../src/game/domain/context';
import { suggestRitualAction } from '../../src/game/domain/ai/ritual-policy';
import { suggestCapacityBond } from '../../src/game/domain/ai/capacity-policy';
import { suggestHandDiscard } from '../../src/game/domain/ai/hand-discard';
import { archerHoldsCard, archerPositionScore } from '../../src/game/domain/ai/archer-policy';
import { manhattan, posKey } from '../../src/game/domain/core/position';
import { updateObjectives } from '../../src/game/domain/objectives/objective-rules';
import { actSummons } from '../../src/game/domain/summons/summons';
import type { GameState } from '../../src/game/domain/state';
import { moveUnit } from '../../src/game/domain/turn/player-actions';
import type { Command } from '../../src/game/engine/commands';
import type { GameEngine } from '../../src/game/engine/GameEngine';

/**
 * Greedy one-step-lookahead bot used to prove scenarios are finishable and to eyeball
 * balance. It only issues regular Commands, so it plays by exactly the same rules as a human.
 */
export interface BotOptions {
  /**
   * Count what player summons do on their own turn: scouts walk to mission pickups, so a page
   * a scout can reach is not only the hero's job. Used by the champion balance simulations.
   */
  summonAware?: boolean;
  /**
   * Ritual play at the start of each turn (`suggestRitualAction`): seal pieces (the free seal,
   * paid ones to finish a ritual), activate a complete ritual when it is obviously useful. Off by default (existing probes unchanged).
   */
  rituals?: boolean | 'seal-only';
  /**
   * Treat end-of-turn terrain damage (lava, fire) under the hero and its summons like incoming
   * damage. Off by default (existing probes unchanged); the World 2 probes turn it on.
   */
  terrainAware?: boolean;
  /**
   * After round 6, finishing the fight weighs more each round (enemy HP and the pull toward the
   * target), like a player pushing for the win. Without it the bot kites a slow melee enemy
   * forever (timeouts on the Colossus, the Forge King…). Off by default.
   */
  antiStall?: boolean;
  /**
   * Score each candidate AFTER the player's summons take their end-of-turn action (`actSummons`
   * on a clone), so commands that only pay off through the summons (Marcar Presa, positioning
   * next to them) are valued like a player who knows what the army will do. Off by default.
   */
  summonLookahead?: boolean;
  /**
   * Archer knowledge (domain/ai/archer-policy.ts): value the Presa, Distancia Óptima, banked
   * Concentración and keeping out of melee; hold Tiro al Corazón unless empowered or lethal.
   * Off by default (existing probes unchanged).
   */
  archer?: boolean;
  /**
   * Capacity cards (Vínculo Prohibido) through `suggestCapacityBond` before the greedy loop: the
   * one-step score only sees the HP paid, never the summon it unlocks. Off by default.
   */
  capacityBond?: boolean;
}

function evaluate(engine: GameEngine, state: GameState, options: BotOptions = {}): number {
  if (options.summonLookahead && !state.outcome && state.units.some((u) => u.kind === 'SUMMON')) {
    const after = structuredClone(state) as GameState;
    const actx = queryContext(after, engine.content);
    actSummons(actx);
    updateObjectives(actx);
    return evaluate(engine, after, { ...options, summonLookahead: false });
  }
  const ctx = queryContext(state, engine.content);
  const hero = getHero(state);
  if (!hero) return -1e6;
  if (state.outcome?.result === 'WON') return 1e6;

  // Momentum (Warrior only; 0 for other champions) is future damage/healing: worth keeping.
  let score = hero.hp * 2 + hero.shield + (hero.momentum?.value ?? 0) * 1.5;
  if (options.archer) score += archerPositionScore(state, engine.content);
  const urgency = options.antiStall ? 1 + Math.max(0, state.round - 6) * 0.25 : 1;
  const danger = new Map<string, number>();
  for (const intent of state.intents) {
    const plan = planIntent(ctx, intent);
    for (const id of plan?.targetUnitIds ?? []) danger.set(id, (danger.get(id) ?? 0) + (plan?.damage ?? 0));
  }
  for (const u of state.units) {
    if (u.faction === 'ENEMY') score -= (u.hp * 3 + 12) * urgency;
    // Owned creatures have future tactical value even before their first activation.
    // Sustained mobility has value only while a real hostile is out of reach. No free value
    // for refreshing a full buff next to an enemy; slow/high-value creatures benefit most.
    if(u.kind==='SUMMON' && u.faction==='PLAYER') {
      const turns=u.statuses.find(s=>s.id==='UNLEASHED_HUNT')?.turnsLeft??0;
      const def=engine.content.summons?.[u.defId];
      const gap=Math.max(0,Math.min(...state.units.filter(t=>t.faction!==u.faction).map(t=>manhattan(u.pos,t.pos)))-(def?.attackRange??1));
      if(Number.isFinite(gap)&&gap>0)score+=Math.min(12,Math.min(6,gap)/Math.max(1,u.moveRange)*turns)*(1+(def?.damage??0)/4);
    }
    if (u.kind === 'SUMMON') score += 6 + u.hp + u.shield + (engine.content.summons?.[u.defId]?.damage ?? 0) * 2;
    if (u.kind === 'STRUCTURE') score += u.hp * 4 + u.shield * 2 - (danger.get(u.id) ?? 0) * 4;
  }
  score -= Math.max(0, (danger.get(hero.id) ?? 0) - hero.shield) * 2.5;
  if (options.terrainAware)
    for (const u of state.units)
      if (u.faction === 'PLAYER' && u.kind !== 'STRUCTURE') {
        const t = state.board.tiles[u.pos.y * state.board.width + u.pos.x];
        const burn = t ? (engine.content.terrain[t.terrain]?.endTurnDamage ?? 0) : 0;
        // The hero can still step off this turn while it has move points left (lookahead is one action).
        score -= burn * (u.kind === 'HERO' ? (state.player.movePoints > 0 ? 0.6 : 2.5) : 1);
      }

  // Close the distance on big boards: a small pull toward the nearest enemy (or the target).
  const targetId = state.objectives.find((o) => o.def.type === 'DEFEAT_TARGET')?.def;
  const focus = state.units.filter(
    (u) => u.faction === 'ENEMY' && (targetId?.type !== 'DEFEAT_TARGET' || u.id === targetId.targetUnitId),
  );
  if (focus.length && !state.objectives.some((o) => o.def.type !== 'ELIMINATE_ALL' && o.def.type !== 'DEFEAT_TARGET'))
    score -= Math.max(0, Math.min(...focus.map((u) => manhattan(hero.pos, u.pos))) - 3) * 0.6 * urgency;
  for (const u of focus) if (targetId?.type === 'DEFEAT_TARGET') score -= u.hp * 6 * urgency;

  for (const obj of state.objectives) {
    const def = obj.def;
    const goals =
      def.type === 'REACH_TILE'
        ? def.tiles
        : def.type === 'COLLECT_OBJECTS'
          ? state.collectibles.filter((c) => c.kind === def.kind && !c.collected).map((c) => c.pos)
          : [];
    if (def.type === 'COLLECT_OBJECTS') score += state.collectibles.filter((c) => c.kind === def.kind && c.collected).length * 80;
    if (!goals.length) continue;
    const reach = computeReachable(ctx, hero);
    const scouts = options.summonAware
      ? state.units.filter((u) => u.kind === 'SUMMON' && u.faction === 'PLAYER' && engine.content.summons?.[u.defId]?.behavior === 'SCOUT')
      : [];
    const dists = goals.map((t) =>
      Math.min(reach.get(posKey(t))?.cost ?? manhattan(hero.pos, t) + 6, ...scouts.map((u) => manhattan(u.pos, t) + 1)),
    );
    score -= Math.min(...dists) * 12;
  }
  return score;
}

function candidates(engine: GameEngine, options: BotOptions = {}): Command[] {
  const out: Command[] = engine.getLegalMoves().map((n) => ({ type: 'MOVE_UNIT', unitId: engine.heroId, to: n.pos }));
  for (const card of engine.state.player.hand) {
    if (!engine.getCardPlayability(card.uid).playable) continue;
    const def = engine.content.cards[card.cardId];
    if (def?.targeting.type === 'SELF') out.push({ type: 'PLAY_CARD', cardUid: card.uid, target: null });
    else
      for (const t of engine.getValidTargets(card.uid))
        if (!options.archer || !archerHoldsCard(engine.state, engine.content, card.cardId, t))
          out.push({ type: 'PLAY_CARD', cardUid: card.uid, target: t });
  }
  return out;
}

function simulate(engine: GameEngine, cmd: Command): GameState | null {
  const state = structuredClone(engine.state) as GameState;
  const ctx = queryContext(state, engine.content);
  const r =
    cmd.type === 'MOVE_UNIT'
      ? moveUnit(ctx, cmd.unitId, cmd.to)
      : cmd.type === 'PLAY_CARD'
        ? playCard(ctx, cmd.cardUid, cmd.target)
        : { ok: false as const };
  if (!r.ok) return null;
  updateObjectives(ctx); // the real win/lose rules, on the clone
  return state;
}

export function playBattle(
  engine: GameEngine,
  maxRounds = 20,
  beforeEndTurn?: (engine: GameEngine) => void,
  options: BotOptions = {},
): GameState {
  while (!engine.state.outcome && engine.state.round <= maxRounds) {
    if (options.rituals)
      for (let i = 0; i < 6 && !engine.state.outcome; i++) {
        const action = suggestRitualAction(queryContext(engine.state as GameState, engine.content));
        if (!action || (options.rituals === 'seal-only' && action.type !== 'COMMIT_RITUAL_PIECE') || !engine.dispatch(action).ok) break;
      }
    if (options.capacityBond && !engine.state.outcome) {
      const bond = suggestCapacityBond(queryContext(engine.state as GameState, engine.content));
      if (bond) engine.dispatch(bond);
    }
    for (let actions = 0; actions < 30; actions++) {
      const base = evaluate(engine, engine.state as GameState, options);
      let best: { cmd: Command; score: number } | null = null;
      for (const cmd of candidates(engine, options)) {
        const next = simulate(engine, cmd);
        if (!next) continue;
        const score = evaluate(engine, next, options) - (cmd.type === 'MOVE_UNIT' ? 0.1 : 0);
        if (!best || score > best.score) best = { cmd, score };
      }
      if (!best || best.score <= base + 0.01) break;
      engine.dispatch(best.cmd);
      if (engine.state.outcome) break;
    }
    if (engine.state.outcome) break;
    beforeEndTurn?.(engine);
    // Over the hand size: discard the lowest-utility card (cheap heuristic, see hand-discard.ts).
    const discardUid = suggestHandDiscard(engine.state, engine.content);
    engine.dispatch(discardUid ? { type: 'END_TURN', discardUid } : { type: 'END_TURN' });
  }
  return engine.state as GameState;
}
