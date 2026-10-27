import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, GameEngine, replayBattle } from '../src/game';
import { drawCards } from '../src/game/domain/cards/deck';
import type { GameEvent } from '../src/game';
import { ctxFor, makeEngine, mutable, ofType, p, scenario, setHand } from './helpers';

const recycle = (e: GameEngine, events: GameEvent[] = []) => {
  const s = mutable(e);
  s.player.discard.push(...s.player.hand, ...s.player.deck);
  s.player.hand = [];
  s.player.deck = [];
  return drawCards(ctxFor(e, events), 1);
};

describe('Arcane fatigue in shared battle core', () => {
  it.each(['mage', 'summoner'])(
    '%s first recycle free, then 1, 2, 3, conserving cards and seeded order',
    (heroId) => {
      const a = makeEngine({ hero: { heroId, pos: p(0, 2) } }, DEFAULT_CONTENT, 123);
      const b = makeEngine({ hero: { heroId, pos: p(0, 2) } }, DEFAULT_CONTENT, 123);
      const startHp = a.state.units[0]!.hp;
      const events: GameEvent[] = [];
      for (let i = 0; i < 4; i++) {
        expect(recycle(a, events)).toBe(1);
        recycle(b);
        expect(a.state).toEqual(b.state);
        const cards = [...a.state.player.deck, ...a.state.player.hand, ...a.state.player.discard];
        expect(cards).toHaveLength(30);
        expect(new Set(cards.map((c) => c.uid)).size).toBe(30);
      }
      expect(a.state.player.deckRecycles).toBe(4);
      expect(a.state.units[0]!.hp).toBe(startHp - 6);
      expect(ofType(events, 'ARCANE_FATIGUE').map((e) => e.amount)).toEqual([1, 2, 3]);
    },
  );

  it('draws across boundary, does not recycle early, keeps held cards out of shuffle', () => {
    const e = makeEngine();
    const s = mutable(e);
    const held = s.player.hand.map((c) => c.uid);
    s.player.discard = s.player.deck.splice(1);
    const events: GameEvent[] = [];
    drawCards(ctxFor(e, events), 1);
    expect(s.player.deckRecycles).toBe(0);
    drawCards(ctxFor(e, events), 2);
    expect(s.player.deckRecycles).toBe(1);
    expect(ofType(events, 'DECK_RESHUFFLED')).toHaveLength(1);
    expect(s.player.hand.slice(0, held.length).map((c) => c.uid)).toEqual(held);
    expect(s.player.deck.some((c) => held.includes(c.uid))).toBe(false);
  });

  it('both piles empty is a no-op; full hand burns rather than granting infinite draws', () => {
    const e = makeEngine();
    const s = mutable(e);
    s.player.deck = [];
    s.player.discard = [];
    expect(drawCards(ctxFor(e), 5)).toBe(0);
    expect(s.player.deckRecycles).toBe(0);
    expect(s.outcome).toBeNull();
    s.player.maxHandSize = s.player.hand.length;
    s.player.discard = [{ uid: 'last', cardId: 'barrier' }];
    const hp = s.units[0]!.hp;
    expect(drawCards(ctxFor(e), 3)).toBe(0);
    expect(s.player.deckRecycles).toBe(3);
    expect(s.units[0]!.hp).toBe(hp - 3);
    expect(s.player.discard).toEqual([{ uid: 'last', cardId: 'barrier' }]);
  });

  it('uses ordinary armor/shield mitigation, and stops drawing when fatigue kills hero', () => {
    const e = makeEngine();
    const s = mutable(e);
    const hero = s.units[0]!;
    hero.armor = 1;
    hero.shield = 1;
    s.player.deckRecycles = 2;
    recycle(e);
    expect(hero.hp).toBe(hero.maxHp);
    expect(hero.shield).toBe(0);
    hero.armor = 0;
    hero.hp = 1;
    const events: GameEvent[] = [];
    expect(recycle(e, events)).toBe(0);
    expect(s.units.some((u) => u.id === e.heroId)).toBe(false);
    expect(ofType(events, 'CARD_DRAWN')).toHaveLength(0);
  });

  it('a draw spell can lose to fatigue; it cannot draw or resolve later effects after caster death', () => {
    const content = {
      ...DEFAULT_CONTENT,
      cards: {
        ...DEFAULT_CONTENT.cards,
        arcane_surge: {
          ...DEFAULT_CONTENT.cards.arcane_surge!,
          effects: [
            { type: 'DRAW', count: 2 } as const,
            { type: 'GAIN_ENERGY', amount: 10 } as const,
          ],
        },
      },
    };
    const e = makeEngine({}, content);
    const s = mutable(e);
    s.units[0]!.hp = 1;
    s.player.deck = [];
    s.player.discard = [{ uid: 'remaining', cardId: 'barrier' }];
    s.player.deckRecycles = 1;
    const [uid] = setHand(e, ['arcane_surge']);
    const energy = s.player.energy;
    const result = e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null });
    expect(result.ok).toBe(true);
    expect(e.state.outcome?.reason).toBe('HERO_DEFEATED');
    expect(e.state.player.energy).toBe(energy - 1);
    expect(ofType(result.events, 'CARD_DRAWN')).toHaveLength(0);
  });

  it('interactive commands and headless server replay match through lethal fatigue', () => {
    const content = { ...DEFAULT_CONTENT, heroes: { ...DEFAULT_CONTENT.heroes } };
    content.heroes.mage = {
      ...content.heroes.mage!,
      startingHandSize: 1,
      maxHandSize: 1,
      deck: [{ cardId: 'barrier', count: 2 }],
    };
    const encounter = scenario({
      enemies: [],
      objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 100 }],
    });
    const e = new GameEngine(encounter, content, 19);
    const commands = [];
    // Full-hand burn gives a naturally reachable repeated recycle; no state injection.
    while (!e.state.outcome && commands.length < 50) {
      const command = { type: 'END_TURN' } as const;
      commands.push(command);
      expect(e.dispatch(command).ok).toBe(true);
    }
    const replay = replayBattle(encounter, content, 19, commands);
    expect(replay.rejectedAt).toBeNull();
    expect(replay.state).toEqual(e.state);
    expect(e.state.outcome?.reason).toBe('HERO_DEFEATED');
    expect(e.dispatch({ type: 'END_TURN' }).ok).toBe(false);
    expect(new GameEngine(encounter, content, 19).state.player.deckRecycles).toBe(0);
  });
});
