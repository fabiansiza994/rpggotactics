import { describe, expect, it } from 'vitest';
import {
  addCard,
  ARSENAL_CARDS,
  ARSENAL_EXPANSION,
  ARSENAL_NEUTRAL_CARDS,
  createProfile,
  DECK_RULES,
  DEFAULT_CONTENT,
  GameEngine,
  removeCard,
  rollReward,
  starterDeck,
  validateDeck,
  withHeroDeck,
  type DeckEntry,
  type GameContent,
  type GameEvent,
  type GameState,
} from '../src/game';
import { planIntent } from '../src/game/domain/ai/ai';
import { attackDamage } from '../src/game/domain/combat/attack-modifiers';
import { actSummons, spawnSummon } from '../src/game/domain/summons/summons';
import { applyStatus } from '../src/game/domain/statuses/status-rules';
import type { ScenarioDef } from '../src/game/domain/scenario';
import { replayBattle } from '../src/game/engine/replay';
import type { Command } from '../src/game/engine/commands';
import { applyDuel, createDuel, duelView, DUEL_SCENARIO, validateLoadout } from '../src/game/pvp/duel';
import { cardsForHero } from '../src/game/collection/deck-rules';
import { ownedCard } from '../src/game/collection/profile';
import { browseCollection, EMPTY_QUERY } from '../src/presentation/react/deckbuilder/collectionView';
import { ctxFor, makeEngine, mutable, ofType, p, scenario, setHand, unit } from './helpers';

type Spawn = { id: string; enemyId?: string; pos: { x: number; y: number }; targetPreference?: 'HERO' | 'OBJECTIVE' };
const HEROES = ['mage', 'summoner', 'warrior'] as const;

function battle(heroId: string, heroPos: { x: number; y: number }, enemies: Spawn[], overrides: Partial<ScenarioDef> = {}): GameEngine {
  const engine = makeEngine({ hero: { heroId, pos: heroPos }, enemies: enemies.map((e) => ({ enemyId: 'orc_warrior', ...e })), ...overrides });
  mutable(engine).player.energy = 9;
  return engine;
}
const play = (engine: GameEngine, cardId: string, target: { x: number; y: number } | null) => {
  const [uid] = setHand(engine, [cardId]);
  const r = engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target });
  return r;
};
const targetsOf = (engine: GameEngine, cardId: string) => engine.getValidTargets(setHand(engine, [cardId])[0]!);
const hero = (engine: GameEngine) => unit(engine, engine.heroId);
const plan = (engine: GameEngine, enemyId: string) =>
  planIntent(ctxFor(engine), engine.state.intents.find((i) => i.enemyId === enemyId)!)!;
const endTurn = (engine: GameEngine) => {
  const events: GameEvent[] = [];
  const off = engine.subscribe((evs) => events.push(...evs));
  expect(engine.dispatch({ type: 'END_TURN' }).ok).toBe(true);
  off();
  return events;
};
function summon(engine: GameEngine, summonId: string, pos: { x: number; y: number }) {
  const s = spawnSummon(ctxFor(engine), hero(engine), summonId, pos);
  if (!s) throw new Error(`could not spawn ${summonId}`);
  s.summon!.readyRound = engine.state.round;
  return s;
}

