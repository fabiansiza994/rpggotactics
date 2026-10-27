import { describe, expect, it } from 'vitest';
import { createEngine, replayBattle, type GameEvent } from '../src/game';
import { playBattle } from './support/bot';
import { GameEngine } from '../src/game/engine/GameEngine';
import { DEFAULT_CONTENT, SCENARIOS } from '../src/game/data';
import { makeEngine, p, setHand } from './helpers';

describe('GameEngine', () => {
  it('produces a new state object per successful dispatch and notifies listeners', () => {
    const engine = makeEngine();
    const seen: GameEvent[][] = [];
    const off = engine.subscribe((events) => seen.push([...events]));
    const before = engine.state;
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(1, 2) });
    expect(engine.state).not.toBe(before);
    expect(before.units.find((u) => u.id === 'mage')?.pos).toEqual(p(0, 2)); // old snapshot untouched
    expect(seen).toHaveLength(1);
    off();
    engine.dispatch({ type: 'END_TURN' });
    expect(seen).toHaveLength(1);
  });

  it('is deterministic: replaying the command history on the same seed gives the same state', () => {
    const a = createEngine('first_blood');
    const cards = a.state.player.hand.map((c) => c.uid);
    a.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) });
    for (const uid of cards) {
      const target = a.getValidTargets(uid)[0] ?? null;
      a.dispatch({ type: 'PLAY_CARD', cardUid: uid, target });
    }
    a.dispatch({ type: 'END_TURN' });
    a.dispatch({ type: 'END_TURN' });

    const b = createEngine('first_blood');
    for (const cmd of a.history) b.dispatch(cmd);
    expect(b.state).toEqual(a.state);
  });

  it('restart resets to the initial state of the same seed', () => {
    const engine = createEngine('crystal_guard');
    const initial = structuredClone(engine.state);
    engine.dispatch({ type: 'END_TURN' });
    engine.restart();
    expect(engine.state).toEqual(initial);
    expect(engine.history).toHaveLength(0);
  });

  it('previewCard is a dry run: it predicts events without mutating state', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(3, 2) } });
    const [fireball] = setHand(engine, ['fireball']);
    const before = structuredClone(engine.state);
    const preview = engine.previewCard(fireball as string, p(4, 2));
    expect(preview.valid).toBe(true);
    expect(preview.predictedEvents.some((e) => e.type === 'UNIT_DAMAGED')).toBe(true);
    expect(engine.state).toEqual(before);
  });

  it('every scenario loads with a valid board, hero and objectives', () => {
    for (const s of SCENARIOS) {
      const engine = new GameEngine(s, DEFAULT_CONTENT);
      expect(engine.state.board.width).toBe(7);
      expect(engine.state.board.height).toBe(5);
      expect(engine.state.units.some((u) => u.kind === 'HERO')).toBe(true);
      expect(engine.state.objectives.length).toBeGreaterThan(0);
      expect(engine.state.player.hand).toHaveLength(5);
    }
  });

  it('game events are plain serialisable data', () => {
    const engine = createEngine('escape');
    const r = engine.dispatch({ type: 'END_TURN' });
    expect(JSON.parse(JSON.stringify(r.events))).toEqual(r.events);
    expect(JSON.parse(JSON.stringify(engine.state))).toEqual(engine.state);
  });
});

describe('headless replay (server verification)', () => {
  it('reaches exactly the state GameEngine.dispatch reaches, and stops at the first rejected command', () => {
    for (const id of ['first_blood', 'crystal_guard', 'escape']) {
      for (const seed of [1, 7, 42]) {
        const live = createEngine(id, seed);
        playBattle(live);
        const replay = replayBattle(live.scenario, live.content, seed, live.history);
        expect(replay.rejectedAt).toBeNull();
        expect(replay.state).toEqual(live.state);
      }
    }
    const live = createEngine('first_blood', 3);
    const bad = replayBattle(live.scenario, live.content, 3, [{ type: 'MOVE_UNIT', unitId: 'nobody', to: { x: 0, y: 0 } }, { type: 'END_TURN' }]);
    expect(bad.rejectedAt).toBe(0);
  });
});
