import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game/data';
import { ARCHER_CARDS, ARCHER_HERO, ARCHER_OPTIMAL_RANGE, withArcher } from '../src/game/data/archer';
import { inOptimalRange, isOptimalDistance, preyOf } from '../src/game/domain/combat/archery';
import { archerCardForecast, archerHud, optimalFromTile } from '../src/game/domain/archer-view';
import { queryContext } from '../src/game/domain/context';
import type { GameState } from '../src/game/domain/state';
import type { Unit } from '../src/game/domain/entities/unit';
import { validateDeck } from '../src/game/collection/deck-rules';
import { DECK_RULES } from '../src/game/data/rules';
import { replayBattle } from '../src/game/engine/replay';
import { playBattle } from './support/bot';
import { EMPTY_7x5, endTurn, makeEngine, mutable, ofType, p, scenario, setHand, unit } from './helpers';
import type { ScenarioDef } from '../src/game/domain/scenario';

const CONTENT = withArcher(DEFAULT_CONTENT);
const ORC = (id: string, x: number, y: number) => ({ id, enemyId: 'orc_warrior', pos: p(x, y) });

function archer(overrides: Partial<ScenarioDef> = {}, heroPos = p(0, 2)) {
  return makeEngine({ hero: { heroId: 'archer', pos: heroPos }, ...overrides }, CONTENT);
}
const hero = (e: ReturnType<typeof archer>) => unit(e, 'archer');
const setFocus = (e: ReturnType<typeof archer>, value: number) => (hero(e).focus!.value = value);
const markPrey = (target: Unit) => target.statuses.push({ id: 'PREY', turnsLeft: 1, sourceId: 'archer' });
const isPrey = (u: Unit) => u.statuses.some((s) => s.id === 'PREY' && s.sourceId === 'archer');
const play = (e: ReturnType<typeof archer>, uid: string, target: { x: number; y: number } | null) =>
  e.dispatch({ type: 'PLAY_CARD', cardUid: uid, target });

describe('Archer content (QA-only)', () => {
  it('is never part of the public registry', () => {
    expect(DEFAULT_CONTENT.heroes.archer).toBeUndefined();
    expect(Object.keys(DEFAULT_CONTENT.cards).filter((id) => ARCHER_CARDS.some((c) => c.id === id))).toEqual([]);
    expect(withArcher(CONTENT)).toBe(CONTENT); // idempotent
  });
  it('ships exactly 8 designed cards + the basic attack, all in the QA set', () => {
    expect(ARCHER_CARDS).toHaveLength(9);
    expect(ARCHER_CARDS.every((c) => c.heroId === 'archer' && c.expansion === 'archer_core')).toBe(true);
  });
  it('core stats: 18 HP, 4 energy, 4 MP, no armour, focus 0/3, optimal 3–4', () => {
    const e = archer();
    expect(hero(e)).toMatchObject({ hp: 18, maxHp: 18, armor: 0, focus: { value: 0, max: 3 } });
    expect(e.state.player).toMatchObject({ maxEnergy: 4, maxMovePoints: 4 });
    expect(ARCHER_HERO.focus!.optimalRange).toEqual({ min: 3, max: 4 });
  });
  it('starter deck is a legal 30-card deck (copy, neutral and class limits)', () => {
    const owned = Object.fromEntries(ARCHER_HERO.deck.map((d) => [d.cardId, d.count]));
    expect(ARCHER_HERO.deck.reduce((n, d) => n + d.count, 0)).toBe(30);
    expect(validateDeck(ARCHER_HERO.deck, 'archer', (id) => owned[id] ?? 0, CONTENT, DECK_RULES)).toEqual([]);
  });
});

