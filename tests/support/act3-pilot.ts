import type { GameEngine } from '../../src/game/engine/GameEngine';
import { playBattle } from './bot';
import { executeCommand, type Command } from '../../src/game/engine/commands';
import type { Pos } from '../../src/game/domain/core/position';
import { manhattan, samePos } from '../../src/game/domain/core/position';
import type { GameContent } from '../../src/game/domain/content';
import type { GameState } from '../../src/game/domain/state';
import { queryContext } from '../../src/game/domain/context';
import { fallbackDiscardUid } from '../../src/game/domain/cards/hand-limit';
import { legalHeroMoves } from '../../src/game/domain/turn/player-actions';
import { interactionOptions } from '../../src/game/domain/mechanisms/mechanism-rules';
import { canEnter } from '../../src/game/domain/board/occupancy';

/**
 * Act III QA support, playing ONLY through regular Commands (same rules the server replays).
 *
 * - `runRoute`: a known, human-written solution (one step per turn) executed with enemies removed.
 *   Directed and fast: this is what proves each encounter is solvable by every champion.
 * - `canSolveWithin`: a SMALL bounded search (cheap state forks, depth limit) used only for the
 *   "cannot be cheesed" checks, where the board is tiny once the statues are removed.
 * - `pilotWithBot`: a human-like playtest under enemy pressure: advance the route (detouring
 *   around enemies), then the regular combat bot plays the rest of the turn.
 */

export interface TurnStep {
  move?: Pos;
  interact?: string;
  /** Playtest pilot only: other tiles that serve the same purpose (another side of the relic). */
  alt?: Pos[];
  /** Playtest pilot only: skip this step once this mechanism is active (someone else did it). */
  doneWhen?: string;
  /** INTERACT this many times in the turn (REPEATABLE_CONTROLs: XXVIII, XXIX). Default 1. */
  times?: number;
  /**
   * Relocating control ring (CYCLE, XXV / XXX): walk next to whichever of these is LIVE right now and
   * INTERACT with it. Replaces `move` / `interact`.
   */
  live?: string[];
}

