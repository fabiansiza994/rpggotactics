import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game/data';
import { withDarkLightRelease } from '../src/game/data/dark-light';
import { createProfile } from '../src/game/collection/profile';
import { createDuel, validateLoadout, applyDuel, duelView } from '../src/game/pvp/duel';
import { validCommand } from '../server/src/pvp';
import { SILENCE_RESPONSE_MS } from '../src/game/domain/cards/silence';
const content = withDarkLightRelease(DEFAULT_CONTENT);
function setup() {
  const profile = createProfile(content), loadout = validateLoadout(profile, 'mage', content);
  const state = createDuel([loadout, loadout], 42, 'DUEL', 'classic', content);
  state.player.energy = 5; state.duel!.other.energy = 5;
  state.player.hand = [{ uid: 'cast', cardId: 'magic_missile' }];
  state.duel!.other.hand = [{ uid: 'seal', cardId: 'dark_silence_seal' }, { uid: 'cost', cardId: 'fireball' }];
  state.units.find(unit => unit.id === state.player.heroId)!.pos = { x: 2, y: 2 };
  state.units.find(unit => unit.id === state.duel!.other.heroId)!.pos = { x: 3, y: 2 };
  return state;
}
function announce(state = setup()) {
  const target = state.units.find(unit => unit.id === state.duel!.other.heroId)!;
  return applyDuel(state, { type: 'PLAY_CARD', cardUid: 'cast', target: target.pos }, content);
}
describe('Silence: a real persisted response window', () => {
  it('reserves energy once, announces without executing damage, blocks unrelated commands', () => {
    const initial = setup(), hp = initial.units.find(unit => unit.id === initial.duel!.other.heroId)!.hp;
    const result = announce(initial), state = result.state;
    expect(SILENCE_RESPONSE_MS).toBe(5000);
    expect(state.pendingCast?.cardUid).toBe('cast');
    expect(state.player.energy).toBe(4);
    expect(result.events.some(event => event.type === 'CARD_PLAYED')).toBe(false);
    expect(result.events.some(event => event.type === 'UNIT_DAMAGED')).toBe(false);
    expect(state.units.find(unit => unit.id === state.duel!.other.heroId)!.hp).toBe(hp);
    const before = JSON.stringify(state);
    expect(() => applyDuel(state, { type: 'END_TURN' }, content)).toThrow('INVALID_TARGET');
    expect(JSON.stringify(state)).toBe(before);
  });
  it('pass resolves the original once without charging it again, including after snapshot restoration', () => {
    const state = announce().state; state.pendingCast!.deadline = 123456;
    const saved = JSON.parse(JSON.stringify(state));
    expect(duelView(saved, 0, content).responseWindow?.deadline).toBe(123456);
    expect(duelView(saved, 1, content).pendingCast).toBeUndefined();
    const result = applyDuel(saved, { type: 'SILENCE_RESPONSE', windowId: saved.pendingCast.id, pass: true }, content);
    expect(result.state.player.energy).toBe(4);
    expect(result.state.pendingCast).toBeUndefined();
    expect(result.events.filter(event => event.type === 'CARD_PLAYED' && event.cardId === 'magic_missile')).toHaveLength(1);
    expect(result.events.filter(event => event.type === 'UNIT_DAMAGED')).toHaveLength(1);
    expect(() => applyDuel(result.state, { type: 'SILENCE_RESPONSE', windowId: saved.pendingCast.id, pass: true }, content)).toThrow('INVALID_TARGET');
  });
  it('a valid Seal pays energy plus a distinct owned discard and suppresses the original effect', () => {
    const state = announce().state, target = state.units.find(unit => unit.id === state.duel!.other.heroId)!, hp = target.hp;
    const result = applyDuel(state, { type: 'SILENCE_RESPONSE', windowId: state.pendingCast!.id, pass: false, sealUid: 'seal', discardUid: 'cost' }, content);
    expect(result.state.duel!.other.energy).toBe(3);
    expect(result.state.duel!.other.hand).toEqual([]);
    expect(result.state.duel!.other.discard.map(card => card.uid)).toEqual(['cost', 'seal']);
    expect(result.state.player.energy).toBe(4);
    expect(result.state.player.discard.some(card => card.uid === 'cast')).toBe(true);
    expect(result.state.units.find(unit => unit.id === target.id)!.hp).toBe(hp);
    expect(result.events.filter(event => event.type === 'CARD_NEGATED')).toHaveLength(1);
    expect(result.events.some(event => event.type === 'CARD_PLAYED' && event.cardId === 'magic_missile')).toBe(false);
    expect(result.state.pendingCast).toBeUndefined();
  });
  it('a forged discard or reusing the Seal itself is rejected without any debit', () => {
    const state = announce().state, before = JSON.stringify(state);
    for (const discardUid of ['foreign', 'seal']) expect(() => applyDuel(state, { type: 'SILENCE_RESPONSE', windowId: state.pendingCast!.id, pass: false, sealUid: 'seal', discardUid }, content)).toThrow('INVALID_TARGET');
    expect(JSON.stringify(state)).toBe(before);
  });
  it('curse has priority and never opens a response window for the canceled card', () => {
    const state = setup(); state.player.hand[0]!.twistedCurse = true;
    const result = announce(state);
    expect(result.state.pendingCast).toBeUndefined();
    expect(result.events.filter(event => event.type === 'CARD_CURSE_TRIGGERED')).toHaveLength(1);
    expect(result.events.some(event => event.type === 'CARD_CAST_PENDING')).toBe(false);
  });
  it('resolves immediately when the defender has no legal response (new approved contract)', () => {
    const state = setup(); state.duel!.other.hand = [];
    expect(announce(state).state.pendingCast).toBeUndefined();
  });
  it('old room snapshots preserve their original immediate resolution', () => {
    const state = setup(); delete state.duel!.darkLightRelease;
    const result = announce(state);
    expect(result.state.pendingCast).toBeUndefined();
    expect(result.events.some(event => event.type === 'CARD_PLAYED')).toBe(true);
  });
  it('validates response command shape without accepting arbitrary payloads', () => {
    expect(validCommand({ type: 'SILENCE_RESPONSE', windowId: 'cast-1', pass: true })).toBe(true);
    expect(validCommand({ type: 'SILENCE_RESPONSE', windowId: 'cast-1', pass: false, sealUid: 's', discardUid: 'd' })).toBe(true);
    expect(validCommand({ type: 'SILENCE_RESPONSE', windowId: 'cast-1', pass: false, sealUid: {} })).toBe(false);
  });
});
