import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, DECK_RULES, GameEngine, rollReward, withHeroDeck, type GameContent, type GameEvent, type GameState } from '../src/game';
import { FORBIDDEN_BOND, FORBIDDEN_BOND_EXPANSION } from '../src/game/data/forbidden-bond';
import { copyLimit, validateDeck } from '../src/game/collection/deck-rules';
import { summonCapacityView } from '../src/game/domain/summons/capacity-view';
import { spawnSummon, summonCapacityOf, summonUsage } from '../src/game/domain/summons/summons';
import { defeatUnit } from '../src/game/domain/combat/damage';
import { drawCards } from '../src/game/domain/cards/deck';
import { replayBattle } from '../src/game/engine/replay';
import type { Command } from '../src/game/engine/commands';
import { applyDuel, createDuel, duelView, duelEvents } from '../src/game/pvp/duel';
import { validCommand } from '../server/src/pvp';
import { suggestCapacityBond } from '../src/game/domain/ai/capacity-policy';
import { queryContext } from '../src/game/domain/context';
import { ctxFor, endTurn, makeEngine, mutable, ofType, p, scenario, setHand, unit } from './helpers';

/**
 * Vínculo Prohibido (qa/forbidden-bond/REPORT.md): sacrifice floor(HP / 2), +1 summon capacity for
 * the rest of THIS battle. Cases A–M of the brief, on the real engine.
 */

const ORC = (id: string, x: number, y: number) => ({ id, enemyId: 'orc_warrior', pos: p(x, y) });

function battle(hp?: number, content: GameContent = DEFAULT_CONTENT) {
  const e = makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) }, enemies: [ORC('orc-1', 6, 2)] }, content);
  mutable(e).player.energy = 9;
  if (hp !== undefined) unit(e, e.heroId).hp = hp;
  return e;
}
type Engine = ReturnType<typeof battle>;
const hero = (e: Engine) => unit(e, e.heroId);
const cap = (e: Engine) => summonCapacityView(e.state, e.content, e.heroId);
const summon = (e: Engine, summonId: string, pos: { x: number; y: number }) => {
  const s = spawnSummon(ctxFor(e), hero(e), summonId, pos);
  if (!s) throw new Error('spawn failed');
  return s;
};
const bond = (e: Engine) => {
  const [uid] = setHand(e, ['forbidden_bond']);
  return e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null });
};

describe('Vínculo Prohibido: catalog', () => {
  it('Summoner LEGENDARY Única, cost 2, 1 copy per deck, Spanish text with the 1 PV note', () => {
    const c = DEFAULT_CONTENT.cards.forbidden_bond!;
    expect(c).toBe(FORBIDDEN_BOND);
    expect(c).toMatchObject({ heroId: 'summoner', cost: 2, rarity: 'LEGENDARY', unique: true, minCasterHp: 2 });
    expect(copyLimit(c, DECK_RULES)).toBe(1);
    expect(c.rulesText).toContain('Sacrifica la mitad de tu vida actual');
    expect(c.rulesText).toContain('No puede usarse con 1 PV');
    // Additive: never "set capacity to 3".
    expect(c.effects).toEqual([{ type: 'SACRIFICE_HP', percentOfCurrent: 50 }, { type: 'GAIN_SUMMON_CAPACITY', amount: 1 }]);
  });

  it('unlock source undecided: own unreleased set, no acquisition, never in drops; not the Premium Track card', () => {
    const c = FORBIDDEN_BOND;
    expect(c.expansion).toBe(FORBIDDEN_BOND_EXPANSION);
    expect(DEFAULT_CONTENT.releasedExpansions).not.toContain(FORBIDDEN_BOND_EXPANSION);
    expect(c.acquisition).toBeUndefined();
    for (let seed = 1; seed <= 60; seed++) {
      const offer = JSON.stringify(rollReward({ heroId: 'summoner', content: DEFAULT_CONTENT, rules: DECK_RULES, owned: () => 0, seed, pity: 10, poolId: seed % 2 ? 'BOSS' : 'ELITE', count: 3 }));
      expect(offer).not.toContain('"forbidden_bond"');
    }
    // Pacto de la Doble Luna is untouched and still the Summoner's premium card.
    expect(DEFAULT_CONTENT.cards.double_moon_pact?.acquisition).toMatchObject({ source: 'RANKED_PREMIUM' });
  });

  it('a deck may hold one copy, never two', () => {
    const base = DEFAULT_CONTENT.heroes.summoner!.deck.filter((d) => d.cardId !== 'summon_chicken');
    const fill = 30 - base.reduce((n, d) => n + d.count, 0);
    const owned = () => 9;
    const one = [...base, { cardId: 'summon_chicken', count: fill - 1 }, { cardId: 'forbidden_bond', count: 1 }];
    const two = [...base, { cardId: 'summon_chicken', count: fill - 2 }, { cardId: 'forbidden_bond', count: 2 }];
    expect(validateDeck(one, 'summoner', owned, DEFAULT_CONTENT, DECK_RULES).map((x) => x.code)).not.toContain('COPY_LIMIT');
    expect(validateDeck(two, 'summoner', owned, DEFAULT_CONTENT, DECK_RULES).map((x) => x.code)).toContain('COPY_LIMIT');
  });
});

