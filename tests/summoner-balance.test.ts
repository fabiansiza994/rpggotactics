import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, GameEngine, type GameEvent, type GameState } from '../src/game';
import { actSummons, spawnSummon } from '../src/game/domain/summons/summons';
import { applyStatus, decrementStatuses } from '../src/game/domain/statuses/status-rules';
import type { ScenarioDef } from '../src/game/domain/scenario';
import type { Pos } from '../src/game/domain/core/position';
import { ctxFor, endTurn, makeEngine, ofType, p, setHand, unit } from './helpers';

/**
 * Summoner balance patch: Marcar Presa lasts 3 turns and summons pursue the prey; Dragón de Guerra
 * moves 2 (4 with Cacería Desatada). Damage, HP, armour, cost, capacity and attacks unchanged.
 */
const DRAKE_BEFORE = { maxHp: 18, armor: 1, damage: 3, capacityCost: 2, attackRange: 2 };
const LONG = Array(5).fill('...........');

function battle(enemies: { id: string; pos: Pos; enemyId?: string }[], overrides: Partial<ScenarioDef> = {}) {
  return makeEngine({
    layout: LONG,
    hero: { heroId: 'summoner', pos: p(0, 4) },
    enemies: enemies.map((e) => ({ enemyId: 'orc_warrior', ...e })),
    ...overrides,
  });
}
function summon(engine: GameEngine, id: string, pos: Pos) {
  const s = spawnSummon(ctxFor(engine), unit(engine, engine.heroId), id, pos)!;
  s.summon!.readyRound = engine.state.round;
  return s;
}
const mark = (engine: GameEngine, id: string) => applyStatus(ctxFor(engine), unit(engine, id), 'MARKED_PREY', 3, engine.heroId);
const activation = (engine: GameEngine) => {
  const events: GameEvent[] = [];
  actSummons(ctxFor(engine, events));
  (engine.state as GameState).round++;
  return events;
};
const dist = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

describe('Dragón de Guerra: mobility only', () => {
  it('base move 2; HP, damage, armour, capacity, range and the card are otherwise unchanged', () => {
    const drake = DEFAULT_CONTENT.summons!.war_drake!;
    expect(drake.moveRange).toBe(2);
    expect({ maxHp: drake.maxHp, armor: drake.armor, damage: drake.damage, capacityCost: drake.capacityCost, attackRange: drake.attackRange }).toEqual(DRAKE_BEFORE);
    expect(DEFAULT_CONTENT.cards.summon_war_drake).toMatchObject({ cost: 4, rarity: 'RARE' });
  });

  it('Cacería Desatada: 4 while buffed, back to 2 when it expires (no nerf to the card)', () => {
    const engine = battle([{ id: 'far', pos: p(10, 2) }]);
    unit(engine, 'far').moveRange = 0;
    unit(engine, 'far').maxHp = unit(engine, 'far').hp = 99; // (arrange) survives the breaths
    const drake = summon(engine, 'war_drake', p(0, 2));
    const ctx = ctxFor(engine);
    applyStatus(ctx, drake, 'UNLEASHED_HUNT', 3, engine.heroId);
    const steps: number[] = [];
    for (let k = 0; k < 4; k++) {
      const x = drake.pos.x;
      activation(engine);
      decrementStatuses(ctx, drake);
      steps.push(drake.pos.x - x);
    }
    // Three buffed activations (4 tiles, until the breath range of 2 stops it), then the base 2.
    expect(steps[0]).toBe(4);
    expect(drake.statuses.some((s) => s.id === 'UNLEASHED_HUNT')).toBe(false);
    drake.pos = p(0, 2); // after expiry the same drake is back to its base 2
    activation(engine);
    expect(drake.pos.x).toBe(2);
    const plain = battle([{ id: 'far', pos: p(10, 2) }]);
    unit(plain, 'far').moveRange = 0;
    const slow = summon(plain, 'war_drake', p(0, 2));
    activation(plain);
    expect(slow.pos.x).toBe(2);
    expect(DEFAULT_CONTENT.cards.unleashed_hunt!.effects).toEqual([{ type: 'APPLY_STATUS', status: 'UNLEASHED_HUNT', duration: 3, to: 'SUMMONS' }]);
  });
});

