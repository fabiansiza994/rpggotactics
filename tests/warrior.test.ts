import { describe, expect, it } from 'vitest';
import {
  ASCENT_CAMPAIGN,
  ARSENAL_CARDS, NEUTRAL_CARDS, SHOWCASE_STORE_CARDS,
  campaignBattleContent,
  createProfile,
  createRun,
  currentEncounter,
  DECK_RULES,
  DEFAULT_CONTENT,
  GameEngine,
  grantCard,
  rollReward,
  validateDeck,
  verifyVictory,
  ownedFor,
  starterDeck,
  type Command,
  type GameState,
} from '../src/game';
import { cardsForHero } from '../src/game/collection/deck-rules';
import { applyDuel, createDuel, duelView, validateLoadout } from '../src/game/pvp/duel';
import { DOMINION_NODES, refreshDominion } from '../src/game/pvp/dominion';
import { validCommand } from '../server/src/pvp';
import { handle } from '../server/src/index';
import { addAccount, memoryD1 } from './support/d1';
import { playBattle } from './support/bot';
import { makeEngine, mutable, ofType, p, setHand, unit, endTurn } from './helpers';

const WARRIOR = DEFAULT_CONTENT.heroes.warrior!;
const CARDS = DEFAULT_CONTENT.cards;
const CORE = ['heavy_strike', 'shield_bash', 'warrior_charge', 'guard', 'riposte', 'second_wind', 'brutal_shove', 'steady_advance'];
/** The original 8 unlockables. Since decks are 30 cards, the starter also holds sweep / steel_wall / unstoppable. */
const UNLOCKABLE = ['sweep', 'grapple', 'steel_wall', 'bastion', 'ram', 'unstoppable', 'vanguard_fury', 'execution'];
const STARTER = [...CORE, 'sweep', 'steel_wall', 'unstoppable'];
const LOCKED = UNLOCKABLE.filter((id) => !STARTER.includes(id));
const LEGEND = { '.': {}, '#': { obstacleId: 'pillar' }, r: { obstacleId: 'rubble' }, C: { terrain: 'COVER' as const }, V: { terrain: 'VOID' as const }, H: { terrain: 'HAZARD' as const } };

/** Warrior at `hero` vs orcs at `orcs` (orc: 8 HP, melee 3). */
function arena(hero = p(1, 2), orcs = [p(2, 2)], layout = ['.......', '.......', '.......', '.......', '.......']) {
  return makeEngine({
    layout,
    legend: LEGEND,
    hero: { heroId: 'warrior', pos: hero },
    enemies: orcs.map((pos, i) => ({ id: `orc-${i + 1}`, enemyId: 'orc_warrior', pos })),
  });
}
const play = (engine: GameEngine, cardId: string, target: { x: number; y: number } | null) => {
  const [uid] = setHand(engine, [cardId]);
  mutable(engine).player.energy = 9;
  return engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target });
};
const momentum = (engine: GameEngine) => unit(engine, 'warrior').momentum!.value;
const setMomentum = (engine: GameEngine, v: number) => (unit(engine, 'warrior').momentum!.value = v);

