import { describe, expect, it } from 'vitest';
import { recoveryChoices, recoverToHand } from '../src/game/domain/cards/recovery';
import { drawCards } from '../src/game/domain/cards/deck';
import { ctxFor, makeEngine, mutable, setHand } from './helpers';

describe('Explicit grave recovery, once per concrete instance', () => {
  it('Gracia recovers the chosen UID, costs two and rejects a repeated request atomically', () => {
    const e = makeEngine();
    const s = mutable(e);
    s.player.energy = 5;
    s.player.discard = [{ uid: 'first', cardId: 'fireball', publicDiscard: true }, { uid: 'second', cardId: 'fireball' }];
    const [cardUid] = setHand(e, ['light_grace_call']);
    expect(e.dispatch({ type: 'SEARCH_SUMMON', cardUid: cardUid!, choiceUid: 'first' }).ok).toBe(true);
    expect(e.state.player.energy).toBe(3);
    expect(e.state.player.hand.find(c => c.uid === 'first')).toEqual({ uid: 'first', cardId: 'fireball', recoveredThisBattle: true });
    expect(e.state.player.discard.some(c => c.uid === 'second')).toBe(true);
    const before = JSON.stringify(e.state);
    expect(e.dispatch({ type: 'SEARCH_SUMMON', cardUid: cardUid!, choiceUid: 'first' }).ok).toBe(false);
    expect(JSON.stringify(e.state)).toBe(before);
  });
  it('same definition has independent eligibility; previously recovered copy cannot be selected again', () => {
    const e = makeEngine(); const s = mutable(e);
    s.player.discard = [{ uid: 'used', cardId: 'fireball', recoveredThisBattle: true }, { uid: 'fresh', cardId: 'fireball' }];
    expect(recoveryChoices(s, e.content).map(c => c.uid)).toEqual(['fresh']);
    const before = JSON.stringify(s);
    expect(recoverToHand(ctxFor(e), 'used', 'ANY_ONCE')).toBeUndefined();
    expect(JSON.stringify(s)).toBe(before);
  });
  it('rejects forged UID and duplicate zone occupancy without mutation', () => {
    const e = makeEngine(); const s = mutable(e);
    s.player.discard = [{ uid: 'duplicate', cardId: 'fireball' }];
    s.player.hand = [{ uid: 'duplicate', cardId: 'fireball' }];
    const before = JSON.stringify(s);
    expect(recoverToHand(ctxFor(e), 'duplicate', 'ANY_ONCE')).toBeUndefined();
    expect(recoverToHand(ctxFor(e), 'foreign', 'ANY_ONCE')).toBeUndefined();
    expect(JSON.stringify(s)).toBe(before);
  });
  it('Story recycling preserves consumed recovery and does not consume a fresh copy', () => {
    const e = makeEngine(); const s = mutable(e);
    s.player.deck = []; s.player.hand = [];
    s.player.discard = [{ uid: 'old', cardId: 'fireball', recoveredThisBattle: true }, { uid: 'new', cardId: 'fireball' }];
    expect(drawCards(ctxFor(e), 2)).toBe(2);
    expect(s.player.hand.find(c => c.uid === 'old')?.recoveredThisBattle).toBe(true);
    expect(s.player.hand.find(c => c.uid === 'new')?.recoveredThisBattle).toBeUndefined();
    expect(JSON.parse(JSON.stringify(s)).player.hand).toEqual(s.player.hand);
  });
  it('invalid Gracia selection does not pay, discard or emit an accepted activation', () => {
    const e = makeEngine(); const s = mutable(e); s.player.energy = 5;
    s.player.discard = [{ uid: 'eligible', cardId: 'fireball' }];
    const [cardUid] = setHand(e, ['light_grace_call']);
    const before = JSON.stringify(e.state);
    expect(e.dispatch({ type: 'SEARCH_SUMMON', cardUid: cardUid!, choiceUid: 'forged' }).ok).toBe(false);
    expect(JSON.stringify(e.state)).toBe(before);
  });
  it('Eco keeps its ritual restriction and consumes the same global recovery allowance', () => {
    const e = makeEngine({ hero: { heroId: 'summoner', pos: { x: 0, y: 2 } } });
    const s = mutable(e); s.player.energy = 5;
    s.player.discard = [{ uid: 'piece', cardId: 'mark_moon' }, { uid: 'spell', cardId: 'fireball' }];
    const [cardUid] = setHand(e, ['altar_echo']);
    expect(e.dispatch({ type: 'SEARCH_SUMMON', cardUid: cardUid!, choiceUid: 'piece' }).ok).toBe(true);
    expect(e.state.player.hand.find(c => c.uid === 'piece')).toMatchObject({ recoveredThisBattle: true, unavailableThisTurn: true });
  });
});


describe('Hand redraw is not grave recovery', () => {
  it('preserves per-copy recovery and returns exactly the other hand cards before drawing', () => {
    const e = makeEngine(); const s = mutable(e); s.player.energy = 5; s.player.deck = [];
    const [uid] = setHand(e, ['light_destiny_rebirth', 'fireball', 'fireball']);
    s.player.hand[1]!.recoveredThisBattle = true;
    const oldUids = s.player.hand.slice(1).map(card => card.uid).sort();
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(true);
    expect(e.state.player.hand.map(card => card.uid).sort()).toEqual(oldUids);
    expect(e.state.player.hand.filter(card => card.recoveredThisBattle)).toHaveLength(1);
    expect(e.state.player.discard).toHaveLength(1);
  });
});

describe('Random recovery', () => {
  it('returns at most three distinct eligible instances and keeps their flags through serialization', () => {
    const e = makeEngine(); const s = mutable(e); s.player.energy = 5;
    s.player.deck = [];
    s.player.discard = ['a', 'b', 'c', 'd'].map(uid => ({ uid, cardId: 'fireball' }));
    s.player.discard.push({ uid: 'used', cardId: 'fireball', recoveredThisBattle: true });
    const [uid] = setHand(e, ['light_second_chance']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(true);
    expect(e.state.player.deck).toHaveLength(3);
    expect(new Set(e.state.player.deck.map(c => c.uid)).size).toBe(3);
    expect(e.state.player.deck.every(c => c.recoveredThisBattle)).toBe(true);
    expect(e.state.player.discard.some(c => c.uid === 'used')).toBe(true);
    expect(JSON.parse(JSON.stringify(e.state)).player.deck).toEqual(e.state.player.deck);
  });
});
