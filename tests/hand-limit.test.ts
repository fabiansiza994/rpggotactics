import { describe, expect, it } from 'vitest';
import {
  createProfile,
  DEFAULT_CONTENT,
  fallbackDiscardUid,
  GameEngine,
  HAND_RULES,
  suggestHandDiscard,
  withHeroDeck,
  type GameState,
} from '../src/game';
import { drawCards } from '../src/game/domain/cards/deck';
import { replayBattle } from '../src/game/engine/replay';
import type { Command } from '../src/game/engine/commands';
import { parseCommand } from '../src/game/run/verify';
import { applyDuel, createDuel, duelEvents, duelView, validateLoadout } from '../src/game/pvp/duel';
import { validCommand } from '../server/src/pvp';
import { ctxFor, makeEngine, mutable, ofType, p, scenario, setHand } from './helpers';

const HEROES = ['mage', 'summoner', 'warrior'] as const;
const battle = (heroId: string) => makeEngine({ hero: { heroId, pos: p(0, 2) } });
/** End the first turn without playing: the next turn starts at 5 and draws to 6. */
const toSix = (engine: GameEngine) => {
  expect(engine.state.player.hand).toHaveLength(5);
  expect(engine.dispatch({ type: 'END_TURN' }).ok).toBe(true);
  expect(engine.state.player.hand).toHaveLength(6);
};

describe('hand rule: 5 kept, 6 during the turn (every champion)', () => {
  it('HAND_RULES is 5 / 6 and every champion uses it', () => {
    expect(HAND_RULES).toEqual({ handSize: 5, turnHandCap: 6 });
    for (const h of HEROES)
      expect(DEFAULT_CONTENT.heroes[h]).toMatchObject({ startingHandSize: 5, handSize: 5, maxHandSize: 6, drawPerTurn: 1 });
  });

  for (const heroId of HEROES)
    it(`${heroId}: opening hand 5, turn draw 5 → 6`, () => {
      const engine = battle(heroId);
      expect(engine.state.player).toMatchObject({ handSize: 5, maxHandSize: 6 });
      toSix(engine);
    });

  it('the Summoner no longer has a 4-card cap: it holds 6 during its turn like everyone', () => {
    const engine = battle('summoner');
    toSix(engine);
    expect(engine.state.player.maxHandSize).toBe(6);
  });

  it('draw economy unchanged: 4 → 5, 3 → 4 (no refill to 5)', () => {
    for (const n of [4, 3]) {
      const engine = battle('mage');
      setHand(engine, Array(n).fill('blink'));
      engine.dispatch({ type: 'END_TURN' });
      expect(engine.state.player.hand).toHaveLength(n + 1);
    }
  });
});

