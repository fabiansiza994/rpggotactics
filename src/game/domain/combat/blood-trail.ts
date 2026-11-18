import {beastsEnabled} from './beasts-release';
import type { GameState } from '../state';
import type { RuleContext } from '../context';
import type { Unit } from '../entities/unit';
import { manhattan, samePos, comparePos, type Pos } from '../core/position';
import { effectiveMoveRange, isMovementPrevented, terrainDefAt } from '../board/occupancy';
import { computeReachable, type PathNode } from '../board/pathfinding';

/** No client clocks or hidden information. Legacy snapshots without marks are valid. */
export function activeBloodTrails(state: GameState): NonNullable<GameState['bloodTrails']> {
  if (state.outcome) return [];
  return (state.bloodTrails ?? []).filter(mark => {
    const prey = state.units.find(u => u.id === mark.preyId);
    const wolf = state.units.find(u => u.id === mark.wolfId);
    return mark.expiresRound > state.round && prey && wolf?.defId === 'wolf' && wolf.kind === 'SUMMON'
      && prey.faction !== wolf.faction && prey.statuses.some(s => s.id === 'BLEEDING' && s.sourceId === wolf.id);
  });
}
export function pruneBloodTrails(state: GameState): void {
  if (state.outcome) for (const unit of state.units) unit.statuses = unit.statuses.filter(s => s.id !== 'BLEEDING');
  if (state.bloodTrails) state.bloodTrails = activeBloodTrails(state);
}

/** Only actual walking/charging/sliding leaves a trail, never teleports or swaps. */
export function leaveBloodTrail(ctx: RuleContext, unit: Unit, path: readonly Pos[]): void {
  pruneBloodTrails(ctx.state);
  const source = unit.statuses.find(s => s.id === 'BLEEDING')?.sourceId;
  const wolf = ctx.state.units.find(u => u.id === source && u.defId === 'wolf' && u.kind === 'SUMMON');
  if (!wolf || wolf.faction === unit.faction || !path.length) return;
  const marks = ctx.state.bloodTrails ??= [];
  for (const pos of path) {
    const old = marks.find(m => m.wolfId === wolf.id && m.preyId === unit.id && samePos(m.pos, pos));
    if (old) old.expiresRound = ctx.state.round + 2;
    else marks.push({pos: {...pos}, wolfId: wolf.id, preyId: unit.id, expiresRound: ctx.state.round + 2});
  }
}

/** One bounded legal route, never a replenishable movement resource. Same pathfinder as all summons. */
export function wolfPursuit(ctx: RuleContext, wolf: Unit, preferred?: Unit): {node: PathNode; prey: Unit} | null {
  if (!beastsEnabled(ctx.state) || wolf.defId !== 'wolf' || wolf.kind !== 'SUMMON' || isMovementPrevented(ctx, wolf)) return null;
  const marks = activeBloodTrails(ctx.state).filter(m => m.wolfId === wolf.id);
  if (!marks.length) return null;
  const budget = effectiveMoveRange(ctx, wolf);
  const nodes = [...computeReachable(ctx, wolf, budget + 1).values()];
  const candidates: {node: PathNode; prey: Unit}[] = [];
  for (const prey of ctx.state.units) {
    if (preferred && prey.id !== preferred.id) continue;
    const ownMarks = marks.filter(m => m.preyId === prey.id);
    if (!ownMarks.length || manhattan(wolf.pos, prey.pos) <= 1) continue;
    for (const node of nodes) {
      if (node.cost <= budget || manhattan(node.pos, prey.pos) >= manhattan(wolf.pos, prey.pos)) continue;
      if (node.path.some(p => terrainDefAt(ctx, p)?.isHazard)) continue;
      if (!node.path.some(p => ownMarks.some(m => samePos(m.pos, p)))) continue;
      candidates.push({node, prey});
    }
  }
  candidates.sort((a,b) => manhattan(a.node.pos,a.prey.pos)-manhattan(b.node.pos,b.prey.pos)
    || a.node.cost-b.node.cost || a.prey.id.localeCompare(b.prey.id) || comparePos(a.node.pos,b.node.pos));
  return candidates[0] ?? null;
}