describe('Warrior: champion, starter deck, collection', () => {
  it('exists with its own stats: more HP than the Mage, no reach, no summons, no base armour', () => {
    expect(WARRIOR).toMatchObject({ name: 'Guerrero', maxHp: 24, maxEnergy: 4, movePoints: 3, momentum: { max: 3 } });
    expect(WARRIOR.maxHp).toBeGreaterThan(DEFAULT_CONTENT.heroes.mage!.maxHp);
    expect(WARRIOR.summonCapacity).toBeUndefined();
    const hero = unit(arena(), 'warrior');
    expect(hero).toMatchObject({ hp: 24, armor: 0, kind: 'HERO', momentum: { value: 0, max: 3, engagedRound: 0 } });
    // Other champions carry no Momentum state at all (their snapshots are unchanged).
    expect(unit(makeEngine(), 'mage').momentum).toBeUndefined();
  });

  it('starter deck: 30 legal cards, 11 distinct, all Warrior cards, no store card, owned from a fresh profile', () => {
    const deck = starterDeck(WARRIOR);
    expect(deck.reduce((n, e) => n + e.count, 0)).toBe(30);
    // Agarre, Embestida and Ejecución are sold in «Juramento del Verdugo»: none is in the starter.
    for (const id of ['grapple', 'ram', 'execution']) expect(deck.some((e) => e.cardId === id)).toBe(false);
    expect(deck.map((e) => e.cardId).sort()).toEqual([...STARTER].sort());
    const profile = createProfile(DEFAULT_CONTENT);
    expect(validateDeck(deck, 'warrior', ownedFor(profile, 'warrior', DEFAULT_CONTENT), DEFAULT_CONTENT, DECK_RULES)).toEqual([]);
    expect(Object.keys(profile.heroes)).toContain('warrior');
  });

  it('card pool: starter + 8 unlockables, three archetypes, every rarity, locked until earned', () => {
    // Plus Golpe de la Forja, earned only by completing World 2 (exclusive source, tested there),
    // the neutral cards every champion shares, and the «Arsenal I» set (QA-gated, earned through drops).
    const pool = cardsForHero(DEFAULT_CONTENT, 'warrior').map((c) => c.id);
    const arsenal = [...ARSENAL_CARDS, ...SHOWCASE_STORE_CARDS].filter((c) => !c.heroId || c.heroId === 'warrior').map((c) => c.id);
    // + the two Ranked Reward Track cards (early access, granted by the track only), and the Act III
    // rewards (Empuje del Coloso + the three neutral temple cards, exclusive sources).
    const temple = ['colossus_shove', 'threshold_step', 'broken_seal', 'counterweight_rope'];
    // + the free catalog's Legendary and Ultra (milestone grants only: free-catalog-phase-a).
    const freeCatalog = ['bastion_blow', 'last_bastion'];
    // + the Ranked Premium Track's Muralla del Rey Caído (pass only).
    expect(pool.sort()).toEqual([...CORE, ...UNLOCKABLE, 'forge_strike', 'siege_leap', 'wall_patience', 'fallen_king_wall', ...temple, ...freeCatalog, 'arcane_surge', ...NEUTRAL_CARDS.map((c) => c.id), ...arsenal].sort());
    const rarities = new Set(UNLOCKABLE.map((id) => CARDS[id]!.rarity));
    expect([...rarities].sort()).toEqual(['COMMON', 'RARE', 'UNCOMMON']);
    for (const tag of ['guardian', 'vanguard', 'brawler']) expect(UNLOCKABLE.some((id) => CARDS[id]!.tags.includes(tag))).toBe(true);
    const owned = ownedFor(createProfile(DEFAULT_CONTENT), 'warrior', DEFAULT_CONTENT);
    for (const id of LOCKED) expect(owned(id), id).toBe(0);
    // Empowered effects never summon (capacity is only checked on the base effects).
    for (const id of pool) expect(CARDS[id]!.empowered?.effects.some((fx) => fx.type === 'SUMMON') ?? false).toBe(false);
  });

  it('deck validation: other classes, copy caps and locked cards are refused', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    const owned = ownedFor(profile, 'warrior', DEFAULT_CONTENT);
    const swap = (from: string, to: string) => starterDeck(WARRIOR).map((e) => (e.cardId === from ? { cardId: to, count: e.count } : e));
    expect(validateDeck(swap('guard', 'fireball'), 'warrior', owned, DEFAULT_CONTENT, DECK_RULES)[0]).toMatchObject({ code: 'WRONG_HERO' });
    expect(validateDeck(swap('guard', 'grapple'), 'warrior', owned, DEFAULT_CONTENT, DECK_RULES)[0]).toMatchObject({ code: 'LOCKED' });
    const mageDeck = starterDeck(DEFAULT_CONTENT.heroes.mage!).map((e) => (e.cardId === 'blink' ? { cardId: 'heavy_strike', count: e.count } : e));
    expect(validateDeck(mageDeck, 'mage', ownedFor(profile, 'mage', DEFAULT_CONTENT), DEFAULT_CONTENT, DECK_RULES)[0]).toMatchObject({ code: 'WRONG_HERO' });
    let granted = profile;
    for (let i = 0; i < 2; i++) granted = (grantCard(granted, 'warrior', 'bastion', DEFAULT_CONTENT) as { profile: typeof profile }).profile;
    const deck = [...swap('steady_advance', 'guard').filter((e) => e.cardId !== 'guard'), { cardId: 'guard', count: 3 }, { cardId: 'bastion', count: 2 }];
    expect(validateDeck(deck, 'warrior', ownedFor(granted, 'warrior', DEFAULT_CONTENT), DEFAULT_CONTENT, DECK_RULES)).toContainEqual(
      expect.objectContaining({ code: 'COPY_LIMIT', cardId: 'bastion', limit: 1 }),
    );
  });

  it('rewards are champion-aware: Warrior drops only offer Warrior cards, other champions never get them', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    for (let seed = 1; seed <= 40; seed++) {
      const w = rollReward({ content: DEFAULT_CONTENT, heroId: 'warrior', owned: ownedFor(profile, 'warrior', DEFAULT_CONTENT), pity: 9, rules: DECK_RULES, poolId: 'BOSS', seed, count: 3 });
      for (const o of w.options) if (o.kind === 'ADD_CARD') expect([undefined, 'warrior']).toContain(CARDS[o.cardId]!.heroId);
      for (const heroId of ['mage', 'summoner']) {
        const r = rollReward({ content: DEFAULT_CONTENT, heroId, owned: ownedFor(profile, heroId, DEFAULT_CONTENT), pity: 9, rules: DECK_RULES, poolId: 'ELITE', seed, count: 3 });
        for (const o of r.options) if (o.kind === 'ADD_CARD') expect(CARDS[o.cardId]!.heroId).not.toBe('warrior');
      }
    }
    expect(grantCard(profile, 'mage', 'grapple', DEFAULT_CONTENT).ok).toBe(false);
    const won = grantCard(profile, 'warrior', 'grapple', DEFAULT_CONTENT);
    expect(won.ok && ownedFor(won.profile, 'warrior', DEFAULT_CONTENT)('grapple')).toBe(1);
  });
});