describe('Vínculo Prohibido: rules (A–M)', () => {
  it('A: 14 HP, capacity 2, no summons → 7 HP, capacity 3', () => {
    const e = battle(14);
    expect(cap(e)).toMatchObject({ used: 0, max: 2, bonus: 0 });
    expect(bond(e).ok).toBe(true);
    expect(hero(e).hp).toBe(7);
    expect(cap(e)).toMatchObject({ used: 0, max: 3, free: 3, bonus: 1 });
    expect(mutable(e).player.energy).toBe(7);
  });

  it('B: 8 HP with 1 summon → 4 HP, 1 / 3: two more summons fit', () => {
    const e = battle(8);
    summon(e, 'fox', p(1, 2));
    expect(bond(e).ok).toBe(true);
    expect(hero(e).hp).toBe(4);
    expect(cap(e)).toMatchObject({ used: 1, max: 3, free: 2 });
    const [a, b] = setHand(e, ['summon_chicken', 'summon_raven']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: a!, target: p(0, 1) }).ok).toBe(true);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: b!, target: p(0, 3) }).ok).toBe(true);
    expect(cap(e)).toMatchObject({ used: 3, max: 3, free: 0 });
  });

  it('C: capacity full (2 / 2) → 2 / 3 at once; nothing dies, nothing is summoned', () => {
    const e = battle();
    const fox = summon(e, 'fox', p(1, 2)),
      chicken = summon(e, 'chicken', p(0, 1));
    const [blocked] = setHand(e, ['summon_raven']);
    expect(e.getCardPlayability(blocked!)).toMatchObject({ playable: false, reason: 'SUMMON_CAPACITY' });
    const units = e.state.units.length;
    expect(bond(e).ok).toBe(true);
    expect(e.state.units.length).toBe(units);
    expect(e.state.units.map((u) => u.id)).toEqual(expect.arrayContaining([fox.id, chicken.id]));
    expect(cap(e)).toMatchObject({ used: 2, max: 3, free: 1 });
    const [raven] = setHand(e, ['summon_raven']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: raven!, target: p(0, 3) }).ok).toBe(true);
  });

  it('D / E: 3 HP → 2, 2 HP → 1, 5 HP → 3 (floor), never lethal', () => {
    for (const [before, after] of [[3, 2], [2, 1], [5, 3], [18, 9]] as const) {
      const e = battle(before);
      expect(bond(e).ok).toBe(true);
      expect(hero(e).hp).toBe(after);
      expect(e.state.outcome).toBeNull();
    }
  });

  it('F: at 1 HP the card is not playable (NOT_ENOUGH_HP), nothing is paid', () => {
    const e = battle(1);
    const [uid] = setHand(e, ['forbidden_bond']);
    expect(e.getCardPlayability(uid!)).toMatchObject({ playable: false, reason: 'NOT_ENOUGH_HP' });
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: null }).ok).toBe(false);
    expect(mutable(e).player.energy).toBe(9);
    expect(hero(e).hp).toBe(1);
    expect(cap(e).max).toBe(2);
  });

  it('the sacrifice is a cost, not damage: shield and armor never absorb it, no damage event', () => {
    const e = battle(10);
    hero(e).shield = 5;
    const seen: GameEvent[] = [];
    e.subscribe((evs) => seen.push(...evs));
    bond(e);
    expect(hero(e)).toMatchObject({ hp: 5, shield: 5 });
    expect(ofType(seen, 'UNIT_DAMAGED')).toHaveLength(0);
    expect(ofType(seen, 'HP_SACRIFICED')).toEqual([{ type: 'HP_SACRIFICED', unitId: e.heroId, cardId: 'forbidden_bond', amount: 5, hpAfter: 5 }]);
    expect(ofType(seen, 'SUMMON_CAPACITY_CHANGED')).toEqual([{ type: 'SUMMON_CAPACITY_CHANGED', unitId: e.heroId, cardId: 'forbidden_bond', from: 2, to: 3, bonus: 1 }]);
    expect(ofType(seen, 'CARD_BANISHED')).toHaveLength(1);
  });

  it('G: a second activation in the same battle is refused (the copy is banished; a forged 2nd copy is refused)', () => {
    const e = battle(16);
    expect(bond(e).ok).toBe(true);
    expect(mutable(e).player.banished?.map((c) => c.cardId)).toEqual(['forbidden_bond']);
    const [again] = setHand(e, ['forbidden_bond']);
    expect(e.getCardPlayability(again!)).toMatchObject({ playable: false, reason: 'UNIQUE_ALREADY_USED' });
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: again!, target: null }).ok).toBe(false);
    expect(hero(e).hp).toBe(8);
    expect(cap(e).max).toBe(3);
  });

  it('H: recycling the deck never brings it back; a regenerated instance cannot resolve again', () => {
    const e = battle(16);
    expect(bond(e).ok).toBe(true);
    const s = mutable(e);
    s.player.deck = [];
    s.player.discard = [{ uid: 'd1', cardId: 'summon_fox' }, { uid: 'd2', cardId: 'summon_chicken' }];
    s.player.hand = [];
    drawCards(ctxFor(e), 2);
    expect([...s.player.hand, ...s.player.deck, ...s.player.discard].some((c) => c.cardId === 'forbidden_bond')).toBe(false);
    // A copy/regeneration effect that hands it back under a new uid still meets the Única guard.
    s.player.hand.push({ uid: 'copy-1', cardId: 'forbidden_bond' });
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: 'copy-1', target: null }).ok).toBe(false);
    expect(cap(e).max).toBe(3);
  });

  it('I: reconnect (JSON snapshot → engine) keeps the bonus and the extra slot', () => {
    const e = battle(12);
    bond(e);
    const restored = GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)), e.content, e.scenario);
    expect(restored.state).toEqual(e.state);
    expect(unit(restored, restored.heroId).summonCapacityBonus).toBe(1);
    expect(summonCapacityView(restored.state, restored.content, restored.heroId)).toMatchObject({ max: 3 });
    // And it survives the turn boundary (enemy turn, next player turn).
    expect(restored.dispatch({ type: 'END_TURN' }).ok).toBe(true);
    expect(summonCapacityView(restored.state, restored.content, restored.heroId).max).toBe(3);
  });

  it('J: replay of the command log reproduces the exact state (deterministic)', () => {
    // A 5-card deck = the whole opening hand, so the commands are legal from the seed alone.
    const content = withHeroDeck(DEFAULT_CONTENT, 'summoner', [
      { cardId: 'forbidden_bond', count: 1 },
      { cardId: 'summon_fox', count: 2 },
      { cardId: 'summon_chicken', count: 2 },
    ]);
    const sc = scenario({ hero: { heroId: 'summoner', pos: p(0, 2) }, enemies: [ORC('orc-1', 6, 2)] });
    const e = makeEngine(sc, content, 7);
    const cmds: Command[] = [];
    const run = (c: Command) => {
      expect(e.dispatch(c).ok).toBe(true);
      cmds.push(c);
    };
    const uidOf = (id: string) => e.state.player.hand.find((c) => c.cardId === id)!.uid;
    run({ type: 'PLAY_CARD', cardUid: uidOf('forbidden_bond'), target: null });
    run({ type: 'PLAY_CARD', cardUid: uidOf('summon_fox'), target: p(1, 2) });
    run({ type: 'END_TURN' });
    run({ type: 'PLAY_CARD', cardUid: uidOf('summon_chicken'), target: p(0, 1) });
    const replay = replayBattle(sc, content, 7, cmds);
    expect(replay.rejectedAt).toBeNull();
    expect(replay.state).toEqual(e.state);
    expect(unit(e, e.heroId).summonCapacityBonus).toBe(1);
  });

  it('K: the bonus ends with the battle — the next battle (mission, run, PvP match) starts at base capacity', () => {
    const e = battle(14);
    bond(e);
    expect(cap(e).max).toBe(3);
    const next = battle(14);
    expect(hero(next).summonCapacityBonus).toBeUndefined();
    expect(cap(next).max).toBe(2);
    // Battle content is never touched: the base stays 2 everywhere.
    expect(DEFAULT_CONTENT.heroes.summoner!.summonCapacity).toBe(2);
    const duel = createDuel([{ heroId: 'summoner', cards: DEFAULT_CONTENT.heroes.summoner!.deck }, { heroId: 'mage', cards: DEFAULT_CONTENT.heroes.mage!.deck }], 3);
    expect(duel.units.every((u) => u.summonCapacityBonus === undefined)).toBe(true);
  });

  it('L: a future base of 3 (Mastery) becomes 4 — additive, no hard cap at 3', () => {
    const base3: GameContent = { ...DEFAULT_CONTENT, heroes: { ...DEFAULT_CONTENT.heroes, summoner: { ...DEFAULT_CONTENT.heroes.summoner!, summonCapacity: 3 } } };
    const e = battle(14, base3);
    expect(cap(e).max).toBe(3);
    bond(e);
    expect(cap(e)).toMatchObject({ max: 4, bonus: 1 });
    expect(summonCapacityOf(base3, hero(e))).toBe(4);
    for (const [id, pos] of [['fox', p(1, 2)], ['chicken', p(0, 1)], ['raven', p(0, 3)], ['turtle', p(1, 1)]] as const) summon(e, id, pos);
    expect(summonUsage(e.state, e.heroId)).toBe(4);
  });

  it('M: a summon dying later frees its points inside the enlarged capacity', () => {
    const e = battle(14);
    const fox = summon(e, 'fox', p(1, 2));
    summon(e, 'chicken', p(0, 1));
    bond(e);
    summon(e, 'raven', p(0, 3));
    expect(cap(e)).toMatchObject({ used: 3, max: 3, free: 0 });
    defeatUnit(ctxFor(e), unit(e, fox.id));
    expect(cap(e)).toMatchObject({ used: 2, max: 3, free: 1 });
    const [wolf] = setHand(e, ['summon_wolf']);
    expect(e.getCardPlayability(wolf!)).toMatchObject({ playable: false, reason: 'SUMMON_CAPACITY' });
    const [fox2] = setHand(e, ['summon_fox']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: fox2!, target: p(1, 2) }).ok).toBe(true);
  });

  it('a capacity-2 summon (Lobo) fits right after the bond with one point already taken', () => {
    const e = battle(14);
    summon(e, 'fox', p(1, 2));
    const [wolf] = setHand(e, ['summon_wolf']);
    expect(e.getCardPlayability(wolf!)).toMatchObject({ playable: false, reason: 'SUMMON_CAPACITY' });
    bond(e);
    const [wolf2] = setHand(e, ['summon_wolf']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: wolf2!, target: p(0, 1) }).ok).toBe(true);
    expect(cap(e)).toMatchObject({ used: 3, max: 3 });
  });
});

