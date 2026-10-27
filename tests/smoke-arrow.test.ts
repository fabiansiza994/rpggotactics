import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { createProfile, withHeroDeck } from '../src/game/collection/profile';
import { archerCardForecast } from '../src/game/domain/archer-view';
import { tileAt } from '../src/game/domain/board/board';
import { hasLineOfSight } from '../src/game/domain/board/line-of-sight';
import { computeReachable } from '../src/game/domain/board/pathfinding';
import { queryContext } from '../src/game/domain/context';
import { posKey, type Pos } from '../src/game/domain/core/position';
import type { GameState } from '../src/game/domain/state';
import type { ScenarioDef } from '../src/game/domain/scenario';
import type { Command } from '../src/game/engine/commands';
import { replayBattle } from '../src/game/engine/replay';
import { applyDuel, createDuel, validateLoadout } from '../src/game/pvp/duel';
import { EMPTY_7x5, endTurn, makeEngine, mutable, ofType, p, scenario, setHand, unit } from './helpers';

const CONTENT = withArcher(DEFAULT_CONTENT);
const ORC = (id: string, x: number, y: number) => ({ id, enemyId: 'orc_warrior', pos: p(x, y) });

function archer(enemies: ScenarioDef['enemies'], overrides: Partial<ScenarioDef> = {}) {
  return makeEngine({ hero: { heroId: 'archer', pos: p(0, 2) }, layout: EMPTY_7x5, enemies, ...overrides }, CONTENT);
}
type Engine = ReturnType<typeof archer>;
const smoke = (e: Engine, target: Pos) => {
  const [uid] = setHand(e, ['smoke_arrow']);
  const r = e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target });
  expect(r.ok).toBe(true);
  return r.ok ? r.events : [];
};
const terrain = (s: Readonly<GameState>, at: Pos) => tileAt(s.board, at)!;
const square = (c: Pos) => [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => p(c.x + dx, c.y + dy)));
const los = (e: Engine, a: Pos, b: Pos) => hasLineOfSight(queryContext(mutable(e), CONTENT), a, b);

describe('Flecha de Humo — cloud', () => {
  it('creates a 3×3 SMOKE cloud for 2 rounds; 1 damage only to the enemy on the impact tile', () => {
    const e = archer([ORC('center', 4, 2), ORC('side', 4, 1)]);
    smoke(e, p(4, 2));
    for (const t of square(p(4, 2))) expect(terrain(e.state, t)).toMatchObject({ terrain: 'SMOKE', terrainTurnsLeft: 2 });
    expect(unit(e, 'center').hp).toBe(7);
    expect(unit(e, 'side').hp).toBe(8);
    expect(e.state.player.energy).toBe(2);
  });

  it('lasts exactly 2 rounds, then reverts to the base ground (TERRAIN_REMOVED EXPIRED)', () => {
    const e = archer([ORC('far', 6, 4)]);
    smoke(e, p(3, 2));
    e.dispatch(endTurn(e));
    expect(terrain(e.state, p(3, 2))).toMatchObject({ terrain: 'SMOKE', terrainTurnsLeft: 1 });
    const r = e.dispatch(endTurn(e));
    for (const t of square(p(3, 2))) expect(terrain(e.state, t)).toMatchObject({ terrain: 'NORMAL', terrainTurnsLeft: null });
    if (r.ok) expect(ofType(r.events, 'TERRAIN_REMOVED').filter((ev) => ev.reason === 'EXPIRED')).toHaveLength(9);
    expect(los(e, p(0, 2), p(6, 2))).toBe(true);
  });

  it('re-shooting refreshes to 2 rounds, never stacks duration or intensity', () => {
    const e = archer([ORC('far', 6, 4)]);
    smoke(e, p(3, 2));
    e.dispatch(endTurn(e));
    mutable(e).player.energy = 4;
    // Its own cloud blocks sight: the centre (3,2) can no longer be aimed at through (2,2).
    const [through] = setHand(e, ['smoke_arrow']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: through!, target: p(3, 2) }).ok).toBe(false);
    smoke(e, p(2, 2)); // overlapping cloud from a visible tile
    expect(terrain(e.state, p(3, 2)).terrainTurnsLeft).toBe(2); // 1 → refreshed to 2, not 3
    expect(terrain(e.state, p(4, 2)).terrainTurnsLeft).toBe(1); // outside the new cloud: untouched
    const ctx = queryContext(mutable(e), CONTENT);
    const reach = computeReachable(ctx, unit(e, 'archer'), 99);
    // Leaving the merged cloud still costs +1 once: (0,2) → (5,2) = 5 steps + 1.
    expect(reach.get(posKey(p(5, 2)))?.cost).toBe(6);
  });

  it('never erases fire, ice, exits or cover (only NORMAL ground becomes smoke)', () => {
    const e = archer([ORC('far', 6, 4)], { layout: ['.......', '..F....', '..I.E..', '.......', '.......'] });
    smoke(e, p(3, 2));
    expect(terrain(e.state, p(2, 1)).terrain).toBe('FIRE');
    expect(terrain(e.state, p(2, 2)).terrain).toBe('ICE');
    expect(terrain(e.state, p(4, 2)).terrain).toBe('OBJECTIVE');
    expect(terrain(e.state, p(3, 2)).terrain).toBe('SMOKE');
  });
});