describe('Presa', () => {
  it('Ojo del Cazador marks an enemy (no damage, 0 energy)', () => {
    const e = archer({ enemies: [ORC('orc-1', 6, 2)] });
    const [eye] = setHand(e, ['hunters_eye']);
    const r = play(e, eye!, p(6, 2));
    expect(r.ok).toBe(true);
    expect(isPrey(unit(e, 'orc-1'))).toBe(true);
    expect(unit(e, 'orc-1').hp).toBe(8);
    expect(e.state.player.energy).toBe(4);
    expect(archerHud(e.state, CONTENT)!.prey).toMatchObject({ targetId: 'orc-1', distance: 6, inOptimalRange: false, inLineOfSight: true });
  });
  it('a new mark replaces the previous one: one Presa at most', () => {
    const e = archer({ enemies: [ORC('orc-1', 6, 2), ORC('orc-2', 4, 0)] });
    const [a, b] = setHand(e, ['hunters_eye', 'hunters_eye']);
    play(e, a!, p(6, 2));
    const r = play(e, b!, p(4, 0));
    expect(r.ok).toBe(true);
    expect(isPrey(unit(e, 'orc-1'))).toBe(false);
    expect(isPrey(unit(e, 'orc-2'))).toBe(true);
    expect(e.state.units.filter(isPrey)).toHaveLength(1);
    if (!r.ok) return;
    expect(ofType(r.events, 'STATUS_REMOVED')).toEqual([{ type: 'STATUS_REMOVED', unitId: 'orc-1', status: 'PREY', reason: 'CONSUMED' }]);
  });
  it('persists across turns (never counts down)', () => {
    const e = archer({ enemies: [ORC('orc-1', 6, 2)] });
    markPrey(unit(e, 'orc-1'));
    for (let i = 0; i < 3; i++) e.dispatch(endTurn(e));
    expect(isPrey(unit(e, 'orc-1'))).toBe(true);
  });
  it('ends when the Presa dies; the HUD then shows no Presa', () => {
    const e = archer({ enemies: [ORC('orc-1', 3, 2), ORC('orc-2', 6, 4)] });
    markPrey(unit(e, 'orc-1'));
    unit(e, 'orc-1').hp = 2;
    const [shot] = setHand(e, ['archer_shot']);
    expect(play(e, shot!, p(3, 2)).ok).toBe(true);
    expect(e.state.units.some((u) => u.id === 'orc-1')).toBe(false);
    expect(preyOf(e.state, 'archer')).toBeUndefined();
    expect(archerHud(e.state, CONTENT)!.prey).toBeNull();
  });
  it('is a negative status: a cleanse removes it', () => {
    expect(CONTENT.statuses.PREY).toMatchObject({ negative: true, permanent: true, preyMark: true });
  });
});

describe('Concentración', () => {
  it('gain: Disparo Certero on the Presa from optimal range', () => {
    const e = archer({ enemies: [ORC('orc-1', 3, 2)] });
    markPrey(unit(e, 'orc-1'));
    const [s] = setHand(e, ['true_shot']);
    const r = play(e, s!, p(3, 2));
    expect(hero(e).focus!.value).toBe(1);
    if (r.ok) expect(ofType(r.events, 'FOCUS_CHANGED')).toEqual([{ type: 'FOCUS_CHANGED', unitId: 'archer', from: 0, to: 1, max: 3, reason: 'CARD' }]);
  });
  it('cap 3: extra gains are lost (no event)', () => {
    const e = archer({ enemies: [ORC('orc-1', 3, 2)] });
    markPrey(unit(e, 'orc-1'));
    setFocus(e, 3);
    const [s] = setHand(e, ['true_shot']);
    const r = play(e, s!, p(3, 2));
    expect(hero(e).focus!.value).toBe(3);
    if (r.ok) expect(ofType(r.events, 'FOCUS_CHANGED')).toEqual([]);
  });
  it('spend: Tiro al Corazón consumes all 3', () => {
    const e = archer({ enemies: [ORC('orc-1', 4, 2)] });
    setFocus(e, 3);
    const [h] = setHand(e, ['heart_shot']);
    const r = play(e, h!, p(4, 2));
    expect(r.ok).toBe(true);
    expect(hero(e).focus!.value).toBe(0);
  });
  it('cannot overspend: 2 Concentración refuses Tiro al Corazón and changes nothing', () => {
    const e = archer({ enemies: [ORC('orc-1', 4, 2)] });
    setFocus(e, 2);
    const [h] = setHand(e, ['heart_shot']);
    expect(e.getCardPlayability(h!)).toMatchObject({ playable: false, reason: 'NOT_ENOUGH_FOCUS' });
    const before = JSON.stringify(e.state);
    const r = play(e, h!, p(4, 2));
    expect(r).toMatchObject({ ok: false, error: 'NOT_ENOUGH_FOCUS' });
    expect(JSON.stringify(e.state)).toBe(before);
  });
  it('is never generated passively (turns pass, focus stays)', () => {
    const e = archer({ enemies: [ORC('orc-1', 6, 2)] });
    setFocus(e, 1);
    for (let i = 0; i < 3; i++) e.dispatch(endTurn(e));
    expect(hero(e).focus!.value).toBe(1);
  });
  it('other champions have no focus', () => {
    expect(makeEngine().state.units[0]!.focus).toBeUndefined();
  });
});

