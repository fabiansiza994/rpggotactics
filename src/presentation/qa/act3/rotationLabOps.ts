import { GameEngine, type Command, type GameContent, type GameEvent, type GameState, type Pos } from '../../../game';
import { canEnter, unitById } from '../../../game/domain/board/occupancy';
import { computeReachable } from '../../../game/domain/board/pathfinding';
import type { RuleContext } from '../../../game/domain/context';
import { posKey } from '../../../game/domain/core/position';
import type { Orientation } from '../../../game/domain/mechanisms/mechanism';
import { mechanismById } from '../../../game/domain/mechanisms/mechanism-board';
import { rotateSection } from '../../../game/domain/mechanisms/mechanism-rules';
import { orientationOf } from '../../../game/domain/mechanisms/mechanism-transform';
import { spawnSummon } from '../../../game/domain/summons/summons';
import { spawnEnemy } from '../../../game/domain/turn/turn-flow';
import { encounterFor } from '../../../game/run/encounter';
import { TEMPLE_CAMPAIGN } from '../../../game/data/temple-encounters';

/**
 * ACT III — ROTATING BOARD LAB (DEV only). QA operations that are not player commands (set an
 * orientation, turn the section from anywhere, place the champion, spawn a summon or an enemy) are
 * recorded as LAB STEPS interleaved with the real commands, so a lab session can be rebuilt and
 * replayed exactly. Operations go through the same engine code as gameplay (rotateSection, spawn).
 */
export const LAB_ENCOUNTER = 'w3_e08';
export const SECTION_ID = 'maze';

export type LabOp =
  | { type: 'ORIENT'; to: Orientation }
  | { type: 'ROTATE'; turns: 1 | -1 }
  | { type: 'PLACE_CHAMPION'; at: Pos }
  | { type: 'SPAWN_ENEMY'; enemyId: string; at: Pos }
  | { type: 'SPAWN_SUMMON'; summonId: string; at: Pos };
export type LabStep = { command: Command } | { op: LabOp };
export interface LabSave {
  hero: string;
  seed: number;
  steps: LabStep[];
}

export const newLabEngine = (content: GameContent, hero: string, seed?: number) =>
  new GameEngine(encounterFor(TEMPLE_CAMPAIGN, LAB_ENCOUNTER, hero), content, seed);

/** Applies a lab op on a clone of `engine`'s state. Returns the new state and its events, or null. */
export function applyLabOp(engine: GameEngine, op: LabOp, labIds: { next: number }): { state: GameState; events: GameEvent[] } | null {
  const state = structuredClone(engine.state) as GameState;
  const events: GameEvent[] = [];
  const ctx: RuleContext = { state, content: engine.content, emit: (e) => events.push(e) };
  const section = mechanismById(state, SECTION_ID);
  switch (op.type) {
    case 'ORIENT':
    case 'ROTATE': {
      if (!section) return null;
      const from = orientationOf(section.state);
      const to = op.type === 'ORIENT' ? op.to : ((((from + 90 * op.turns) % 360) + 360) % 360) as Orientation;
      if (to === from) return null;
      rotateSection(ctx, SECTION_ID, to, op.type === 'ROTATE' ? op.turns : undefined);
      break;
    }
    case 'PLACE_CHAMPION': {
      const hero = unitById(state, state.player.heroId);
      if (!hero || !canEnter(ctx, op.at, hero.id)) return null;
      const from = hero.pos;
      hero.pos = { ...op.at };
      events.push({ type: 'UNIT_TELEPORTED', unitId: hero.id, from, to: { ...op.at }, sourceId: 'qa:lab' });
      break;
    }
    case 'SPAWN_ENEMY': {
      if (!engine.content.enemies[op.enemyId]) return null;
      const unit = spawnEnemy(ctx, { id: `qa-${op.enemyId}-${labIds.next++}`, enemyId: op.enemyId, pos: op.at });
      if (!unit) return null;
      break;
    }
    case 'SPAWN_SUMMON': {
      const hero = unitById(state, state.player.heroId);
      if (!hero || !engine.content.summons?.[op.summonId] || !canEnter(ctx, op.at)) return null;
      if (!spawnSummon(ctx, hero, op.summonId, op.at)) return null;
      break;
    }
  }
  return { state, events };
}

/** Rebuilds a lab session from its save: commands through dispatch, lab ops through applyLabOp. */
export function rebuildLab(content: GameContent, save: LabSave, upTo = save.steps.length): { engine: GameEngine; failedAt: number | null } {
  let engine = newLabEngine(content, save.hero, save.seed);
  const ids = { next: 1 };
  for (let i = 0; i < upTo; i++) {
    const step = save.steps[i]!;
    if ('command' in step) {
      if (!engine.dispatch(step.command).ok) return { engine, failedAt: i };
    } else {
      const next = applyLabOp(engine, step.op, ids);
      if (!next) return { engine, failedAt: i };
      engine = GameEngine.fromSnapshot(next.state, engine.content, engine.scenario);
    }
  }
  return { engine, failedAt: null };
}

/** Same gameplay state? (what replay / reconnect must reproduce). */
export const sameBoard = (a: Readonly<GameState>, b: Readonly<GameState>) => JSON.stringify(a) === JSON.stringify(b);

export type InspectCell = {
  pos: Pos;
  kind: 'floor' | 'abyss' | 'wall' | 'solid' | 'exit';
  unit?: { id: string; letter: string; faction: 'PLAYER' | 'ENEMY' };
  reachable: boolean;
  onPath: boolean;
  inSection: boolean;
};

/**
 * Pathfinding inspector grid: what `unitId` can reach now (no movement budget), its shortest path to
 * `goal`, walls/abyss/solid mechanisms, and the section's cells. Read-only.
 */
export function inspectGrid(engine: GameEngine, unitId: string, goal: Pos): { cells: InspectCell[]; pathLength: number | null } {
  const state = engine.state as GameState;
  const ctx: RuleContext = { state, content: engine.content, emit: () => undefined };
  const unit = unitById(state, unitId);
  const reach = unit ? computeReachable(ctx, unit) : new Map();
  const path = reach.get(posKey(goal))?.path ?? null;
  const onPath = new Set((path ?? []).map(posKey));
  const section = new Set((mechanismById(state, SECTION_ID)?.def.region?.cells ?? []).map(posKey));
  const cells: InspectCell[] = [];
  for (let y = 0; y < state.board.height; y++)
    for (let x = 0; x < state.board.width; x++) {
      const pos = { x, y };
      const terrain = state.board.tiles[y * state.board.width + x]!.terrain;
      const u = state.units.find((v) => v.pos.x === x && v.pos.y === y);
      const solid = state.mechanisms?.objects.some((o) => o.def.kind !== 'REGION' && o.pos.x === x && o.pos.y === y && ['SWITCH', 'STATUE'].includes(o.def.kind));
      const kind: InspectCell['kind'] =
        terrain === 'BLOCKED' || terrain === 'VOID' ? 'abyss' : state.obstacles.some((o) => o.pos.x === x && o.pos.y === y) ? 'wall' : solid ? 'solid' : terrain === 'OBJECTIVE' ? 'exit' : 'floor';
      cells.push({
        pos,
        kind,
        ...(u ? { unit: { id: u.id, letter: u.kind === 'HERO' ? 'C' : u.kind === 'SUMMON' ? 'S' : 'E', faction: u.faction } } : {}),
        reachable: reach.has(posKey(pos)),
        onPath: onPath.has(posKey(pos)),
        inSection: section.has(posKey(pos)),
      });
    }
  return { cells, pathLength: path ? path.length : null };
}