describe('Arsenal I: data', () => {
  it('12 new cards: 3 per champion + 3 neutral, 6 COMMON + 6 RARE, existing rarities only', () => {
    expect(ARSENAL_CARDS).toHaveLength(12);
    const byHero = (h: string | undefined) => ARSENAL_CARDS.filter((c) => c.heroId === h).length;
    expect([byHero('mage'), byHero('summoner'), byHero('warrior'), byHero(undefined)]).toEqual([3, 3, 3, 3]);
    expect(ARSENAL_CARDS.filter((c) => c.rarity === 'COMMON')).toHaveLength(6);
    expect(ARSENAL_CARDS.filter((c) => c.rarity === 'RARE')).toHaveLength(6);
    for (const c of ARSENAL_CARDS) {
      expect(DEFAULT_CONTENT.cards[c.id]).toBe(c);
      expect(c.expansion).toBe(ARSENAL_EXPANSION);
      expect(c.acquisition).toBeUndefined(); // normal progression: never store / promo / gift / world exclusive
    }
  });

  it('exactly 3 Showcase Rares (Sello de Silencio, Instinto Alfa, Rompeguardia), all RARE', () => {
    const showcase = ARSENAL_CARDS.filter((c) => c.presentation.premiumTreatment === 'showcase');
    expect(showcase.map((c) => [c.id, c.heroId, c.rarity])).toEqual([
      ['silence_seal', 'mage', 'RARE'],
      ['alpha_instinct', 'summoner', 'RARE'],
      ['guard_breaker', 'warrior', 'RARE'],
    ]);
    // Every Showcase in the game sits in a released-on-purpose set (Arsenal I, «Vitrina I»).
    expect(Object.values(DEFAULT_CONTENT.cards).filter((c) => c.presentation.premiumTreatment && c.expansion === ARSENAL_EXPANSION)).toHaveLength(3);
  });

  it('showcase is presentation only: same copy limit as any RARE, same deck rules', () => {
    const twice = (heroId: string, cardId: string): DeckEntry[] => {
      let deck = starterDeck(DEFAULT_CONTENT.heroes[heroId]!);
      for (let i = 0; i < 2; i++) deck = addCard(removeCard(deck, deck[0]!.cardId), cardId);
      return deck;
    };
    const limit = (heroId: string, cardId: string) =>
      validateDeck(twice(heroId, cardId), heroId, () => 3, DEFAULT_CONTENT, DECK_RULES).find((i) => i.code === 'COPY_LIMIT');
    expect(limit('summoner', 'alpha_instinct')).toEqual({ ...limit('summoner', 'bond_sacrifice')!, cardId: 'alpha_instinct' });
    expect(limit('warrior', 'guard_breaker')).toMatchObject({ code: 'COPY_LIMIT', limit: 1 });
  });

  it('starter decks are unchanged: no Arsenal card in any starter', () => {
    const ids = new Set(ARSENAL_CARDS.map((c) => c.id));
    for (const h of HEROES) expect(DEFAULT_CONTENT.heroes[h]!.deck.filter((e) => ids.has(e.cardId))).toEqual([]);
  });

  it('only the owning champion can play a champion card', () => {
    const engine = battle('mage', p(1, 2), [{ id: 'orc-1', pos: p(2, 2) }]);
    const [uid] = setHand(engine, ['guard_breaker']);
    expect(engine.getCardPlayability(uid!)).toMatchObject({ playable: false });
  });
});

describe('Arsenal I: acquisition (normal reward pools, QA-gated until release)', () => {
  const offered = (content: GameContent, heroId: string, poolId: 'NORMAL' | 'ELITE' | 'BOSS' = 'NORMAL') =>
    new Set(
      Array.from({ length: 400 }, (_, seed) =>
        rollReward({ content, heroId, owned: () => 0, pity: 9, rules: DECK_RULES, poolId, seed, count: 3 }).options.flatMap((o) =>
          o.kind === 'ADD_CARD' ? [o.cardId] : [],
        ),
      ).flat(),
    );
  it('never offered before release; afterwards COMMON in normal rewards, RARE (Showcase included) in elite/boss rewards', () => {
    const released = { ...DEFAULT_CONTENT, releasedExpansions: [ARSENAL_EXPANSION] };
    for (const heroId of HEROES) {
      const mine = ARSENAL_CARDS.filter((c) => !c.heroId || c.heroId === heroId);
      const ids = (r: string) => mine.filter((c) => c.rarity === r).map((c) => c.id);
      for (const pool of ['NORMAL', 'ELITE', 'BOSS'] as const) {
        const before = offered(DEFAULT_CONTENT, heroId, pool);
        expect(mine.filter((c) => before.has(c.id))).toEqual([]);
      }
      expect([...offered(released, heroId, 'NORMAL')]).toEqual(expect.arrayContaining(ids('COMMON')));
      expect([...offered(released, heroId, 'BOSS')]).toEqual(expect.arrayContaining(ids('RARE')));
      expect(ids('RARE').filter((id) => offered(released, heroId, 'NORMAL').has(id))).toEqual([]);
    }
  });
});

describe('Arsenal I: Deck Builder', () => {
  it('Arsenal neutrals count toward the max-4 neutral rule', () => {
    let deck = starterDeck(DEFAULT_CONTENT.heroes.warrior!);
    for (const id of ['smoke_bomb', 'grappling_hook', 'grappling_hook', 'field_ration', 'take_cover'])
      deck = addCard(removeCard(deck, deck[0]!.cardId), id);
    expect(validateDeck(deck, 'warrior', () => 3, DEFAULT_CONTENT, DECK_RULES)).toContainEqual(
      expect.objectContaining({ code: 'NEUTRAL_LIMIT', limit: 4 }),
    );
  });

  it('every champion pool shows its 3 new cards + the 3 neutrals; the origin filter splits them', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    for (const heroId of HEROES) {
      const pool = cardsForHero(DEFAULT_CONTENT, heroId);
      const ids = pool.map((c) => c.id);
      for (const c of ARSENAL_CARDS.filter((x) => !x.heroId || x.heroId === heroId)) expect(ids).toContain(c.id);
      for (const c of ARSENAL_CARDS.filter((x) => x.heroId && x.heroId !== heroId)) expect(ids).not.toContain(c.id);
      const lookup = (id: string) => ownedCard(profile, heroId, id, DEFAULT_CONTENT);
      const neutral = browseCollection(pool, lookup, { ...EMPTY_QUERY, origin: 'NEUTRAL' }).map((c) => c.id);
      expect(neutral).toEqual(expect.arrayContaining(ARSENAL_NEUTRAL_CARDS.map((c) => c.id)));
    }
  });

  it('categories match the roles', () => {
    const cat = (id: string) => DEFAULT_CONTENT.cards[id]!.category;
    expect(['arcane_chain', 'silence_seal', 'challenge', 'grappling_hook'].map(cat)).toEqual(['CONTROL', 'CONTROL', 'CONTROL', 'CONTROL']);
    expect(['mirror_step', 'pack_call', 'titan_step'].map(cat)).toEqual(['MOVEMENT', 'MOVEMENT', 'MOVEMENT']);
    expect(['bond_sacrifice', 'smoke_bomb', 'field_ration'].map(cat)).toEqual(['DEFENSE', 'DEFENSE', 'DEFENSE']);
    expect(['alpha_instinct', 'guard_breaker'].map(cat)).toEqual(['ATTACK', 'ATTACK']);
  });
});

