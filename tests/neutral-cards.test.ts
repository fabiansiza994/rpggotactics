import { describe, expect, it } from 'vitest';
import {
  addCard,
  addCardIssue,
  createProfile,
  DECK_RULES,
  deckStatus,
  DEFAULT_CONTENT,
  GameEngine,
  grantCard,
  NEUTRAL_CARDS,
  neutralCount,
  removeCard,
  rollReward,
  saveActiveDeck,
  starterDeck,
  TACTICAL_EXPANSION,
  validateDeck,
  type DeckEntry,
  type GameContent,
  type PlayerProfile,
} from '../src/game';
import { applyDuel, createDuel, duelView, DUEL_SCENARIO, validateLoadout } from '../src/game/pvp/duel';
import { browseCollection, EMPTY_QUERY, facets } from '../src/presentation/react/deckbuilder/collectionView';
import { cardsForHero } from '../src/game/collection/deck-rules';
import { ownedCard } from '../src/game/collection/profile';
import { ctxFor, makeEngine, mutable, p, setHand, unit } from './helpers';
import { applyStatus } from '../src/game/domain/statuses/status-rules';

const NEUTRAL_IDS = NEUTRAL_CARDS.map((c) => c.id);
const HEROES = ['mage', 'summoner', 'warrior'] as const;
const all = () => 3;

/** The champion's starter with its first `n` card copies swapped for neutral cards (round-robin). */
function withNeutrals(heroId: string, n: number, ids: readonly string[] = NEUTRAL_IDS): DeckEntry[] {
  let deck = starterDeck(DEFAULT_CONTENT.heroes[heroId]!);
  for (let i = 0; i < n; i++) {
    deck = removeCard(deck, deck[0]!.cardId);
    deck = addCard(deck, ids[i % ids.length]!);
  }
  return deck;
}

describe('neutral card set', () => {
  it('five neutral COMMON cards with no champion, in the QA-only tactical set', () => {
    expect(NEUTRAL_IDS).toEqual(['emergency_strike', 'take_cover', 'step_back', 'first_aid', 'shove']);
    for (const c of NEUTRAL_CARDS) {
      expect(c.heroId).toBeUndefined();
      expect(c.rarity).toBe('COMMON');
      expect(c.expansion).toBe(TACTICAL_EXPANSION);
      expect(c.acquisition).toBeUndefined();
      expect(DEFAULT_CONTENT.cards[c.id]).toBe(c);
    }
  });

  it('every champion pool contains them (Mage, Summoner, Warrior)', () => {
    for (const heroId of HEROES) expect(cardsForHero(DEFAULT_CONTENT, heroId).map((c) => c.id)).toEqual(expect.arrayContaining(NEUTRAL_IDS));
  });

  for (const heroId of HEROES)
    it(`a ${heroId} deck accepts neutral cards (existing copy rules)`, () => {
      const deck = withNeutrals(heroId, 4);
      expect(validateDeck(deck, heroId, all, DEFAULT_CONTENT, DECK_RULES)).toEqual([]);
      // Normal rarity copy cap: COMMON = 3 of one neutral card.
      const four = withNeutrals(heroId, 4, ['take_cover']);
      expect(validateDeck(four, heroId, () => 9, DEFAULT_CONTENT, DECK_RULES).map((i) => i.code)).toEqual(['COPY_LIMIT']);
    });
});

