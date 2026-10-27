import { describe, it, expect } from 'vitest';
import { DEFAULT_CONTENT, GameEngine, createProfile, withHeroDeck } from '../src/game';
import {
  SHAPESHIFTER_QA_DECKS,
  SHAPESHIFTER_QA_SCENARIO,
  withShapeshifterQa,
} from '../src/game/data/shapeshifter-qa';
import { SHAPESHIFTER_2D_DECKS } from '../src/game/data/shapeshifter-2d-qa';
import {
  QA_CONTENT,
  createQaEngine,
  startQaBattle,
  serializeQa,
  restoreQa,
  saveQaDeck,
} from '../src/presentation/qa/shapeshifter/session';
const deck = SHAPESHIFTER_2D_DECKS.balanced8;
const transform = (id: string) => id === 'qa_bear_form' || id === 'qa_minotaur_form';
describe('Phase 2D isolated lab rules', () => {
  it('adds 4/4 replacing one claw and one sweep, preserving 30 cards and ownership', () => {
    expect(deck.reduce((n, c) => n + c.count, 0)).toBe(30);
    expect(deck.find((c) => c.cardId === 'qa_bear_form')!.count).toBe(4);
    expect(deck.find((c) => c.cardId === 'qa_minotaur_form')!.count).toBe(4);
    expect(deck.find((c) => c.cardId === 'qa_bear_claw')!.count).toBe(2);
    expect(deck.find((c) => c.cardId === 'qa_axe_sweep')!.count).toBe(2);
    expect(() => saveQaDeck(createProfile(QA_CONTENT), deck)).not.toThrow();
    expect(SHAPESHIFTER_QA_DECKS.balanced[0]!.count).toBe(3);
  });
  it('normal opening is exactly the seeded engine; guarantee only swaps if absent, no RNG or UID change', () => {
    let swapped = 0,
      untouched = 0;
    for (const seed of [1, 101, 1009, 10007, 104729, 0x5eed1234, 42]) {
      const normal = createQaEngine(QA_CONTENT, deck, seed, 'normal');
      const original = new GameEngine(
        SHAPESHIFTER_QA_SCENARIO,
        withHeroDeck(QA_CONTENT, 'shapeshifter', deck),
        seed,
      );
      const guaranteed = startQaBattle(createProfile(QA_CONTENT), deck, seed, 'guaranteed');
      expect(normal.state).toEqual(original.state);
      expect(guaranteed.seed).toBe(seed);
      expect(guaranteed.state.rngState).toBe(normal.state.rngState);
      expect(guaranteed.state.player.hand).toHaveLength(5);
      expect(guaranteed.state.player.hand.some((c) => transform(c.cardId))).toBe(true);
      const cards = (e: GameEngine) =>
        [...e.state.player.hand, ...e.state.player.deck].map((c) => c.uid + ':' + c.cardId).sort();
      expect(cards(guaranteed)).toEqual(cards(normal));
      if (normal.state.player.hand.some((c) => transform(c.cardId))) {
        expect(guaranteed.state).toEqual(normal.state);
        untouched++;
      } else {
        expect(guaranteed.state.player.hand.slice(0, 4)).toEqual(
          normal.state.player.hand.slice(0, 4),
        );
        swapped++;
      }
      expect(startQaBattle(createProfile(QA_CONTENT), deck, seed, 'guaranteed').state).toEqual(
        guaranteed.state,
      );
    }
    expect(swapped).toBeGreaterThan(0);
    expect(untouched).toBeGreaterThan(0);
  });
  it.each(['normal', 'guaranteed'] as const)(
    'serializes %s policy and original seed across repeated reloads',
    (opening) => {
      const p = createProfile(QA_CONTENT),
        e = startQaBattle(p, deck, 1, opening);
      if (opening === 'guaranteed') {
        const c = e.state.player.hand.find((c) => transform(c.cardId))!;
        expect(e.dispatch({ type: 'PLAY_CARD', cardUid: c.uid, target: null }).ok).toBe(true);
      }
      const saved = serializeQa(p, e),
        r = restoreQa(saved).engine!;
      expect(r.seed).toBe(1);
      expect(r.state).toEqual(e.state);
      expect(restoreQa(serializeQa(p, r)).engine!.state).toEqual(e.state);
      const invalid = JSON.parse(saved);
      invalid.battle.opening = 'seed-search';
      expect(() => restoreQa(JSON.stringify(invalid))).toThrow();
    },
  );
  it('preserves v1 rules for old saves even after saving again', () => {
    const content = withShapeshifterQa(DEFAULT_CONTENT),
      p = createProfile(content);
    const old = new GameEngine(SHAPESHIFTER_QA_SCENARIO, content, 101);
    const data = JSON.parse(serializeQa(p, old));
    data.version = 1;
    const r = restoreQa(JSON.stringify(data)).engine!;
    expect(r.state).toEqual(old.state);
    expect(r.content.cards.qa_hunter_step!.cost).toBe(1);
    expect(restoreQa(serializeQa(p, r)).engine!.state).toEqual(old.state);
  });
  it('composes actual charge + one movement and leaves other champions and roar untouched', () => {
    const e = startQaBattle(createProfile(QA_CONTENT), deck, 42, 'normal');
    const state = structuredClone(e.state),
      h = state.units.find((u) => u.id === state.player.heroId)!;
    h.activeForm = 'minotaur';
    h.armor = 1;
    h.pos = { x: 2, y: 2 };
    state.player.movePoints = 0;
    state.player.hand = [{ uid: 'charge-test', cardId: 'qa_brutal_charge' }];
    const fixture = GameEngine.fromSnapshot(state, e.content, e.scenario);
    expect(
      fixture.dispatch({ type: 'PLAY_CARD', cardUid: 'charge-test', target: { x: 5, y: 2 } }).ok,
    ).toBe(true);
    expect(fixture.state.player.movePoints).toBe(1);
    expect(QA_CONTENT.cards.qa_hunter_step!.cost).toBe(0);
    const baseline = withShapeshifterQa(DEFAULT_CONTENT);
    expect(baseline.cards.qa_hunter_step!.cost).toBe(1);
    expect(QA_CONTENT.cards.qa_protective_roar).toEqual(baseline.cards.qa_protective_roar);
    for (const id of Object.keys(DEFAULT_CONTENT.cards))
      expect(QA_CONTENT.cards[id]).toEqual(DEFAULT_CONTENT.cards[id]);
    for (const id of Object.keys(DEFAULT_CONTENT.heroes))
      expect(QA_CONTENT.heroes[id]).toEqual(DEFAULT_CONTENT.heroes[id]);
  });
});