describe('Flecha de Humo — vision and movement', () => {
  it('blocks line of sight THROUGH the cloud, the same way for both sides; edges stay visible', () => {
    const e = archer([ORC('hidden', 5, 2), ORC('edge', 3, 3)]);
    smoke(e, p(4, 2));
    expect(los(e, p(0, 2), p(6, 2))).toBe(false);
    expect(los(e, p(6, 2), p(0, 2))).toBe(false); // symmetric
    expect(los(e, p(0, 2), p(3, 2))).toBe(true); // first smoke tile: nothing in between
    const [shot] = setHand(e, ['archer_shot']);
    mutable(e).player.energy = 4;
    const targets = e.getValidTargets(shot!).map(posKey);
    expect(targets).not.toContain(posKey(p(5, 2)));
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: shot!, target: p(5, 2) }).ok).toBe(false);
  });

  it('a unit stepping out of the cloud pays +1 move once (enemies and the Archer alike)', () => {
    const e = archer([ORC('orc', 4, 2)]);
    smoke(e, p(4, 2));
    e.dispatch(endTurn(e));
    // 3 MP: (4,2)→(3,2) inside = 1, (3,2)→(2,2) leaving = 2: it stops at (2,2) instead of (1,2).
    expect(unit(e, 'orc').pos).toEqual(p(2, 2));

    const own = archer([ORC('far', 6, 4)]);
    smoke(own, p(1, 2)); // the cloud covers the Archer's own tile (0,2)
    const reach = computeReachable(queryContext(mutable(own), CONTENT), unit(own, 'archer'), 4);
    expect(reach.get(posKey(p(3, 2)))?.cost).toBe(4); // (0,2)→(2,2) inside: 2, leaving: 2
    expect(reach.has(posKey(p(4, 2)))).toBe(false);
  });

  it('no lock: a normal unit can always walk out, and the cloud ends after 2 rounds whatever happens', () => {
    const e = archer([ORC('orc', 4, 2), ORC('o2', 6, 0)]);
    smoke(e, p(4, 2));
    const ctx = queryContext(mutable(e), CONTENT);
    expect([...computeReachable(ctx, unit(e, 'orc'), unit(e, 'orc').moveRange).values()].some((n) => terrain(e.state, n.pos).terrain !== 'SMOKE')).toBe(true);
    e.dispatch(endTurn(e));
    e.dispatch(endTurn(e));
    expect(e.state.board.tiles.some((t) => t.terrain === 'SMOKE')).toBe(false);
  });

  it('preview: area, rounds, sight and movement rule come from a dry run of the real rules', () => {
    const e = archer([ORC('center', 4, 2)], { layout: ['.......', '...F...', '.......', '.......', '.......'] });
    const [uid] = setHand(e, ['smoke_arrow']);
    const f = archerCardForecast(e.state, CONTENT, uid!, p(4, 2))!;
    expect(f.predictedHpLoss).toBe(1);
    expect(f.terrain).toEqual([expect.objectContaining({ terrain: 'SMOKE', rounds: 2, blocksLineOfSight: true, exitCost: 1 })]);
    expect(f.terrain[0]!.tiles).toHaveLength(8); // (3,1) is fire: skipped, and the preview says so
    expect(f.notes).toContain('Humo en 8 casillas durante 2 rondas: bloquea la visión a través; salir cuesta +1 movimiento');
  });
});