describe('neutral deck limit', () => {
  const limit = DECK_RULES.maxNeutralCards!;

  it(`at most ${limit} neutral cards per 30-card deck`, () => {
    expect(limit).toBe(4);
    for (const heroId of HEROES) {
      expect(validateDeck(withNeutrals(heroId, limit), heroId, all, DEFAULT_CONTENT, DECK_RULES)).toEqual([]);
      const over = withNeutrals(heroId, limit + 1);
      expect(neutralCount(over, DEFAULT_CONTENT)).toBe(limit + 1);
      expect(validateDeck(over, heroId, all, DEFAULT_CONTENT, DECK_RULES)).toEqual([{ code: 'NEUTRAL_LIMIT', count: limit + 1, limit }]);
    }
  });

  it('the Deck Builder refuses the extra neutral copy, but champion cards still go in', () => {
    const full = removeCard(withNeutrals('summoner', limit), 'nurture');
    expect(addCardIssue(full, 'shove', 'summoner', all, DEFAULT_CONTENT, DECK_RULES)).toEqual({ code: 'NEUTRAL_LIMIT', count: limit + 1, limit });
    expect(addCardIssue(full, 'nurture', 'summoner', all, DEFAULT_CONTENT, DECK_RULES)).toBeNull();
    const status = deckStatus(full, 'summoner', all, DEFAULT_CONTENT, DECK_RULES);
    expect(status).toMatchObject({ neutralCards: limit, maxNeutralCards: limit });
  });

  it('without a limit in the rules any number is legal (the rule is data, not hard-coded)', () => {
    const rules = { ...DECK_RULES, maxNeutralCards: undefined };
    expect(validateDeck(withNeutrals('mage', 9), 'mage', all, DEFAULT_CONTENT, rules)).toEqual([]);
  });

  it('saving and PvP use the same rule: an over-limit deck is refused', () => {
    let profile: PlayerProfile = createProfile(DEFAULT_CONTENT);
    for (const id of NEUTRAL_IDS)
      for (let i = 0; i < 3; i++) {
        const r = grantCard(profile, 'warrior', id, DEFAULT_CONTENT);
        if (!r.ok) throw new Error(r.error);
        profile = r.profile;
      }
    // Copies are shared: granted through the Warrior, usable by the Mage.
    expect(ownedCard(profile, 'mage', 'shove', DEFAULT_CONTENT)?.copies).toBe(3);
    const ok = saveActiveDeck(profile, 'mage', withNeutrals('mage', limit), DEFAULT_CONTENT, DECK_RULES);
    if (!ok.ok) throw new Error(JSON.stringify(ok.issues));
    expect(validateLoadout(ok.profile, 'mage').cards).toEqual(withNeutrals('mage', limit));
    expect(saveActiveDeck(profile, 'mage', withNeutrals('mage', limit + 1), DEFAULT_CONTENT, DECK_RULES).ok).toBe(false);
    // A tampered stored deck is still refused by PvP.
    const tampered = structuredClone(ok.profile);
    tampered.heroes.mage!.decks[0]!.cards = withNeutrals('mage', limit + 1);
    expect(() => validateLoadout(tampered, 'mage')).toThrow('INVALID_DECK');
  });
});

describe('neutral ownership and drops', () => {
  const offered = (content: GameContent, heroId: string) =>
    new Set(
      Array.from({ length: 200 }, (_, seed) =>
        rollReward({ content, heroId, owned: () => 0, pity: 9, rules: DECK_RULES, poolId: 'NORMAL', seed, count: 3 }).options.flatMap((o) =>
          o.kind === 'ADD_CARD' ? [o.cardId] : [],
        ),
      ).flat(),
    );

  it('QA-only: never a reward drop until the tactical set is released, then a COMMON drop for every champion', () => {
    for (const heroId of HEROES) for (const id of NEUTRAL_IDS) expect(offered(DEFAULT_CONTENT, heroId).has(id)).toBe(false);
    const released = { ...DEFAULT_CONTENT, releasedExpansions: [TACTICAL_EXPANSION] };
    for (const heroId of HEROES) expect([...offered(released, heroId)]).toEqual(expect.arrayContaining(NEUTRAL_IDS));
  });

  it('no starter deck holds a neutral card (fresh accounts own none)', () => {
    for (const heroId of HEROES) expect(neutralCount(DEFAULT_CONTENT.heroes[heroId]!.deck, DEFAULT_CONTENT)).toBe(0);
    expect(createProfile(DEFAULT_CONTENT).shared!.collection).toEqual({});
  });
});