describe('Cadena Arcana', () => {
  it('range 4 with line of sight: 1 arcane damage and Rooted 1 turn (the orc cannot walk)', () => {
    const engine = battle('mage', p(0, 2), [{ id: 'orc-1', pos: p(4, 2) }, { id: 'far', pos: p(6, 0) }]);
    expect(targetsOf(engine, 'arcane_chain')).toEqual([p(4, 2)]);
    expect(play(engine, 'arcane_chain', p(4, 2)).ok).toBe(true);
    expect(unit(engine, 'orc-1').hp).toBe(7);
    expect(unit(engine, 'orc-1').statuses.map((s) => s.id)).toEqual(['ROOTED']);
    endTurn(engine);
    expect(unit(engine, 'orc-1').pos).toEqual(p(4, 2));
    expect(unit(engine, 'orc-1').statuses).toEqual([]); // 1 turn, then gone
  });

  it('no infinite root: a second chain refreshes the root, never extends it', () => {
    const engine = battle('mage', p(0, 2), [{ id: 'orc-1', pos: p(4, 2) }]);
    play(engine, 'arcane_chain', p(4, 2));
    play(engine, 'arcane_chain', p(4, 2));
    expect(unit(engine, 'orc-1').statuses).toEqual([{ id: 'ROOTED', turnsLeft: 1 }]);
  });
});

describe('Paso Espejo', () => {
  it('walks up to 2 free tiles without spending movement and gains 2 shield', () => {
    const engine = battle('mage', p(0, 2), [{ id: 'orc-1', pos: p(6, 2) }]);
    const mp = engine.state.player.movePoints;
    expect(targetsOf(engine, 'mirror_step')).toContainEqual(p(2, 2));
    expect(targetsOf(engine, 'mirror_step')).not.toContainEqual(p(3, 2));
    expect(play(engine, 'mirror_step', p(1, 3)).ok).toBe(true);
    expect(hero(engine).pos).toEqual(p(1, 3));
    expect(hero(engine).shield).toBe(2);
    expect(engine.state.player.movePoints).toBe(mp);
  });

  it('a legal walk, unlike Blink: never through a pillar, never while Rooted', () => {
    const engine = battle('mage', p(0, 2), [{ id: 'orc-1', pos: p(6, 2) }], { layout: ['.......', '##.....', '.#.....', '##.....', '.......'] });
    expect(targetsOf(engine, 'mirror_step')).toEqual([]);
    const open = battle('mage', p(0, 2), [{ id: 'orc-1', pos: p(6, 2) }]);
    applyStatus(ctxFor(open), hero(open), 'ROOTED', 1, 'test');
    expect(targetsOf(open, 'mirror_step')).toEqual([]);
  });
});

describe('Sello de Silencio', () => {
  it('the sealed enemy hits for 2 less, in the telegraph and on execution; it expires after its turn', () => {
    const engine = battle('mage', p(0, 2), [{ id: 'orc-1', pos: p(2, 2) }]);
    const hp = hero(engine).hp;
    expect(plan(engine, 'orc-1').damage).toBe(3);
    expect(play(engine, 'silence_seal', p(2, 2)).ok).toBe(true);
    expect(plan(engine, 'orc-1').damage).toBe(1);
    endTurn(engine);
    expect(hero(engine).hp).toBe(hp - 1);
    expect(unit(engine, 'orc-1').statuses).toEqual([]);
  });

  it('never below 1, never a full silence of a boss (Coloso 6 → 4)', () => {
    const imp = battle('mage', p(0, 2), [{ id: 'imp', enemyId: 'infernal_imp', pos: p(1, 2) }]);
    play(imp, 'silence_seal', p(1, 2));
    expect(plan(imp, 'imp').damage).toBe(1);
    const boss = battle('mage', p(0, 2), [{ id: 'boss', enemyId: 'stone_colossus', pos: p(1, 2) }]);
    play(boss, 'silence_seal', p(1, 2));
    expect(plan(boss, 'boss').damage).toBe(4);
  });

  it('removes the hit rider: no push (Caballero), no burn (Diablillo), and the telegraph says so', () => {
    const knight = battle('mage', p(1, 2), [{ id: 'k', enemyId: 'infernal_knight', pos: p(2, 2) }]);
    expect(plan(knight, 'k').onHit?.push).toBeDefined();
    play(knight, 'silence_seal', p(2, 2));
    expect(plan(knight, 'k').onHit).toBeUndefined();
    expect(ofType(endTurn(knight), 'UNIT_PUSHED')).toEqual([]);
    expect(hero(knight).pos).toEqual(p(1, 2));
    const imp = battle('mage', p(0, 2), [{ id: 'imp', enemyId: 'infernal_imp', pos: p(1, 2) }]);
    play(imp, 'silence_seal', p(1, 2));
    endTurn(imp);
    expect(hero(imp).statuses).toEqual([]);
  });
});

