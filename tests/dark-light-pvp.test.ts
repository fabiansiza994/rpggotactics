import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game/data';
import { createProfile } from '../src/game/collection/profile';
import { createDuel, validateLoadout, applyDuel, duelView } from '../src/game/pvp/duel';
import { nextRandom } from '../src/game/domain/core/rng';
import type { GameState } from '../src/game/domain/state';
function battle() {
  const profile = createProfile(DEFAULT_CONTENT), loadout = validateLoadout(profile, 'mage');
  return createDuel([loadout, loadout], 47);
}
function seedFor(predicate: (draw: number) => boolean) {
  for (let seed = 0; seed < 10000; seed++) if (predicate(nextRandom({ rngState: seed }))) return seed;
  throw Error('no deterministic draw');
}
function roulette(state: GameState) {
  state.player.energy = 20;
  state.player.hand = [{ uid: 'roulette', cardId: 'dark_executioner_call' }];
  return applyDuel(state, { type: 'PLAY_CARD', cardUid: 'roulette', target: null });
}
describe('Two-seat engine projection (not an authenticated WebSocket smoke)', () => {
  it('hides a curse even from the owner of the cursed hand and strips private choice copies', () => {
    const s = battle(); s.player.hand[0]!.twistedCurse = true;
    s.player.pendingCardChoice = { kind: 'BOTTOM_TOP_CARD', sourceCardId: 'light_celestial_clarity', allowKeep: true, options: [{ uid: 'secret', card: { uid: 'secret', cardId: 'fireball', twistedCurse: true } }] };
    for (const seat of [0, 1] as const) expect(JSON.stringify(duelView(s, seat))).not.toContain('twistedCurse');
    expect(s.player.hand[0]!.twistedCurse).toBe(true);
  });
  it('a curse is assigned to exactly one actual enemy deck instance without disclosing it', () => {
    const s = battle(); s.player.energy = 20;
    s.player.hand = [{ uid: 'curse', cardId: 'dark_twisted_curse' }];
    const before = s.duel!.other.deck.map(card => card.uid);
    const result = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'curse', target: null });
    expect(result.state.duel!.other.deck.filter(card => card.twistedCurse)).toHaveLength(1);
    expect(result.state.duel!.other.deck.map(card => card.uid)).toEqual(before);
    for (const seat of [0, 1] as const) expect(JSON.stringify(duelView(result.state, seat))).not.toContain('twistedCurse');
  });
  it('simultaneous five-HP loss resolves a draw once, visible equally to both seats', () => {
    const s = battle(); s.rngState = seedFor(draw => draw > 0.9);
    for (const hero of s.units.filter(unit => unit.kind === 'HERO')) { hero.hp = 4; hero.shield = 10; hero.armor = 10; }
    const result = roulette(s);
    expect(result.state.outcome?.result).toBe('DRAW');
    expect(result.state.duel?.winner).toBe(-1);
    expect(result.events.filter(event => event.type === 'BATTLE_DRAW')).toHaveLength(1);
    for (const seat of [0, 1] as const) expect(duelView(result.state, seat).outcome?.result).toBe('DRAW');
  });
  it('own Dark World changes only the roulette thresholds, preserving five HP per result', () => {
    const s = battle(); s.rngState = seedFor(draw => draw > 0.21 && draw < 0.3);
    const normal = roulette(structuredClone(s));
    expect(normal.events.find(event => event.type === 'EXECUTIONER_RESULT')).toMatchObject({ result: 'SELF' });
    const owner = s.units.find(unit => unit.id === s.player.heroId)!;
    owner.statuses.push({ id: 'DARK_WORLD', turnsLeft: 6 });
    const upgraded = roulette(s);
    expect(upgraded.events.find(event => event.type === 'EXECUTIONER_RESULT')).toMatchObject({ result: 'ENEMY' });
    expect(upgraded.events.filter(event => event.type === 'UNIT_DAMAGED').map(event => event.hpLost)).toEqual([5]);
  });
  it('Tribute validates and resolves its chosen discard and two enemy discards atomically', () => {
    const s = battle(); s.player.energy = 5;
    s.player.hand = [{ uid: 'tribute', cardId: 'dark_despair_tribute' }, { uid: 'cost', cardId: 'fireball' }];
    const rivalHand = s.duel!.other.hand.length;
    const result = applyDuel(s, { type: 'SEARCH_SUMMON', cardUid: 'tribute', choiceUid: 'cost' });
    expect(result.state.player.energy).toBe(2);
    expect(result.state.player.hand).toEqual([]);
    expect(result.state.player.discard.map(card => card.uid)).toContain('cost');
    expect(result.state.duel!.other.hand).toHaveLength(rivalHand - 2);
  });
});