describe('Deck Builder origin filter', () => {
  it('Todas / Campeón / Neutrales split the pool; the chips only exist when the pool mixes both', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    const pool = cardsForHero(DEFAULT_CONTENT, 'summoner');
    const lookup = (id: string) => ownedCard(profile, 'summoner', id, DEFAULT_CONTENT);
    const ids = (origin: typeof EMPTY_QUERY.origin) => browseCollection(pool, lookup, { ...EMPTY_QUERY, origin }).map((c) => c.id);
    // The «Arsenal I» neutrals (Bomba de Humo, Gancho, Ración) and the Act III neutral rewards share the origin.
    expect(ids('NEUTRAL').sort()).toEqual([...NEUTRAL_IDS, 'arcane_surge', 'smoke_bomb', 'grappling_hook', 'field_ration', 'threshold_step', 'broken_seal', 'counterweight_rope'].sort());
    expect(ids('CHAMPION').every((id) => DEFAULT_CONTENT.cards[id]!.heroId === 'summoner')).toBe(true);
    expect(ids('ALL')).toHaveLength(pool.length);
    expect(facets(pool).origins).toEqual(['ALL', 'CHAMPION', 'NEUTRAL']);
    expect(facets(pool.filter((c) => c.heroId)).origins).toEqual([]);
  });
});

describe('neutral cards in battle', () => {
  const content = DEFAULT_CONTENT;
  const engineFor = (heroId: string, enemyPos = p(2, 2)) =>
    makeEngine({ hero: { heroId, pos: p(1, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: enemyPos }] }, content);

  for (const heroId of HEROES)
    it(`${heroId}: Golpe de emergencia hits an ADJACENT enemy for 2 (melee only)`, () => {
      const near = engineFor(heroId);
      const [uid] = setHand(near, ['emergency_strike']);
      mutable(near).player.energy = 5;
      expect(near.getValidTargets(uid!)).toEqual([p(2, 2)]);
      expect(near.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(2, 2) }).ok).toBe(true);
      expect(unit(near, 'orc-1').hp).toBe(6);
      const far = engineFor(heroId, p(3, 2));
      const [farUid] = setHand(far, ['emergency_strike']);
      expect(far.getValidTargets(farUid!)).toEqual([]);
    });

  it('Ponerse a cubierto: 3 shield on the caster only (below Barrier/Guardia)', () => {
    const engine = engineFor('warrior', p(5, 2));
    const [uid] = setHand(engine, ['take_cover']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(true);
    expect(unit(engine, engine.heroId).shield).toBe(3);
    expect(engine.state.player.movePoints).toBe(engine.state.player.maxMovePoints); // no plant
  });

  it('Paso atrás: one legal step to a free adjacent tile, no movement points spent', () => {
    const engine = makeEngine({
      layout: ['.......', '.#.....', '.......', '.......', '.......'],
      hero: { heroId: 'summoner', pos: p(1, 2) },
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(2, 2) }],
    });
    const [uid] = setHand(engine, ['step_back']);
    // Pillar above, orc to the right: only left and down.
    expect(engine.getValidTargets(uid!)).toEqual([p(0, 2), p(1, 3)]);
    mutable(engine).player.movePoints = 0;
    const events: string[] = [];
    engine.subscribe((evs) => events.push(...evs.map((e) => e.type)));
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(0, 2) }).ok).toBe(true);
    expect(unit(engine, engine.heroId).pos).toEqual(p(0, 2));
    expect(engine.state.player.movePoints).toBe(0);
    expect(events).toContain('UNIT_MOVED'); // a walk, not a teleport
    expect(events).not.toContain('UNIT_TELEPORTED');
  });

  it('Paso atrás is blocked while Rooted (no teleport, no root escape)', () => {
    const engine = engineFor('mage', p(5, 2));
    const [uid] = setHand(engine, ['step_back']);
    applyStatus(ctxFor(engine), unit(engine, engine.heroId), 'ROOTED', 1, 'test');
    expect(engine.getValidTargets(uid!)).toEqual([]);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(0, 2) }).ok).toBe(false);
  });

  it('Primeros auxilios: self-only heal 3, capped at max HP', () => {
    const engine = engineFor('summoner', p(5, 2));
    const hero = unit(engine, engine.heroId);
    hero.hp = hero.maxHp - 5;
    const [a, b] = setHand(engine, ['first_aid', 'first_aid']);
    mutable(engine).player.energy = 4;
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: a!, target: null }).ok).toBe(true);
    expect(unit(engine, engine.heroId).hp).toBe(hero.maxHp - 2);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: b!, target: null }).ok).toBe(true);
    expect(unit(engine, engine.heroId).hp).toBe(hero.maxHp);
    expect(DEFAULT_CONTENT.cards.first_aid!.targeting.type).toBe('SELF');
  });

  it('Empujón: pushes an adjacent enemy 1 tile, no damage on a free push, 1 on collision', () => {
    const engine = engineFor('mage');
    const [uid] = setHand(engine, ['shove']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(2, 2) }).ok).toBe(true);
    expect(unit(engine, 'orc-1').pos).toEqual(p(3, 2));
    expect(unit(engine, 'orc-1').hp).toBe(8);

    const wall = makeEngine({
      layout: ['.......', '.......', '...#...', '.......', '.......'],
      hero: { heroId: 'warrior', pos: p(1, 2) },
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(2, 2) }],
    });
    const [w] = setHand(wall, ['shove']);
    expect(wall.dispatch({ type: 'PLAY_CARD', cardUid: w!, target: p(2, 2) }).ok).toBe(true);
    expect(unit(wall, 'orc-1').pos).toEqual(p(2, 2)); // the pillar stops it
    expect(unit(wall, 'orc-1').hp).toBe(7);
    // Still below Empujón brutal (pushes 2, 2 on collision).
    expect(DEFAULT_CONTENT.cards.brutal_shove!.effects[0]).toMatchObject({ distance: 2, collisionDamage: 2 });
  });
});

