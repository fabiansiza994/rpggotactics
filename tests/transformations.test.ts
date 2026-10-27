import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, GameEngine, type CardDefinition, type GameContent } from '../src/game';
import { PROTOTYPE_TRANSFORMATIONS } from '../src/game/data/transformation-prototypes';
import { activeForm, clearBattleForms } from '../src/game/domain/transformations/transformations';
import { scenario, setHand, mutable } from './helpers';
import { replayBattle } from '../src/game/engine/replay';
import { createDuel, duelView, duelEvents } from '../src/game/pvp/duel';
import { executeCommand } from '../src/game/engine/commands';
import { parseCommand } from '../src/game/run/verify';
import { validCommand } from '../server/src/pvp';
import { fallbackDiscardUid } from '../src/game/domain/cards/hand-limit';

const card = (
  id: string,
  effects: CardDefinition['effects'],
  requiredForms?: CardDefinition['requiredForms'],
): CardDefinition => ({
  id,
  name: id,
  heroId: 'shapeshifter',
  cost: 1,
  category: 'UTILITY',
  rarity: 'COMMON',
  tags: [],
  rulesText: 'Fixture only',
  targeting: { type: 'SELF' },
  effects,
  requiredForms,
  presentation: { visualKey: 'barrier', element: 'ARCANE' },
});
const cards = {
  bear_shift: card('bear_shift', [{ type: 'TRANSFORM', formId: 'bear' }]),
  minotaur_shift: card('minotaur_shift', [{ type: 'TRANSFORM', formId: 'minotaur' }]),
  human_shift: card('human_shift', [{ type: 'TRANSFORM', formId: null }]),
  bear_skill: card('bear_skill', [{ type: 'SHIELD', to: 'CASTER', amount: 1 }], ['bear']),
  human_skill: card('human_skill', [], [null]),
  invalid_shift: card('invalid_shift', [{ type: 'TRANSFORM', formId: 'forged' }]),
};
function content(): GameContent {
  return {
    ...DEFAULT_CONTENT,
    transformations: PROTOTYPE_TRANSFORMATIONS,
    cards: { ...DEFAULT_CONTENT.cards, ...cards },
    heroes: {
      ...DEFAULT_CONTENT.heroes,
      shapeshifter: {
        ...DEFAULT_CONTENT.heroes.mage!,
        id: 'shapeshifter',
        transformationForms: ['bear', 'minotaur'],
        startingHandSize: 1,
        deck: [{ cardId: 'bear_shift', count: 30 }],
      },
    },
  };
}
const sc = () => scenario({ hero: { heroId: 'shapeshifter', pos: { x: 0, y: 2 } } });
const make = (c = content()) => new GameEngine(sc(), c, 42);
const hero = (e: GameEngine) => e.state.units.find((u) => u.id === e.state.player.heroId)!;
function play(e: GameEngine, id: string) {
  const [uid] = setHand(e, [id]);
  return e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null });
}