describe('Marcar Presa: 3 turns + pursuit (light playtest scenarios A–E)', () => {
  it('A · far target: the drake (move 2) closes in each turn and breathes on the prey within the mark', () => {
    const engine = battle([{ id: 'near', pos: p(1, 0) }, { id: 'prey', pos: p(8, 2) }]);
    unit(engine, 'prey').moveRange = 0;
    unit(engine, 'near').moveRange = 0;
    const drake = summon(engine, 'war_drake', p(1, 2));
    mark(engine, 'prey');
    const hits: string[] = [];
    for (let k = 0; k < 3; k++) {
      const events = activation(engine);
      hits.push(...ofType(events, 'SUMMON_ATTACKED').map((e) => e.targetId), ...ofType(events, 'SUMMON_BREATH').flatMap((e) => e.targetIds));
    }
    expect(dist(drake.pos, p(8, 2))).toBeLessThanOrEqual(2);
    expect(unit(engine, 'prey').hp).toBeLessThan(8);
    expect(hits).not.toContain('near'); // focus fire, not the closer enemy
  });

  it('B · behind obstacles: it walks around the wall (never through it, never onto hazards)', () => {
    const engine = battle([{ id: 'prey', pos: p(6, 2) }], { layout: ['...........', '....#......', '....#......', '....#......', '...........'] });
    unit(engine, 'prey').moveRange = 0;
    const fox = summon(engine, 'fox', p(2, 2));
    mark(engine, 'prey');
    const path: Pos[] = [];
    for (let k = 0; k < 3; k++) {
      activation(engine);
      path.push({ ...fox.pos });
    }
    expect(path.every((q) => !(q.x === 4 && q.y >= 1 && q.y <= 3))).toBe(true);
    expect(unit(engine, 'prey').hp).toBeLessThan(8);
  });

  it('C · prey dies: the mark is gone and the summons pick the closest enemy again', () => {
    const engine = battle([{ id: 'prey', pos: p(3, 2) }, { id: 'other', pos: p(6, 4) }]);
    const fox = summon(engine, 'fox', p(2, 2));
    mark(engine, 'prey');
    unit(engine, 'prey').hp = 1;
    expect(ofType(activation(engine), 'SUMMON_ATTACKED').map((e) => e.targetId)).toEqual(['prey']);
    expect(engine.state.units.some((u) => u.statuses.some((s) => s.id === 'MARKED_PREY'))).toBe(false);
    const before = dist(fox.pos, p(6, 4));
    activation(engine);
    expect(dist(fox.pos, p(6, 4))).toBeLessThan(before);
  });

  it('D · new prey: a second mark replaces the first and the pursuit switches', () => {
    const engine = battle([{ id: 'a', pos: p(9, 0) }, { id: 'b', pos: p(9, 4) }]);
    for (const id of ['a', 'b']) unit(engine, id).moveRange = 0;
    const fox = summon(engine, 'fox', p(2, 2));
    const [m1, m2] = setHand(engine, ['mark_prey', 'mark_prey']);
    (engine.state as GameState).player.energy = 9;
    unit(engine, engine.heroId).pos = p(7, 2);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: m1!, target: p(9, 0) }).ok).toBe(true);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: m2!, target: p(9, 4) }).ok).toBe(true);
    expect(unit(engine, 'a').statuses).toEqual([]);
    expect(unit(engine, 'b').statuses).toEqual([{ id: 'MARKED_PREY', turnsLeft: 3, sourceId: engine.heroId }]);
    activation(engine);
    const now = unit(engine, fox.id).pos; // dispatch works on a copy: re-read the unit
    expect(now.y).toBeGreaterThanOrEqual(2); // heading for b (south), not a
    expect(dist(now, p(9, 4))).toBeLessThan(dist(p(2, 2), p(9, 4)));
  });

  it('E · kite: a prey retreating 2 a turn is caught by the buffed drake, not by the plain one', () => {
    const run = (buffed: boolean) => {
      const engine = battle([{ id: 'prey', pos: p(4, 2) }]);
      const prey = unit(engine, 'prey');
      prey.moveRange = 0;
      const drake = summon(engine, 'war_drake', p(0, 2));
      mark(engine, 'prey');
      if (buffed) applyStatus(ctxFor(engine), drake, 'UNLEASHED_HUNT', 3, engine.heroId);
      let breathed = false;
      for (let k = 0; k < 3; k++) {
        prey.pos = { x: Math.min(10, prey.pos.x + 2), y: 2 }; // the kiter's turn
        const events = activation(engine);
        breathed ||= events.some((e) => (e.type === 'SUMMON_ATTACKED' && e.targetId === 'prey') || (e.type === 'SUMMON_BREATH' && e.targetIds.includes('prey')));
      }
      return breathed;
    };
    expect(run(true)).toBe(true);
    expect(run(false)).toBe(false); // still a slow threat on its own
  });

  it('not suicidal: a summon holding a plate or an objective never leaves it to chase', () => {
    // The Tortuga holding a Dominion node / plate is covered by the existing rules (preyPursuit: holding → null).
    const engine = battle([{ id: 'prey', pos: p(8, 2) }]);
    const fox = summon(engine, 'fox', p(1, 2));
    applyStatus(ctxFor(engine), fox, 'ROOTED', 2, 'test');
    mark(engine, 'prey');
    activation(engine);
    expect(fox.pos).toEqual(p(1, 2));
  });
});

describe('Marcar Presa: determinism', () => {
  it('replay (same snapshot + same commands) and reconnect reproduce the 3-turn mark and the pursuit exactly', () => {
    const engine = battle([{ id: 'prey', pos: p(8, 2) }, { id: 'near', pos: p(2, 0) }]);
    (engine.state as GameState).player.energy = 9;
    const [fox, markCard] = setHand(engine, ['summon_fox', 'mark_prey']);
    unit(engine, engine.heroId).pos = p(4, 2);
    // Arrange-only moves above are part of the initial snapshot for the reconnect copy below.
    const snapshot = structuredClone(engine.state) as GameState;
    const commands = [
      { type: 'PLAY_CARD', cardUid: fox!, target: p(4, 3) },
      { type: 'PLAY_CARD', cardUid: markCard!, target: p(8, 2) },
    ] as const;
    for (const c of commands) expect(engine.dispatch(c).ok).toBe(true);
    for (let k = 0; k < 4; k++) engine.dispatch(endTurn(engine));
    const copy = GameEngine.fromSnapshot(snapshot, engine.content, engine.scenario);
    for (const c of commands) copy.dispatch(c);
    for (let k = 0; k < 4; k++) copy.dispatch(endTurn(copy));
    expect(JSON.stringify(copy.state)).toBe(JSON.stringify(engine.state));
    // Reconnect mid-mark: a serialized snapshot continues identically.
    const mid = GameEngine.fromSnapshot(JSON.parse(JSON.stringify(engine.state)) as GameState, engine.content, engine.scenario);
    engine.dispatch(endTurn(engine));
    mid.dispatch(endTurn(mid));
    expect(JSON.stringify(mid.state)).toBe(JSON.stringify(engine.state));
  });
});