describe('Warrior: Momentum (Impulso)', () => {
  it('engaging: ending a walk next to an enemy you were not next to gives +1, once per turn', () => {
    const engine = arena(p(0, 2), [p(4, 2)]);
    expect(engine.dispatch({ type: 'MOVE_UNIT', unitId: 'warrior', to: p(3, 2) }).ok).toBe(true);
    expect(momentum(engine)).toBe(1);
    // Stepping out and back in the same turn does not farm it.
    mutable(engine).player.movePoints = 3;
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'warrior', to: p(2, 2) });
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'warrior', to: p(3, 2) });
    expect(momentum(engine)).toBe(1);
  });

  it('moving while already adjacent, or ending away from enemies, gives nothing', () => {
    const engine = arena(p(1, 2), [p(2, 2)]);
    engine.dispatch({ type: 'MOVE_UNIT', unitId: 'warrior', to: p(2, 1) }); // still adjacent
    expect(momentum(engine)).toBe(0);
    const far = arena(p(0, 0), [p(6, 4)]);
    far.dispatch({ type: 'MOVE_UNIT', unitId: 'warrior', to: p(2, 0) });
    expect(momentum(far)).toBe(0);
  });

  it('hostile hits feed Momentum (shield-absorbed hits count); it caps at 3', () => {
    const engine = arena(p(1, 2), [p(2, 2), p(1, 1), p(1, 3)]);
    mutable(engine).player.energy = 0;
    const { events } = engine.dispatch(endTurn(engine)) as { events: import('../src/game').GameEvent[] };
    expect(ofType(events, 'MOMENTUM_CHANGED').filter((e) => e.reason === 'HIT')).toHaveLength(3);
    expect(momentum(engine)).toBe(3);
    unit(engine, 'warrior').momentum!.value = 3;
    expect(play(engine, 'shield_bash', p(2, 2)).ok).toBe(true);
    expect(momentum(engine)).toBe(3); // capped
  });

  it('empowered cards spend Momentum automatically and resolve their stronger effects', () => {
    const engine = arena();
    setMomentum(engine, 2);
    const r = play(engine, 'heavy_strike', p(2, 2));
    expect(r.ok && ofType(r.events, 'CARD_PLAYED')[0]!.empowered).toBe(true);
    expect(unit(engine, 'orc-1').hp).toBe(8 - 5);
    expect(momentum(engine)).toBe(0);
    // Without enough Momentum the base effect resolves and nothing is spent.
    setMomentum(engine, 1);
    play(engine, 'heavy_strike', p(2, 2));
    expect(engine.state.units.some((u) => u.id === 'orc-1')).toBe(false);
    expect(momentum(engine)).toBe(1);
  });

  it('the preview shows exactly what the empowered play will do', () => {
    const engine = arena();
    setMomentum(engine, 2);
    const [uid] = setHand(engine, ['heavy_strike']);
    const preview = engine.previewCard(uid!, p(2, 2));
    expect(ofType(preview.predictedEvents, 'UNIT_DAMAGED')[0]!.hpLost).toBe(5);
    expect(momentum(engine)).toBe(2); // preview never mutates
  });
});

