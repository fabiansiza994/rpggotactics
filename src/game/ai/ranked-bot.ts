import { computeReachable } from "../domain/board/pathfinding";
import { hasLineOfSight } from "../domain/board/line-of-sight";
import { terrainDefAt } from "../domain/board/occupancy";
import type { GameContent } from "../domain/content";
import type { GameState, PlayerState } from "../domain/state";
import type { Command } from "../engine/commands";
import { applyDuel, duelView } from "../pvp/duel";
import { queryContext } from "../domain/context";
import { legalHeroMoves } from "../domain/turn/player-actions";
import {
  checkPlayability,
  summonSearchChoices,
  discardSearchChoices,
} from "../domain/cards/play-card";
import {
  getValidTargets,
  pairSwapPartners,
  resolveTarget,
} from "../domain/cards/targeting";
import { getHero, unitAt, isActionPrevented } from "../domain/board/occupancy";
import { suggestRitualAction } from "../domain/ai/ritual-policy";
import { suggestCapacityBond } from "../domain/ai/capacity-policy";
import { suggestHandDiscard } from "../domain/ai/hand-discard";
import { manhattan } from "../domain/core/position";
import { BOT_LEVELS, type BotIdentity } from "./ranked-bot-policy";
/** Only this projection crosses into the planner. Never pass canonical state to planBot. */
export function botObservation(
  state: GameState,
  seat: 0 | 1,
  content: GameContent,
): GameState {
  const view = duelView(state, seat, content);
  // Future draw order is unknown even to the owner. Search candidates are unordered private knowledge.
  view.player.deck = [];
  view.rngState = 0;
  view.nextId = 0;
  view.traps = view.traps?.filter(
    (t) => view.units.find((u) => u.id === t.ownerId)?.faction === "PLAYER",
  );
  return structuredClone(view);
}
function planningState(observation: GameState, seed: number): GameState {
  const s = structuredClone(observation);
  const opponent = s.units.find(
    (u) => u.kind === "HERO" && u.id !== s.player.heroId,
  );
  if (!opponent) throw Error("BOT_NO_OPPONENT");
  const other: PlayerState = {
    heroId: opponent.id,
    energy: 0,
    maxEnergy: 0,
    movePoints: 0,
    maxMovePoints: 0,
    drawPerTurn: 0,
    maxHandSize: 0,
    deck: [],
    hand: [],
    discard: [],
    deckRecycles: 0,
  };
  s.duel = {
    champions: [s.player.heroId, opponent.id],
    active: 0,
    other,
    turns: Math.max(2, (s.round - 1) * 2),
  };
  s.player.deck = structuredClone(s.searchChoices ?? []).sort(
    (a, b) => a.cardId.localeCompare(b.cardId) || a.uid.localeCompare(b.uid),
  );
  s.searchChoices = undefined;
  s.pileCounts = undefined;
  s.rngState = seed >>> 0 || 1;
  s.nextId = 100000;
  s.phase = "PLAYER";
  s.activeFaction = "PLAYER";
  return s;
}
export function botCandidates(s: GameState, content: GameContent): Command[] {
  const ctx = queryContext(s, content),
    hero = getHero(s);
  if (!hero) return [];
  const discardUid = suggestHandDiscard(s, content);
  const out: Command[] = [
    discardUid ? { type: "END_TURN", discardUid } : { type: "END_TURN" },
  ];
  const ritual = suggestRitualAction(ctx),
    bond = suggestCapacityBond(ctx);
  if (ritual) out.push(ritual);
  if (bond) out.push(bond);

  for (const card of s.player.hand) {
    if (!checkPlayability(ctx, card.uid).ok) continue;
    const def = content.cards[card.cardId];
    if (!def) continue;
    if (def.discardSearch) {
      for (const choice of discardSearchChoices(s, content))
        out.push({
          type: "SEARCH_SUMMON",
          cardUid: card.uid,
          choiceUid: choice.uid,
        });
      continue;
    }
    if (def.deckSearch) {
      for (const choice of summonSearchChoices(s, content))
        out.push({
          type: "SEARCH_SUMMON",
          cardUid: card.uid,
          choiceUid: choice.uid,
        });
      continue;
    }
    const targets =
      def.targeting.type === "SELF"
        ? [null]
        : getValidTargets(ctx, hero, def.targeting);
    for (const target of targets) {
      if (target && def.targeting.type === "UNIT" && def.targeting.pairSwap) {
        const first = unitAt(s, target);
        if (first)
          for (const secondary of pairSwapPartners(
            ctx,
            hero,
            def.targeting,
            first,
          ))
            if (secondary)
              out.push({
                type: "PLAY_CARD",
                cardUid: card.uid,
                target,
                secondary,
              });
      } else if (
        "area" in def.targeting &&
        def.targeting.area?.shape === "WALL"
      ) {
        out.push({
          type: "PLAY_CARD",
          cardUid: card.uid,
          target,
          wallOrientation: "HORIZONTAL",
        });
        out.push({
          type: "PLAY_CARD",
          cardUid: card.uid,
          target,
          wallOrientation: "VERTICAL",
        });
      } else out.push({ type: "PLAY_CARD", cardUid: card.uid, target });
    }
  }
  for (const n of legalHeroMoves(ctx))
    out.push({ type: "MOVE_UNIT", unitId: hero.id, to: n.pos });
  return [...new Map(out.map((c) => [JSON.stringify(c), c])).values()];
}
/** Ordering only, using public geometry/effects; the engine still decides legality and damage. */
function orderedCandidates(s: GameState, content: GameContent): Command[] {
  const hero = getHero(s),
    ctx = queryContext(s, content);
  const enemies = s.units.filter((u) => hero && u.faction !== hero.faction);
  function priority(c: Command): number {
    if (!hero) return 0;
    if (c.type === "END_TURN") return 1e6;
    if (c.type === "MOVE_UNIT") {
      const rival = enemies.find((u) => u.kind === "HERO");
      return rival
        ? 3 -
            Math.abs(
              manhattan(c.to, rival.pos) -
                (hero.defId === "shapeshifter" ? 1 : 3),
            )
        : 0;
    }
    if (c.type !== "PLAY_CARD") return 4;
    const card =
      content.cards[
        s.player.hand.find((h) => h.uid === c.cardUid)?.cardId ?? ""
      ];
    if (!card) return -50;
    const target = resolveTarget(
      ctx,
      hero,
      card.targeting,
      c.target ?? null,
      c.secondary,
      c.wallOrientation,
    );
    if (!target) return -50;
    const victims = enemies.filter(
      (u) =>
        target.affectedTiles.some((p) => p.x === u.pos.x && p.y === u.pos.y) ||
        target.hitUnitId === u.id,
    );
    let value = -card.cost * 0.05;
    for (const e of card.effects) {
      if (e.type === "DAMAGE")
        for (const u of victims) {
          const amount = Math.max(
            0,
            e.amount - (e.attackKind === "PIERCING" ? 0 : u.armor),
          );
          value += Math.min(u.hp + u.shield, amount) * 5;
          if (amount >= u.hp + u.shield) value += u.kind === "HERO" ? 1000 : 20;
        }
      if (e.type === "HEAL")
        value += Math.min(hero.maxHp - hero.hp, e.amount) * 4;
      if (e.type === "SHIELD")
        value += Math.min(5, e.amount) * (hero.hp < 8 ? 3 : 1);
      if (e.type === "DRAW" && s.player.hand.length < s.player.maxHandSize)
        value += 8;
      if (e.type === "SUMMON") value += 9;
      if (e.type === "TRANSFORM") value += 5;
      if (e.type === "GAIN_ENERGY" || e.type === "GAIN_MOVE_POINTS") value += 3;
    }
    return value;
  }
  return botCandidates(s, content)
    .map((command, index) => ({ command, index, priority: priority(command) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .map((x) => x.command);
}

function evaluate(
  s: GameState,
  heroId: string,
  content: GameContent,
  bot: BotIdentity,
  routeCache: Map<string, number>,
): number {
  const hero = s.units.find((u) => u.id === heroId);
  const rival = s.units.find((u) => u.kind === "HERO" && u.id !== heroId);
  if (!hero) return -1e6;
  if (!rival) return 1e6;
  const defense = bot.personality === "DEFENSIVE" ? 1.35 : 1,
    attack = bot.personality === "AGGRESSIVE" ? 1.3 : 1;
  let score =
    (hero.hp * 5 + hero.shield * 2) * defense -
    (rival.hp * 5 + rival.shield * 2) * attack;
  score += hero.armor * 1.8;
  if (hero.activeForm) {
    score += 2;
    score +=
      s.player.hand.filter((c) =>
        content.cards[c.cardId]?.requiredForms?.includes(hero.activeForm!),
      ).length * 0.8;
  }
  const ownFaction = hero.faction;
  for (const u of s.units) {
    if (u.kind !== "SUMMON") continue;
    const value =
      6 + u.hp + u.shield + (content.summons?.[u.defId]?.damage ?? 0) * 2;
    score +=
      (u.faction === ownFaction ? 1 : -1) *
      value *
      (bot.personality === "SUMMONS" ? 1.3 : 1);
  }
  const desiredRange = hero.defId === "shapeshifter" ? 1 : 3;
  const ctx = queryContext(s, content);
  const routeKey = JSON.stringify([
    hero.id,
    hero.pos,
    rival.pos,
    s.units.map((u) => [u.id, u.pos]),
    s.board.tiles.map((t) => t.terrain),
    s.obstacles,
  ]);
  let route = routeCache.get(routeKey);
  if (route === undefined) {
    const goals = [...computeReachable(ctx, hero).values()].filter(
      (n) =>
        manhattan(n.pos, rival.pos) <= desiredRange &&
        hasLineOfSight(ctx, n.pos, rival.pos),
    );
    route = goals.length
      ? Math.min(...goals.map((n) => n.cost))
      : s.board.width + s.board.height;
    routeCache.set(routeKey, route);
  }
  score -= route * (hero.defId === "shapeshifter" ? 1.5 : 0.65);
  const control = bot.personality === "CONTROL" ? 1.5 : 1;
  for (const unit of s.units) {
    const own = unit.faction === ownFaction,
      sign = own ? -1 : 1;
    const hazard = terrainDefAt(ctx, unit.pos)?.endTurnDamage ?? 0;
    score += sign * Math.min(unit.hp, hazard) * 2;
    for (const status of unit.statuses) {
      const def = content.statuses[status.id];
      if (!def) continue;
      const value =
        (def.preventsActions ? 2.5 : 0) +
        (def.preventsMovement ? 1.2 : 0) +
        (def.tickDamage ?? 0) * 1.5;
      score += sign * value * Math.min(2, status.turnsLeft) * control;
    }
  }
  // Public immediate threat: visible summon range/LOS and current armor/shield, never rival cards.
  let incoming = 0;
  for (const u of s.units.filter((u) => u.faction !== ownFaction)) {
    if (isActionPrevented(ctx, u)) continue;
    const def = u.kind === "SUMMON" ? content.summons?.[u.defId] : undefined;
    const range = def?.attackRange ?? 1;
    if (
      manhattan(hero.pos, u.pos) <= range &&
      hasLineOfSight(ctx, u.pos, hero.pos)
    )
      incoming += Math.max(0, (def?.damage ?? 2) - hero.armor);
  }
  const exposed = Math.max(0, incoming - hero.shield);
  score -= exposed * (hero.hp < 8 ? 3 : 0.5);
  if (exposed >= hero.hp) score -= 100;
  score += (s.player.heroId === heroId ? s.player.energy : 0) * 0.12;
  if (bot.personality === "COMBOS") score += (s.player.altar?.length ?? 0) * 2;
  if (bot.personality === "CONTROL")
    score -= Math.abs(hero.pos.x - rival.pos.x) * 0.25;
  return score;
}
export interface BotPlan {
  command: Command;
  nodes: number;
  cpuMs: number;
  cutoff: boolean;
  score: number;
  depths: number[];
  candidates: number;
  invalid: number;
}
export function planBot(
  observation: GameState,
  content: GameContent,
  bot: BotIdentity,
  options: { clock?: () => number; maxNodes?: number; maxCpuMs?: number } = {},
): BotPlan {
  const clock = options.clock ?? (() => performance.now()),
    start = clock(),
    level =
      BOT_LEVELS[Math.min(BOT_LEVELS.length - 1, Math.max(0, bot.level))]!;
  const budget = Math.min(level.nodes, options.maxNodes ?? level.nodes),
    ms = Math.min(level.cpuMs, options.maxCpuMs ?? level.cpuMs);
  const initial = planningState(observation, bot.seed),
    heroId = initial.player.heroId;
  const depths: number[] = [];
  let candidates = 0,
    invalid = 0;
  let nodes = 0,
    cutoff = false;
  type Node = {
    state: GameState;
    first: Command;
    score: number;
    seen: Set<string>;
    expectedDraws: number;
  };
  let beam: Node[] = [];
  let best: Node | undefined;
  const routeCache = new Map<string, number>();
  const base = evaluate(initial, heroId, content, bot, routeCache);
  const unknownDraws =
    (observation.pileCounts?.deck ?? 0) + observation.player.discard.length;
  for (let depth = 0; depth < level.depth; depth++) {
    const next: Node[] = [];
    const parents =
      depth === 0
        ? [
            {
              state: initial,
              first: null,
              seen: new Set<string>(),
              expectedDraws: 0,
            },
          ]
        : beam;
    // Reserve work for more than the first parent/root layer; deeper profiles need room for combos.
    const perParent =
      level.depth === 1
        ? budget
        : Math.max(
            8,
            Math.floor(budget / (level.depth * Math.max(2, parents.length))),
          );
    outer: for (const parent of parents) {
      let expanded = 0;
      const ordered = orderedCandidates(parent.state, content);
      candidates += ordered.length;
      for (const command of ordered) {
        if (expanded >= perParent) break;
        if (nodes >= budget || clock() - start >= ms) {
          cutoff = true;
          break outer;
        }
        nodes++;
        expanded++;
        depths[depth] = (depths[depth] ?? 0) + 1;
        try {
          const card =
            command.type === "PLAY_CARD"
              ? content.cards[
                  parent.state.player.hand.find(
                    (h) => h.uid === command.cardUid,
                  )?.cardId ?? ""
                ]
              : undefined;
          const drawCount =
            card?.effects.reduce(
              (n, e) => n + (e.type === "DRAW" ? e.count : 0),
              0,
            ) ?? 0;
          let simulation = parent.state;
          if (drawCount > 0) {
            // Search choices are an unordered authorization list, never a predicted draw pile.
            simulation = structuredClone(parent.state);
            simulation.player.deck = [];
            simulation.player.discard = [];
          }
          const applied = applyDuel(simulation, command, content).state;
          const key = JSON.stringify({
            units: applied.units,
            player: applied.player,
            turn: applied.duel?.turns,
          });
          if (parent.seen.has(key)) continue;
          const first = parent.first ?? command;
          // Value unknown draws conservatively, without fabricating cards or peeking at deck order.
          const expectedDraws =
            parent.expectedDraws +
            Math.max(
              0,
              Math.min(
                drawCount,
                unknownDraws - parent.expectedDraws,
                parent.state.player.maxHandSize -
                  parent.state.player.hand.length +
                  (card ? 1 : 0) -
                  parent.expectedDraws,
              ),
            );
          const score =
            evaluate(applied, heroId, content, bot, routeCache) +
            expectedDraws * 2 -
            (depth + 1) * 0.03;
          const node = {
            state: applied,
            first,
            score,
            expectedDraws,
            seen: new Set([...parent.seen, key]),
          };
          if (!best || node.score > best.score) best = node;
          if (command.type !== "END_TURN" && !applied.outcome) next.push(node);
        } catch {
          invalid++;
          /* Engine is the final legal-action filter on the independent simulation. */
        }
      }
    }
    beam = next.sort((a, b) => b.score - a.score).slice(0, level.width);
    if (cutoff || !beam.length) break;
  }
  const end = botCandidates(initial, content)[0] ?? {
    type: "END_TURN" as const,
  };
  return {
    depths,
    candidates,
    invalid,
    command: best && best.score > base + 0.01 ? best.first : end,
    nodes,
    cpuMs: clock() - start,
    cutoff,
    score: best?.score ?? base,
  };
}