describe('Llamado de la Manada', () => {
  it('summons within 3 get +1 move on this action: a fox reaches an enemy it would miss', () => {
    // Fox (move 4) at (0,0), enemy at (6,0): five steps to (5,0) — only with the call.
    const setup = () => {
      const engine = battle('summoner', p(0, 2), [{ id: 'orc-1', pos: p(6, 0) }]);
      const fox = summon(engine, 'fox', p(0, 0));
      return { engine, fox };
    };
    const plain = setup();
    actSummons(ctxFor(plain.engine));
    expect(unit(plain.engine, 'orc-1').hp).toBe(8);
    const called = setup();
    expect(play(called.engine, 'pack_call', null).ok).toBe(true);
    expect(unit(called.engine, called.fox.id).statuses.map((s) => s.id)).toEqual(['PACK_CALL']);
    actSummons(ctxFor(called.engine));
    expect(unit(called.engine, called.fox.id).pos).toEqual(p(5, 0));
    expect(unit(called.engine, 'orc-1').hp).toBe(6);
  });

  it('never moves or commands them itself, and only reaches your summons within 3', () => {
    const engine = battle('summoner', p(0, 2), [{ id: 'orc-1', pos: p(6, 4) }]);
    const near = summon(engine, 'fox', p(1, 1));
    const far = summon(engine, 'chicken', p(5, 0));
    const events: GameEvent[] = [];
    engine.subscribe((evs) => events.push(...evs));
    play(engine, 'pack_call', null);
    expect(ofType(events, 'UNIT_MOVED')).toEqual([]);
    expect(unit(engine, near.id).statuses.map((s) => s.id)).toEqual(['PACK_CALL']);
    expect(unit(engine, far.id).statuses).toEqual([]);
  });
});

describe('Sacrificio del Vínculo', () => {
  it('retires your summon: capacity freed, 5 shield, +1 energy (net 0: no loop)', () => {
    const engine = battle('summoner', p(0, 2), [{ id: 'orc-1', pos: p(6, 2) }]);
    const fox = summon(engine, 'fox', p(1, 2));
    const energy = engine.state.player.energy;
    expect(play(engine, 'bond_sacrifice', p(1, 2)).ok).toBe(true);
    expect(engine.state.units.some((u) => u.id === fox.id)).toBe(false);
    expect(hero(engine).shield).toBe(5);
    expect(engine.state.player.energy).toBe(energy);
    expect(spawnSummon(ctxFor(engine), hero(engine), 'wolf', p(1, 2))).not.toBeNull(); // capacity 2 free again
  });

  it('needs one of YOUR summons: no enemy, no ally champion, nothing without a summon', () => {
    const engine = battle('summoner', p(0, 2), [{ id: 'orc-1', pos: p(1, 2) }]);
    expect(targetsOf(engine, 'bond_sacrifice')).toEqual([]);
    const [uid] = setHand(engine, ['bond_sacrifice']);
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(1, 2) }).ok).toBe(false);
  });
});

describe('Instinto Alfa', () => {
  const setup = () => {
    const engine = battle('summoner', p(0, 2), [{ id: 'near', pos: p(2, 2) }, { id: 'prey', pos: p(2, 0) }]);
    const fox = summon(engine, 'fox', p(1, 2));
    return { engine, fox };
  };
  it('+1 damage on its attack this turn; +2 against your marked prey', () => {
    const plain = setup();
    play(plain.engine, 'alpha_instinct', plain.fox.pos);
    actSummons(ctxFor(plain.engine));
    expect(unit(plain.engine, 'near').hp).toBe(8 - 3);
    const marked = setup();
    play(marked.engine, 'mark_prey', p(2, 0));
    play(marked.engine, 'alpha_instinct', marked.fox.pos);
    actSummons(ctxFor(marked.engine));
    expect(unit(marked.engine, 'prey').hp).toBe(8 - 4);
  });

  it('does not stack: a second Instinto on the same summon is still +1', () => {
    const { engine, fox } = setup();
    play(engine, 'alpha_instinct', fox.pos);
    play(engine, 'alpha_instinct', fox.pos);
    expect(unit(engine, fox.id).statuses).toEqual([{ id: 'ALPHA_INSTINCT', turnsLeft: 1 }]);
    actSummons(ctxFor(engine));
    expect(unit(engine, 'near').hp).toBe(5);
  });

  it('ends with the turn (no permanent buff)', () => {
    const { engine, fox } = setup();
    play(engine, 'alpha_instinct', fox.pos);
    endTurn(engine);
    expect(engine.state.units.find((u) => u.id === fox.id)?.statuses ?? []).toEqual([]);
  });
});

