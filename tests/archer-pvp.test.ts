import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withArcher } from '../src/game/data/archer';
import { createProfile } from '../src/game/collection/profile';
import { applyDuel, createDuel, duelView, validateLoadout } from '../src/game/pvp/duel';
import { archerHud } from '../src/game/domain/archer-view';
import type { Command } from '../src/game/engine/commands';
import type { GameState } from '../src/game/domain/state';
import { validCommand } from '../server/src/pvp';
import { endTurn, p } from './helpers';

/**
 * PvP authority: the Archer's rules run inside the same server-side duel engine (`applyDuel`) as
 * every other champion. A client only sends { cardUid, target } / { unitId, to }: Presa,
 * Concentración, Distancia Óptima, focus spending, conditional damage and traps are all decided
 * from the authoritative state.
 */
const CONTENT = withArcher(DEFAULT_CONTENT);
const profile = createProfile(CONTENT);

function archerDuel(): GameState {
  let s = createDuel([validateLoadout(profile, 'archer', CONTENT), validateLoadout(profile, 'mage', CONTENT)], 7, 'DUEL', 'classic', CONTENT);
  if (s.duel!.active !== 0) s = applyDuel(s, endTurn(s), CONTENT).state; // archer (seat 0) to act
  // Arrangement: face to face in one column (the server state is plain data).
  s.units.find((u) => u.id === 'champion-a')!.pos = p(4, 0);
  s.units.find((u) => u.id === 'champion-b')!.pos = p(4, 5);
  return s;
}
const run = (s: GameState, c: Command) => applyDuel(s, c, CONTENT);
const champ = (s: GameState, id: 'champion-a' | 'champion-b') => s.units.find((u) => u.id === id)!;
/** Test arrangement only: the server-side state is plain data. */
function hand(s: GameState, ids: string[]): string[] {
  s.player.hand = ids.map((cardId, i) => ({ uid: `t-${cardId}-${i}`, cardId }));
  return s.player.hand.map((c) => c.uid);
}