describe('neutral cards in PvP', () => {
  it('both seats play neutral cards through the authoritative duel; snapshots stay hydratable', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    let state = createDuel([validateLoadout(profile, 'warrior'), validateLoadout(profile, 'summoner')], 11);
    for (let turn = 0; turn < 2; turn++) {
      const me = state.units.find((u) => u.id === state.player.heroId)!;
      const rival = state.units.find((u) => u.id === state.duel!.other.heroId)!;
      me.pos = { x: 3, y: 2 };
      rival.pos = { x: 4, y: 2 };
      rival.shield = 0; // the first seat's cover would absorb the second seat's hit
      state.player.energy = 5;
      state.player.hand = [
        { uid: `n${turn}-hit`, cardId: 'emergency_strike' },
        { uid: `n${turn}-cover`, cardId: 'take_cover' },
      ];
      const hpBefore = rival.hp;
      state = applyDuel(state, { type: 'PLAY_CARD', cardUid: `n${turn}-hit`, target: { x: 4, y: 2 } }).state;
      state = applyDuel(state, { type: 'PLAY_CARD', cardUid: `n${turn}-cover`, target: null }).state;
      expect(state.units.find((u) => u.id === rival.id)!.hp).toBe(hpBefore - 2);
      expect(state.units.find((u) => u.id === me.id)!.shield).toBe(3);
      for (const seat of [0, 1] as const) {
        const wire = JSON.parse(JSON.stringify(duelView(state, seat)));
        const engine = GameEngine.fromSnapshot(wire, DEFAULT_CONTENT, DUEL_SCENARIO);
        expect(engine.state.units.find((u) => u.id === me.id)!.shield).toBe(3);
      }
      state = applyDuel(state, { type: 'END_TURN' }).state;
    }
  });
});