describe('end-of-turn discard', () => {
  it('END_TURN with 6 is refused until one card is chosen; nothing happens meanwhile', () => {
    const engine = battle('mage');
    toSix(engine);
    const before = structuredClone(engine.state);
    expect(engine.dispatch({ type: 'END_TURN' })).toMatchObject({ ok: false, error: 'DISCARD_REQUIRED' });
    expect(engine.state).toEqual(before);
  });

  it('the chosen card goes to the discard pile and the turn ends with 5 kept', () => {
    const engine = battle('mage');
    toSix(engine);
    const chosen = engine.state.player.hand[2]!;
    const discard = engine.state.player.discard.length;
    const r = engine.dispatch({ type: 'END_TURN', discardUid: chosen.uid });
    expect(r.ok).toBe(true);
    expect(ofType(r.ok ? r.events : [], 'CARD_DISCARDED')[0]).toMatchObject({ cardUid: chosen.uid, reason: 'HAND_LIMIT' });
    expect(engine.state.player.discard.map((c) => c.uid)).toContain(chosen.uid);
    expect(engine.state.player.discard.length).toBe(discard + 1);
    // Next turn: 5 kept + the turn draw.
    expect(engine.state.player.hand).toHaveLength(6);
    expect(engine.state.player.hand.some((c) => c.uid === chosen.uid)).toBe(false);
  });

  it('ending with 5 or fewer needs no discard, and a discard is then refused', () => {
    const engine = battle('warrior');
    expect(engine.dispatch({ type: 'END_TURN', discardUid: engine.state.player.hand[0]!.uid })).toMatchObject({
      ok: false,
      error: 'DISCARD_NOT_ALLOWED',
    });
    expect(engine.dispatch({ type: 'END_TURN' }).ok).toBe(true);
  });

  it('a card that is not in the hand is refused (no arbitrary discard)', () => {
    const engine = battle('mage');
    toSix(engine);
    const deckCard = engine.state.player.deck[0]!.uid;
    expect(engine.dispatch({ type: 'END_TURN', discardUid: deckCard })).toMatchObject({ ok: false, error: 'CARD_NOT_IN_HAND' });
    expect(engine.dispatch({ type: 'END_TURN', discardUid: 'nope' })).toMatchObject({ ok: false, error: 'CARD_NOT_IN_HAND' });
  });

  it('playing a card first (6 → 5) ends the turn normally', () => {
    const engine = battle('mage');
    toSix(engine);
    const [blink] = setHand(engine, ['blink', 'blink', 'blink', 'blink', 'blink', 'blink']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: blink!, target: p(1, 2) }).ok).toBe(true);
    expect(engine.dispatch({ type: 'END_TURN' }).ok).toBe(true);
  });

  it('rituals: pieces stay in hand, sealing lowers the count, a piece may be the discarded card', () => {
    const deck = [
      { cardId: 'summon_chicken', count: 10 },
      { cardId: 'nurture', count: 10 },
      { cardId: 'summoner_blink', count: 10 },
    ];
    const engine = new GameEngine(scenario({ hero: { heroId: 'summoner', pos: p(0, 2) } }), withHeroDeck(DEFAULT_CONTENT, 'summoner', deck), 7);
    toSix(engine);
    const piece = Object.values(DEFAULT_CONTENT.cards).find((c) => c.ritualPiece && c.heroId === 'summoner')!;
    const uids = setHand(engine, [piece.id, piece.id, 'nurture', 'nurture', 'nurture', 'nurture']);
    expect(engine.dispatch({ type: 'COMMIT_RITUAL_PIECE', cardUid: uids[0]! }).ok).toBe(true);
    expect(engine.state.player.hand).toHaveLength(5);
    expect(engine.dispatch({ type: 'END_TURN' }).ok).toBe(true); // 5 after sealing: no discard
    // Next turn at 6 with a piece in hand: discarding the piece is legal (it is a hand card).
    const held = engine.state.player.hand.find((c) => c.cardId === piece.id)!;
    expect(engine.state.player.hand).toHaveLength(6);
    expect(engine.dispatch({ type: 'END_TURN', discardUid: held.uid }).ok).toBe(true);
    expect(engine.state.player.altar!.map((c) => c.cardId)).toEqual([piece.id]);
  });
});

describe('overdraw never makes 7', () => {
  it('a draw at 6 goes straight to the discard pile (existing HAND_FULL rule)', () => {
    const engine = battle('mage');
    toSix(engine);
    const events: Parameters<typeof ctxFor>[1] = [];
    drawCards(ctxFor(engine, events), 3);
    expect(engine.state.player.hand).toHaveLength(6);
    expect(ofType(events, 'CARD_DISCARDED').map((e) => e.reason)).toEqual(['HAND_FULL', 'HAND_FULL', 'HAND_FULL']);
  });

  it('every DRAW card respects the cap (Arcane Surge, Retorno ritual) for every champion', () => {
    const drawers = Object.values(DEFAULT_CONTENT.cards).filter((c) => c.effects.some((e) => e.type === 'DRAW'));
    expect(drawers.length).toBeGreaterThan(0);
    for (const card of drawers) {
      const engine = battle(card.heroId ?? 'mage');
      toSix(engine);
      mutable(engine).player.energy = 9;
      const [uid] = setHand(engine, Array(6).fill(card.id));
      const target = card.targeting.type === 'SELF' ? null : (engine.getValidTargets(uid!)[0] ?? null);
      engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target });
      expect(engine.state.player.hand.length).toBeLessThanOrEqual(6);
    }
  });
});