describe('Warrior cards', () => {
  it('Golpe pesado: adjacent only (no diagonals, no reach); melee ignores COVER', () => {
    const engine = arena(p(1, 2), [p(2, 2), p(2, 3), p(3, 2)], ['.......', '.......', '..C....', '.......', '.......']);
    const [uid] = setHand(engine, ['heavy_strike']);
    expect(engine.getValidTargets(uid!)).toEqual([p(2, 2)]);
    play(engine, 'heavy_strike', p(2, 2));
    expect(unit(engine, 'orc-1').hp).toBe(5); // 3 damage despite the orc standing on COVER
    expect(play(engine, 'heavy_strike', p(3, 2)).ok).toBe(false);
  });

  it('Golpe de escudo: 1 damage, push 1 (2 on collision), +1 Momentum', () => {
    const engine = arena(p(1, 2), [p(2, 2), p(3, 2)]);
    play(engine, 'shield_bash', p(2, 2));
    expect(unit(engine, 'orc-1')).toMatchObject({ pos: p(2, 2), hp: 8 - 1 - 2 });
    expect(unit(engine, 'orc-2').hp).toBe(8 - 2);
    expect(momentum(engine)).toBe(1);
  });

  it('Carga: straight free lane, lands adjacent, hits; empowered adds damage and a push', () => {
    const engine = arena(p(0, 2), [p(4, 2)]);
    const r = play(engine, 'warrior_charge', p(4, 2));
    expect(r.ok).toBe(true);
    expect(unit(engine, 'warrior').pos).toEqual(p(3, 2));
    expect(ofType(r.ok ? r.events : [], 'UNIT_MOVED')[0]).toMatchObject({ mode: 'CHARGE', path: [p(1, 2), p(2, 2), p(3, 2)] });
    expect(unit(engine, 'orc-1').hp).toBe(6);
    expect(momentum(engine)).toBe(1); // engage
    const e2 = arena(p(0, 2), [p(3, 2)]);
    setMomentum(e2, 2);
    play(e2, 'warrior_charge', p(3, 2));
    expect(unit(e2, 'orc-1')).toMatchObject({ hp: 5, pos: p(4, 2) });
  });

  it('Carga obeys movement rules: blocked lanes, VOID, units, range, diagonals, ROOTED', () => {
    const blocked = (layout: string[], orcs = [p(4, 2)]) => {
      const engine = arena(p(0, 2), orcs, layout);
      const [uid] = setHand(engine, ['warrior_charge']);
      return engine.getValidTargets(uid!);
    };
    expect(blocked(['.......', '.......', '..r....', '.......', '.......'])).toEqual([]); // rubble
    expect(blocked(['.......', '.......', '..V....', '.......', '.......'])).toEqual([]); // VOID
    // A unit in the lane blocks the far target; the near one (distance 2, free lane) stays legal.
    expect(blocked(['.......', '.......', '.......', '.......', '.......'], [p(4, 2), p(2, 2)])).toEqual([p(2, 2)]);
    expect(blocked(['.......', '.......', '.......', '.......', '.......'], [p(5, 2)])).toEqual([]); // too far
    expect(blocked(['.......', '.......', '.......', '.......', '.......'], [p(2, 3)])).toEqual([]); // not aligned
    expect(blocked(['.......', '.......', '.......', '.......', '.......'], [p(1, 2)])).toEqual([]); // adjacent: nothing to charge
    const rooted = arena(p(0, 2), [p(3, 2)]);
    unit(rooted, 'warrior').statuses.push({ id: 'ROOTED', turnsLeft: 1 });
    const [uid] = setHand(rooted, ['warrior_charge']);
    expect(rooted.getValidTargets(uid!)).toEqual([]);
  });

  it('Guardia: 4 shield until the start of your next turn; you lose remaining movement', () => {
    const engine = arena(p(1, 2), [p(2, 2)]);
    play(engine, 'guard', null);
    expect(unit(engine, 'warrior').shield).toBe(4);
    expect(engine.state.player.movePoints).toBe(0);
    engine.dispatch(endTurn(engine)); // orc hits 3: absorbed
    expect(unit(engine, 'warrior').hp).toBe(24);
    expect(unit(engine, 'warrior').shield).toBe(0); // the rest expired at turn start
  });

  it('Contraataque: answers the first ADJACENT attack once, then is consumed; never chains', () => {
    const engine = arena(p(1, 2), [p(2, 2), p(1, 3)]);
    play(engine, 'riposte', null);
    const { events } = engine.dispatch(endTurn(engine)) as { events: import('../src/game').GameEvent[] };
    expect(ofType(events, 'COUNTER_ATTACK')).toHaveLength(1);
    const hit = ofType(events, 'COUNTER_ATTACK')[0]!;
    expect(unit(engine, hit.targetId).hp).toBe(8 - 3);
    expect(unit(engine, 'warrior').statuses.some((s) => s.id === 'RIPOSTE')).toBe(false);
  });

  it('Contraataque ignores non-adjacent attackers and expires at the start of your turn', () => {
    const engine = makeEngine({ hero: { heroId: 'warrior', pos: p(1, 2) }, enemies: [{ id: 'sh', enemyId: 'dark_shaman', pos: p(4, 2) }] });
    play(engine, 'riposte', null);
    const { events } = engine.dispatch(endTurn(engine)) as { events: import('../src/game').GameEvent[] };
    expect(ofType(events, 'COUNTER_ATTACK')).toHaveLength(0);
    expect(unit(engine, 'warrior').statuses).toEqual([]);
  });

  it('Segundo aliento: heal 2, or 5 with 2 Momentum; never above max HP', () => {
    const engine = arena();
    unit(engine, 'warrior').hp = 10;
    play(engine, 'second_wind', null);
    expect(unit(engine, 'warrior').hp).toBe(12);
    setMomentum(engine, 2);
    play(engine, 'second_wind', null);
    expect(unit(engine, 'warrior').hp).toBe(17);
    unit(engine, 'warrior').hp = 23;
    play(engine, 'second_wind', null);
    expect(unit(engine, 'warrior').hp).toBe(24);
  });

  it('Empujón brutal: pushes 2 (3 with Momentum); never into VOID (no falling); HAZARD is fine', () => {
    const intoVoid = arena(p(1, 2), [p(2, 2)], ['.......', '.......', '...V...', '.......', '.......']);
    play(intoVoid, 'brutal_shove', p(2, 2));
    expect(unit(intoVoid, 'orc-1')).toMatchObject({ pos: p(2, 2), hp: 6 });
    const intoHazard = arena(p(1, 2), [p(2, 2)], ['.......', '.......', '....H..', '.......', '.......']);
    play(intoHazard, 'brutal_shove', p(2, 2));
    expect(unit(intoHazard, 'orc-1').pos).toEqual(p(4, 2));
    const far = arena(p(0, 2), [p(1, 2)]);
    setMomentum(far, 1);
    play(far, 'brutal_shove', p(1, 2));
    expect(unit(far, 'orc-1').pos).toEqual(p(4, 2));
    expect(momentum(far)).toBe(0);
  });

  it('Avance: +1 movement and +1 Momentum for 0 energy', () => {
    const engine = arena();
    const before = engine.state.player.movePoints;
    play(engine, 'steady_advance', null);
    expect(engine.state.player.movePoints).toBe(before + 1);
    expect(momentum(engine)).toBe(1);
  });

  it('Barrido: hits every orthogonally adjacent enemy; empowered pushes them away', () => {
    const engine = arena(p(2, 2), [p(1, 2), p(3, 2), p(2, 1), p(3, 3)]);
    setMomentum(engine, 2);
    play(engine, 'sweep', null);
    expect(['orc-1', 'orc-2', 'orc-3'].map((id) => unit(engine, id).hp)).toEqual([5, 5, 5]);
    expect(unit(engine, 'orc-4').hp).toBe(8); // diagonal is not adjacent
    expect(unit(engine, 'orc-1').pos).toEqual(p(0, 2));
  });

  it('Agarre: roots the target so it cannot walk away', () => {
    const engine = makeEngine({ hero: { heroId: 'warrior', pos: p(1, 2) }, enemies: [{ id: 'sh', enemyId: 'dark_shaman', pos: p(2, 2) }] });
    play(engine, 'grapple', p(2, 2));
    expect(unit(engine, 'sh').statuses.map((s) => s.id)).toEqual(['ROOTED']);
    engine.dispatch(endTurn(engine));
    expect(unit(engine, 'sh').pos).toEqual(p(2, 2));
  });

  it('Muro de acero: you and adjacent allies gain 3 Guard; you plant', () => {
    const engine = makeEngine({
      hero: { heroId: 'warrior', pos: p(1, 2) },
      structures: [{ id: 'crystal', structureId: 'crystal', pos: p(2, 2) }],
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 4) }],
      objectives: [{ type: 'ELIMINATE_ALL' }],
    });
    play(engine, 'steel_wall', null);
    expect(unit(engine, 'warrior').shield).toBe(3);
    expect(unit(engine, 'crystal').shield).toBe(3);
    expect(unit(engine, 'orc-1').shield).toBe(0);
    expect(engine.state.player.movePoints).toBe(0);
  });

  it('Bastión: 5 Guard + Riposte + 1 Momentum, rooted through your next turn (pushes still move you)', () => {
    const engine = arena(p(1, 2), [p(5, 2)]);
    play(engine, 'bastion', null);
    const hero = unit(engine, 'warrior');
    expect(hero.shield).toBe(5);
    expect(hero.statuses.map((s) => s.id).sort()).toEqual(['RIPOSTE', 'ROOTED']);
    expect(momentum(engine)).toBe(1);
    engine.dispatch(endTurn(engine));
    expect(engine.getLegalMoves()).toEqual([]);
  });

  it('Embestida: charges 2–3 and drives the target 2 tiles down the lane', () => {
    const engine = arena(p(0, 2), [p(3, 2)]);
    play(engine, 'ram', p(3, 2));
    expect(unit(engine, 'warrior').pos).toEqual(p(2, 2));
    expect(unit(engine, 'orc-1')).toMatchObject({ pos: p(5, 2), hp: 7 });
    expect(momentum(engine)).toBe(2); // engage + card
  });

  it('Imparable: removes ROOTED / BURNING and grants 2 movement', () => {
    const engine = arena();
    unit(engine, 'warrior').statuses.push({ id: 'ROOTED', turnsLeft: 1 }, { id: 'BURNING', turnsLeft: 2 });
    const mp = engine.state.player.movePoints;
    play(engine, 'unstoppable', null);
    expect(unit(engine, 'warrior').statuses).toEqual([]);
    expect(engine.state.player.movePoints).toBe(mp + 2);
  });

  it('Furia de vanguardia: 2 damage, or 6 consuming 3 Momentum', () => {
    const engine = arena(p(1, 2), [p(2, 2), p(1, 1)]);
    play(engine, 'vanguard_fury', p(2, 2));
    expect(unit(engine, 'orc-1').hp).toBe(6);
    setMomentum(engine, 3);
    play(engine, 'vanguard_fury', p(1, 1));
    expect(unit(engine, 'orc-2').hp).toBe(2);
    expect(momentum(engine)).toBe(0);
  });
});

