import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTENT,
  DECK_RULES,
  createProfile,
  grantCard,
  ownedFor,
  validateDeck,
  addCard,
  removeCard,
  battleDeck,
  rollReward,
  parseProfileSave,
  serializeProfile,
} from '../src/game';
import {
  actSummons,
  retreatSummon,
  spawnSummon,
  summonUsage,
} from '../src/game/domain/summons/summons';
import { canEnter, terrainDefAt } from '../src/game/domain/board/occupancy';
import { manhattan } from '../src/game/domain/core/position';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import type { GameEvent } from '../src/game';
import { makeEngine, ctxFor, mutable, p, setHand } from './helpers';

const make = (layout = ['.......', '.......', '.......', '.......', '.......']) =>
  makeEngine({
    layout,
    hero: { heroId: 'summoner', pos: p(0, 0) },
    enemies: [{ id: 'enemy', enemyId: 'orc_warrior', pos: p(4, 2) }],
  });
const spawn = (e: ReturnType<typeof make>, id = 'chicken', pos = p(3, 2)) =>
  spawnSummon(
    ctxFor(e),
    mutable(e).units.find((u) => u.id === e.heroId)!,
    id,
    pos,
  )!;

describe('Summoner roster and tactical roles', () => {
  it('chicken approaches, attacks, then retreats once in causal order', () => {
    const e = make();
    const u = spawn(e, 'chicken', p(1, 2));
    mutable(e).round = 2;
    const events: GameEvent[] = [];
    actSummons(ctxFor(e, events));
    expect(events.map((e) => e.type)).toEqual([
      'UNIT_MOVED',
      'SUMMON_ATTACKED',
      'UNIT_DAMAGED',
      'UNIT_MOVED',
    ]);
    expect(manhattan(u.pos, p(4, 2))).toBeGreaterThan(1);
    const pos = { ...u.pos };
    actSummons(ctxFor(e, events));
    expect(u.pos).toEqual(pos);
  });
  it('retreat stays put when trapped by blocked cells and occupied cells', () => {
    const e = make(['.......', '...x...', '..x....', '...x...', '.......']);
    const u = spawn(e);
    const before = { ...u.pos };
    retreatSummon(ctxFor(e), u, 2);
    expect(u.pos).toEqual(before);
  });
  it('retreat skips fire, ice, occupied tiles and blocked obstacles along the entire path', () => {
    const e = make(['.......', '...F...', '..I....', '...#...', '.......']);
    const u = spawn(e);
    const events: GameEvent[] = [];
    retreatSummon(ctxFor(e, events), u, 2);
    expect(events).toEqual([]);
    // Open a safe branch, keeping unsafe alternatives in place.
    mutable(e).board.tiles[2 * 7 + 2]!.terrain = 'NORMAL';
    retreatSummon(ctxFor(e, events), u, 2);
    expect(events).toHaveLength(1);
    const move = events[0];
    if (move?.type === 'UNIT_MOVED') {
      expect(move.path.length).toBeLessThanOrEqual(2);
      expect(move.path.every((pos) => !terrainDefAt(ctxFor(e), pos)?.isHazard)).toBe(true);
      expect(manhattan(move.to, p(4, 2))).toBeGreaterThan(1);
    }
  });
  it('rooted chicken can attack but cannot retreat', () => {
    const e = make();
    const u = spawn(e);
    u.statuses.push({ id: 'ROOTED', turnsLeft: 1 });
    mutable(e).round = 2;
    const events: GameEvent[] = [];
    actSummons(ctxFor(e, events));
    expect(events.some((e) => e.type === 'SUMMON_ATTACKED')).toBe(true);
    expect(u.pos).toEqual(p(3, 2));
  });
  it.each(['fox', 'turtle', 'raven', 'wolf'])('%s does not inherit chicken retreat', (id) => {
    const e = make();
    const u = spawn(e, id);
    mutable(e).round = 2;
    const events: GameEvent[] = [];
    actSummons(ctxFor(e, events));
    const attack = events.findIndex((e) => e.type === 'SUMMON_ATTACKED');
    expect(attack).toBeGreaterThanOrEqual(0);
    expect(events.slice(attack + 1).some((e) => e.type === 'UNIT_MOVED' && e.unitId === u.id)).toBe(
      false,
    );
  });
  it('fox chooses a safer legal flank rather than a surrounded attack tile', () => {
    const e = make();
    const u = spawn(e, 'fox', p(2, 2));
    const enemy = mutable(e).units.find((x) => x.faction === 'ENEMY')!;
    mutable(e).units.push(
      { ...structuredClone(enemy), id: 'other-a', pos: p(3, 1) },
      { ...structuredClone(enemy), id: 'other-b', pos: p(5, 1) },
    );
    mutable(e).round = 2;
    actSummons(ctxFor(e));
    expect(u.pos).toEqual(p(4, 3));
  });
  it('turtle holds distant deployed ground while wolf applies pressure', () => {
    const a = make(),
      b = make();
    const turtle = spawn(a, 'turtle', p(0, 2)),
      wolf = spawn(b, 'wolf', p(0, 2));
    mutable(a).round = 2;
    mutable(b).round = 2;
    actSummons(ctxFor(a));
    actSummons(ctxFor(b));
    expect(turtle.pos).toEqual(p(0, 2));
    expect(wolf.pos).not.toEqual(p(0, 2));
  });
  it('raven uses vision and range, low arcane damage and cleanses a nearby ally', () => {
    const e = make();
    const raven = spawn(e, 'raven', p(1, 2));
    const hero = mutable(e).units.find((u) => u.id === e.heroId)!;
    hero.pos = p(1, 1);
    hero.statuses.push({ id: 'ROOTED', turnsLeft: 2 });
    mutable(e).round = 2;
    const events: GameEvent[] = [];
    actSummons(ctxFor(e, events));
    expect(raven.pos).toEqual(p(1, 2));
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'UNIT_DAMAGED', damageType: 'ARCANE', rawAmount: 1 }),
    );
    expect(hero.statuses).toEqual([]);
    const blocked = make(['.......', '.......', '..#....', '.......', '.......']);
    spawn(blocked, 'raven', p(1, 2)).statuses.push({ id: 'ROOTED', turnsLeft: 1 });
    mutable(blocked).round = 2;
    const hits: GameEvent[] = [];
    actSummons(ctxFor(blocked, hits));
    expect(hits.some((e) => e.type === 'SUMMON_ATTACKED')).toBe(false);
  });
  it.each(['chicken', 'fox', 'turtle', 'raven', 'wolf'])(
    '%s shares owned spawn, capacity and persistent occupancy',
    (id) => {
      const e = make();
      const u = spawn(e, id);
      expect(u.summon?.ownerId).toBe(e.heroId);
      expect(canEnter(ctxFor(e), u.pos)).toBe(false);
      expect(summonUsage(e.state, e.heroId)).toBe(DEFAULT_CONTENT.summons![id]!.capacityCost);
      mutable(e).round = 4;
      actSummons(ctxFor(e));
      expect(e.state.units.some((x) => x.id === u.id)).toBe(true);
      expect(summonUsage(e.state, e.heroId)).toBe(DEFAULT_CONTENT.summons![id]!.capacityCost);
    },
  );
  it('wolf excludes a second capacity-1 unit, while fox permits two', () => {
    const a = make();
    spawn(a, 'wolf');
    expect(spawn(a, 'chicken', p(1, 1))).toBeNull();
    const b = make();
    spawn(b, 'fox');
    expect(spawn(b, 'chicken', p(1, 1))).not.toBeNull();
  });
  it('selected summon support cannot target the hero; recall releases capacity without extending life', () => {
    const e = make();
    const u = spawn(e, 'fox', p(1, 0));
    const [shield] = setHand(e, ['familiar_aegis']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: shield!, target: p(0, 0) }).ok).toBe(false);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: shield!, target: u.pos }).ok).toBe(true);
    expect(e.state.units.find((x) => x.id === u.id)?.shield).toBe(3);
    const [recall] = setHand(e, ['recall_familiar']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: recall!, target: u.pos }).ok).toBe(true);
    expect(summonUsage(e.state, e.heroId)).toBe(0);
    expect(e.state.player.energy).toBe(4);
  });
  it('starter has 30 legal cards; the Lobo and Recall stay locked until granted and persist', () => {
    const profile = createProfile(DEFAULT_CONTENT);
    const deck = battleDeck(profile, 'summoner', DEFAULT_CONTENT, DECK_RULES).cards;
    expect(deck.reduce((n, e) => n + e.count, 0)).toBe(30);
    const owned = ownedFor(profile, 'summoner', DEFAULT_CONTENT);
    for (const id of ['summon_chicken', 'summon_fox', 'summoner_blink']) expect(owned(id)).toBe(3);
    // One copy each of the specialised creatures/support: the second copy is still earned.
    for (const id of ['summon_turtle', 'summon_raven', 'familiar_aegis']) expect(owned(id)).toBe(1);
    for (const id of ['summon_wolf', 'recall_familiar']) expect(owned(id)).toBe(0);
    const custom = addCard(removeCard(deck, 'summoner_push'), 'summon_wolf');
    expect(
      validateDeck(custom, 'summoner', ownedFor(profile, 'summoner', DEFAULT_CONTENT), DEFAULT_CONTENT, DECK_RULES).map((i) => i.code),
    ).toEqual(['LOCKED']);
    const grant = grantCard(profile, 'summoner', 'summon_wolf', DEFAULT_CONTENT);
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    expect(
      validateDeck(
        custom,
        'summoner',
        ownedFor(grant.profile, 'summoner', DEFAULT_CONTENT),
        DEFAULT_CONTENT,
        DECK_RULES,
      ),
    ).toEqual([]);
    const save = parseProfileSave(serializeProfile(grant.profile), DEFAULT_CONTENT);
    expect(save.status).toBe('OK');
    if (save.status === 'OK')
      expect(save.profile.heroes.summoner?.collection.summon_wolf?.copies).toBe(1);
  });
  it('tier rewards select only Summoner cards and boss quality can unlock wolf', () => {
    const roll = rollReward({
      content: DEFAULT_CONTENT,
      heroId: 'summoner',
      owned: ownedFor(createProfile(DEFAULT_CONTENT), 'summoner', DEFAULT_CONTENT),
      pity: 4,
      rules: DECK_RULES,
      poolId: 'BOSS',
      seed: 1,
      count: 3,
    });
    const cards = roll.options.filter((o) => o.kind === 'ADD_CARD');
    expect(cards.some((o) => o.cardId === 'summon_wolf')).toBe(true);
    expect(cards.every((o) => DEFAULT_CONTENT.cards[o.cardId]?.heroId === 'summoner')).toBe(true);
  });
  it('summon timeline separates caster gesture, portal and visible arrival; attack precedes retreat', () => {
    const e = make();
    const events: GameEvent[] = [];
    e.subscribe((batch) => events.push(...batch));
    const [uid] = setHand(e, ['summon_chicken']);
    e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(1, 0) });
    const timeline = compileTimeline(events, (id) => id, false);
    const cast = timeline.cues.find((c) => c.kind === 'cast')!,
      portal = timeline.cues.find((c) => c.kind === 'spellImpact')!,
      arrival = timeline.cues.find((c) => c.event.type === 'UNIT_SPAWNED')!;
    expect(cast.at).toBeLessThan(portal.at);
    expect(portal.at).toBeLessThan(arrival.at);
  });
});
