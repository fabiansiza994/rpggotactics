import { spawnSummon } from '../src/game/domain/summons/summons';
import { describe, it, expect } from 'vitest';
import { endTurn } from './helpers';
import { DEFAULT_CONTENT, createProfile, type GameState, type GameEvent } from '../src/game';
import { createDuel, applyDuel, duelView, validateLoadout } from '../src/game/pvp/duel';
import { DOMINION_NODES, refreshDominion, scoreDominion } from '../src/game/pvp/dominion';
const profile = createProfile(DEFAULT_CONTENT);
const loadouts = [validateLoadout(profile, 'mage'), validateLoadout(profile, 'summoner')] as const;
const battle = (seed = 7) => createDuel([...loadouts], seed, 'DOMINION');
function champion(s: GameState, seat: number) {
  return s.units.find((u) => u.id === s.duel!.champions[seat])!;
}
function score(s: GameState) {
  const events: GameEvent[] = [];
  scoreDominion({ state: s, content: DEFAULT_CONTENT, emit: (e) => events.push(e) });
  return events;
}
function occupy(s: GameState, seat: 0 | 1, node: number) {
  champion(s, seat).pos = { ...DOMINION_NODES[node]! };
  refreshDominion(s);
}
describe('Arcane Dominion', () => {
  it('exactly three nodes and a mirror-symmetric 10x7 map; Duel unchanged', () => {
    const s = battle();
    expect([s.board.width, s.board.height]).toEqual([10, 7]);
    expect(s.dominion!.nodes).toHaveLength(3);
    for (const p of DOMINION_NODES) expect(DOMINION_NODES).toContainEqual({ x: p.x, y: 6 - p.y });
    expect(champion(s, 0).pos).toEqual({ x: 4, y: 0 });
    expect(champion(s, 1).pos).toEqual({ x: 4, y: 6 });
    const d = createDuel([...loadouts], 7);
    expect(d.dominion).toBeUndefined();
    expect([d.board.width, d.board.height]).toEqual([9, 6]);
  });
  it('neutral, both sides, leaving and dead occupancy have no capture memory', () => {
    const s = battle();
    expect(s.dominion!.nodes.every((n) => n.control === 'NEUTRAL')).toBe(true);
    occupy(s, 0, 0);
    expect(s.dominion!.nodes[0]!.control).toBe(0);
    champion(s, 0).pos = { x: 0, y: 0 };
    occupy(s, 1, 0);
    expect(s.dominion!.nodes[0]!.control).toBe(1);
    champion(s, 1).hp = 0;
    refreshDominion(s);
    expect(s.dominion!.nodes[0]!.control).toBe('NEUTRAL');
  });
  it('summons use stable owner identity even when active factions swap', () => {
    let s = battle();
    const unit = structuredClone(champion(s, 1));
    unit.id = 'familiar';
    unit.kind = 'SUMMON';
    unit.summon = {
      ownerId: champion(s, 1).id,
      capacityCost: 1,
      lastActedRound: 1,
      readyRound: 999,
    };
    unit.pos = { ...DOMINION_NODES[2]! };
    s.units.push(unit);
    refreshDominion(s);
    expect(s.dominion!.nodes[2]!.control).toBe(1);
    s = applyDuel(s, endTurn(s)).state;
    expect(s.dominion!.nodes[2]!.control).toBe(1);
    s.units = s.units.filter((u) => u.id !== 'familiar');
    refreshDominion(s);
    expect(s.dominion!.nodes[2]!.control).toBe('NEUTRAL');
  });
  it('defensive contested state scores zero', () => {
    const s = battle();
    occupy(s, 0, 1);
    occupy(s, 1, 1);
    s.round = 2;
    score(s);
    expect(s.dominion!.nodes[1]!.control).toBe('CONTESTED');
    expect(s.dominion!.scores).toEqual([0, 0]);
  });
  it('round one scores nothing and only one checkpoint occurs per full round', () => {
    let s = battle();
    occupy(s, 0, 0);
    s = applyDuel(s, endTurn(s)).state;
    expect(s.dominion!.lastScoredRound).toBe(0);
    s = applyDuel(s, endTurn(s)).state;
    expect(s.dominion!.scores).toEqual([0, 0]);
    expect(s.dominion!.lastScoredRound).toBe(1);
    s = applyDuel(s, endTurn(s)).state;
    expect(s.dominion!.scores).toEqual([0, 0]);
    s = applyDuel(s, endTurn(s)).state;
    expect(s.dominion!.scores).toEqual([1, 0]);
    expect(s.round).toBe(3);
  });
  for (const count of [0, 1, 2, 3])
    it(`${count} occupied nodes grant exactly ${count} points without buffs`, () => {
      const s = battle();
      for (let i = 0; i < count; i++) {
        const u = structuredClone(champion(s, 0));
        u.id = `holder-${i}`;
        u.kind = 'SUMMON';
        u.summon = {
          ownerId: champion(s, 0).id,
          capacityCost: 1,
          lastActedRound: 0,
          readyRound: 999,
        };
        u.pos = { ...DOMINION_NODES[i]! };
        s.units.push(u);
      }
      s.round = 2;
      const resources = structuredClone(s.player);
      score(s);
      expect(s.dominion!.scores).toEqual([count, 0]);
      expect(s.player).toEqual(resources);
      score(s);
      expect(s.dominion!.scores).toEqual([count, 0]);
    });
  it('target eight ends match, both projections report winner correctly, no future scoring/actions', () => {
    const s = battle();
    occupy(s, 1, 2);
    s.round = 2;
    s.dominion!.scores = [0, 7];
    score(s);
    expect(s.dominion!.winner).toBe(1);
    expect(duelView(s, 1).outcome?.result).toBe('WON');
    expect(duelView(s, 0).outcome?.result).toBe('LOST');
    s.round++;
    score(s);
    expect(s.dominion!.scores).toEqual([0, 8]);
    expect(() => applyDuel(s, endTurn(s))).toThrow();
  });
  it('simultaneous target uses score, node count, exact HP fraction then sudden death', () => {
    for (const rule of ['score', 'nodes', 'hp', 'sudden'] as const) {
      const s = battle();
      occupy(s, 0, 0);
      occupy(s, 1, 2);
      s.round = 2;
      s.dominion!.scores = rule === 'score' ? [8, 7] : [7, 7];
      if (rule === 'nodes') {
        const u = structuredClone(champion(s, 0));
        u.id = 'third';
        u.summon = {
          ownerId: champion(s, 0).id,
          capacityCost: 1,
          lastActedRound: 0,
          readyRound: 999,
        };
        u.pos = { ...DOMINION_NODES[1]! };
        s.units.push(u);
        s.dominion!.scores = [6, 7];
      }
      if (rule === 'hp') champion(s, 1).hp--;
      score(s);
      if (rule !== 'sudden') expect(s.dominion!.winner).toBe(0);
      else {
        expect(s.dominion!.suddenDeath).toBe(true);
        expect(s.outcome).toBeNull();
        s.round++;
        score(s);
        expect(s.outcome).toBeNull();
        champion(s, 1).pos = { x: 9, y: 6 };
        s.round++;
        score(s);
        expect(s.dominion!.winner).toBe(0);
      }
    }
  });
  it('champion elimination overrides a pending scoring opportunity', () => {
    const s = battle();
    s.duel!.turns = 3;
    s.round = 2;
    s.dominion!.scores = [7, 7];
    occupy(s, 0, 0);
    s.units = s.units.filter((u) => u.id !== s.duel!.other.heroId);
    const next = applyDuel(s, endTurn(s)).state;
    expect(next.outcome?.reason).toBe('HERO_DEFEATED');
    expect(next.dominion!.scores).toEqual([7, 7]);
  });
  it('real MOVE updates nodes; replay reaches identical authoritative final state', () => {
    const original = battle();
    const s = structuredClone(original);
    const own = champion(s, s.duel!.active);
    own.pos = { x: 2, y: 1 };
    const cmd = { type: 'MOVE_UNIT', unitId: own.id, to: { x: 2, y: 2 } } as const;
    const a = applyDuel(s, cmd),
      b = applyDuel(structuredClone(s), cmd);
    expect(a.state).toEqual(b.state);
    expect(a.state.dominion!.nodes[0]!.control).toBe(s.duel!.active);
    const moved = applyDuel(a.state, {
      type: 'MOVE_UNIT',
      unitId: own.id,
      to: { x: 3, y: 2 },
    }).state;
    expect(moved.dominion!.nodes[0]!.control).toBe('NEUTRAL');
  });
  it('projection preserves objective fields without leaking hidden hands', () => {
    const s = battle();
    occupy(s, 0, 0);
    s.round = 2;
    score(s);
    for (const seat of [0, 1] as const) {
      const v = duelView(s, seat);
      expect(v.dominion).toEqual(s.dominion);
      expect(v.duel).toBeUndefined();
      expect(v.player.deck).toEqual([]);
    }
    const restored = structuredClone(s);
    expect(restored).toEqual(s);
  });
});

