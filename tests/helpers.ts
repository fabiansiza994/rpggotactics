import { DEFAULT_CONTENT } from '../src/game/data';
import { GameEngine } from '../src/game/engine/GameEngine';
import type { GameContent } from '../src/game/domain/content';
import type { RuleContext } from '../src/game/domain/context';
import type { Pos } from '../src/game/domain/core/position';
import type { GameEvent, GameEventType } from '../src/game/domain/events';
import type { ScenarioDef } from '../src/game/domain/scenario';
import type { GameState } from '../src/game/domain/state';
import type { Unit } from '../src/game/domain/entities/unit';
import type { Command } from '../src/game/engine/commands';
import { fallbackDiscardUid } from '../src/game/domain/cards/hand-limit';

export const LEGEND: ScenarioDef['legend'] = {
  '.': {},
  '#': { obstacleId: 'pillar' },
  r: { obstacleId: 'rubble' },
  F: { terrain: 'FIRE' },
  I: { terrain: 'ICE' },
  x: { terrain: 'BLOCKED' },
  E: { terrain: 'OBJECTIVE' },
};

export const EMPTY_7x5 = ['.......', '.......', '.......', '.......', '.......'];

export function scenario(overrides: Partial<ScenarioDef> = {}): ScenarioDef {
  return {
    id: 'test',
    name: 'Test',
    description: '',
    layout: EMPTY_7x5,
    legend: LEGEND,
    hero: { heroId: 'mage', pos: { x: 0, y: 2 } },
    structures: [],
    enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: { x: 6, y: 2 } }],
    waves: [],
    objectives: [{ type: 'ELIMINATE_ALL' }],
    defaultSeed: 42,
    ...overrides,
  };
}

export function makeEngine(overrides: Partial<ScenarioDef> = {}, content: GameContent = DEFAULT_CONTENT, seed = 42) {
  return new GameEngine(scenario(overrides), content, seed);
}

/** Test "arrange" helper: direct access to the engine's live state. */
export const mutable = (engine: GameEngine): GameState => engine.state as GameState;

export function unit(engine: GameEngine, id: string): Unit {
  const u = engine.state.units.find((x) => x.id === id);
  if (!u) throw new Error(`unit ${id} not found`);
  return u;
}

/** Replace the hand with specific cards (uids: `test-<cardId>-<i>`). Returns the uids. */
export function setHand(engine: GameEngine, cardIds: string[]): string[] {
  const hand = cardIds.map((cardId, i) => ({ uid: `test-${cardId}-${i}`, cardId }));
  mutable(engine).player.hand = hand;
  return hand.map((c) => c.uid);
}

export function ofType<T extends GameEventType>(events: readonly GameEvent[], type: T) {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

export function ctxFor(engine: GameEngine, events: GameEvent[] = []): RuleContext {
  return { state: mutable(engine), content: engine.content, emit: (e) => events.push(e) };
}

export const p = (x: number, y: number): Pos => ({ x, y });

/**
 * END_TURN that obeys the hand rule (HAND_RULES): with more cards than the hand size it discards
 * the deterministic fallback card (the last in hand). Tests that are not about the discard use it.
 */
export function endTurn(source: { state: Readonly<GameState> } | Readonly<GameState>): Command {
  const state = 'player' in source ? source : source.state;
  const discardUid = fallbackDiscardUid(state);
  return discardUid ? { type: 'END_TURN', discardUid } : { type: 'END_TURN' };
}