describe('Distancia Óptima (3–4, Manhattan, no RNG)', () => {
  const at = (x: number) => {
    const e = archer({ enemies: [ORC('orc-1', 6, 2)] }, p(6 - x, 2));
    return inOptimalRange(queryContext(mutable(e), CONTENT), hero(e), p(6, 2));
  };
  it.each([
    [2, false],
    [3, true],
    [4, true],
    [5, false],
  ])('distance %i → %s', (d, expected) => {
    expect(isOptimalDistance(ARCHER_OPTIMAL_RANGE, d)).toBe(expected);
    expect(at(d)).toBe(expected);
  });
  it('the UI can ask before moving: would this tile be optimal to my Presa?', () => {
    const e = archer({ enemies: [ORC('orc-1', 6, 2)] });
    expect(optimalFromTile(e.state, CONTENT, p(3, 2))).toBeNull(); // no Presa yet
    markPrey(unit(e, 'orc-1'));
    expect(optimalFromTile(e.state, CONTENT, p(3, 2))).toBe(true);
    expect(optimalFromTile(e.state, CONTENT, p(4, 2))).toBe(false);
  });
});

describe('cards', () => {
  it('Disparo (basic): 2 physical ranged, LoS, cover reduces it', () => {
    const e = archer({ enemies: [ORC('orc-1', 4, 2)] });
    const [s] = setHand(e, ['archer_shot']);
    play(e, s!, p(4, 2));
    expect(unit(e, 'orc-1').hp).toBe(6);
    const c = archer({ enemies: [ORC('orc-1', 4, 2)], layout: ['.......', '.......', '....C..', '.......', '.......'], legend: { '.': {}, C: { terrain: 'COVER' } } });
    const [s2] = setHand(c, ['archer_shot']);
    play(c, s2!, p(4, 2));
    expect(unit(c, 'orc-1').hp).toBe(7);
  });

  it('Disparo Certero: 2, 3 vs Presa; focus only vs Presa AND optimal', () => {
    const cases: [number, boolean, number, number][] = [
      // distance, prey, hp after, focus
      [4, false, 6, 0],
      [3, true, 5, 1],
      [2, true, 5, 0],
    ];
    for (const [d, prey, hp, focus] of cases) {
      const e = archer({ enemies: [ORC('orc-1', d, 2)] });
      if (prey) markPrey(unit(e, 'orc-1'));
      const [s] = setHand(e, ['true_shot']);
      expect(play(e, s!, p(d, 2)).ok).toBe(true);
      expect([unit(e, 'orc-1').hp, hero(e).focus!.value]).toEqual([hp, focus]);
    }
  });
  it('Disparo Certero killing the Presa still grants the Concentración', () => {
    const e = archer({ enemies: [ORC('orc-1', 3, 2), ORC('orc-2', 6, 4)] });
    markPrey(unit(e, 'orc-1'));
    unit(e, 'orc-1').hp = 3;
    const [s] = setHand(e, ['true_shot']);
    play(e, s!, p(3, 2));
    expect(e.state.units.some((u) => u.id === 'orc-1')).toBe(false);
    expect(hero(e).focus!.value).toBe(1);
  });

  it('Paso del Acechador: +1 when not adjacent and with LoS to the Presa', () => {
    const e = archer({ enemies: [ORC('orc-1', 6, 2)] });
    markPrey(unit(e, 'orc-1'));
    const [s] = setHand(e, ['stalker_step']);
    expect(play(e, s!, p(2, 2)).ok).toBe(true);
    expect(hero(e).pos).toEqual(p(2, 2));
    expect(e.state.player.movePoints).toBe(4); // free step
    expect(hero(e).focus!.value).toBe(1);
  });
  it('Paso del Acechador: no gain when ending adjacent, without Presa, or without LoS', () => {
    const adjacent = archer({ enemies: [ORC('orc-1', 3, 2)] });
    markPrey(unit(adjacent, 'orc-1'));
    play(adjacent, setHand(adjacent, ['stalker_step'])[0]!, p(2, 2));
    expect(hero(adjacent).focus!.value).toBe(0);

    const noPrey = archer({ enemies: [ORC('orc-1', 6, 2)] });
    play(noPrey, setHand(noPrey, ['stalker_step'])[0]!, p(2, 2));
    expect(hero(noPrey).focus!.value).toBe(0);

    const blocked = archer({ enemies: [ORC('orc-1', 6, 2)], layout: ['.......', '.......', '....#..', '.......', '.......'] });
    markPrey(unit(blocked, 'orc-1'));
    play(blocked, setHand(blocked, ['stalker_step'])[0]!, p(2, 2));
    expect(hero(blocked).focus!.value).toBe(0);
  });
  it('Paso del Acechador is a walk: refused while ROOTED', () => {
    const e = archer({ enemies: [ORC('orc-1', 6, 2)] });
    hero(e).statuses.push({ id: 'ROOTED', turnsLeft: 1 });
    expect(e.getValidTargets(setHand(e, ['stalker_step'])[0]!)).toEqual([]);
  });

  it('Flecha Perforante: 3 to the first unit only without spending', () => {
    const e = archer({ enemies: [ORC('orc-1', 2, 2), ORC('orc-2', 4, 2)] });
    setFocus(e, 3);
    const [a] = setHand(e, ['piercing_arrow']);
    expect(play(e, a!, p(2, 2)).ok).toBe(true);
    expect([unit(e, 'orc-1').hp, unit(e, 'orc-2').hp, hero(e).focus!.value]).toEqual([5, 8, 3]);
  });
  it('Flecha Perforante: aiming at the unit behind spends 2 and hits both', () => {
    const e = archer({ enemies: [ORC('orc-1', 2, 2), ORC('orc-2', 4, 2)] });
    setFocus(e, 2);
    const [a] = setHand(e, ['piercing_arrow']);
    expect(e.getValidTargets(a!)).toContainEqual(p(4, 2));
    const r = play(e, a!, p(4, 2));
    expect(r.ok).toBe(true);
    expect([unit(e, 'orc-1').hp, unit(e, 'orc-2').hp, hero(e).focus!.value]).toEqual([5, 5, 0]);
    if (r.ok) expect(ofType(r.events, 'PROJECTILE_LAUNCHED')[0]).toMatchObject({ to: p(4, 2), hitUnitId: 'orc-2' });
  });
  it('Flecha Perforante: with 1 Concentración the unit behind is not a target', () => {
    const e = archer({ enemies: [ORC('orc-1', 2, 2), ORC('orc-2', 4, 2)] });
    setFocus(e, 1);
    const [a] = setHand(e, ['piercing_arrow']);
    expect(e.getValidTargets(a!)).not.toContainEqual(p(4, 2));
    expect(play(e, a!, p(4, 2))).toMatchObject({ ok: false, error: 'INVALID_TARGET' });
    expect(hero(e).focus!.value).toBe(1);
  });

  it('Tiro al Corazón: 4 base, 6 vs Presa from optimal range, 4 vs Presa too close', () => {
    const cases: [number, boolean, number][] = [
      [4, false, 4],
      [4, true, 2],
      [2, true, 4],
    ];
    for (const [d, prey, hp] of cases) {
      const e = archer({ enemies: [ORC('orc-1', d, 2)] });
      if (prey) markPrey(unit(e, 'orc-1'));
      setFocus(e, 3);
      expect(play(e, setHand(e, ['heart_shot'])[0]!, p(d, 2)).ok).toBe(true);
      expect(unit(e, 'orc-1').hp).toBe(hp);
    }
  });

  it('Retirada Táctica: only tiles farther from the nearest enemy; +1 at optimal range of the Presa', () => {
    const e = archer({ enemies: [ORC('orc-1', 3, 2)] }, p(2, 2));
    markPrey(unit(e, 'orc-1'));
    const [r] = setHand(e, ['tactical_retreat']);
    const targets = e.getValidTargets(r!);
    expect(targets).toContainEqual(p(0, 2));
    expect(targets).not.toContainEqual(p(3, 1)); // still adjacent
    expect(targets).not.toContainEqual(p(3, 3));
    expect(play(e, r!, p(0, 2)).ok).toBe(true);
    expect(hero(e).focus!.value).toBe(1);
    expect(hero(e).hp).toBe(18); // no damage is provoked
  });
  it('Retirada Táctica: no gain when the end tile is not optimal', () => {
    const e = archer({ enemies: [ORC('orc-1', 3, 2)] }, p(2, 2));
    markPrey(unit(e, 'orc-1'));
    expect(play(e, setHand(e, ['tactical_retreat'])[0]!, p(2, 1)).ok).toBe(true); // distance 2
    expect(hero(e).focus!.value).toBe(0);
  });

  it('Trampa de Zarzas: the walking enemy stops on it, takes 1 and stays ROOTED through its next turn', () => {
    const e = archer({ enemies: [ORC('orc-1', 6, 2)] }, p(1, 2));
    const [t] = setHand(e, ['bramble_trap']);
    const r = play(e, t!, p(4, 2));
    expect(r.ok).toBe(true);
    expect(e.state.traps).toEqual([{ id: expect.any(String), trapId: 'bramble', ownerId: 'archer', pos: p(4, 2), damage: 1, turnsLeft: 3 }]);
    // The telegraph already shows the stop: the plan ends on the trap and does not attack.
    const plan = e.getIntentPreviews()[0]!;
    expect(plan.end).toEqual(p(4, 2));
    expect(plan.targetUnitIds).toEqual([]);

    const end = e.dispatch(endTurn(e));
    const orc = unit(e, 'orc-1');
    expect(orc.pos).toEqual(p(4, 2));
    expect(orc.hp).toBe(7);
    expect(orc.statuses.find((s) => s.id === 'ROOTED')?.turnsLeft).toBe(1);
    expect(e.state.traps).toEqual([]);
    if (end.ok) expect(ofType(end.events, 'TRAP_TRIGGERED')).toHaveLength(1);
    expect(hero(e).hp).toBe(18);

    e.dispatch(endTurn(e)); // rooted enemy turn: it cannot walk
    expect(unit(e, 'orc-1').pos).toEqual(p(4, 2));
    expect(unit(e, 'orc-1').statuses.some((s) => s.id === 'ROOTED')).toBe(false);
  });
  it('Trampa de Zarzas: the owner never triggers it; it expires after 3 rounds', () => {
    const e = archer({ enemies: [ORC('orc-1', 6, 4)] }, p(1, 0));
    mutable(e).units.find((u) => u.id === 'orc-1')!.statuses.push({ id: 'STUNNED', turnsLeft: 9 });
    play(e, setHand(e, ['bramble_trap'])[0]!, p(2, 0));
    expect(e.dispatch({ type: 'MOVE_UNIT', unitId: 'archer', to: p(3, 0) }).ok).toBe(true);
    expect(hero(e).statuses).toEqual([]);
    expect(e.state.traps).toHaveLength(1);
    for (let i = 0; i < 3; i++) e.dispatch(endTurn(e));
    expect(e.state.traps).toEqual([]);
  });
  it('Trampa de Zarzas: a pushed enemy is caught too (it stops on the trap)', () => {
    const e = archer({ enemies: [ORC('orc-1', 2, 2)] }, p(1, 2));
    const [t, sh] = setHand(e, ['bramble_trap', 'shove']);
    expect(play(e, t!, p(3, 2)).ok).toBe(true);
    expect(play(e, sh!, p(2, 2)).ok).toBe(true);
    const orc = unit(e, 'orc-1');
    expect(orc.pos).toEqual(p(3, 2));
    expect(orc.hp).toBe(7);
    // Caught on the other side's turn: rooted 1, i.e. through its own next turn.
    expect(orc.statuses.find((x) => x.id === 'ROOTED')?.turnsLeft).toBe(1);
    expect(e.state.traps).toEqual([]);
  });

  it('Flecha del Verdugo: 2, or 4 vs the Presa at ≤40% HP (8 max → 3 HP qualifies, 4 does not)', () => {
    const cases: [boolean, number, number][] = [
      [true, 4, 2],
      [true, 3, -1],
      [false, 3, 1],
    ];
    for (const [prey, hp, after] of cases) {
      const e = archer({ enemies: [ORC('orc-1', 4, 2), ORC('orc-2', 6, 4)] });
      if (prey) markPrey(unit(e, 'orc-1'));
      unit(e, 'orc-1').hp = hp;
      play(e, setHand(e, ['executioner_arrow'])[0]!, p(4, 2));
      expect(e.state.units.find((u) => u.id === 'orc-1')?.hp ?? -1).toBe(after);
    }
  });
});