describe('replay, PvP authority and fallback', () => {
  it('replay reproduces draw → 6 → chosen discard → end turn (live ×2 + headless)', () => {
    const sc = scenario({ hero: { heroId: 'warrior', pos: p(0, 2) } });
    const run = (fixed?: readonly Command[]) => {
      const engine = new GameEngine(sc, DEFAULT_CONTENT, 13);
      const cmds: Command[] = [];
      const send = (c: Command) => {
        expect(engine.dispatch(c).ok).toBe(true);
        cmds.push(c);
      };
      if (fixed) fixed.forEach(send);
      else
        for (let t = 0; t < 4; t++) {
          const hand = engine.state.player.hand;
          send(hand.length > 5 ? { type: 'END_TURN', discardUid: hand[t % hand.length]!.uid } : { type: 'END_TURN' });
        }
      return { state: engine.state, cmds };
    };
    const a = run();
    expect(a.cmds.filter((c) => c.type === 'END_TURN' && c.discardUid)).not.toHaveLength(0);
    expect(run(a.cmds).state).toEqual(a.state);
    const headless = replayBattle(sc, DEFAULT_CONTENT, 13, a.cmds);
    expect(headless.rejectedAt).toBeNull();
    expect(headless.state).toEqual(a.state);
  });

  it('wire parsers keep the discard (campaign verify + PvP server); junk is refused', () => {
    expect(parseCommand({ type: 'END_TURN', discardUid: 'card-3' })).toEqual({ type: 'END_TURN', discardUid: 'card-3' });
    expect(parseCommand({ type: 'END_TURN', discardUid: 7 })).toEqual({ type: 'END_TURN' });
    expect(validCommand({ type: 'END_TURN', discardUid: 'card-3' })).toBe(true);
    expect(validCommand({ type: 'END_TURN', discardUid: 7 })).toBe(false);
    expect(validCommand({ type: 'END_TURN', discardUid: 'x'.repeat(200) })).toBe(false);
  });

  const duelAtSix = () => {
    const profile = createProfile(DEFAULT_CONTENT);
    let s = createDuel([validateLoadout(profile, 'summoner'), validateLoadout(profile, 'mage')], 31);
    // Both seats take their first turn (5 cards); the next active seat draws to 6.
    for (let i = 0; i < 2; i++) s = applyDuel(s, { type: 'END_TURN' }).state;
    expect(s.player.hand).toHaveLength(6);
    return s;
  };

  it('PvP: the server enforces it — wrong seat, no choice, foreign card are refused; the choice is applied', () => {
    const s = duelAtSix();
    expect(() => applyDuel(s, { type: 'END_TURN' })).toThrow('DISCARD_REQUIRED');
    // A card from the RIVAL's hand is not in the active hand.
    expect(() => applyDuel(s, { type: 'END_TURN', discardUid: s.duel!.other.hand[0]!.uid })).toThrow('CARD_NOT_IN_HAND');
    const chosen = s.player.hand[1]!.uid;
    const done = applyDuel(s, { type: 'END_TURN', discardUid: chosen });
    const prev = done.state.duel!.other; // the seat that just ended
    expect(prev.hand).toHaveLength(5);
    expect(prev.discard.map((c) => c.uid)).toContain(chosen);
  });

  it('PvP: the rival learns only the count — no discarded card identity, no former hand', () => {
    const s = duelAtSix();
    const mover = s.duel!.active;
    const chosen = s.player.hand[0]!;
    const done = applyDuel(s, { type: 'END_TURN', discardUid: chosen.uid });
    const rivalSeat = (1 - mover) as 0 | 1;
    const events = duelEvents(done.state, rivalSeat, done.events);
    expect(events.some((e) => e.type === 'CARD_DISCARDED')).toBe(false);
    const view = duelView(done.state, rivalSeat);
    expect(JSON.stringify(view)).not.toContain(chosen.uid);
    expect(view.pileCounts.opponentHand).toBe(5);
  });

  it('timeout / disconnect fallback: deterministic last card in hand, recorded as a normal command', () => {
    const s = duelAtSix();
    const uid = fallbackDiscardUid(s)!;
    expect(uid).toBe(s.player.hand.at(-1)!.uid);
    expect(fallbackDiscardUid(structuredClone(s))).toBe(uid);
    const a = applyDuel(s, { type: 'END_TURN', discardUid: uid }).state;
    const b = applyDuel(structuredClone(s), { type: 'END_TURN', discardUid: fallbackDiscardUid(s)! }).state;
    expect(a).toEqual(b);
    expect(fallbackDiscardUid({ ...s, player: { ...s.player, hand: s.player.hand.slice(0, 5) } } as GameState)).toBeNull();
  });

  it('bot heuristic: duplicates, then the most expensive card, never a sealable ritual piece', () => {
    const engine = battle('mage');
    toSix(engine);
    setHand(engine, ['magic_missile', 'fireball', 'blink', 'barrier', 'ice_wall', 'magic_missile']);
    expect(engine.state.player.hand.find((c) => c.uid === suggestHandDiscard(engine.state, engine.content))!.cardId).toBe('magic_missile');
    setHand(engine, ['magic_missile', 'fireball', 'blink', 'barrier', 'phase_step', 'ice_wall']);
    expect(engine.state.player.hand.find((c) => c.uid === suggestHandDiscard(engine.state, engine.content))!.cardId).toBe('ice_wall');
    setHand(engine, ['magic_missile', 'blink']);
    expect(suggestHandDiscard(engine.state, engine.content)).toBeNull();
  });
});