describe('Dominion control-card interactions', () => {
  function mage() {
    for (let seed = 1; seed < 30; seed++) {
      const s = battle(seed);
      if (s.player.heroId === 'champion-a') return s;
    }
    throw Error('No seed');
  }
  it('Force Push removes rival occupation through the real shared card path', () => {
    const s = mage();
    champion(s, 0).pos = { x: 2, y: 1 };
    occupy(s, 1, 0);
    s.player.hand = [{ uid: 'push-test', cardId: 'force_push' }];
    const result = applyDuel(s, {
      type: 'PLAY_CARD',
      cardUid: 'push-test',
      target: { x: 2, y: 2 },
    });
    expect(result.events.some((e) => e.type === 'UNIT_PUSHED')).toBe(true);
    expect(result.state.dominion!.nodes[0]!.control).toBe('NEUTRAL');
    expect(result.state.units.find((u) => u.id === 'champion-b')!.pos).toEqual({ x: 2, y: 4 });
    expect(result.state.dominion!.nodes[2]!.control).toBe(1);
  });
  it('Blink onto and off a node controls only the currently occupied tile', () => {
    const s = mage();
    champion(s, 0).pos = { x: 2, y: 1 };
    s.player.hand = [{ uid: 'blink-test', cardId: 'blink' }];
    const next = applyDuel(s, {
      type: 'PLAY_CARD',
      cardUid: 'blink-test',
      target: { x: 2, y: 2 },
    }).state;
    expect(next.dominion!.nodes[0]!.control).toBe(0);
    next.player.hand = [{ uid: 'blink-test-2', cardId: 'blink' }];
    const away = applyDuel(next, {
      type: 'PLAY_CARD',
      cardUid: 'blink-test-2',
      target: { x: 3, y: 2 },
    }).state;
    expect(away.dominion!.nodes[0]!.control).toBe('NEUTRAL');
  });
  it('existing wall may block an empty node but cannot capture it or displace a unit illegally', () => {
    const s = mage();
    champion(s, 0).pos = { x: 2, y: 1 };
    s.player.hand = [{ uid: 'wall-test', cardId: 'ice_wall' }];
    const wall = applyDuel(s, {
      type: 'PLAY_CARD',
      cardUid: 'wall-test',
      target: { x: 2, y: 2 },
    }).state;
    expect(wall.obstacles.some((o) => o.pos.x === 2 && o.pos.y === 2)).toBe(true);
    expect(wall.dominion!.nodes[0]!.control).toBe('NEUTRAL');
    expect(() =>
      applyDuel(wall, { type: 'MOVE_UNIT', unitId: 'champion-a', to: { x: 2, y: 2 } }),
    ).toThrow();
  });
});

it('Pollo retreat changes node control before scoring and replays identically', () => {
  let s = battle();
  for (let seed = 1; seed < 30; seed++) {
    const candidate = battle(seed);
    if (candidate.player.heroId === 'champion-b') {
      s = candidate;
      break;
    }
  }
  s.round = 2;
  s.duel!.turns = 3;
  champion(s, 1).pos = { x: 2, y: 1 };
  champion(s, 0).pos = { x: 2, y: 3 };
  const chicken = spawnSummon(
    { state: s, content: DEFAULT_CONTENT, emit: () => {} },
    champion(s, 1),
    'chicken',
    { x: 2, y: 2 },
  )!;
  chicken.summon!.readyRound = 2;
  refreshDominion(s);
  expect(s.dominion!.nodes[0]!.control).toBe(1);
  const a = applyDuel(s, endTurn(s)),
    b = applyDuel(structuredClone(s), { type: 'END_TURN' });
  expect(a).toEqual(b);
  expect(a.events.some((e) => e.type === 'SUMMON_ATTACKED')).toBe(true);
  expect(a.state.dominion!.nodes[0]!.control).toBe('NEUTRAL');
  expect(a.state.dominion!.scores).toEqual([0, 0]);
});
