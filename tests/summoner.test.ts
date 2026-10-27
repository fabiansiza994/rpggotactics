import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, DECK_RULES } from '../src/game/data';
import { parseProfileSave, serializeProfile } from '../src/game/collection/profile-save';
import {
  createProfile,
  ownedFor,
  battleDeck,
} from '../src/game/collection/profile';
import { validateDeck } from '../src/game/collection/deck-rules';
import { dealDamage, defeatUnit } from '../src/game/domain/combat/damage';
import { actSummons, spawnSummon, summonUsage } from '../src/game/domain/summons/summons';
import { evaluateObjective } from '../src/game/domain/objectives/objective-rules';
import { canEnter } from '../src/game/domain/board/occupancy';
import { makeEngine, ctxFor, mutable, p, setHand, endTurn } from './helpers';

const engine = () => makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) } });
const summon = (e: ReturnType<typeof engine>, pos = p(1, 2)) => {
  const [uid] = setHand(e, ['summon_chicken']);
  return e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: pos });
};

describe('Summoner foundation', () => {
  it('uses the shared pathfinder to detour around a wall instead of stalling', () => {
    const e = makeEngine({
      hero: { heroId: 'summoner', pos: p(0, 2) },
      layout: ['.......', '..#....', '..#....', '..#....', '.......'],
    });
    summon(e);
    mutable(e).round = 2;
    const events: import('../src/game/domain/events').GameEvent[] = [];
    actSummons(ctxFor(e, events));
    expect(events.some((ev) => ev.type === 'UNIT_MOVED' && ev.unitId.startsWith('summon-'))).toBe(true);
    expect(e.state.units.find((u) => u.kind === 'SUMMON')?.pos).not.toEqual(p(1, 2));
    expect(e.state.player.movePoints).toBe(3);
  });
  it('has a legal persisted starter deck, the shared 5/6 hand and capacity 2', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    const deck = battleDeck(profile, 'summoner', DEFAULT_CONTENT, DECK_RULES);
    expect(
      validateDeck(deck.cards, 'summoner', ownedFor(profile, 'summoner', DEFAULT_CONTENT), DEFAULT_CONTENT, DECK_RULES),
    ).toEqual([]);
    const e = engine();
    expect(e.state.player.hand).toHaveLength(5);
    expect(e.state.player).toMatchObject({ handSize: 5, maxHandSize: 6 }); // no special 4-card cap any more
    expect(deck.cards.reduce((n, c) => n + c.count, 0)).toBe(30);
    expect(DEFAULT_CONTENT.heroes.summoner!.summonCapacity).toBe(2);
    const loaded = parseProfileSave(serializeProfile(profile), DEFAULT_CONTENT);
    expect(loaded.status).toBe('OK');
    if (loaded.status === 'OK')
      expect(battleDeck(loaded.profile, 'summoner', DEFAULT_CONTENT, DECK_RULES).cards).toEqual(
        deck.cards,
      );
    const old = parseProfileSave(
      serializeProfile({ ...profile, heroes: { mage: profile.heroes.mage! } }),
      DEFAULT_CONTENT,
    );
    expect(old.status).toBe('OK');
    if (old.status === 'OK')
      expect(battleDeck(old.profile, 'summoner', DEFAULT_CONTENT, DECK_RULES).cards).toEqual(
        deck.cards,
      );
  });

  it('rejects class cards in combat, deck builder and battle loadout', () => {
    const mage = makeEngine();
    const [uid] = setHand(mage, ['summon_chicken']);
    expect(mage.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(1, 2) })).toMatchObject({
      ok: false,
      error: 'WRONG_CLASS',
    });
    expect(
      validateDeck(
        [{ cardId: 'summon_chicken', count: 3 }],
        'mage',
        () => 3,
        DEFAULT_CONTENT,
        DECK_RULES,
      ),
    ).toContainEqual({ code: 'WRONG_HERO', cardId: 'summon_chicken', heroId: 'mage' });
    expect(() =>
      makeEngine(
        {},
        {
          ...DEFAULT_CONTENT,
          heroes: {
            ...DEFAULT_CONTENT.heroes,
            mage: {
              ...DEFAULT_CONTENT.heroes.mage!,
              deck: [{ cardId: 'summon_chicken', count: 3 }],
            },
          },
        },
      ),
    ).toThrow(/not legal/);
    const e = engine();
    const [mageCard] = setHand(e, ['magic_missile']);
    expect(e.getCardPlayability(mageCard!)).toMatchObject({
      playable: false,
      reason: 'WRONG_CLASS',
    });
  });

  it('creates an owned actor, consumes card and energy, blocks movement', () => {
    const e = engine();
    expect(summon(e).ok).toBe(true);
    const pollo = e.state.units.find((u) => u.kind === 'SUMMON')!;
    expect(pollo).toMatchObject({
      defId: 'chicken',
      faction: 'PLAYER',
      pos: p(1, 2),
      hp: 3,
      summon: { ownerId: e.heroId, capacityCost: 1, readyRound: 2 },
    });
    expect(e.state.player.energy).toBe(2);
    expect(e.state.player.hand).toHaveLength(0);
    expect(e.state.player.discard.at(-1)?.cardId).toBe('summon_chicken');
    expect(canEnter(ctxFor(e), pollo.pos)).toBe(false);
  });

  it.each([p(0, 2), p(6, 2), p(-1, 2), p(3, 2)])(
    'rejects occupied, off-board or out-of-range tile %j atomically',
    (pos) => {
      const e = engine();
      const [uid] = setHand(e, ['summon_chicken']);
      const before = structuredClone(e.state);
      expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: pos })).toMatchObject({
        ok: false,
        error: 'INVALID_TARGET',
      });
      expect(e.state).toEqual(before);
    },
  );

  it('rejects blocked terrain and obstacle tiles', () => {
    const e = makeEngine({
      hero: { heroId: 'summoner', pos: p(0, 2) },
      layout: ['.......', '.x.....', '.#.....', '.......', '.......'],
    });
    expect(summon(e, p(1, 1)).ok).toBe(false);
    expect(summon(e, p(1, 2)).ok).toBe(false);
  });

  it('enforces capacity before paying and releases it on death', () => {
    const e = engine();
    expect(summon(e).ok).toBe(true);
    expect(summon(e, p(0, 1)).ok).toBe(true);
    mutable(e).player.energy = 4;
    const [uid] = setHand(e, ['summon_chicken']);
    const before = structuredClone(e.state);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(0, 3) })).toMatchObject({
      ok: false,
      error: 'SUMMON_CAPACITY',
    });
    expect(e.state).toEqual(before);
    const pollo = mutable(e).units.find((u) => u.kind === 'SUMMON')!;
    dealDamage(ctxFor(e), pollo, 3, 'test', 'PHYSICAL');
    expect(summonUsage(e.state, e.heroId)).toBe(1);
    expect(e.state.stats.enemiesDefeated).toBe(0);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(1, 2) }).ok).toBe(true);
    expect(summonUsage(e.state, e.heroId)).toBe(2);
  });

  it('supports future capacity-2 definitions without special-case chicken rules', () => {
    const e = engine();
    const content = {
      ...DEFAULT_CONTENT,
      summons: {
        ...DEFAULT_CONTENT.summons,
        heavy: { ...DEFAULT_CONTENT.summons!.chicken!, id: 'heavy', capacityCost: 2 },
      },
    };
    const ctx = { ...ctxFor(e), content };
    const hero = mutable(e).units.find((u) => u.id === e.heroId)!;
    expect(spawnSummon(ctx, hero, 'heavy', p(1, 2))).not.toBeNull();
    expect(spawnSummon(ctx, hero, 'chicken', p(0, 1))).toBeNull();
    expect(summonUsage(e.state, hero.id)).toBe(2);
  });

  it('delays activation, acts once per round and stays beyond the old lifetime', () => {
    const e = engine();
    summon(e);
    const id = e.state.units.find((u) => u.kind === 'SUMMON')!.id;
    expect(e.dispatch(endTurn(e)).ok).toBe(true);
    expect(e.state.units.find((u) => u.id === id)?.pos).toEqual(p(1, 2));
    // Isolate ally behavior while retaining the normal turn pipeline.
    mutable(e).units.find((u) => u.faction === 'ENEMY')!.pos = p(5, 2);
    const events: import('../src/game/domain/events').GameEvent[] = [];
    actSummons(ctxFor(e, events));
    expect(events.filter((ev) => ev.type === 'UNIT_MOVED')).toHaveLength(2);
    expect(events.filter((ev) => ev.type === 'UNIT_DAMAGED')).toHaveLength(1);
    expect(mutable(e).units.find((u) => u.faction === 'ENEMY')!.hp).toBe(7);
    actSummons(ctxFor(e));
    expect(mutable(e).units.find((u) => u.faction === 'ENEMY')!.hp).toBe(7);
    // No time expiry: no enemies, retain the normal turn pipeline.
    mutable(e).units = mutable(e).units.filter((u) => u.faction === 'PLAYER');
    mutable(e).objectives = [
      { def: { type: 'SURVIVE_ROUNDS', rounds: 8 }, status: 'IN_PROGRESS', current: 1, target: 8 },
    ];
    for (let i = 0; i < 3; i++) expect(e.dispatch(endTurn(e)).ok).toBe(true);
    expect(e.state.units.some((u) => u.id === id)).toBe(true);
    expect(summonUsage(e.state, e.heroId)).toBe(1);
    expect(e.state.player.hand.length).toBeLessThanOrEqual(4);
  });

  it('collects mission pickups using movement, while REACH remains hero-only', () => {
    const e = makeEngine({
      hero: { heroId: 'summoner', pos: p(0, 2) },
      collectibles: [{ id: 'orb', kind: 'ORB', pos: p(3, 1) }],
      objectives: [{ type: 'COLLECT_OBJECTS', kind: 'ORB', required: 1 }],
    });
    summon(e, p(0, 1));
    mutable(e).round = 2;
    actSummons(ctxFor(e));
    expect(e.state.collectibles[0]?.collected).toBe(true);
    expect(
      evaluateObjective(mutable(e), { type: 'REACH_TILE', tiles: [p(3, 1)], roundLimit: 8 }).status,
    ).toBe('IN_PROGRESS');
    expect(e.state.units.find((u) => u.kind === 'SUMMON')?.pos).toEqual(p(3, 1));
  });

  it('support heals a persistent summon', () => {
    const e = engine();
    summon(e);
    const pollo = mutable(e).units.find((u) => u.kind === 'SUMMON')!;
    pollo.hp = 1;
    const [uid] = setHand(e, ['nurture']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: pollo.pos }).ok).toBe(true);
    expect(e.state.units.find((u) => u.id === pollo.id)).toMatchObject({
      hp: 3,
      summon: { ownerId: e.heroId },
    });
  });

  it('stun prevents actions, owner death removes summons, replay is deterministic', () => {
    const e = engine();
    summon(e);
    const pollo = mutable(e).units.find((u) => u.kind === 'SUMMON')!;
    pollo.statuses.push({ id: 'STUNNED', turnsLeft: 1 });
    mutable(e).round = 2;
    actSummons(ctxFor(e));
    expect(pollo.pos).toEqual(p(1, 2));
    defeatUnit(
      ctxFor(e),
      mutable(e).units.find((u) => u.id === e.heroId)!,
    );
    expect(e.state.units.filter((u) => u.kind === 'SUMMON')).toHaveLength(0);
    const a = engine(),
      b = engine();
    summon(a);
    summon(b);
    for (let i = 0; i < 3; i++) {
      a.dispatch(endTurn(a));
      b.dispatch(endTurn(b));
    }
    expect(a.state).toEqual(b.state);
  });
});