describe('Warrior in PvP (Duel / Arcane Dominion)', () => {
  const profile = createProfile(DEFAULT_CONTENT);
  const loadout = (heroId: string) => validateLoadout(profile, heroId);
  /** Duel with the Warrior as seat 0, made the active seat. */
  function duel(opponent = 'mage', mode: 'DUEL' | 'DOMINION' = 'DUEL'): GameState {
    let s = createDuel([loadout('warrior'), loadout(opponent)], 7, mode);
    if (s.duel!.active !== 0) s = applyDuel(s, endTurn(s)).state;
    return s;
  }
  const seat = (s: GameState, i: 0 | 1) => s.units.find((u) => u.id === s.duel!.champions[i])!;
  const hand = (s: GameState, cardId: string) => {
    s.player.hand = [{ uid: 'w-1', cardId }];
    s.player.energy = 4;
    return 'w-1';
  };

  it('a Warrior loadout is a validated starter deck; unknown champions are refused', () => {
    expect(loadout('warrior').heroId).toBe('warrior');
    expect(() => validateLoadout(profile, 'paladin')).toThrow('UNKNOWN_CHAMPION');
    expect(() => validateLoadout(profile, 'toString')).toThrow('UNKNOWN_CHAMPION');
  });

  it('duel: the server rules validate charge targets, melee reach and cards in hand', () => {
    const s = duel();
    seat(s, 0).pos = p(0, 1);
    seat(s, 1).pos = p(3, 1);
    const uid = hand(s, 'warrior_charge');
    expect(() => applyDuel(s, { type: 'PLAY_CARD', cardUid: uid, target: p(3, 2) })).toThrow('INVALID_TARGET');
    expect(() => applyDuel(s, { type: 'PLAY_CARD', cardUid: 'forged', target: p(3, 1) })).toThrow('CARD_NOT_IN_HAND');
    const after = applyDuel(s, { type: 'PLAY_CARD', cardUid: uid, target: p(3, 1) }).state;
    expect(seat(after, 0).pos).toEqual(p(2, 1));
    expect(seat(after, 1).hp).toBe(DEFAULT_CONTENT.heroes.mage!.maxHp - 2);
    const melee = duel();
    seat(melee, 1).pos = p(5, 5);
    expect(() => applyDuel(melee, { type: 'PLAY_CARD', cardUid: hand(melee, 'heavy_strike'), target: p(5, 5) })).toThrow('INVALID_TARGET');
  });

  it('clients cannot forge Momentum, charge distance or empowerment: commands carry none of it', () => {
    const forged = { type: 'PLAY_CARD', cardUid: 'w-1', target: p(1, 1), empowered: true, momentum: 3, distance: 9 };
    expect(validCommand(forged)).toBe(true); // extra keys are ignored…
    const s = duel();
    seat(s, 1).pos = p(1, 1);
    seat(s, 0).pos = p(0, 1);
    hand(s, 'heavy_strike');
    const r = applyDuel(s, forged as unknown as Command);
    // …the server decides from its own state: 0 Momentum → base 3 damage.
    expect(seat(r.state, 1).hp).toBe(DEFAULT_CONTENT.heroes.mage!.maxHp - 3);
    expect(ofType(r.events, 'CARD_PLAYED')[0]!.empowered).toBeUndefined();
  });

  it('Momentum and defensive state are authoritative, visible to both seats and survive reconnect', () => {
    let s = duel('summoner');
    seat(s, 0).pos = p(0, 1);
    seat(s, 1).pos = p(1, 1);
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: hand(s, 'shield_bash'), target: p(1, 1) }).state;
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: hand(s, 'riposte'), target: null }).state;
    // Reconnect = the room reloads its stored JSON and re-projects each seat's view.
    const restored = JSON.parse(JSON.stringify(s)) as GameState;
    expect(restored).toEqual(s);
    for (const viewer of [0, 1] as const) {
      const w = duelView(restored, viewer).units.find((u) => u.id === 'champion-a')!;
      expect(w.momentum?.value).toBe(1);
      expect(w.shield).toBe(2);
      expect(w.statuses.map((x) => x.id)).toContain('RIPOSTE');
    }
    const next = applyDuel(restored, endTurn(restored)).state;
    expect(next.duel!.active).toBe(1);
    expect(seat(next, 0).statuses.map((x) => x.id)).toContain('RIPOSTE'); // still guarding during the rival's turn
  });

  it('mirror: a Riposte answering a Riposte never chains', () => {
    const s = duel('warrior');
    seat(s, 0).pos = p(2, 2);
    seat(s, 1).pos = p(3, 2);
    for (const i of [0, 1] as const) seat(s, i).statuses.push({ id: 'RIPOSTE', turnsLeft: 1 });
    const r = applyDuel(s, { type: 'PLAY_CARD', cardUid: hand(s, 'heavy_strike'), target: p(3, 2) });
    expect(ofType(r.events, 'COUNTER_ATTACK')).toHaveLength(1);
    expect(seat(r.state, 0).hp).toBe(24 - 3);
    expect(seat(r.state, 0).statuses.map((x) => x.id)).toEqual(['RIPOSTE']); // untouched: counters are not attacks to answer
    expect(seat(r.state, 1).hp).toBe(24 - 3);
  });

  it('Arcane Dominion: pushing the rival off a node takes it from them; standing on it holds it', () => {
    const s = duel('mage', 'DOMINION');
    const node = DOMINION_NODES[0]!;
    seat(s, 1).pos = { ...node };
    seat(s, 0).pos = { x: node.x - 1, y: node.y };
    refreshDominion(s);
    expect(s.dominion!.nodes[0]!.control).toBe(1);
    const pushed = applyDuel(s, { type: 'PLAY_CARD', cardUid: hand(s, 'shield_bash'), target: node }).state;
    expect(seat(pushed, 1).pos).toEqual({ x: node.x + 1, y: node.y });
    expect(pushed.dominion!.nodes[0]!.control).toBe('NEUTRAL');
    const held = applyDuel(pushed, { type: 'MOVE_UNIT', unitId: 'champion-a', to: node }).state;
    expect(held.dominion!.nodes[0]!.control).toBe(0);
  });

  it('a duel with Warriors replays to the identical state (determinism)', () => {
    const commands: Command[] = [];
    let live = createDuel([loadout('warrior'), loadout('warrior')], 11);
    for (let i = 0; i < 3; i++) {
      commands.push(endTurn(live));
      live = applyDuel(live, commands.at(-1)!).state;
    }
    const run = () => commands.reduce((st, c) => applyDuel(st, c).state, createDuel([loadout('warrior'), loadout('warrior')], 11));
    expect(run()).toEqual(live);
    expect(run()).toEqual(run());
  });
});

