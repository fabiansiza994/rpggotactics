import { describe, expect, it } from 'vitest';
import { makeEngine, mutable, setHand } from './helpers';
import { validCommand } from '../server/src/pvp';
import { parseCommand } from '../src/game/run/verify';
import { resolveCardChoice } from '../src/game/domain/cards/card-choice';
import { ctxFor } from './helpers';

describe('Authoritative private card choices', () => {
  it('Whisper waits for a real choice, blocks other actions and revalidates after snapshot', () => {
    const e = makeEngine(); const s = mutable(e);
    s.player.deck = [{ uid: 'a', cardId: 'fireball' }, { uid: 'b', cardId: 'fireball' }, { uid: 'c', cardId: 'fireball' }];
    const [uid] = setHand(e, ['dark_crypt_whisper']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(true);
    expect(e.state.player.pendingCardChoice?.options.map(card => card.uid)).toEqual(['a', 'b']);
    const before = JSON.stringify(e.state);
    expect(e.dispatch({ type: 'END_TURN' }).ok).toBe(false);
    expect(JSON.stringify(e.state)).toBe(before);
    const restored = JSON.parse(before), ctx = { ...ctxFor(e), state: restored };
    expect(resolveCardChoice(ctx, 'c').ok).toBe(false);
    expect(resolveCardChoice(ctx, null).ok).toBe(false);
    expect(resolveCardChoice(ctx, 'a').ok).toBe(true);
    expect(restored.player.deck.map((card: { uid: string }) => card.uid)).toEqual(['b', 'c', 'a']);
    const after = JSON.stringify(restored);
    expect(resolveCardChoice(ctx, 'a').ok).toBe(false);
    expect(JSON.stringify(restored)).toBe(after);
  });
  it('Clarity may keep the top card without moving it or consuming recovery', () => {
    const e = makeEngine(); const s = mutable(e);
    s.player.deck = [{ uid: 'top', cardId: 'fireball', recoveredThisBattle: true }];
    const [uid] = setHand(e, ['light_celestial_clarity']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(true);
    expect(e.dispatch({ type: 'RESOLVE_CARD_CHOICE', choiceUid: null }).ok).toBe(true);
    expect(e.state.player.deck[0]).toMatchObject({ uid: 'top', recoveredThisBattle: true });
    expect(e.state.player.pendingCardChoice).toBeUndefined();
  });
  it('normal PvP commands and campaign proof parser accept only well-formed choices', () => {
    const command = { type: 'RESOLVE_CARD_CHOICE', choiceUid: 'a' } as const;
    expect(validCommand(command)).toBe(true);
    expect(parseCommand(command)).toEqual(command);
    expect(validCommand({ type: command.type, choiceUid: {} })).toBe(false);
    expect(parseCommand({ type: command.type, choiceUid: {} })).toBeNull();
  });
});