const DIRS: readonly Pos[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

/** A `live` step resolved against the board: the live control and the free tiles next to it. */
export function resolveStep(state: Readonly<GameState>, content: GameContent, step: TurnStep): TurnStep {
  if (!step.live) return step;
  const b = state.mechanisms;
  const ring = step.live.map((id) => b?.objects.find((o) => o.def.id === id)).filter((o) => !!o);
  const live = ring.find((o) => !o!.locked);
  if (!live) return { ...step, live: undefined };
  const ctx = queryContext(state as GameState, content);
  const heroId = state.player.heroId;
  const tiles = DIRS.map((d) => ({ x: live.pos.x + d.x, y: live.pos.y + d.y })).filter((t) => canEnter(ctx, t, heroId));
  const hero = state.units.find((u) => u.id === heroId);
  if (hero) tiles.sort((a, c) => manhattan(a, hero.pos) - manhattan(c, hero.pos));
  return { move: tiles[0], alt: tiles.slice(1), interact: live.def.id, ...(step.times ? { times: step.times } : {}) };
}

/** Walking distance to `goal` over tiles the champion could enter now (units block), ignoring MP. */
function distanceTo(state: Readonly<GameState>, content: GameContent, goal: Pos): Map<string, number> {
  const ctx = queryContext(state as GameState, content);
  const heroId = state.player.heroId;
  const dist = new Map([[`${goal.x},${goal.y}`, 0]]);
  const queue = [goal];
  while (queue.length) {
    const at = queue.shift()!;
    for (const d of DIRS) {
      const to = { x: at.x + d.x, y: at.y + d.y };
      const k = `${to.x},${to.y}`;
      if (dist.has(k) || !canEnter(ctx, to, heroId)) continue;
      dist.set(k, dist.get(`${at.x},${at.y}`)! + 1);
      queue.push(to);
    }
  }
  return dist;
}

/**
 * One move toward `goal` this turn: the goal itself when legal, else the legal tile with the shortest
 * real walk left (around units and walls, like a player), never a step that gets no closer. True = arrived.
 */
function stepToward(engine: GameEngine, goal: Pos): boolean {
  const hero = engine.state.units.find((u) => u.id === engine.heroId)!;
  const moves = engine.getLegalMoves();
  const exact = moves.find((n) => samePos(n.pos, goal));
  if (exact) return engine.dispatch({ type: 'MOVE_UNIT', unitId: engine.heroId, to: exact.pos }).ok;
  const dist = distanceTo(engine.state, engine.content, goal);
  const left = (q: Pos) => dist.get(`${q.x},${q.y}`) ?? 1000 + manhattan(q, goal);
  const near = moves.filter((n) => left(n.pos) < left(hero.pos)).sort((a, b) => left(a.pos) - left(b.pos) || a.cost - b.cost)[0];
  if (near) engine.dispatch({ type: 'MOVE_UNIT', unitId: engine.heroId, to: near.pos });
  return false;
}

/** INTERACT `step.interact` `times` times; true when every pull was accepted. */
function pull(engine: GameEngine, step: TurnStep): boolean {
  for (let k = 0; k < (step.times ?? 1); k++) if (engine.state.outcome || !engine.dispatch({ type: 'INTERACT', mechanismId: step.interact! }).ok) return k > 0 && !!engine.state.outcome;
  return true;
}

const endTurn = (state: Readonly<GameState>): Command => {
  const discardUid = fallbackDiscardUid(state);
  return discardUid ? { type: 'END_TURN', discardUid } : { type: 'END_TURN' };
};

/** Same as engine.dispatch but on a bare state clone: no engine construction, no history. */
function apply(content: GameContent, state: GameState, command: Command): GameState | null {
  const draft = structuredClone(state);
  return executeCommand({ state: draft, content, emit: () => {} }, command).ok ? draft : null;
}

/** Puzzle-only copy: no enemies, no waves, no round pressure (a structural question). */
export function puzzleOnly(state: Readonly<GameState>): GameState {
  const copy = structuredClone(state) as GameState;
  copy.units = copy.units.filter((u) => u.kind !== 'ENEMY');
  copy.pendingWaves = [];
  copy.intents = [];
  for (const o of copy.objectives) if ('roundLimit' in o.def && o.def.roundLimit !== undefined) o.def = { ...o.def, roundLimit: 999 } as never;
  return copy;
}

const won = (s: Readonly<GameState>) => s.outcome?.result === 'WON';

/** Executes a known route (puzzle-only). Returns the failing step index, or 'WON' / 'NOT_WON'. */
export function runRoute(engine: GameEngine, route: readonly TurnStep[]): { result: 'WON' | 'NOT_WON' | `STEP_${number}`; state: GameState } {
  let state = puzzleOnly(engine.state);
  const heroId = state.player.heroId;
  for (let i = 0; i < route.length; i++) {
    const step = resolveStep(state, engine.content, route[i]!);
    if (step.move) {
      const next = apply(engine.content, state, { type: 'MOVE_UNIT', unitId: heroId, to: step.move });
      if (!next) return { result: `STEP_${i}`, state };
      state = next;
    }
    for (let k = 0; step.interact && k < (step.times ?? 1) && !won(state); k++) {
      const next = apply(engine.content, state, { type: 'INTERACT', mechanismId: step.interact });
      if (!next) return { result: `STEP_${i}`, state };
      state = next;
    }
    if (won(state)) return { result: 'WON', state };
    state = apply(engine.content, state, endTurn(state)) ?? state;
    // Puzzle-only stays puzzle-only: enemies a mechanism spawned (XXVI) are removed too.
    state.units = state.units.filter((u) => u.kind !== 'ENEMY');
  }
  return { result: won(state) ? 'WON' : 'NOT_WON', state };
}

/** Puzzle identity (round, HP, cards ignored). */
function puzzleKey(state: Readonly<GameState>): string {
  const hero = state.units.find((u) => u.id === state.player.heroId);
  return JSON.stringify([hero?.pos, state.mechanisms?.objects.map((o) => [o.state, o.pos, o.active, o.pending ?? null, !!o.locked]), state.mechanisms?.fired]);
}

/**
 * Bounded breadth-first search over turns (move or stay, then optionally INTERACT, then END_TURN),
 * deduplicated by puzzle key. Only for tiny boards; `maxNodes` caps it so it can never run away.
 */
export function canSolveWithin(engine: GameEngine, maxTurns: number, maxNodes = 600): { solved: boolean; nodes: number; exhausted: boolean } {
  const content = engine.content;
  let frontier = [puzzleOnly(engine.state)];
  const seen = new Set([puzzleKey(frontier[0]!)]);
  for (let turn = 0; turn < maxTurns && frontier.length; turn++) {
    const next: GameState[] = [];
    for (const state of frontier) {
      const ctx = queryContext(state, content);
      const moves: (Pos | undefined)[] = [undefined, ...legalHeroMoves(ctx).map((n) => n.pos)];
      for (const move of moves) {
        const moved = move ? apply(content, state, { type: 'MOVE_UNIT', unitId: state.player.heroId, to: move }) : state;
        if (!moved) continue;
        const variants = [moved];
        for (const o of interactionOptions(queryContext(moved, content)).filter((x) => x.allowed)) {
          const after = apply(content, moved, { type: 'INTERACT', mechanismId: o.mechanismId });
          if (after) variants.push(after);
        }
        for (const v of variants) {
          if (won(v)) return { solved: true, nodes: seen.size, exhausted: false };
          const ended = apply(content, v, endTurn(v));
          if (!ended || ended.outcome) continue;
          const key = puzzleKey(ended);
          if (seen.has(key)) continue;
          seen.add(key);
          if (seen.size > maxNodes) return { solved: false, nodes: seen.size, exhausted: false };
          next.push(ended);
        }
      }
    }
    frontier = next;
  }
  return { solved: false, nodes: seen.size, exhausted: frontier.length === 0 };
}

/**
 * Static rail check for a statue (no engine): from every allowed tile, can pushes alone bring it
 * onto `goal`? A push needs the champion's tile (opposite side) to be in bounds and on floor.
 */
export function railReachesGoal(allowed: readonly Pos[], goal: Pos, isFloor: (p: Pos) => boolean): Pos[] {
  const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  const onRail = (p: Pos) => allowed.some((t) => samePos(t, p));
  const reaches = (start: Pos) => {
    const seen = [start];
    for (let i = 0; i < seen.length; i++) {
      const at = seen[i]!;
      if (samePos(at, goal)) return true;
      for (const d of dirs) {
        const to = { x: at.x + d.x, y: at.y + d.y };
        const from = { x: at.x - d.x, y: at.y - d.y };
        if (onRail(to) && isFloor(from) && !seen.some((s) => samePos(s, to))) seen.push(to);
      }
    }
    return false;
  };
  return allowed.filter((t) => !reaches(t));
}

// ── Human-like playtest ────────────────────────────────────────────────────

export interface PilotResult {
  result: 'WON' | 'LOST' | 'TIMEOUT';
  rounds: number;
  heroHpLeft: number;
  heroMaxHp: number;
  interactions: number;
  detours: number;
  /** First round the encounter's key mechanism was active (gate open / bridge down), null = never. */
  unlockedRound: number | null;
}

/** The mechanism whose activation means "the puzzle is solved" per encounter. */
export const KEY_MECHANISM: Record<string, string> = { w3_e01: 'gate', w3_e02: 'bridge-w', w3_e03: 'gate' };

/**
 * Hybrid playtest, puzzle first like a player who knows the solution: at the start of each turn
 * advance the route (walk to the next waypoint — or as close as the enemies allow — and INTERACT
 * there), then the regular greedy combat bot plays the rest of the turn (cards, positioning,
 * exits). After the route's last interaction the bot alone finishes the fight.
 */
export function pilotWithBot(engine: GameEngine, route: readonly TurnStep[], maxRounds = 16, keyId?: string): PilotResult {
  let unlockedRound: number | null = null;
  const off = engine.subscribe((_events, state) => {
    if (unlockedRound === null && keyId && state.mechanisms?.objects.find((o) => o.def.id === keyId)?.active) unlockedRound = state.round;
  });
  const lastInteract = route.reduce((last, s, k) => (s.interact ? k : last), -1);
  const puzzle = route.slice(0, lastInteract + 1);
  let i = 0;
  let interactions = 0;
  let detours = 0;
  const options = { terrainAware: true, antiStall: true, archer: engine.state.player.heroId === 'archer' };
  while (!engine.state.outcome && engine.state.round <= maxRounds) {
    while (puzzle[i]?.doneWhen && engine.getMechanismView()?.objects.find((o) => o.id === puzzle[i]!.doneWhen)?.visualState !== 'inactive') i++;
    const step = puzzle[i] && resolveStep(engine.state, engine.content, puzzle[i]!);
    const hero = engine.state.units.find((u) => u.id === engine.heroId);
    if (step && hero) {
      const goals = step.move ? [step.move, ...(step.alt ?? [])] : [];
      const free = goals.filter((g) => samePos(g, hero.pos) || !engine.state.units.some((u) => samePos(u.pos, g)));
      const goal = (free.length ? free : goals).sort((a, b) => manhattan(a, hero.pos) - manhattan(b, hero.pos))[0];
      if (goal && !samePos(hero.pos, goal)) {
        const exact = stepToward(engine, goal);
        if (!exact) detours++;
      }
      const at = engine.state.units.find((u) => u.id === engine.heroId);
      if (at && (!goal || samePos(at.pos, goal)) && !engine.state.outcome) {
        if (!step.interact) i++;
        else if (pull(engine, step)) {
          interactions++;
          i++;
        }
      }
    }
    if (engine.state.outcome) break;
    playBattle(engine, engine.state.round, undefined, options); // exactly one bot turn
  }
  off();
  const end = engine.state.units.find((u) => u.id === engine.state.player.heroId);
  return {
    result: engine.state.outcome?.result ?? 'TIMEOUT',
    rounds: engine.state.round,
    heroHpLeft: end?.hp ?? 0,
    heroMaxHp: end?.maxHp ?? 0,
    interactions,
    detours,
    unlockedRound,
  };
}

const p = (x: number, y: number): Pos => ({ x, y });

/** Human-written solutions (one entry per turn). Moves are ≤ 3 steps: valid for every champion. */
export const GUARDIAN_LEVERS = ['lever-a', 'lever-b', 'lever-c'] as const;
export const ARCHITECT_KEYS = ['key-a', 'key-b'] as const;

export const ROUTES: Record<string, TurnStep[]> = {
  // Lever on turn 1, through the gate, out.
  w3_e01: [{ move: p(2, 3), interact: 'lever' }, { move: p(4, 2) }, { move: p(7, 2) }, { move: p(8, 1) }],
  // Statue down, statue left onto the plate (bridge lowers), walk across.
  w3_e02: [
    { move: p(1, 3), interact: 'statue', doneWhen: 'plate' },
    { move: p(2, 5), interact: 'statue', doneWhen: 'plate' },
    { move: p(2, 2) },
    { move: p(5, 2) },
    { move: p(7, 1) },
    { move: p(8, 1) },
  ],
  // Statue B onto its seal, statue A onto its seal, champion on the third → chamber; take the relic.
  w3_e03: [
    { move: p(3, 2), interact: 'statue-b', doneWhen: 'seal-b' },
    { move: p(3, 1), interact: 'statue-a', doneWhen: 'seal-a' },
    { move: p(5, 2), doneWhen: 'gate' },
    { move: p(7, 2), alt: [p(8, 3)], interact: 'relic' },
  ],
  // Call the near platform, ride it across, ride the second one up to the exit pocket.
  w3_e04: [
    { move: p(2, 5), interact: 'lever-a' },
    { move: p(3, 4), interact: 'lever-a' },
    { move: p(7, 3) },
    { move: p(7, 2), interact: 'lever-b' },
    { move: p(8, 0) },
  ],
  // Statue onto the plate once, then whichever lever is live opens the 2-round window (the combat
  // loop keeps following the ring A → B → C → A).
  w3_e05: [{ move: p(4, 5), interact: 'statue', doneWhen: 'plate' }, { live: [...GUARDIAN_LEVERS] }],
  // Sun, then Moon; into the vault; take the relic; home through the side gate (2 MP while carrying).
  w3_e06: [
    { move: p(3, 2) },
    { move: p(5, 1) },
    { move: p(5, 0), interact: 'rune-sun' },
    { move: p(5, 3) },
    { move: p(6, 5), interact: 'rune-moon' },
    { move: p(7, 3) },
    { move: p(8, 3), interact: 'relic' },
    { move: p(6, 3) },
    { move: p(6, 5) },
    { move: p(4, 5) },
    { move: p(2, 5) },
    { move: p(1, 4) },
    { move: p(0, 4), interact: 'relic' },
  ],
  // Onto the Balanza, push the counterweight onto the plate: the weight carries you north. Out.
  w3_e07: [{ move: p(3, 3) }, { move: p(4, 4), interact: 'statue' }, { move: p(6, 1) }, { move: p(8, 0) }],
  // Lever ×2 (180°), into the Eje, console ×1 (90°, riding to the door), out.
  w3_e08: [{ move: p(1, 2), interact: 'lever', times: 2 }, { move: p(1, 5) }, { move: p(4, 5) }, { move: p(6, 4), interact: 'console' }, { move: p(10, 3) }],
  // Statue onto the plate (wall opens), into the west arm, console ×2 (riding to the east arm), out
  // through the wall, shut the Heart down.
  w3_e09: [
    { move: p(1, 4), interact: 'statue', doneWhen: 'plate' },
    { move: p(3, 3) },
    { move: p(5, 2), interact: 'console', times: 2 },
    { move: p(7, 3) },
    { move: p(9, 3), interact: 'heart' },
  ],
  // Boss: pull whichever Key is live (the combat loop keeps following the ring).
  w3_e10: [{ live: [...ARCHITECT_KEYS] }],
};

/** Combat loops (after the route): XXV and XXX keep following their live control. */
export const LOOPS: Record<string, TurnStep[]> = {
  w3_e05: [{ live: [...GUARDIAN_LEVERS] }],
  w3_e10: [{ live: [...ARCHITECT_KEYS] }],
};

// ── Combat route (a human with a plan): route step, then the best damage cards, end turn ──

/** Best single damage card play now (most HP taken from enemies), or null. Never relocates the champion. */
export function bestAttack(engine: GameEngine): Command | null {
  let best: { command: Command; score: number } | null = null;
  for (const card of engine.state.player.hand) {
    if (!engine.getCardPlayability(card.uid).playable) continue;
    const def = engine.content.cards[card.cardId];
    const targets: (Pos | null)[] = def?.targeting.type === 'SELF' ? [null] : engine.getValidTargets(card.uid);
    for (const target of targets) {
      const preview = engine.previewCard(card.uid, target);
      if (!preview.valid) continue;
      if (preview.predictedEvents.some((e) => (e.type === 'UNIT_TELEPORTED' || e.type === 'UNIT_MOVED') && e.unitId === engine.heroId)) continue;
      let score = 0;
      for (const e of preview.predictedEvents) {
        if (e.type !== 'UNIT_DAMAGED') continue;
        const victim = engine.state.units.find((u) => u.id === e.unitId);
        if (victim?.faction === 'ENEMY') score += e.hpLost + (e.hpAfter === 0 ? 3 : 0);
        else if (victim) score -= e.hpLost * 2;
      }
      if (score > 0 && (!best || score > best.score)) best = { command: { type: 'PLAY_CARD', cardUid: card.uid, target }, score };
    }
  }
  return best?.command ?? null;
}

/**
 * Shapeshifter: a player takes a form before fighting (the greedy bot never transforms). Plays the
 * first playable TRANSFORM-into-a-form card when the champion has no active form. No-op otherwise.
 */
export function takeFormIfNeeded(engine: GameEngine): void {
  const hero = engine.state.units.find((u) => u.id === engine.heroId);
  if (!hero || hero.activeForm || engine.state.outcome) return;
  for (const card of engine.state.player.hand) {
    const def = engine.content.cards[card.cardId];
    if (!def?.effects.some((f) => f.type === 'TRANSFORM' && f.formId) || !engine.getCardPlayability(card.uid).playable) continue;
    const target = def.targeting.type === 'SELF' ? null : (engine.getValidTargets(card.uid)[0] ?? null);
    if (engine.dispatch({ type: 'PLAY_CARD', cardUid: card.uid, target }).ok) return;
  }
}

export function attackWithCards(engine: GameEngine): void {
  for (let i = 0; i < 6 && !engine.state.outcome; i++) {
    const command = bestAttack(engine);
    if (!command || !engine.dispatch(command).ok) return;
  }
}

/**
 * Plays the real battle by hand-written plan: each turn advance the route (walk to the waypoint
 * or as close as the board allows, INTERACT there), then attack with the best damage cards.
 * When the route is done, `loop` steps repeat (XXV: keep reopening the Guardian's window).
 */
export function playCombatRoute(
  engine: GameEngine,
  route: readonly TurnStep[],
  loop: readonly TurnStep[] = [],
  maxRounds = 20,
  combat: 'cards' | 'bot' = 'cards',
): GameState {
  let i = 0;
  const botOptions = { terrainAware: true, antiStall: true, archer: engine.state.player.heroId === 'archer' };
  while (!engine.state.outcome && engine.state.round <= maxRounds) {
    takeFormIfNeeded(engine);
    if (combat === 'cards') attackWithCards(engine);
    while (route[i]?.doneWhen && engine.getMechanismView()?.objects.find((o) => o.id === route[i]!.doneWhen)?.visualState !== 'inactive') i++;
    const raw = i < route.length ? route[i] : loop.length ? loop[(i - route.length) % loop.length] : undefined;
    const step = raw && resolveStep(engine.state, engine.content, raw);
    const hero = engine.state.units.find((u) => u.id === engine.heroId);
    if (step && hero && !engine.state.outcome) {
      const goals = step.move ? [step.move, ...(step.alt ?? [])] : [];
      const free = goals.filter((g) => samePos(g, hero.pos) || !engine.state.units.some((u) => samePos(u.pos, g)));
      const goal = (free.length ? free : goals).sort((a, b) => manhattan(a, hero.pos) - manhattan(b, hero.pos))[0];
      if (goal && !samePos(hero.pos, goal)) {
        stepToward(engine, goal);
      }
      const at = engine.state.units.find((u) => u.id === engine.heroId);
      if (at && (!goal || samePos(at.pos, goal)) && !engine.state.outcome) {
        if (!step.interact || pull(engine, step)) i++;
      }
    }
    if (engine.state.outcome) break;
    if (combat === 'bot') {
      playBattle(engine, engine.state.round, undefined, botOptions); // the rest of this turn, then END_TURN
      continue;
    }
    attackWithCards(engine);
    if (engine.state.outcome) break;
    engine.dispatch(endTurn(engine.state));
  }
  return engine.state as GameState;
}

