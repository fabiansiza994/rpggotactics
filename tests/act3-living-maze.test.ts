import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
import { WORLDS } from '../src/game/data/worlds';
import { GameEngine } from '../src/game/engine/GameEngine';
import { executeCommand, type Command } from '../src/game/engine/commands';
import { replayBattle } from '../src/game/engine/replay';
import { encounterFor, validateCampaign } from '../src/game/run/encounter';
import { queryContext } from '../src/game/domain/context';
import { canEnter } from '../src/game/domain/board/occupancy';
import { computeReachable } from '../src/game/domain/board/pathfinding';
import { manhattan, posKey, samePos, type Pos } from '../src/game/domain/core/position';
import { mechanismById } from '../src/game/domain/mechanisms/mechanism-board';
import { fallbackDiscardUid } from '../src/game/domain/cards/hand-limit';
import type { GameState } from '../src/game/domain/state';
import { puzzleOnly, takeFormIfNeeded } from './support/act3-pilot';
import { playBattle } from './support/bot';

const CONTENT = withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
const HEROES = TEMPLE_CAMPAIGN.heroIds;
const p = (x: number, y: number): Pos => ({ x, y });
const EXIT = p(10, 3);
const engineFor = (heroId: string, seed?: number) => new GameEngine(encounterFor(TEMPLE_CAMPAIGN, 'w3_e08', heroId), CONTENT, seed);
const endTurn = (state: Readonly<GameState>): Command => {
  const discardUid = fallbackDiscardUid(state);
  return discardUid ? { type: 'END_TURN', discardUid } : { type: 'END_TURN' };
};
const apply = (state: GameState, command: Command): GameState | null => {
  const draft = structuredClone(state);
  return executeCommand({ state: draft, content: CONTENT, emit: () => {} }, command).ok ? draft : null;
};
const orientation = (s: Readonly<GameState>) => mechanismById(s, 'maze')!.state;
const heroOf = (s: Readonly<GameState>) => s.units.find((u) => u.id === s.player.heroId)!;

/**
 * Exhaustive puzzle graph (no enemies): node = (orientation, champion tile). Edges = one step onto an
 * enterable tile, or one pull of a control the champion is adjacent to (through the real INTERACT
 * command, so the engine's rotation, riding and safety rules are what is explored).
 */
function puzzleGraph(heroId: string, start?: (s: GameState) => GameState) {
  let s0 = puzzleOnly(engineFor(heroId).state);
  if (start) s0 = start(s0);
  const key = (s: GameState) => `${orientation(s)}@${posKey(heroOf(s).pos)}`;
  const nodes = new Map<string, GameState>([[key(s0), s0]]);
  const edges = new Map<string, { to: string; pull: boolean }[]>();
  const queue = [s0];
  while (queue.length) {
    const s = queue.shift()!;
    const k = key(s);
    const out: { to: string; pull: boolean }[] = [];
    const hero = heroOf(s);
    const ctx = queryContext(s, CONTENT);
    for (const d of [p(1, 0), p(-1, 0), p(0, 1), p(0, -1)]) {
      const to = p(hero.pos.x + d.x, hero.pos.y + d.y);
      if (!canEnter(ctx, to, hero.id)) continue;
      const next = structuredClone(s);
      heroOf(next).pos = to;
      out.push({ to: key(next), pull: false });
      if (!nodes.has(key(next))) {
        nodes.set(key(next), next);
        queue.push(next);
      }
    }
    for (const control of ['lever', 'console']) {
      const next = apply(s, { type: 'INTERACT', mechanismId: control });
      if (!next || orientation(next) === orientation(s)) continue;
      out.push({ to: key(next), pull: true });
      if (!nodes.has(key(next))) {
        nodes.set(key(next), next);
        queue.push(next);
      }
    }
    edges.set(k, out);
  }
  return { start: key(s0), nodes, edges, exitKeys: [...nodes.keys()].filter((k) => k.endsWith(`@${posKey(EXIT)}`)) };
}