describe('transformation foundation (private fixtures only)', () => {
  it('starts humanoid, switches one form at a time, preserves damage/status/shield and spends shared energy', () => {
    const e = make(),
      u = hero(e);
    expect(activeForm(u)).toBeNull();
    u.hp = 7;
    u.shield = 3;
    u.statuses = [{ id: 'ROOTED', turnsLeft: 2 }];
    const hpMax = u.maxHp,
      movement = e.state.player.movePoints;
    const statuses = structuredClone(u.statuses),
      energy = e.state.player.energy;
    const first = play(e, 'bear_shift');
    expect(first.ok).toBe(true);
    expect(
      first.ok && first.events.some((ev) => ev.type === 'FORM_CHANGED' && ev.to === 'bear'),
    ).toBe(true);
    expect(hero(e)).toMatchObject({ activeForm: 'bear', hp: 7, shield: 3, armor: 2, statuses });
    expect(e.state.player.energy).toBe(energy - 1);
    expect(hero(e).maxHp).toBe(hpMax);
    expect(e.state.player.movePoints).toBe(movement);
    expect(play(e, 'minotaur_shift').ok).toBe(true);
    expect(hero(e)).toMatchObject({ activeForm: 'minotaur', hp: 7, armor: 1, statuses });
    expect(play(e, 'human_shift').ok).toBe(true);
    expect(activeForm(hero(e))).toBeNull();
    expect(hero(e).armor).toBe(0);
  });
  it('rejects a wrong-form card atomically, then permits it only in the required form', () => {
    const e = make();
    setHand(e, ['bear_skill']);
    const before = structuredClone(e.state);
    expect(
      e.dispatch({ type: 'PLAY_CARD', cardUid: e.state.player.hand[0]!.uid, target: null }),
    ).toMatchObject({ ok: false, error: 'FORM_REQUIRED' });
    expect(e.state).toEqual(before);
    expect(play(e, 'bear_shift').ok).toBe(true);
    expect(play(e, 'bear_skill').ok).toBe(true);
    expect(play(e, 'human_skill')).toMatchObject({ ok: false, error: 'FORM_REQUIRED' });
  });
  it('rejects unregistered/forbidden forms and class injection before spending', () => {
    const e = make();
    setHand(e, ['invalid_shift']);
    const before = structuredClone(e.state);
    expect(
      e.dispatch({ type: 'PLAY_CARD', cardUid: e.state.player.hand[0]!.uid, target: null }),
    ).toMatchObject({ ok: false, error: 'INVALID_TRANSFORMATION' });
    expect(e.state).toEqual(before);
    const mage = new GameEngine(scenario(), content());
    expect(play(mage, 'bear_shift')).toMatchObject({ ok: false, error: 'WRONG_CLASS' });
  });
  it('persists across turns and JSON restore, resets in a new battle, and accepts legacy snapshots', () => {
    const e = make();
    play(e, 'bear_shift');
    const snap = JSON.parse(JSON.stringify(e.state));
    const r = GameEngine.fromSnapshot(snap, e.content, e.scenario);
    const discardUid = fallbackDiscardUid(r.state);
    expect(r.dispatch({ type: 'END_TURN', ...(discardUid ? { discardUid } : {}) }).ok).toBe(true);
    expect(activeForm(hero(r))).toBe('bear');
    expect(activeForm(hero(make()))).toBeNull();
    delete snap.units.find((u: { id: string }) => u.id === snap.player.heroId).activeForm;
    expect(activeForm(hero(GameEngine.fromSnapshot(snap, e.content, e.scenario)))).toBeNull();
  });
  it('replays the same authoritative state; client-supplied form metadata cannot choose the effect', () => {
    const e = make();
    const raw = {
      type: 'PLAY_CARD',
      cardUid: e.state.player.hand[0]!.uid,
      target: null,
      formId: 'forged',
    };
    const cmd = parseCommand(raw)!;
    expect(cmd).toEqual({ type: 'PLAY_CARD', cardUid: raw.cardUid, target: null });
    expect(validCommand(cmd)).toBe(true);
    expect(e.dispatch(cmd).ok).toBe(true);
    const replay = replayBattle(e.scenario, e.content, e.seed, [cmd]);
    expect(replay.rejectedAt).toBeNull();
    expect(replay.state).toEqual(e.state);
    expect(activeForm(hero(e))).toBe('bear');
  });
  it('adds a third form using registry and hero/card data only', () => {
    const c = content();
    c.transformations = {
      ...c.transformations,
      test_raven: { id: 'test_raven', name: 'Cuervo QA', armorBonus: 0 },
    };
    c.heroes = {
      ...c.heroes,
      shapeshifter: {
        ...c.heroes.shapeshifter!,
        transformationForms: ['bear', 'minotaur', 'test_raven'],
      },
    };
    c.cards = {
      ...c.cards,
      raven_shift: card('raven_shift', [{ type: 'TRANSFORM', formId: 'test_raven' }]),
    };
    const e = make(c);
    expect(play(e, 'bear_shift').ok).toBe(true);
    expect(play(e, 'raven_shift').ok).toBe(true);
    expect(hero(e)).toMatchObject({ activeForm: 'test_raven', armor: 0 });
  });
  it('clears forms on battle end and does not stack armor on repeat transformations', () => {
    const e = make();
    play(e, 'bear_shift');
    play(e, 'bear_shift');
    expect(hero(e).armor).toBe(2);
    // A real objective-completing command clears battle-only form state.
    mutable(e).units = mutable(e).units.filter((u) => u.kind !== 'ENEMY');
    expect(play(e, 'human_skill')).toMatchObject({ ok: false, error: 'FORM_REQUIRED' });
    expect(play(e, 'bear_shift').ok).toBe(true);
    expect(e.state.phase).toBe('ENDED');
    expect(activeForm(hero(e))).toBeNull();
    expect(hero(e).armor).toBe(0);
  });
  it('uses the authoritative PvP command path, public per-unit form state and persistent seat swaps', () => {
    const c = content();
    let state = createDuel(
      [
        { heroId: 'mage', cards: DEFAULT_CONTENT.heroes.mage!.deck },
        { heroId: 'mage', cards: DEFAULT_CONTENT.heroes.mage!.deck },
      ],
      42,
    );
    const seat = state.duel!.active,
      own = state.units.find((u) => u.id === state.player.heroId)!;
    own.defId = 'shapeshifter';
    state.player.hand = [{ uid: 'pvp-shift', cardId: 'bear_shift' }];
    const events: import('../src/game').GameEvent[] = [];
    const ctx = {
      state,
      content: c,
      emit: (ev: import('../src/game').GameEvent) => events.push(ev),
    };
    expect(executeCommand(ctx, { type: 'PLAY_CARD', cardUid: 'pvp-shift', target: null }).ok).toBe(
      true,
    );
    expect(duelView(state, seat === 0 ? 1 : 0).units.find((u) => u.id === own.id)?.activeForm).toBe(
      'bear',
    );
    expect(
      duelEvents(state, seat === 0 ? 1 : 0, events).some((ev) => ev.type === 'FORM_CHANGED'),
    ).toBe(true);
    const uid = fallbackDiscardUid(state);
    expect(executeCommand(ctx, { type: 'END_TURN', ...(uid ? { discardUid: uid } : {}) }).ok).toBe(
      true,
    );
    state = JSON.parse(JSON.stringify(state));
    expect(state.units.find((u) => u.id === own.id)?.activeForm).toBe('bear');
    clearBattleForms(state, c);
    expect(state.units.every((u) => !u.activeForm)).toBe(true);
  });
  it('preserves independent armor bonuses and rejects malformed form definitions atomically', () => {
    const e = make();
    hero(e).armor = 5;
    expect(play(e, 'bear_shift').ok).toBe(true);
    expect(hero(e).armor).toBe(7);
    expect(play(e, 'minotaur_shift').ok).toBe(true);
    expect(hero(e).armor).toBe(6);
    expect(play(e, 'human_shift').ok).toBe(true);
    expect(hero(e).armor).toBe(5);
    const c = content();
    c.transformations = {
      ...c.transformations,
      bear: { id: 'bear', name: 'Invalid QA', armorBonus: -1 },
    };
    const bad = make(c);
    const before = structuredClone(bad.state);
    expect(
      bad.dispatch({ type: 'PLAY_CARD', cardUid: bad.state.player.hand[0]!.uid, target: null }),
    ).toMatchObject({ ok: false, error: 'INVALID_TRANSFORMATION' });
    expect(bad.state).toEqual(before);
  });
  it('cannot transform while stunned, on the rival turn, or through another champion opting out', () => {
    const e = make();
    hero(e).statuses = [{ id: 'STUNNED', turnsLeft: 1 }];
    expect(play(e, 'bear_shift')).toMatchObject({ ok: false, error: 'CASTER_INCAPACITATED' });
    hero(e).statuses = [];
    mutable(e).phase = 'ENEMY';
    expect(play(e, 'bear_shift')).toMatchObject({ ok: false, error: 'NOT_PLAYER_TURN' });
    const c = content();
    c.heroes = {
      ...c.heroes,
      shapeshifter: { ...c.heroes.shapeshifter!, transformationForms: [] },
    };
    const locked = make(c);
    expect(play(locked, 'bear_shift')).toMatchObject({
      ok: false,
      error: 'INVALID_TRANSFORMATION',
    });
  });
  it('never registers prototype forms/champion/cards in default released content', () => {
    expect(DEFAULT_CONTENT.transformations).toBeUndefined();
    expect(DEFAULT_CONTENT.heroes.shapeshifter).toBeUndefined();
    expect(DEFAULT_CONTENT.cards.bear_shift).toBeUndefined();
  });
});