describe('Vínculo Prohibido: PvP / Ranked', () => {
  function duelWithBond(seed = 5) {
    let s = createDuel([{ heroId: 'summoner', cards: DEFAULT_CONTENT.heroes.summoner!.deck }, { heroId: 'warrior', cards: DEFAULT_CONTENT.heroes.warrior!.deck }], seed);
    if (s.player.heroId !== 'champion-a') s = applyDuel(s, { type: 'END_TURN' }).state;
    s = structuredClone(s);
    s.units.find((u) => u.id === 'champion-a')!.pos = p(0, 2);
    s.units.find((u) => u.id === 'champion-b')!.pos = p(6, 2);
    s.player.energy = 9;
    s.player.hand = [{ uid: 'bond', cardId: 'forbidden_bond' }, { uid: 'f1', cardId: 'summon_fox' }];
    return s;
  }

  it('same command, same result on both servers; the rival sees the card, the HP and the enlarged capacity', () => {
    let s = duelWithBond();
    const cmd: Command = { type: 'PLAY_CARD', cardUid: 'bond', target: null };
    expect(validCommand(cmd)).toBe(true);
    const a = applyDuel(s, cmd),
      b = applyDuel(structuredClone(s), cmd);
    expect(a.state).toEqual(b.state);
    s = a.state;
    const A = s.units.find((u) => u.id === 'champion-a')!;
    expect(A.summonCapacityBonus).toBe(1);
    const rival = duelView(s, 1);
    const seenByRival = rival.units.find((u) => u.id === 'champion-a')!;
    expect(seenByRival).toMatchObject({ hp: A.hp, summonCapacityBonus: 1 });
    expect(summonCapacityView(rival, DEFAULT_CONTENT, 'champion-a')).toMatchObject({ max: 3, bonus: 1 });
    const rivalEvents = duelEvents(s, 1, a.events).map((e) => e.type);
    expect(rivalEvents).toEqual(expect.arrayContaining(['CARD_PLAYED', 'HP_SACRIFICED', 'SUMMON_CAPACITY_CHANGED', 'CARD_BANISHED']));
  });

  it('the bonus survives the turn hand-off in both directions and a second copy is refused', () => {
    let s = applyDuel(duelWithBond(), { type: 'PLAY_CARD', cardUid: 'bond', target: null }).state;
    s = applyDuel(s, endTurn(s)).state;
    s = applyDuel(s, endTurn(s)).state;
    expect(s.player.heroId).toBe('champion-a');
    expect(summonCapacityView(s, DEFAULT_CONTENT, 'champion-a').max).toBe(3);
    s = structuredClone(s);
    s.player.hand.push({ uid: 'forged', cardId: 'forbidden_bond' });
    expect(() => applyDuel(s, { type: 'PLAY_CARD', cardUid: 'forged', target: null })).toThrow('UNIQUE_ALREADY_USED');
  });
});

