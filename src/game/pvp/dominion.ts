import { clearBattleForms } from '../domain/transformations/transformations';
import type { GameState } from '../domain/state';
import type { RuleContext } from '../domain/context';
import type { Pos } from '../domain/core/position';
import type { ScenarioDef } from '../domain/scenario';
export type PvpMode = 'DUEL' | 'DOMINION';
export type NodeControl = 0 | 1 | 'NEUTRAL' | 'CONTESTED';
export const DOMINION_RULES = { target: 8, firstScoringRound: 2 } as const;
export const DOMINION_NODES: readonly Pos[] = [
  { x: 2, y: 2 },
  { x: 7, y: 3 },
  { x: 2, y: 4 },
];
export const DOMINION_SCENARIO: ScenarioDef = {
  id: 'private_dominion',
  name: 'Dominio Arcano',
  description: 'Controla tres nodos. Alcanza 8 puntos o derrota al campeón rival.',
  layout: Array.from({ length: 7 }, () => '..........'),
  legend: { '.': {} },
  hero: { heroId: 'mage', pos: { x: 4, y: 0 } },
  structures: [],
  enemies: [],
  waves: [],
  objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 1000000 }],
  defaultSeed: 1,
};
export interface DominionState {
  nodes: { id: string; pos: Pos; control: NodeControl }[];
  scores: [number, number];
  target: number;
  firstScoringRound: number;
  lastScoredRound: number;
  suddenDeath: boolean;
  winner: 0 | 1 | null;
}
export function createDominion(nodes: readonly Pos[] = DOMINION_NODES): DominionState {
  return {
    nodes: nodes.map((pos, i) => ({
      id: `node-${i + 1}`,
      pos: { ...pos },
      control: 'NEUTRAL',
    })),
    scores: [0, 0],
    target: DOMINION_RULES.target,
    firstScoringRound: DOMINION_RULES.firstScoringRound,
    lastScoredRound: 0,
    suddenDeath: false,
    winner: null,
  };
}
/** No capture memory: alive occupancy alone decides control; owner IDs survive faction swaps. */
export function refreshDominion(state: GameState): void {
  const d = state.dominion,
    meta = state.duel;
  if (!d || !meta) return;
  for (const node of d.nodes) {
    const sides = new Set<number>();
    for (const u of state.units) {
      if (u.hp <= 0 || u.pos.x !== node.pos.x || u.pos.y !== node.pos.y) continue;
      const owner = u.summon?.ownerId ?? u.id;
      const seat = meta.champions.indexOf(owner);
      if (seat >= 0) sides.add(seat);
    }
    node.control =
      sides.size > 1 ? 'CONTESTED' : sides.size === 1 ? ([...sides][0] as 0 | 1) : 'NEUTRAL';
  }
}
/** Called once after BOTH turns resolve, before next-round start effects/draw. */
export function scoreDominion(ctx: RuleContext): void {
  const { state } = ctx,
    d = state.dominion;
  if (!d || state.outcome || d.lastScoredRound >= state.round) return;
  refreshDominion(state);
  d.lastScoredRound = state.round;
  if (state.round < d.firstScoringRound) return;
  const points: [number, number] = [0, 0];
  for (const n of d.nodes) if (n.control === 0 || n.control === 1) points[n.control]++;
  d.scores[0] += points[0];
  d.scores[1] += points[1];
  let winner: 0 | 1 | null = null;
  if (d.suddenDeath) {
    if (d.scores[0] !== d.scores[1]) winner = d.scores[0] > d.scores[1] ? 0 : 1;
  } else if (Math.max(...d.scores) >= d.target) {
    if (d.scores[0] !== d.scores[1]) winner = d.scores[0] > d.scores[1] ? 0 : 1;
    else if (points[0] !== points[1]) winner = points[0] > points[1] ? 0 : 1;
    else {
      const a = state.units.find((u) => u.id === state.duel!.champions[0])!,
        b = state.units.find((u) => u.id === state.duel!.champions[1])!;
      const comparison = a.hp * b.maxHp - b.hp * a.maxHp;
      if (comparison !== 0) winner = comparison > 0 ? 0 : 1;
      else d.suddenDeath = true;
    }
  }
  ctx.emit({
    type: 'DOMINION_SCORED',
    round: state.round,
    points,
    scores: [...d.scores],
    suddenDeath: d.suddenDeath,
  });
  if (winner !== null) {
    d.winner = winner;
    state.outcome = {
      result: state.duel!.active === winner ? 'WON' : 'LOST',
      reason: 'OBJECTIVES_COMPLETED',
    };
    state.phase = 'ENDED';
    clearBattleForms(state, ctx.content);
    ctx.emit({
      type: state.outcome.result === 'WON' ? 'BATTLE_WON' : 'BATTLE_LOST',
      outcome: state.outcome,
    });
  }
}
