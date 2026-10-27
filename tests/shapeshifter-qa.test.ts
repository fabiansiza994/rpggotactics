import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTENT,
  DECK_RULES,
  createProfile,
  validateDeck,
  ownedFor,
  replayBattle,
  type DeckEntry,
} from '../src/game';
import {
  SHAPESHIFTER_QA_CARDS,
  SHAPESHIFTER_QA_DECKS,
  SHAPESHIFTER_QA_SCENARIO,
} from '../src/game/data/shapeshifter-qa';
import {
  QA_CONTENT,
  QA_STORAGE_KEY,
  openingSeed,
  restoreQa,
  saveQaDeck,
  serializeQa,
  startQaBattle,
} from '../src/presentation/qa/shapeshifter/session';

const hero = (engine: ReturnType<typeof startQaBattle>) =>
  engine.state.units.find((u) => u.id === engine.state.player.heroId)!;
function castForm(engine: ReturnType<typeof startQaBattle>, id: string) {
  const c = engine.state.player.hand.find((c) => c.cardId === id)!;
  return engine.dispatch({ type: 'PLAY_CARD', cardUid: c.uid, target: null });
}
describe('Cambiaformas playable private QA', () => {
  it('registers exactly ten private cards, one humanoid hero, existing provisional modifiers and no public exposure', () => {
    expect(SHAPESHIFTER_QA_CARDS).toHaveLength(10);
    expect(new Set(SHAPESHIFTER_QA_CARDS.map((c) => c.id)).size).toBe(10);
    expect(DEFAULT_CONTENT.heroes.shapeshifter).toBeUndefined();
    expect(DEFAULT_CONTENT.transformations).toBeUndefined();
    for (const card of SHAPESHIFTER_QA_CARDS) {
      expect(DEFAULT_CONTENT.cards[card.id]).toBeUndefined();
      expect(card.heroId).toBe('shapeshifter');
      expect(card.rulesText).toContain('QA provisional');
    }
    expect(QA_CONTENT.transformations!.bear!.armorBonus).toBe(2);
    expect(QA_CONTENT.transformations!.minotaur!.armorBonus).toBe(1);
    expect(DEFAULT_CONTENT.heroes.mage!.maxHp).toBe(20);
    expect(QA_STORAGE_KEY).not.toBe('rpg-go-tactics:session');
  });
  it.each(Object.entries(SHAPESHIFTER_QA_DECKS))(
    '%s deck is legal and deterministic with a legacy-selected normal opening',
    (_, deck) => {
      const profile = createProfile(QA_CONTENT),
        before = structuredClone(deck);
      expect(
        validateDeck(
          deck,
          'shapeshifter',
          ownedFor(profile, 'shapeshifter', QA_CONTENT),
          QA_CONTENT,
          DECK_RULES,
        ),
      ).toEqual([]);
      expect(() => saveQaDeck(profile, deck)).not.toThrow();
      expect(deck.reduce((n, c) => n + c.count, 0)).toBe(30);
      const engine = startQaBattle(profile, deck, openingSeed(deck), 'normal');
      expect(hero(engine).activeForm).toBeUndefined();
      expect(engine.seed).toBe(openingSeed(deck));
      expect(deck).toEqual(before);
      for (const id of ['qa_bear_form', 'qa_minotaur_form'])
        expect(engine.state.player.hand.some((c) => c.cardId === id)).toBe(true);
      expect(castForm(engine, 'qa_bear_form').ok).toBe(true);
      expect(hero(engine).activeForm).toBe('bear');
      expect(hero(engine).armor).toBe(2);
      expect(castForm(engine, 'qa_minotaur_form').ok).toBe(true);
      expect(hero(engine).activeForm).toBe('minotaur');
      expect(hero(engine).armor).toBe(1);
      expect(engine.state.player.energy).toBe(2);
      const replay = replayBattle(engine.scenario, engine.content, engine.seed, engine.history);
      expect(replay.rejectedAt).toBeNull();
      expect(replay.state).toEqual(engine.state);
    },
  );
  it('allows different distributions but rejects missing transformations, size, ownership and class violations', () => {
    const profile = createProfile(QA_CONTENT);
    const deck = structuredClone(SHAPESHIFTER_QA_DECKS.bear);
    deck[0]!.count--;
    deck.find((c) => c.cardId === 'qa_bark_skin')!.count++;
    expect(() => saveQaDeck(profile, deck)).not.toThrow();
    const absent: DeckEntry[] = SHAPESHIFTER_QA_DECKS.balanced
      .filter((c) => c.cardId !== 'qa_bear_form')
      .map((c) => ({ ...c }));
    absent.find((c) => c.cardId === 'qa_bark_skin')!.count += 3;
    expect(() => saveQaDeck(profile, absent)).toThrow(/transformación/);
    expect(() => saveQaDeck(profile, deck.slice(1))).toThrow();
    const tooMany = structuredClone(deck);
    tooMany[0]!.count = 7;
    expect(() => saveQaDeck(profile, tooMany)).toThrow();
    expect(
      validateDeck(
        deck,
        'mage',
        ownedFor(profile, 'mage', QA_CONTENT),
        QA_CONTENT,
        DECK_RULES,
      ).some((i) => i.code === 'WRONG_HERO'),
    ).toBe(true);
  });
  it('keeps form requirements authoritative and never heals when changing form', () => {
    const profile = createProfile(QA_CONTENT),
      e = startQaBattle(
        profile,
        SHAPESHIFTER_QA_DECKS.balanced,
        openingSeed(SHAPESHIFTER_QA_DECKS.balanced),
        'normal',
      );
    hero(e).hp = 9;
    // Controlled hand fixture only to test the card gates, not the saved replay.
    const s = e.state as import('../src/game').GameState;
    s.player.hand.push(
      { uid: 'claw', cardId: 'qa_bear_claw' },
      { uid: 'axe', cardId: 'qa_axe_sweep' },
    );
    expect(e.getCardPlayability('claw')).toMatchObject({
      playable: false,
      reason: 'FORM_REQUIRED',
    });
    expect(castForm(e, 'qa_bear_form').ok).toBe(true);
    expect(e.getCardPlayability('claw').playable).toBe(true);
    expect(e.getCardPlayability('axe')).toMatchObject({ playable: false, reason: 'FORM_REQUIRED' });
    expect(castForm(e, 'qa_minotaur_form').ok).toBe(true);
    expect(e.getCardPlayability('claw')).toMatchObject({
      playable: false,
      reason: 'FORM_REQUIRED',
    });
    expect(e.getCardPlayability('axe').playable).toBe(true);
    expect(hero(e).hp).toBe(9);
  });
  it('restores a QA battle through authoritative replay rather than trusting a serialized snapshot', () => {
    const profile = createProfile(QA_CONTENT),
      e = startQaBattle(
        profile,
        SHAPESHIFTER_QA_DECKS.minotaur,
        openingSeed(SHAPESHIFTER_QA_DECKS.minotaur),
        'normal',
      );
    castForm(e, 'qa_minotaur_form');
    const saved = serializeQa(profile, e);
    const restored = restoreQa(saved);
    expect(restored.engine!.state).toEqual(e.state);
    expect(restored.engine!.history).toEqual(e.history);
    expect(castForm(restored.engine!, 'qa_bear_form').ok).toBe(true);
    expect(hero(restored.engine!).activeForm).toBe('bear');
    expect(restoreQa(serializeQa(profile, null)).engine).toBeNull();
    expect(() => restoreQa('{"version":999}')).toThrow();
    const bad = JSON.parse(saved);
    bad.battle.commands.push({ type: 'PLAY_CARD', cardUid: 'not-owned', target: null });
    expect(() => restoreQa(JSON.stringify(bad))).toThrow(/rechazado/);
  });
  it('uses only existing charge, shield, movement, collision and damage effects', () => {
    const effects = SHAPESHIFTER_QA_CARDS.flatMap((c) => c.effects.map((f) => f.type));
    expect([...new Set(effects)].sort()).toEqual(
      ['CHARGE_CASTER', 'DAMAGE', 'DRAW', 'PUSH', 'SHIELD', 'STEP_CASTER', 'TRANSFORM'].sort(),
    );
    expect(SHAPESHIFTER_QA_CARDS.find((c) => c.id === 'qa_protective_roar')!.rulesText).toContain(
      'Sin provocación ni aura',
    );
    expect(SHAPESHIFTER_QA_SCENARIO.id).toBe('shapeshifter_private_lab');
  });
});