describe('Vínculo Prohibido: AI (bots)', () => {
  const ctxOf = (e: Engine) => queryContext(e.state as GameState, e.content);

  it('plays it when the extra point lets a summon in hand land now, with HP to spare', () => {
    const e = battle(18);
    summon(e, 'fox', p(1, 2));
    summon(e, 'chicken', p(0, 1));
    setHand(e, ['forbidden_bond', 'summon_raven']);
    expect(suggestCapacityBond(ctxOf(e))).toMatchObject({ type: 'PLAY_CARD', target: null });
  });

  it('holds it at 1 HP, with free capacity, with no summon to use the point, or when the sacrifice would be lethal next turn', () => {
    const one = battle(1);
    summon(one, 'fox', p(1, 2));
    summon(one, 'chicken', p(0, 1));
    setHand(one, ['forbidden_bond', 'summon_raven']);
    expect(suggestCapacityBond(ctxOf(one))).toBeNull();

    const free = battle(18);
    setHand(free, ['forbidden_bond', 'summon_raven']);
    expect(suggestCapacityBond(ctxOf(free))).toBeNull();

    const none = battle(18);
    summon(none, 'fox', p(1, 2));
    summon(none, 'chicken', p(0, 1));
    setHand(none, ['forbidden_bond']);
    expect(suggestCapacityBond(ctxOf(none))).toBeNull();

    const low = battle(6);
    summon(low, 'fox', p(1, 2));
    summon(low, 'chicken', p(0, 1));
    setHand(low, ['forbidden_bond', 'summon_raven']);
    expect(suggestCapacityBond(ctxOf(low))).toBeNull();
  });
});
