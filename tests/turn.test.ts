import { describe, expect, it } from 'vitest';
import { makeEngine, mutable, ofType, p, setHand } from './helpers';

describe('turn engine', () => {
  it('starts on round 1, player phase, full resources and a 5-card opening hand', () => {
    const engine = makeEngine();
    const s = engine.state;
    expect(s.round).toBe(1);
    expect(s.phase).toBe('PLAYER');
    expect(s.player.energy).toBe(5);
    expect(s.player.movePoints).toBe(3);
    expect(s.player.hand).toHaveLength(5);
    expect(s.player.deck).toHaveLength(25);
    expect(s.intents).toHaveLength(1);
    expect(engine.initialEvents[0]).toMatchObject({ type: 'BATTLE_STARTED' });
  });

  it('END_TURN runs the enemy phase and returns to a refreshed player turn', () => {
    const engine = makeEngine();
    const [missile] = setHand(engine, ['magic_missile']);
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) });
    engine.dispatch({ type: 'PLAY_CARD', cardUid: missile as string, target: p(6, 2) });
    expect(engine.state.player.energy).toBe(4);
    expect(engine.state.player.movePoints).toBe(1);

    const { events } = engine.dispatch({ type: 'END_TURN' });
    const flow = events.flatMap((e) => {
      if (e.type === 'ROUND_STARTED') return [`ROUND_${e.round}`];
      if (e.type === 'TURN_STARTED' || e.type === 'TURN_ENDED') return [`${e.type}:${e.faction}`];
      return [];
    });
    expect(flow).toEqual([
      'TURN_ENDED:PLAYER',
      'TURN_STARTED:ENEMY',
      'TURN_ENDED:ENEMY',
      'ROUND_2',
      'TURN_STARTED:PLAYER',
    ]);
    expect(engine.state.round).toBe(2);
    expect(engine.state.phase).toBe('PLAYER');
    expect(engine.state.player.energy).toBe(5);
    expect(engine.state.player.movePoints).toBe(3);
    expect(ofType(events, 'CARD_DRAWN')).toHaveLength(1);
    expect(ofType(events, 'ENEMY_INTENT_DECLARED')).toHaveLength(1);
  });

  it('keeps up to 5 cards between turns; the turn draw takes 5 → 6 (hand rule: tests/hand-limit.test.ts)', () => {
    const engine = makeEngine();
    setHand(engine, ['blink', 'blink', 'blink', 'blink', 'blink']);
    engine.dispatch({ type: 'END_TURN' });
    expect(engine.state.player.hand).toHaveLength(6);
  });

  it('rejects player commands once the battle is over', () => {
    const engine = makeEngine();
    mutable(engine).units.find((u) => u.id === 'orc-1')!.hp = 1;
    const [missile] = setHand(engine, ['magic_missile']);
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'mage', to: p(2, 2) });
    const result = engine.dispatch({ type: 'PLAY_CARD', cardUid: missile as string, target: p(6, 2) });
    expect(ofType(result.events, 'BATTLE_WON')).toHaveLength(1);
    expect(engine.state.phase).toBe('ENDED');
    expect(engine.dispatch({ type: 'END_TURN' })).toMatchObject({ ok: false, error: 'BATTLE_OVER' });
  });
});