/** Fewest control pulls to the exit (0-1 BFS: steps are free). */
function minPulls(g: ReturnType<typeof puzzleGraph>): number | null {
  const best = new Map([[g.start, 0]]);
  const deque = [g.start];
  while (deque.length) {
    const k = deque.shift()!;
    for (const e of g.edges.get(k) ?? []) {
      const c = best.get(k)! + (e.pull ? 1 : 0);
      if (c < (best.get(e.to) ?? Infinity)) {
        best.set(e.to, c);
        if (e.pull) deque.push(e.to);
        else deque.unshift(e.to);
      }
    }
  }
  const costs = g.exitKeys.map((k) => best.get(k)!).filter((c) => c !== undefined);
  return costs.length ? Math.min(...costs) : null;
}

function reachesExit(g: ReturnType<typeof puzzleGraph>, from: string): boolean {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const k = queue.shift()!;
    if (g.exitKeys.includes(k)) return true;
    for (const e of g.edges.get(k) ?? [])
      if (!seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
  }
  return false;
}

/** Walk toward `goal` along a real shortest path (enemies block), as far as this turn's MP allow. */
function walkToward(engine: GameEngine, goal: Pos): void {
  const hero = engine.state.units.find((u) => u.id === engine.heroId)!;
  if (samePos(hero.pos, goal)) return;
  const legal = engine.getLegalMoves();
  if (!legal.length) return;
  const all = computeReachable(queryContext(engine.state as GameState, engine.content), hero);
  const path = all.get(posKey(goal))?.path;
  const along = path ? [...path].reverse().find((t) => legal.some((n) => samePos(n.pos, t))) : undefined;
  const target =
    along ?? [...legal].sort((a, b) => manhattan(a.pos, goal) - manhattan(b.pos, goal) || a.cost - b.cost)[0]!.pos;
  if (manhattan(target, goal) < manhattan(hero.pos, goal) || along) engine.dispatch({ type: 'MOVE_UNIT', unitId: engine.heroId, to: target });
}

/** The written solution: waypoint, then pull `pulls` times. Every hop is ≤ 3 tiles (any champion). */
const ROUTE: { move: Pos; pull?: { id: string; times: number } }[] = [
  { move: p(1, 2), pull: { id: 'lever', times: 2 } }, // 180°: the Eje's door faces our side (row 5)
  { move: p(1, 5) },
  { move: p(4, 5) },
  { move: p(6, 4), pull: { id: 'console', times: 1 } }, // 90°: we ride to (7,3), facing the exit
  { move: EXIT },
];

describe('XXVIII «El Laberinto Vivo» — structure', () => {
  it('validates for every champion and is XXVIII of World 3 (hidden behind WORLD_3)', () => {
    expect(validateCampaign(TEMPLE_CAMPAIGN, CONTENT)).toEqual([]);
    const world = WORLDS.find((w) => w.encounterIds.includes('w3_e08'))!;
    expect(world).toMatchObject({ id: 'world_3', releaseFlag: 'WORLD_3' });
    expect(world.encounterIds.indexOf('w3_e08')).toBe(7);
  });

  it('needs the board to turn: no route without rotation, minimum 3 pulls', () => {
    const g = puzzleGraph('mage');
    expect(g.exitKeys.length).toBeGreaterThan(0);
    expect(g.exitKeys.every((k) => !k.startsWith('ORIENTATION_0@'))).toBe(true);
    expect(minPulls(g)).toBe(3);
  });

  it('no softlock: from every reachable (orientation, tile) the exit is still reachable', () => {
    const g = puzzleGraph('mage');
    const stuck = [...g.nodes.keys()].filter((k) => !reachesExit(g, k));
    expect(stuck).toEqual([]);
    expect(g.nodes.size).toBeGreaterThan(40);
  });

  it('a wrong turn is always correctable: solvable from any starting orientation (QA pre-rotation)', () => {
    for (const turns of [1, 2, 3]) {
      const g = puzzleGraph('mage', (s) => {
        let state = s;
        heroOf(state).pos = p(1, 2);
        for (let i = 0; i < turns; i++) state = apply(state, { type: 'INTERACT', mechanismId: 'lever' })!;
        heroOf(state).pos = p(0, 3);
        return state;
      });
      expect(reachesExit(g, g.start)).toBe(true);
    }
  });

  it('turning the section seals the Arco (and its wolf) away from the champion', () => {
    const e = engineFor('mage');
    const wolfCanReach = () => computeReachable(queryContext(e.state as GameState, e.content), e.state.units.find((u) => u.id === 'wolf-1')!).has('2,5');
    expect(wolfCanReach()).toBe(true);
    e.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) });
    e.dispatch({ type: 'INTERACT', mechanismId: 'lever' });
    e.dispatch({ type: 'INTERACT', mechanismId: 'lever' });
    expect(orientation(e.state)).toBe('ORIENTATION_180');
    expect(e.state.units.find((u) => u.id === 'wolf-1')!.pos).toEqual(p(8, 4)); // it rode the turn
    expect(wolfCanReach()).toBe(false);
  });
});