describe('Warrior campaign readiness and server authority', () => {
  it('El Ascenso lists the Warrior; a Warrior run plays and replay-verifies its first encounter', () => {
    expect(ASCENT_CAMPAIGN.heroIds).toContain('warrior');
    const profile = createProfile(DEFAULT_CONTENT);
    const run = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 5, 'warrior');
    const encounter = currentEncounter(ASCENT_CAMPAIGN, run);
    expect(encounter.hero.heroId).toBe('warrior');
    for (let seed = 1; seed < 30; seed++) {
      const engine = new GameEngine(encounter, campaignBattleContent(DEFAULT_CONTENT, profile, run, DECK_RULES), seed);
      playBattle(engine);
      if (engine.state.outcome?.result !== 'WON') continue;
      const proof = { encounterId: encounter.id, seed, commands: JSON.parse(JSON.stringify(engine.history)) };
      expect(verifyVictory(ASCENT_CAMPAIGN, DEFAULT_CONTENT, profile, run, proof, DECK_RULES)).toMatchObject({ ok: true });
      // A forged command list (one command dropped) never verifies as the same victory.
      const forged = { ...proof, commands: proof.commands.slice(0, -1) };
      expect(verifyVictory(ASCENT_CAMPAIGN, DEFAULT_CONTENT, profile, run, forged, DECK_RULES).ok).toBe(false);
      return;
    }
    throw new Error('the bot never won encounter 1 with the Warrior');
  });

  const deps = { content: DEFAULT_CONTENT, now: () => 1_000_000, seed: () => 7 };
  async function call(db: ReturnType<typeof memoryD1>, env: Record<string, unknown>, token: string, method: string, path: string, body?: unknown) {
    const res = await handle(
      new Request(`https://api.test/api/tactics${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }),
      { DB: db, ...env },
      deps,
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  it('the server keeps the Warrior locked unless WARRIOR_ENABLED (or WARRIOR_QA for QA accounts)', async () => {
    const db = memoryD1({ legacyProfiles: true });
    const ana = addAccount(db, 'ana').token;
    const qa = addAccount(db, 'tactics_qa_a').token;
    for (const t of [ana, qa]) await call(db, {}, t, 'POST', '/profile', {});
    db.sql.exec('UPDATE tactics_profiles SET campaign_best = 6');
    const deck = starterDeck(WARRIOR);
    expect((await call(db, {}, ana, 'PUT', '/champion', { championId: 'warrior' })).status).toBe(403);
    expect((await call(db, {}, ana, 'PUT', '/decks/warrior/main', { cards: deck })).status).toBe(403);
    expect((await call(db, {}, ana, 'POST', '/campaign/start', { heroId: 'warrior' })).status).toBe(403);
    expect((await call(db, { PVP_ROOMS: {} }, ana, 'POST', '/pvp/join', { code: 'ABCDEFGH', heroId: 'warrior' })).status).toBe(403);
    expect((await call(db, { WARRIOR_QA: '1' }, ana, 'PUT', '/champion', { championId: 'warrior' })).status).toBe(403);
    const qaState = await call(db, { WARRIOR_QA: '1' }, qa, 'PUT', '/champion', { championId: 'warrior' });
    expect(qaState.status).toBe(200);
    expect(qaState.body.warriorAvailable).toBe(true);
    const open = await call(db, { WARRIOR_ENABLED: '1' }, ana, 'POST', '/campaign/start', { heroId: 'warrior' });
    expect(open.body.runs.warrior).toMatchObject({ heroId: 'warrior', completedEncounterIds: [] });
  });

  it('ownership: a champion added after the account was created keeps its starter set once it stores cards', async () => {
    const db = memoryD1({ legacyProfiles: true });
    const { id, token } = addAccount(db, 'ana');
    await call(db, {}, token, 'POST', '/profile', {});
    db.sql.prepare('UPDATE tactics_profiles SET campaign_best = 6 WHERE user_id = ?').run(id);
    // Simulate an account created before the Warrior existed: no Warrior starter rows at all.
    db.sql.prepare("DELETE FROM tactics_player_cards WHERE user_id = ? AND hero_id = 'warrior'").run(id);
    db.sql.prepare("DELETE FROM tactics_decks WHERE user_id = ? AND hero_id = 'warrior'").run(id);
    db.sql.prepare("DELETE FROM tactics_deck_cards WHERE user_id = ? AND hero_id = 'warrior'").run(id);
    // Its first earned card is stored…
    db.sql.prepare("INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, 'warrior', 'grapple', 1, 1, 'NORMAL_DROP', 0)").run(id);
    const state = await call(db, { WARRIOR_ENABLED: '1' }, token, 'GET', '/state');
    const collection = state.body.profile.heroes.warrior.collection as Record<string, { copies: number }>;
    expect(collection.grapple!.copies).toBe(1);
    for (const e of starterDeck(WARRIOR)) expect(collection[e.cardId]!.copies, e.cardId).toBe(e.count);
    // …and a deck using it validates against the server's collection.
    const deck = starterDeck(WARRIOR).map((e) => (e.cardId === 'steady_advance' ? { cardId: 'steady_advance', count: 2 } : e)).concat({ cardId: 'grapple', count: 1 });
    expect((await call(db, { WARRIOR_ENABLED: '1' }, token, 'PUT', '/decks/warrior/main', { cards: deck })).status).toBe(200);
    const reloaded = await call(db, { WARRIOR_ENABLED: '1' }, token, 'GET', '/state');
    expect(reloaded.body.profile.heroes.warrior.collection.guard.copies).toBe(3);
  });
});
