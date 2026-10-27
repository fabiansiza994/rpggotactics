import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game/data';
import { capacityNeeded, summonCapacityView } from '../src/game/domain/summons/capacity-view';
import { dealDamage, defeatUnit } from '../src/game/domain/combat/damage';
import { summonUsage } from '../src/game/domain/summons/summons';
import { ctxFor, endTurn, makeEngine, mutable, p, setHand } from './helpers';

/**
 * 02_MVP_RULES §17.1 — summon capacity is measured in POINTS (decision 2026-10-15, first external
 * playtest). These pin the approved rules so a later UI or balance pass cannot silently change them.
 */
const summoner = (enemies = [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(6, 2) }]) =>
  makeEngine({ hero: { heroId: 'summoner', pos: p(0, 2) }, enemies });
const play = (e: ReturnType<typeof summoner>, cardId: string, target = p(1, 2)) => {
  const [uid] = setHand(e, [cardId]);
  return e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target });
};

describe('summon capacity rules (points, not creatures)', () => {
  it('the Summoner holds 2 points and every creature declares the approved cost', () => {
    expect(DEFAULT_CONTENT.heroes.summoner!.summonCapacity).toBe(2);
    const cost = (id: string) => DEFAULT_CONTENT.summons![id]!.capacityCost;
    for (const id of ['chicken', 'fox', 'turtle', 'raven', 'ash_hound']) expect(cost(id), id).toBe(1);
    for (const id of ['wolf', 'ancient_wolf', 'war_drake', 'primordial_dragon', 'ancient_turtle'])
      expect(cost(id), id).toBe(2);
  });

  it('a single Wolf fills 2/2 and blocks a 1-point Fox; its death frees the points at once', () => {
    const e = summoner();
    expect(play(e, 'summon_wolf').ok).toBe(true);
    expect(e.state.units.filter((u) => u.kind === 'SUMMON')).toHaveLength(1);
    expect(summonUsage(e.state, e.heroId)).toBe(2);
    mutable(e).player.energy = 4;
    const [fox] = setHand(e, ['summon_fox']);
    expect(e.getCardPlayability(fox!)).toMatchObject({ playable: false, reason: 'SUMMON_CAPACITY' });
    const wolf = mutable(e).units.find((u) => u.kind === 'SUMMON')!;
    expect(dealDamage(ctxFor(e), wolf, 99, 'test', 'PHYSICAL').defeated).toBe(true);
    expect(summonUsage(e.state, e.heroId)).toBe(0);
    expect(e.getCardPlayability(fox!)).toEqual({ playable: true });
  });

  it('a summon that dies during END_TURN is free again on the next player turn', () => {
    // Rooted on fire: the end-of-turn terrain kills it inside the real END_TURN resolution.
    const e = makeEngine({
      hero: { heroId: 'summoner', pos: p(0, 2) },
      layout: ['.......', '.......', '.F.....', '.......', '.......'],
    });
    expect(play(e, 'summon_fox').ok).toBe(true);
    const fox = mutable(e).units.find((u) => u.kind === 'SUMMON')!;
    fox.hp = 1;
    fox.statuses.push({ id: 'ROOTED', turnsLeft: 2 });
    expect(summonUsage(e.state, e.heroId)).toBe(1);
    expect(e.dispatch(endTurn(e)).ok).toBe(true);
    expect(e.state.units.some((u) => u.kind === 'SUMMON')).toBe(false);
    expect(e.state.phase).toBe('PLAYER');
    expect(summonUsage(e.state, e.heroId)).toBe(0);
    const [again] = setHand(e, ['summon_wolf']);
    expect(e.getCardPlayability(again!)).toEqual({ playable: true });
  });

  it('two 1-point creatures fill the capacity exactly like one 2-point creature', () => {
    const e = summoner();
    expect(play(e, 'summon_chicken', p(1, 2)).ok).toBe(true);
    mutable(e).player.energy = 4;
    expect(play(e, 'summon_fox', p(0, 1)).ok).toBe(true);
    expect(summonUsage(e.state, e.heroId)).toBe(2);
    mutable(e).player.energy = 4;
    expect(play(e, 'summon_chicken', p(0, 3))).toMatchObject({ ok: false, error: 'SUMMON_CAPACITY' });
  });

  it.each(['recall_familiar', 'vital_offering', 'bond_sacrifice'])('%s frees the capacity it removes', (card) => {
    const e = summoner();
    expect(play(e, 'summon_wolf').ok).toBe(true);
    mutable(e).player.energy = 4;
    expect(play(e, card, p(1, 2)).ok).toBe(true);
    expect(summonUsage(e.state, e.heroId)).toBe(0);
  });

  it("the owner's defeat removes its summons with it", () => {
    const e = summoner();
    expect(play(e, 'summon_fox').ok).toBe(true);
    const hero = mutable(e).units.find((u) => u.id === e.heroId)!;
    defeatUnit(ctxFor(e), hero);
    expect(e.state.units.some((u) => u.kind === 'SUMMON')).toBe(false);
  });

  it('unused cards stay in hand across END_TURN and energy refills to max', () => {
    const e = summoner();
    const kept = e.state.player.hand.map((c) => c.uid);
    expect(kept.length).toBeLessThanOrEqual(5);
    mutable(e).player.energy = 0;
    expect(e.dispatch(endTurn(e)).ok).toBe(true);
    const after = e.state.player.hand.map((c) => c.uid);
    for (const uid of kept) expect(after).toContain(uid);
    expect(e.state.player.energy).toBe(e.state.player.maxEnergy);
  });
});

describe('summonCapacityView (UI read model)', () => {
  it('mirrors summonUsage and lists who holds the points', () => {
    const e = summoner();
    expect(summonCapacityView(e.state, DEFAULT_CONTENT, e.heroId)).toEqual({ used: 0, max: 2, bonus: 0, free: 2, occupants: [] });
    expect(play(e, 'summon_wolf').ok).toBe(true);
    const view = summonCapacityView(e.state, DEFAULT_CONTENT, e.heroId);
    expect(view).toMatchObject({ used: 2, max: 2, free: 0 });
    expect(view.used).toBe(summonUsage(e.state, e.heroId));
    expect(view.occupants).toEqual([expect.objectContaining({ defId: 'wolf', name: 'Lobo', cost: 2 })]);
  });

  it('capacityNeeded agrees with the rules for every summon card', () => {
    for (const def of Object.values(DEFAULT_CONTENT.cards)) {
      const needed = capacityNeeded(DEFAULT_CONTENT, def.effects);
      if (!def.effects.some((fx) => fx.type === 'SUMMON')) {
        expect(needed, def.id).toBe(0);
        continue;
      }
      const summonId = def.effects.find((fx) => fx.type === 'SUMMON')!;
      expect(needed, def.id).toBe(
        summonId.type === 'SUMMON' ? DEFAULT_CONTENT.summons![summonId.summonId]!.capacityCost : NaN,
      );
    }
  });

  it('is 0/0 for champions without summons', () => {
    const e = makeEngine();
    expect(summonCapacityView(e.state, DEFAULT_CONTENT, e.heroId)).toMatchObject({ used: 0, max: 0 });
  });
});