describe('Flecha de Humo — modes, authority, replay', () => {
  it('PvP: the server resolves it; the cloud blocks the rival\'s sight too; forged client fields carry nothing', () => {
    const profile = createProfile(CONTENT);
    let s = createDuel([validateLoadout(profile, 'archer', CONTENT), validateLoadout(profile, 'mage', CONTENT)], 7, 'DUEL', 'classic', CONTENT);
    if (s.duel!.active !== 0) s = applyDuel(s, endTurn(s), CONTENT).state;
    s.units.find((u) => u.id === 'champion-a')!.pos = p(4, 0);
    s.units.find((u) => u.id === 'champion-b')!.pos = p(4, 4);
    s.player.hand = [{ uid: 't-smoke', cardId: 'smoke_arrow' }];
    const forged = { type: 'PLAY_CARD', cardUid: 't-smoke', target: p(4, 2), radius: 9, duration: 99, terrain: 'BLOCKED' } as unknown as Command;
    s = applyDuel(s, forged, CONTENT).state;
    expect(s.board.tiles.filter((t) => t.terrain === 'SMOKE')).toHaveLength(9);
    expect(s.board.tiles.filter((t) => t.terrain === 'SMOKE').every((t) => t.terrainTurnsLeft === 2)).toBe(true);
    s = applyDuel(s, endTurn(s), CONTENT).state;
    expect(s.player.heroId).toBe('champion-b');
    s.player.hand = [{ uid: 't-mm', cardId: 'magic_missile' }];
    expect(() => applyDuel(s, { type: 'PLAY_CARD', cardUid: 't-mm', target: p(4, 0) }, CONTENT)).toThrow();
  });

  it('skirmish / campaign: works in an authored Archer encounter (same engine as skirmishes)', async () => {
    const { ARCHER_HUNT_CAMPAIGN, encounterFor } = await import('../src/game');
    const e = makeEngine(encounterFor(ARCHER_HUNT_CAMPAIGN, 'hunt_08_two_prey', 'archer'), CONTENT, 3) as Engine;
    const [uid] = setHand(e, ['smoke_arrow']);
    const target = e.getValidTargets(uid!)[0]!;
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target }).ok).toBe(true);
    expect(e.state.board.tiles.some((t) => t.terrain === 'SMOKE')).toBe(true);
  });

  it('replay / reconnect: a battle with smoke replays to the identical state', () => {
    const content = withHeroDeck(CONTENT, 'archer', [{ cardId: 'smoke_arrow', count: 15 }, { cardId: 'archer_shot', count: 15 }]);
    const sc = scenario({ hero: { heroId: 'archer', pos: p(0, 2) }, layout: EMPTY_7x5, enemies: [ORC('o1', 4, 2), ORC('o2', 6, 1)] });
    const e = makeEngine(sc, content, 9);
    for (let turn = 0; turn < 4 && !e.state.outcome; turn++) {
      for (const card of [...e.state.player.hand]) {
        const targets = e.getValidTargets(card.uid);
        if (targets.length && e.getCardPlayability(card.uid).playable) e.dispatch({ type: 'PLAY_CARD', cardUid: card.uid, target: targets.at(-1)! });
      }
      if (!e.state.outcome) e.dispatch(endTurn(e));
    }
    const replay = replayBattle(sc, content, 9, e.history);
    expect(replay.rejectedAt).toBeNull();
    expect(JSON.stringify(replay.state)).toBe(JSON.stringify(e.state as GameState));
  });
});