describe('Archer PvP authority', () => {
  it('the public registry (production Worker content) refuses the Archer', () => {
    expect(() => validateLoadout(createProfile(DEFAULT_CONTENT), 'archer')).toThrow('UNKNOWN_CHAMPION');
  });

  it('Presa, Concentración and conditional damage resolve server-side and are public to both seats', () => {
    let s = archerDuel();
    expect(champ(s, 'champion-a')).toMatchObject({ defId: 'archer', pos: p(4, 0), focus: { value: 0, max: 3 } });
    const [eye, shot] = hand(s, ['hunters_eye', 'true_shot']);
    s = run(s, { type: 'PLAY_CARD', cardUid: eye!, target: p(4, 5) }).state;
    s = run(s, { type: 'MOVE_UNIT', unitId: 'champion-a', to: p(4, 1) }).state; // distance 4: optimal
    const shotResult = run(s, { type: 'PLAY_CARD', cardUid: shot!, target: p(4, 5) });
    s = shotResult.state;
    expect(champ(s, 'champion-b').hp).toBe(17); // 2 + 1 vs Presa
    expect(champ(s, 'champion-a').focus!.value).toBe(1);
    expect(shotResult.events.some((e) => e.type === 'FOCUS_CHANGED')).toBe(true);

    for (const seat of [0, 1] as const) {
      const view = duelView(s, seat, CONTENT);
      const rival = view.units.find((u) => u.id === 'champion-b')!;
      expect(rival.statuses).toContainEqual({ id: 'PREY', turnsLeft: 1, sourceId: 'champion-a' });
      expect(view.units.find((u) => u.id === 'champion-a')!.focus).toEqual({ value: 1, max: 3 });
      expect(archerHud(view, CONTENT, 'champion-a')!.prey).toMatchObject({ targetId: 'champion-b', distance: 4, inOptimalRange: true });
    }
  });

  it('the client cannot spend Concentración it does not have, even with forged fields', () => {
    const s = archerDuel();
    const [heart] = hand(s, ['heart_shot']);
    s.units.find((u) => u.id === 'champion-a')!.pos = p(4, 1);
    const forged = { type: 'PLAY_CARD', cardUid: heart!, target: p(4, 5), focus: 3, empowered: true } as unknown as Command;
    expect(validCommand(forged)).toBe(true); // shape only: extra fields carry no authority
    expect(() => run(s, forged)).toThrow('NOT_ENOUGH_FOCUS');
    expect(champ(s, 'champion-b').hp).toBe(20);
  });

  it('a pierce needs the focus on the server: the unit behind is only a target with 2', () => {
    const s = archerDuel();
    s.units.find((u) => u.id === 'champion-a')!.pos = p(4, 1);
    // Arrangement: a hostile body between both champions (the duel engine treats it like any unit).
    s.units.push({ ...structuredClone(champ(s, 'champion-b')), id: 'dummy', defId: 'orc_warrior', kind: 'ENEMY', pos: p(4, 3), hp: 8, maxHp: 8, statuses: [] });
    const [arrow] = hand(s, ['piercing_arrow']);
    expect(() => run(s, { type: 'PLAY_CARD', cardUid: arrow!, target: p(4, 5) })).toThrow('INVALID_TARGET');
    champ(s, 'champion-a').focus!.value = 2;
    const after = run(s, { type: 'PLAY_CARD', cardUid: arrow!, target: p(4, 5) }).state;
    expect(after.units.find((u) => u.id === 'dummy')!.hp).toBe(5);
    expect(champ(after, 'champion-b').hp).toBe(17);
    expect(champ(after, 'champion-a').focus!.value).toBe(0);
  });

  it('a visible trap stops the rival champion on its own MOVE_UNIT, roots it and charges only the steps taken', () => {
    let s = archerDuel();
    const [trap] = hand(s, ['bramble_trap']);
    s = run(s, { type: 'PLAY_CARD', cardUid: trap!, target: p(4, 3) }).state;
    for (const seat of [0, 1] as const) expect(duelView(s, seat, CONTENT).traps).toHaveLength(1);
    s = run(s, endTurn(s)).state; // mage's turn
    expect(s.player.heroId).toBe('champion-b');
    const mp = s.player.movePoints;
    s = run(s, { type: 'MOVE_UNIT', unitId: 'champion-b', to: p(4, 3) }).state;
    // Straight walk (4,5)→(4,3) is the only shortest path; the trap is its last tile.
    expect(champ(s, 'champion-b')).toMatchObject({ pos: p(4, 3), hp: 19 });
    expect(champ(s, 'champion-b').statuses.find((x) => x.id === 'ROOTED')?.turnsLeft).toBe(2);
    expect(s.player.movePoints).toBe(mp - 2);
    expect(() => run(s, { type: 'MOVE_UNIT', unitId: 'champion-b', to: p(4, 4) })).toThrow('MOVEMENT_PREVENTED');
    s = run(s, endTurn(s)).state; // archer
    s = run(s, endTurn(s)).state; // mage again: still rooted this turn
    expect(() => run(s, { type: 'MOVE_UNIT', unitId: 'champion-b', to: p(4, 4) })).toThrow('MOVEMENT_PREVENTED');
  });

  it('a trap cuts a longer walk at the trap tile (the rest of the path is not walked)', () => {
    let s = archerDuel();
    const [trap] = hand(s, ['bramble_trap']);
    s = run(s, { type: 'PLAY_CARD', cardUid: trap!, target: p(4, 3) }).state;
    s = run(s, endTurn(s)).state;
    s.player.movePoints = 4;
    s = run(s, { type: 'MOVE_UNIT', unitId: 'champion-b', to: p(4, 2) }).state;
    expect(champ(s, 'champion-b').pos).toEqual(p(4, 3));
    expect(s.player.movePoints).toBe(2);
  });
});