describe('Desafío', () => {
  it('an objective-hunting enemy re-targets the Warrior at once (public telegraph) and he gains 2 Guard', () => {
    const engine = battle('warrior', p(3, 2), [{ id: 'orc-1', pos: p(3, 0), targetPreference: 'OBJECTIVE' }], {
      structures: [{ id: 'crystal', structureId: 'crystal', pos: p(0, 0) }],
      objectives: [{ type: 'PROTECT_TARGET', targetUnitId: 'crystal', rounds: 9 }],
    });
    expect(engine.state.intents[0]).toMatchObject({ targetUnitId: 'crystal' });
    expect(play(engine, 'challenge', p(3, 0)).ok).toBe(true);
    expect(engine.state.intents[0]).toMatchObject({ targetUnitId: engine.heroId });
    expect(hero(engine).shield).toBe(2);
    expect(unit(engine, 'orc-1').statuses).toEqual([{ id: 'CHALLENGED', turnsLeft: 1, sourceId: engine.heroId }]);
    endTurn(engine);
    expect(unit(engine, 'crystal').hp).toBe(10);
    expect(unit(engine, 'orc-1').statuses).toEqual([]);
  });

  it('its attacks against anyone else deal 2 less (never below 1)', () => {
    const engine = battle('warrior', p(3, 2), [{ id: 'orc-1', pos: p(3, 0) }], {
      structures: [{ id: 'crystal', structureId: 'crystal', pos: p(0, 0) }],
    });
    play(engine, 'challenge', p(3, 0));
    const ctx = ctxFor(engine);
    expect(attackDamage(ctx, unit(engine, 'orc-1'), unit(engine, 'crystal'), 3)).toBe(1);
    expect(attackDamage(ctx, unit(engine, 'orc-1'), unit(engine, 'crystal'), 1)).toBe(1);
    expect(attackDamage(ctx, unit(engine, 'orc-1'), hero(engine), 3)).toBe(3);
  });

  it('one challenge per Warrior: challenging another enemy releases the first', () => {
    const engine = battle('warrior', p(3, 2), [{ id: 'a', pos: p(3, 0) }, { id: 'b', pos: p(5, 2) }]);
    play(engine, 'challenge', p(3, 0));
    play(engine, 'challenge', p(5, 2));
    expect(unit(engine, 'a').statuses).toEqual([]);
    expect(unit(engine, 'b').statuses.map((s) => s.id)).toEqual(['CHALLENGED']);
  });
});

describe('Rompeguardia', () => {
  it('3 damage that ignores armor (Bruto de Piedra) where Golpe pesado deals 2', () => {
    const engine = battle('warrior', p(1, 2), [{ id: 'b', enemyId: 'stone_brute', pos: p(2, 2) }]);
    play(engine, 'guard_breaker', p(2, 2));
    expect(unit(engine, 'b').hp).toBe(8 - 3);
    const heavy = battle('warrior', p(1, 2), [{ id: 'b', enemyId: 'stone_brute', pos: p(2, 2) }]);
    play(heavy, 'heavy_strike', p(2, 2));
    expect(unit(heavy, 'b').hp).toBe(8 - 2);
  });

  it('breaks up to 2 shield first; that extra never reaches HP', () => {
    const engine = battle('warrior', p(1, 2), [{ id: 'orc-1', pos: p(2, 2) }]);
    unit(engine, 'orc-1').shield = 4;
    const events: GameEvent[] = [];
    engine.subscribe((evs) => events.push(...evs));
    play(engine, 'guard_breaker', p(2, 2));
    expect(ofType(events, 'SHIELD_SHATTERED')).toEqual([expect.objectContaining({ amount: 2, total: 2 })]);
    expect(unit(engine, 'orc-1')).toMatchObject({ shield: 0, hp: 8 - 1 });
    const thin = battle('warrior', p(1, 2), [{ id: 'orc-1', pos: p(2, 2) }]);
    unit(thin, 'orc-1').shield = 1;
    play(thin, 'guard_breaker', p(2, 2));
    expect(unit(thin, 'orc-1')).toMatchObject({ shield: 0, hp: 8 - 3 });
  });

  it('melee only', () => {
    const engine = battle('warrior', p(0, 2), [{ id: 'orc-1', pos: p(2, 2) }]);
    expect(targetsOf(engine, 'guard_breaker')).toEqual([]);
  });
});

