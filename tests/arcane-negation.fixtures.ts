import {DEFAULT_CONTENT} from '../src/game/data';
import {withDarkLightRelease} from '../src/game/data/dark-light';
import {createProfile} from '../src/game/collection/profile';
import {createDuel, validateLoadout, applyDuel, duelView} from '../src/game/pvp/duel';
export const negationContent = withDarkLightRelease(DEFAULT_CONTENT);
export function negationFixture(cardId = 'magic_missile', cursedSeal = false) {
  const content = negationContent, profile = createProfile(content);
  const hero = ['dark_scorpion_king', 'summon_chicken'].includes(cardId) ? 'summoner' : 'mage';
  const state = createDuel([validateLoadout(profile, hero, content), validateLoadout(profile, 'mage', content)], 42, 'DUEL', 'classic', content);
  state.player.energy = 5; state.player.movePoints = 0; state.duel!.other.energy = 5;
  state.player.hand = [{uid: 'public-cast', cardId}];
  state.duel!.other.hand = [{uid: 'public-seal', cardId: 'dark_silence_seal', ...(cursedSeal ? {twistedCurse: true} : {})}, {uid: 'private-discard', cardId: 'fireball'}];
  const caster = state.units.find(u => u.id === state.player.heroId)!;
  const responder = state.units.find(u => u.id === state.duel!.other.heroId)!;
  caster.pos = {x: 2, y: 2}; responder.pos = {x: 4, y: 2}; caster.hp = caster.maxHp = 18;
  const announced = applyDuel(state, {type: 'PLAY_CARD', cardUid: 'public-cast',
    target: hero === 'summoner' ? {x: 3, y: 2} : responder.pos,
    ...(cardId === 'dark_scorpion_king' ? {sacrificeHp: 9} : {})}, content);
  if (!announced.state.pendingCast) throw Error('Fixture must open the real response window');
  const before = announced.state;
  const resolve = (pass = false) => applyDuel(before, pass
    ? {type: 'SILENCE_RESPONSE', windowId: before.pendingCast!.id, pass: true}
    : {type: 'SILENCE_RESPONSE', windowId: before.pendingCast!.id, pass: false, sealUid: 'public-seal', discardUid: 'private-discard'}, content);
  return {content, initial: state, before, announced, resolve, view: (seat: 0 | 1) => duelView(before, seat, content)};
}
