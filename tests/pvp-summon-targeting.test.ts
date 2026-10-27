import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, GameEngine, createProfile } from '../src/game';
import {
  applyDuel,
  createDuel,
  duelView,
  validateLoadout,
  DUEL_SCENARIO,
} from '../src/game/pvp/duel';
import { resolveMouseTarget } from '../src/presentation/input/aim';

const profile = createProfile(DEFAULT_CONTENT);
describe('PvP summon targeting after authoritative snapshot reload', () => {
  for (const species of ['chicken', 'fox', 'raven', 'wolf', 'turtle']) {
    it(`${species}: spawn, shield, hostile damage and both-seat hydration`, () => {
      let state = createDuel(
        [validateLoadout(profile, 'summoner'), validateLoadout(profile, 'mage')],
        7,
      );
      if (state.player.heroId !== 'champion-a')
        state = applyDuel(state, { type: 'END_TURN' }).state;
      const owner = state.units.find((u) => u.id === state.player.heroId)!;
      const rival = state.units.find((u) => u.id === state.duel!.other.heroId)!;
      owner.pos = { x: 3, y: 2 };
      rival.pos = { x: 5, y: 2 };
      state.player.energy = 10;
      state.player.hand = [
        { uid: 'spawn', cardId: `summon_${species}` },
        { uid: 'heal', cardId: 'nurture' },
        { uid: 'shield', cardId: 'familiar_aegis' },
      ];
      const pos = { x: 4, y: 2 };
      state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'spawn', target: pos }).state;
      const summon = state.units.find((u) => u.kind === 'SUMMON')!;
      expect(summon.summon?.ownerId).toBe(owner.id);
      const ownSnapshot = JSON.parse(JSON.stringify(duelView(state, state.duel!.active)));
      const ownEngine = GameEngine.fromSnapshot(ownSnapshot, DEFAULT_CONTENT, DUEL_SCENARIO);
      expect(ownEngine.getValidTargets('heal')).toContainEqual(pos);
      expect(ownEngine.getValidTargets('shield')).toContainEqual(pos);
      summon.hp -= 2;
      state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'heal', target: pos }).state;
      expect(state.units.find((u) => u.id === summon.id)!.hp).toBe(summon.maxHp);
      state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'shield', target: pos }).state;
      expect(state.units.find((u) => u.id === summon.id)!.shield).toBe(3);
      state = applyDuel(state, { type: 'END_TURN' }).state;
      state.player.hand = [{ uid: 'hit', cardId: 'magic_missile' }];
      state.player.energy = 10;
      for (const seat of [0, 1] as const) {
        const wire = JSON.parse(JSON.stringify(duelView(state, seat)));
        const engine = GameEngine.fromSnapshot(wire, DEFAULT_CONTENT, DUEL_SCENARIO);
        expect(engine.state.units.find((u) => u.id === summon.id)?.summon?.ownerId).toBe(owner.id);
        if (seat === state.duel!.active) {
          expect(engine.getValidTargets('hit')).toContainEqual(pos);
          expect(engine.previewCard('hit', pos).valid).toBe(true);
          expect(
            resolveMouseTarget({ x: 4, y: 1 }, [pos], true, engine.getValidTargets('hit')),
          ).toEqual(pos);
        }
      }
      const before = state.units.find((u) => u.id === summon.id)!;
      const result = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'hit', target: pos });
      const after = result.state.units.find((u) => u.id === summon.id);
      expect((after?.hp ?? 0) + (after?.shield ?? 0)).toBeLessThan(before.hp + before.shield);
      expect(result.state.units.find((u) => u.id === rival.id)).toBeDefined();
      state = applyDuel(result.state, { type: 'END_TURN' }).state;
      const acted = applyDuel(state, { type: 'END_TURN' });
      expect(acted.events.some((e) => e.type === 'SUMMON_ATTACKED' && e.unitId === summon.id)).toBe(
        true,
      );
    });
  }
  it('keeps ground targeting for movement/terrain and rejects illegal bodies', () => {
    const ground = { x: 4, y: 1 },
      body = { x: 4, y: 2 };
    expect(resolveMouseTarget(ground, [body], false, [body])).toEqual(ground);
    expect(resolveMouseTarget(ground, [body], true, [])).toEqual(ground);
    expect(resolveMouseTarget(null, [body], true, [body])).toEqual(body);
  });
});