describe('Paso del Titán', () => {
  it('walks 2 free tiles without movement; next to an enemy: 2 Guard + the normal engage Impulso', () => {
    const engine = battle('warrior', p(0, 2), [{ id: 'orc-1', pos: p(3, 2) }]);
    const mp = engine.state.player.movePoints;
    expect(play(engine, 'titan_step', p(2, 2)).ok).toBe(true);
    expect(hero(engine)).toMatchObject({ pos: p(2, 2), shield: 2 });
    expect(hero(engine).momentum!.value).toBe(1);
    expect(engine.state.player.movePoints).toBe(mp);
  });

  it('no Guard when it ends away from enemies', () => {
    const engine = battle('warrior', p(0, 2), [{ id: 'orc-1', pos: p(6, 2) }]);
    play(engine, 'titan_step', p(2, 2));
    expect(hero(engine).shield).toBe(0);
    expect(hero(engine).momentum!.value).toBe(0);
  });

  it('never a second Momentum trigger: engage is still once per round', () => {
    const engine = battle('warrior', p(0, 2), [{ id: 'a', pos: p(2, 2) }, { id: 'b', pos: p(0, 4) }]);
    expect(engine.dispatch({ type: 'MOVE_UNIT', unitId: engine.heroId, to: p(1, 2) }).ok).toBe(true);
    expect(hero(engine).momentum!.value).toBe(1);
    play(engine, 'titan_step', p(0, 3)); // ends next to b, but this round's engage is spent
    expect(hero(engine).momentum!.value).toBe(1);
    expect(hero(engine).shield).toBe(2);
  });
});

describe('Bomba de Humo', () => {
  it('you and your allies in the 3×3 take 1 less from each enemy attack until your next turn', () => {
    const engine = battle('summoner', p(1, 2), [{ id: 'orc-1', pos: p(2, 2) }, { id: 'orc-2', pos: p(5, 0) }]);
    const fox = summon(engine, 'fox', p(1, 1));
    const hp = hero(engine).hp;
    expect(play(engine, 'smoke_bomb', p(1, 2)).ok).toBe(true);
    expect(hero(engine).statuses.map((s) => s.id)).toEqual(['SMOKE_SCREEN']);
    expect(unit(engine, fox.id).statuses.map((s) => s.id)).toEqual(['SMOKE_SCREEN']);
    expect(unit(engine, 'orc-1').statuses).toEqual([]); // enemies in the cloud get nothing
    expect(plan(engine, 'orc-1').damage).toBe(2);
    endTurn(engine);
    expect(hero(engine).hp).toBe(hp - 2);
    expect(hero(engine).statuses).toEqual([]); // gone at the start of your turn
  });

  it('only attacks: terrain and status ticks are untouched', () => {
    const engine = battle('mage', p(0, 2), [{ id: 'orc-1', pos: p(6, 2) }]);
    play(engine, 'smoke_bomb', p(1, 2));
    const ctx = ctxFor(engine);
    expect(attackDamage(ctx, undefined, hero(engine), 2)).toBe(2);
    expect(attackDamage(ctx, unit(engine, 'orc-1'), hero(engine), 3)).toBe(2);
  });
});

describe('Gancho', () => {
  it('pulls an enemy at range 3 one tile toward you, no damage', () => {
    const engine = battle('warrior', p(0, 2), [{ id: 'orc-1', pos: p(3, 2) }]);
    expect(play(engine, 'grappling_hook', p(3, 2)).ok).toBe(true);
    expect(unit(engine, 'orc-1')).toMatchObject({ pos: p(2, 2), hp: 8 });
  });

  it('stops at blockers and next to you (the push rules, reversed)', () => {
    const engine = battle('mage', p(0, 2), [{ id: 'orc-1', pos: p(1, 2) }]);
    play(engine, 'grappling_hook', p(1, 2));
    expect(unit(engine, 'orc-1')).toMatchObject({ pos: p(1, 2), hp: 8 });
    const rubble = battle('mage', p(0, 2), [{ id: 'orc-1', pos: p(3, 2) }], { layout: ['.......', '.......', '..r....', '.......', '.......'] });
    play(rubble, 'grappling_hook', p(3, 2));
    expect(unit(rubble, 'orc-1').pos).toEqual(p(3, 2));
  });

  it('bosses follow the same displacement rules as pushes (no immovable rule exists)', () => {
    const engine = battle('mage', p(0, 2), [{ id: 'boss', enemyId: 'stone_colossus', pos: p(3, 2) }]);
    play(engine, 'grappling_hook', p(3, 2));
    expect(unit(engine, 'boss').pos).toEqual(p(2, 2));
  });
});