describe('XXVIII — every champion solves it with the same written route (puzzle only)', () => {
  for (const heroId of HEROES)
    it(heroId, () => {
      const e = engineFor(heroId);
      let state = puzzleOnly(e.state);
      for (const [i, step] of ROUTE.entries()) {
        const moved = samePos(heroOf(state).pos, step.move) ? state : apply(state, { type: 'MOVE_UNIT', unitId: state.player.heroId, to: step.move });
        expect(moved, `step ${i} move`).not.toBeNull();
        state = moved!;
        for (let k = 0; k < (step.pull?.times ?? 0); k++) {
          const next = apply(state, { type: 'INTERACT', mechanismId: step.pull!.id });
          expect(next, `step ${i} pull ${k}`).not.toBeNull();
          state = next!;
        }
        if (state.outcome) break;
        state = apply(state, endTurn(state))!;
      }
      expect(state.outcome?.result).toBe('WON');
    });
});

/**
 * Human-like playtest under pressure: each turn, advance the written plan (path-aware walk, pull the
 * control there), then the regular greedy combat bot plays the rest of the turn and ends it.
 */
function playtest(heroId: string, seed?: number, maxRounds = 14) {
  const e = engineFor(heroId, seed);
  const options = { terrainAware: true, antiStall: true, archer: heroId === 'archer' };
  let i = 0;
  while (!e.state.outcome && e.state.round <= maxRounds) {
    takeFormIfNeeded(e);
    const step = ROUTE[i];
    if (step && !e.state.outcome) {
      walkToward(e, step.move);
      const hero = e.state.units.find((u) => u.id === e.heroId)!;
      if (samePos(hero.pos, step.move)) {
        let ok = true;
        for (let k = 0; k < (step.pull?.times ?? 0) && ok; k++) ok = e.dispatch({ type: 'INTERACT', mechanismId: step.pull!.id }).ok;
        if (ok) i++;
      }
    }
    if (e.state.outcome) break;
    playBattle(e, e.state.round, undefined, options); // exactly one bot turn
  }
  const hero = e.state.units.find((u) => u.id === e.heroId);
  return { engine: e, result: e.state.outcome?.result ?? 'TIMEOUT', rounds: e.state.round, hp: hero?.hp ?? 0 };
}

describe('XXVIII — playtest under enemy pressure (route + best cards)', () => {
  for (const heroId of HEROES)
    it(`${heroId} wins`, () => {
      const run = playtest(heroId);
      expect(run.result, `${heroId}: ${run.result} round ${run.rounds} hp ${run.hp}`).toBe('WON');
    });

  it('replay and reconnect reproduce the full victory exactly', () => {
    const run = playtest('mage');
    expect(run.result).toBe('WON');
    const e = run.engine;
    const { state, rejectedAt } = replayBattle(e.scenario, e.content, e.seed, e.history);
    expect(rejectedAt).toBeNull();
    expect(JSON.stringify(state)).toBe(JSON.stringify(e.state));
    // Reconnect halfway (after the section has turned) and replay the rest on the snapshot.
    const half = e.history.findIndex((c, k) => k > 0 && c.type === 'END_TURN' && e.history.slice(0, k).filter((x) => x.type === 'INTERACT').length >= 2);
    const prefix = replayBattle(e.scenario, e.content, e.seed, e.history.slice(0, half + 1)).state;
    expect(orientation(prefix)).toBe('ORIENTATION_180');
    const resumed = GameEngine.fromSnapshot(JSON.parse(JSON.stringify(prefix)) as GameState, e.content, e.scenario);
    for (const c of e.history.slice(half + 1)) expect(resumed.dispatch(c).ok).toBe(true);
    expect(JSON.stringify(resumed.state)).toBe(JSON.stringify(e.state));
  });
});