describe('preview / targeting clarity', () => {
  it('Disparo Certero on the Presa at 3: base 2, conditional 3 (met), optimal, +1 focus', () => {
    const e = archer({ enemies: [ORC('orc-1', 3, 2)] });
    markPrey(unit(e, 'orc-1'));
    const [s] = setHand(e, ['true_shot']);
    const f = archerCardForecast(e.state, CONTENT, s!, p(3, 2))!;
    expect(f).toMatchObject({
      targetId: 'orc-1', targetIsPrey: true, distance: 3, inOptimalRange: true,
      baseDamage: 2, conditionalDamage: 3, conditionMet: true, predictedHpLoss: 3,
      focus: { before: 0, gain: 1, spend: 0, after: 1, max: 3 },
    });
    expect(f.notes).toContain('Ganas 1 Concentración');
    expect(JSON.stringify(e.state.units)).not.toContain('"focus":{"value":1'); // preview never mutates
  });
  it('Tiro al Corazón too close: shows 6 is NOT met and the 3 it spends', () => {
    const e = archer({ enemies: [ORC('orc-1', 2, 2)] });
    markPrey(unit(e, 'orc-1'));
    setFocus(e, 3);
    const f = archerCardForecast(e.state, CONTENT, setHand(e, ['heart_shot'])[0]!, p(2, 2))!;
    expect(f).toMatchObject({ baseDamage: 4, conditionalDamage: 6, conditionMet: false, inOptimalRange: false, predictedHpLoss: 4 });
    expect(f.focus).toMatchObject({ spend: 3, after: 0 });
  });
  it('Flecha Perforante pierce target reports the spend', () => {
    const e = archer({ enemies: [ORC('orc-1', 2, 2), ORC('orc-2', 4, 2)] });
    setFocus(e, 2);
    const f = archerCardForecast(e.state, CONTENT, setHand(e, ['piercing_arrow'])[0]!, p(4, 2))!;
    expect(f).toMatchObject({ pierces: true, targetId: 'orc-2', focus: { spend: 2, after: 0 } });
  });
  it('movement cards report the destination relative to the Presa', () => {
    const e = archer({ enemies: [ORC('orc-1', 6, 2)] });
    markPrey(unit(e, 'orc-1'));
    const f = archerCardForecast(e.state, CONTENT, setHand(e, ['stalker_step'])[0]!, p(2, 2))!;
    expect(f).toMatchObject({ distance: 4, inOptimalRange: true, focus: { gain: 1 } });
  });
  it('HUD contract: focus label 0/3 … 3/3', () => {
    const e = archer();
    for (const v of [0, 1, 2, 3]) {
      setFocus(e, v);
      expect(archerHud(e.state, CONTENT)!.focus.label).toBe(`${v}/3`);
    }
    expect(archerHud(makeEngine().state, DEFAULT_CONTENT)).toBeNull();
  });
});

describe('replay-safe', () => {
  it('a bot-played Archer battle replays to the identical state', () => {
    const sc = scenario({ hero: { heroId: 'archer', pos: p(0, 2) }, layout: EMPTY_7x5, enemies: [ORC('orc-1', 6, 1), ORC('orc-2', 6, 3)] });
    const e = makeEngine(sc, CONTENT, 11);
    playBattle(e, 12, undefined, { archer: true });
    const replay = replayBattle(sc, CONTENT, 11, e.history);
    expect(replay.rejectedAt).toBeNull();
    expect(JSON.stringify(replay.state)).toBe(JSON.stringify(e.state as GameState));
  });
});