describe('Ración de Campaña', () => {
  it('heal 1; heal 2 at half HP or less (always below Primeros auxilios: 3 for 2)', () => {
    const engine = battle('mage', p(0, 2), [{ id: 'orc-1', pos: p(6, 2) }]);
    hero(engine).hp = 15;
    expect(play(engine, 'field_ration', null).ok).toBe(true);
    expect(hero(engine).hp).toBe(16);
    expect(DEFAULT_CONTENT.cards.field_ration!.cost).toBeLessThan(DEFAULT_CONTENT.cards.first_aid!.cost);
    const low = battle('mage', p(0, 2), [{ id: 'orc-1', pos: p(6, 2) }]);
    hero(low).hp = 10;
    play(low, 'field_ration', null);
    expect(hero(low).hp).toBe(12);
  });
});

describe('Arsenal I: replay and PvP', () => {
  it('replay reproduces every new effect exactly (live twice + headless server replay)', () => {
    const sc = scenario({
      hero: { heroId: 'warrior', pos: p(0, 2) },
      enemies: [{ id: 'a', enemyId: 'orc_warrior', pos: p(4, 2) }, { id: 'b', enemyId: 'stone_brute', pos: p(5, 0) }],
    });
    const deck = [
      { cardId: 'titan_step', count: 6 },
      { cardId: 'guard_breaker', count: 6 },
      { cardId: 'challenge', count: 6 },
      { cardId: 'grappling_hook', count: 6 },
      { cardId: 'smoke_bomb', count: 6 },
    ];
    const content = withHeroDeck(DEFAULT_CONTENT, 'warrior', deck);
    const run = (fixed?: readonly Command[]) => {
      const engine = new GameEngine(sc, content, 5);
      const log: string[] = [];
      engine.subscribe((evs) => log.push(...evs.map((e) => e.type)));
      const cmds: Command[] = [];
      const send = (c: Command) => {
        expect(engine.dispatch(c).ok).toBe(true);
        cmds.push(c);
      };
      if (fixed) for (const c of fixed) send(c);
      else
        for (let turn = 0; turn < 5 && !engine.state.outcome; turn++) {
          for (const card of [...engine.state.player.hand]) {
            if (!engine.getCardPlayability(card.uid).playable) continue;
            const t = DEFAULT_CONTENT.cards[card.cardId]!.targeting.type === 'SELF' ? null : engine.getValidTargets(card.uid)[0];
            if (t !== undefined) send({ type: 'PLAY_CARD', cardUid: card.uid, target: t });
          }
          send({ type: 'END_TURN' });
        }
      return { state: engine.state, log, cmds };
    };
    const a = run();
    const b = run(a.cmds);
    expect(b.log).toEqual(a.log);
    expect(b.state).toEqual(a.state);
    for (const t of ['STATUS_APPLIED', 'UNIT_PUSHED', 'UNIT_MOVED']) expect(a.log).toContain(t);
    const headless = replayBattle(sc, content, 5, a.cmds);
    expect(headless.rejectedAt).toBeNull();
    expect(headless.state).toEqual(a.state);
  });

  const duel = (a: string, b: string, seed = 21) => {
    const profile = createProfile(DEFAULT_CONTENT);
    let state = createDuel([validateLoadout(profile, a), validateLoadout(profile, b)], seed);
    if (state.player.heroId !== 'champion-a') state = applyDuel(state, { type: 'END_TURN' }).state;
    const me = state.units.find((u) => u.id === 'champion-a')!;
    const rival = state.units.find((u) => u.id === 'champion-b')!;
    state.player.energy = 9;
    return { state, me, rival };
  };

  it('PvP: Sello on the rival champion — its next card attack deals 2 less (min 1), server-side', () => {
    const d = duel('mage', 'warrior');
    const { me, rival } = d;
    let state = d.state;
    me.pos = { x: 2, y: 2 };
    rival.pos = { x: 3, y: 2 };
    state.player.hand = [{ uid: 'seal', cardId: 'silence_seal' }];
    state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'seal', target: rival.pos }).state;
    state = applyDuel(state, { type: 'END_TURN' }).state;
    expect(state.player.heroId).toBe(rival.id);
    state.player.energy = 9;
    state.player.hand = [{ uid: 'hit', cardId: 'heavy_strike' }];
    const before = state.units.find((u) => u.id === me.id)!;
    const hp = before.hp + before.shield;
    state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'hit', target: { x: 2, y: 2 } }).state;
    const after = state.units.find((u) => u.id === me.id)!;
    expect(hp - (after.hp + after.shield)).toBe(1);
  });

  it('PvP: every new status is public and survives the wire snapshot (statuses + sourceId)', () => {
    const d = duel('warrior', 'summoner');
    const { me, rival } = d;
    let state = d.state;
    me.pos = { x: 2, y: 2 };
    rival.pos = { x: 4, y: 2 };
    state.player.hand = [
      { uid: 'ch', cardId: 'challenge' },
      { uid: 'smoke', cardId: 'smoke_bomb' },
      { uid: 'hook', cardId: 'grappling_hook' },
    ];
    state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'ch', target: rival.pos }).state;
    state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'smoke', target: me.pos }).state;
    state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'hook', target: rival.pos }).state;
    expect(state.units.find((u) => u.id === rival.id)!.pos).toEqual({ x: 3, y: 2 });
    for (const seat of [0, 1] as const) {
      const wire = JSON.parse(JSON.stringify(duelView(state, seat)));
      const engine = GameEngine.fromSnapshot(wire, DEFAULT_CONTENT, DUEL_SCENARIO);
      expect(engine.state.units.find((u) => u.id === rival.id)!.statuses).toEqual([{ id: 'CHALLENGED', turnsLeft: 1, sourceId: me.id }]);
      expect(engine.state.units.find((u) => u.id === me.id)!.statuses).toEqual([{ id: 'SMOKE_SCREEN', turnsLeft: 1 }]);
    }
  });

  it('PvP: a challenged rival summon goes for the challenger; illegal targets are refused by the server', () => {
    const d = duel('warrior', 'summoner');
    const { me, rival } = d;
    let state = d.state;
    me.pos = { x: 2, y: 2 };
    rival.pos = { x: 6, y: 4 };
    const ctx = { state, content: DEFAULT_CONTENT, emit: () => {} };
    const fox = spawnSummon(ctx, rival, 'fox', { x: 3, y: 0 })!;
    fox.summon!.readyRound = 0;
    state.player.hand = [
      { uid: 'ch', cardId: 'challenge' },
      { uid: 'gb', cardId: 'guard_breaker' },
    ];
    expect(() => applyDuel(state, { type: 'PLAY_CARD', cardUid: 'gb', target: { x: 3, y: 0 } })).toThrow();
    state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'ch', target: { x: 3, y: 0 } }).state;
    const end = applyDuel(state, { type: 'END_TURN' });
    state = end.state;
    // The rival summoner's turn: its fox acts at that turn's end and must pick the Warrior.
    const events = applyDuel(state, { type: 'END_TURN' }).events;
    expect(ofType(events, 'SUMMON_ATTACKED')).toContainEqual(expect.objectContaining({ unitId: fox.id, targetId: me.id }));
  });

  it('PvP: Sacrificio / Instinto are legal only on your own summon (server-authoritative)', () => {
    const d = duel('summoner', 'summoner');
    const { rival } = d;
    let state = d.state;
    const ctx = { state, content: DEFAULT_CONTENT, emit: () => {} };
    const me = state.units.find((u) => u.id === state.player.heroId)!;
    me.pos = { x: 2, y: 2 };
    rival.pos = { x: 6, y: 4 };
    spawnSummon(ctx, rival, 'fox', { x: 3, y: 2 });
    state.player.hand = [
      { uid: 'sac', cardId: 'bond_sacrifice' },
      { uid: 'alpha', cardId: 'alpha_instinct' },
    ];
    expect(() => applyDuel(state, { type: 'PLAY_CARD', cardUid: 'sac', target: { x: 3, y: 2 } })).toThrow();
    expect(() => applyDuel(state, { type: 'PLAY_CARD', cardUid: 'alpha', target: { x: 3, y: 2 } })).toThrow();
    spawnSummon(ctx, me, 'fox', { x: 2, y: 1 });
    state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'alpha', target: { x: 2, y: 1 } }).state;
    state = applyDuel(state, { type: 'PLAY_CARD', cardUid: 'sac', target: { x: 2, y: 1 } }).state;
    expect(state.units.filter((u) => u.kind === 'SUMMON' && u.summon!.ownerId === me.id)).toEqual([]);
    expect(state.units.find((u) => u.id === me.id)!.shield).toBe(5);
  });
});

describe('Arsenal I: serialization', () => {
  it('a battle snapshot with every new status round-trips through JSON', () => {
    const engine = battle('summoner', p(1, 2), [{ id: 'orc-1', pos: p(3, 2) }]);
    const fox = summon(engine, 'fox', p(1, 1));
    const ctx = ctxFor(engine);
    applyStatus(ctx, unit(engine, 'orc-1'), 'SEALED', 1, engine.heroId);
    applyStatus(ctx, unit(engine, 'orc-1'), 'CHALLENGED', 1, engine.heroId);
    applyStatus(ctx, hero(engine), 'SMOKE_SCREEN', 1, engine.heroId);
    applyStatus(ctx, unit(engine, fox.id), 'PACK_CALL', 1, engine.heroId);
    applyStatus(ctx, unit(engine, fox.id), 'ALPHA_INSTINCT', 1, engine.heroId);
    const wire = JSON.parse(JSON.stringify(engine.state)) as GameState;
    const back = GameEngine.fromSnapshot(wire, engine.content, scenario());
    expect(back.state).toEqual(engine.state);
    expect(plan(back, 'orc-1').damage).toBe(plan(engine, 'orc-1').damage);
  });
});
