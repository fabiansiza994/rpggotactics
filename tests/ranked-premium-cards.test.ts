import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTENT, DECK_RULES, rollReward, withHeroDeck, type GameState } from '../src/game';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { RANKED_PREMIUM_CARDS, RANKED_PREMIUM_CARD_REWARD_ID, RANKED_PREMIUM_CORE_CARDS } from '../src/game/data/ranked-premium-cards';
import { copyLimit, validateDeck } from '../src/game/collection/deck-rules';
import { isExclusiveCard } from '../src/game/domain/cards/card';
import { addShield } from '../src/game/domain/combat/damage';
import { effectiveMoveRange } from '../src/game/domain/board/occupancy';
import { applyStatus, cleanseUnit } from '../src/game/domain/statuses/status-rules';
import { spawnSummon } from '../src/game/domain/summons/summons';
import { transform } from '../src/game/domain/transformations/transformations';
import { createObstacle, createTerrain } from '../src/game/domain/terrain/terrain-rules';
import { placeTrap } from '../src/game/domain/combat/traps';
import { replayBattle } from '../src/game/engine/replay';
import type { Command } from '../src/game/engine/commands';
import { applyDuel, createDuel, duelView } from '../src/game/pvp/duel';
import { cardSource } from '../src/game/data/worlds';
import { validCommand } from '../server/src/pvp';
import { ctxFor, makeEngine, mutable, ofType, p, scenario, setHand, unit } from './helpers';

/**
 * Ranked Premium Track — the five pass cards on the real engine (qa/ranked-premium-track/REPORT.md).
 * Every number here is the approved design; the tests pin the counterplay too.
 */

const ARCHER = withArcher(DEFAULT_CONTENT);
const SHIFTER = withShapeshifterRelease(DEFAULT_CONTENT);
const ORC = (id: string, x: number, y: number) => ({ id, enemyId: 'orc_warrior', pos: p(x, y) });

function battle(heroId: string, heroPos: { x: number; y: number }, enemies: ReturnType<typeof ORC>[], content = DEFAULT_CONTENT) {
  const e = makeEngine({ hero: { heroId, pos: heroPos }, enemies }, content);
  mutable(e).player.energy = 9;
  return e;
}
type Engine = ReturnType<typeof battle>;
const hero = (e: Engine) => unit(e, e.heroId);
const play = (e: Engine, cardId: string, target: { x: number; y: number } | null, secondary?: { x: number; y: number }) => {
  const [uid] = setHand(e, [cardId]);
  return e.dispatch(secondary ? { type: 'PLAY_CARD', cardUid: uid!, target, secondary } : { type: 'PLAY_CARD', cardUid: uid!, target });
};
const keyOf = (q: { x: number; y: number }) => `${q.x},${q.y}`;
const summon = (e: Engine, summonId: string, pos: { x: number; y: number }) => {
  const s = spawnSummon(ctxFor(e), hero(e), summonId, pos);
  if (!s) throw new Error('spawn failed');
  return s;
};

describe('Premium cards: catalog', () => {
  it('five cards, one per champion, LEGENDARY + Única (1 copy per deck, banished once played), approved costs', () => {
    expect(RANKED_PREMIUM_CARDS.map((c) => [c.id, c.heroId, c.cost])).toEqual([
      ['double_moon_pact', 'summoner', 3],
      ['fallen_king_wall', 'warrior', 2],
      ['stalker_heart', 'archer', 3],
      ['ash_eclipse', 'mage', 4],
      ['primal_ascent', 'shapeshifter', 3],
    ]);
    for (const c of RANKED_PREMIUM_CARDS) {
      expect(c.rarity).toBe('LEGENDARY');
      expect(c.unique).toBe(true);
      expect(copyLimit(c, DECK_RULES)).toBe(1);
      expect(c.presentation.premiumTreatment).toBeUndefined(); // the Showcase is a cosmetic, not the base card
    }
  });

  it('early access with release metadata: exclusive to the pass until season_1, never dropped, labelled', () => {
    for (const c of RANKED_PREMIUM_CARDS) {
      expect(c.acquisition).toEqual({
        source: 'RANKED_PREMIUM',
        seasonId: 'preseason_0',
        rewardId: RANKED_PREMIUM_CARD_REWARD_ID[c.id as keyof typeof RANKED_PREMIUM_CARD_REWARD_ID],
        exclusiveUntilSeason: 'season_1',
      });
      expect(isExclusiveCard(c)).toBe(true);
      expect(cardSource(c)?.label).toBe('Pase Premium Ranked');
    }
    for (const heroId of ['mage', 'summoner', 'warrior'])
      for (let seed = 1; seed <= 40; seed++) {
        const offer = JSON.stringify(rollReward({ heroId, content: DEFAULT_CONTENT, rules: DECK_RULES, owned: () => 0, seed, pity: 10, poolId: seed % 2 ? 'BOSS' : 'ELITE', count: 3 }));
        for (const c of RANKED_PREMIUM_CORE_CARDS) expect(offer).not.toContain(`"${c.id}"`);
      }
  });

  it('registered where their champion lives; a second copy in a deck is refused', () => {
    for (const c of RANKED_PREMIUM_CORE_CARDS) expect(DEFAULT_CONTENT.cards[c.id]).toBe(c);
    expect(ARCHER.cards.stalker_heart?.heroId).toBe('archer');
    expect(SHIFTER.cards.primal_ascent?.heroId).toBe('shapeshifter');
    expect(DEFAULT_CONTENT.cards.stalker_heart).toBeUndefined();
    const deck = [{ cardId: 'ash_eclipse', count: 2 }, { cardId: 'magic_missile', count: 3 }];
    const issues = validateDeck(deck, 'mage', () => 3, DEFAULT_CONTENT, DECK_RULES);
    expect(JSON.stringify(issues)).toContain('COPY_LIMIT');
  });
});

describe('Pacto de la Doble Luna (Invocador)', () => {
  const setup = () => {
    const e = battle('summoner', p(0, 2), [ORC('orc-1', 6, 2)]);
    const fox = summon(e, 'fox', p(2, 2));
    const chicken = summon(e, 'chicken', p(3, 3));
    return { e, fox, chicken };
  };

  it('you ↔ an own summon: tiles swap, both gain 2 shield, the summon +1 move this turn; costs 3; banished', () => {
    const { e, fox } = setup();
    const before = e.state.player.energy;
    const [uid] = setHand(e, ['double_moon_pact']);
    expect(e.getValidTargets(uid!).map(keyOf)).toEqual(['2,2', '3,3']);
    expect(e.getSecondaryTargets(uid!, p(2, 2))).toEqual([null, p(3, 3)]);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(2, 2) }).ok).toBe(true);
    expect(e.state.player.energy).toBe(before - 3);
    expect(hero(e).pos).toEqual(p(2, 2));
    expect(unit(e, fox.id).pos).toEqual(p(0, 2));
    expect([hero(e).shield, unit(e, fox.id).shield]).toEqual([2, 2]);
    expect(unit(e, fox.id).statuses.find((s) => s.id === 'PACK_CALL')).toBeTruthy();
    expect(hero(e).statuses.find((s) => s.id === 'PACK_CALL')).toBeUndefined();
    expect(e.state.player.banished?.map((c) => c.cardId)).toEqual(['double_moon_pact']);
    expect(e.state.player.discard.some((c) => c.cardId === 'double_moon_pact')).toBe(false);
  });

  it('two own summons: they swap, the Invocador stays; both get shield and +1 move', () => {
    const { e, fox, chicken } = setup();
    expect(play(e, 'double_moon_pact', p(2, 2), p(3, 3)).ok).toBe(true);
    expect(hero(e).pos).toEqual(p(0, 2));
    expect(hero(e).shield).toBe(0);
    expect(unit(e, fox.id).pos).toEqual(p(3, 3));
    expect(unit(e, chicken.id).pos).toEqual(p(2, 2));
    for (const id of [fox.id, chicken.id]) {
      expect(unit(e, id).shield).toBe(2);
      expect(unit(e, id).statuses.some((s) => s.id === 'PACK_CALL')).toBe(true);
    }
  });

  it('illegal picks never resolve: enemy, empty tile, same summon twice, out of range, a secondary on another card', () => {
    const { e } = setup();
    expect(play(e, 'double_moon_pact', p(6, 2)).ok).toBe(false); // enemy as first
    expect(play(e, 'double_moon_pact', p(2, 2), p(6, 2)).ok).toBe(false); // enemy as partner
    expect(play(e, 'double_moon_pact', p(2, 2), p(1, 1)).ok).toBe(false); // empty tile
    expect(play(e, 'double_moon_pact', p(2, 2), p(2, 2)).ok).toBe(false); // same summon
    const far = battle('summoner', p(0, 2), [ORC('orc-1', 6, 4)]);
    summon(far, 'fox', p(5, 2));
    expect(play(far, 'double_moon_pact', p(5, 2)).ok).toBe(false); // range 4
    expect(play(e, 'magic_missile', p(6, 2), p(2, 2)).ok).toBe(false); // secondary only for pairSwap
    expect(hero(e).pos).toEqual(p(0, 2));
  });

  it('counterplay: a ROOTED unit never moves (caster rooted → only summon↔summon; summon rooted → not a pick)', () => {
    const { e, fox, chicken } = setup();
    applyStatus(ctxFor(e), hero(e), 'ROOTED', 1, 'orc-1');
    const [uid] = setHand(e, ['double_moon_pact']);
    expect(e.getSecondaryTargets(uid!, p(2, 2))).toEqual([p(3, 3)]);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(2, 2) }).ok).toBe(false);
    applyStatus(ctxFor(e), unit(e, chicken.id), 'ROOTED', 1, 'orc-1');
    expect(e.getValidTargets(uid!)).toEqual([]); // fox has no partner left, chicken is rooted
    expect(unit(e, fox.id).pos).toEqual(p(2, 2));
  });

  it('line of sight is required (a pillar hides the summon); a hostile trap under a destination springs', () => {
    const e = battle('summoner', p(0, 2), [ORC('orc-1', 6, 4)]);
    summon(e, 'fox', p(0, 4));
    createObstacle(ctxFor(e), p(0, 3), 'pillar', null, 'orc-1');
    expect(play(e, 'double_moon_pact', p(0, 4)).ok).toBe(false);
    const t = battle('summoner', p(0, 2), [ORC('orc-1', 6, 4)]);
    const fox = summon(t, 'fox', p(2, 2));
    placeTrap(ctxFor(t), unit(t, 'orc-1'), p(2, 2), 'snare', 2, 3);
    expect(play(t, 'double_moon_pact', p(2, 2)).ok).toBe(true);
    // The Invocador lands on the trapped tile (teleport → trap springs on it), the fox on the old tile.
    expect(hero(t).pos).toEqual(p(2, 2));
    expect(unit(t, fox.id).pos).toEqual(p(0, 2));
    expect(hero(t).statuses.some((s) => s.id === 'ROOTED')).toBe(true);
  });
});

describe('Muralla del Rey Caído (Guerrero)', () => {
  const setup = (guard: number, enemies = [ORC('orc-1', 1, 2)]) => {
    const e = battle('warrior', p(0, 2), enemies);
    if (guard) addShield(ctxFor(e), hero(e), guard, e.heroId);
    return e;
  };

  it('damage = current Guardia, then ALL of it is lost; under 5 there is no push and no MP', () => {
    const e = setup(4);
    const mp = e.state.player.movePoints;
    expect(play(e, 'fallen_king_wall', p(1, 2)).ok).toBe(true);
    expect(unit(e, 'orc-1').hp).toBe(8 - 4);
    expect(hero(e).shield).toBe(0);
    expect(unit(e, 'orc-1').pos).toEqual(p(1, 2));
    expect(e.state.player.movePoints).toBe(mp);
  });

  it('5+ Guardia: push 1 + recover 1 MP; capped at 7 damage and every point of Guardia is spent', () => {
    const e = setup(9, [ORC('orc-1', 1, 2)]);
    const mp = e.state.player.movePoints;
    expect(play(e, 'fallen_king_wall', p(1, 2)).ok).toBe(true);
    expect(unit(e, 'orc-1').hp).toBe(1); // 8 − 7 (cap)
    expect(hero(e).shield).toBe(0); // 9 lost, not 7
    expect(unit(e, 'orc-1').pos).toEqual(p(2, 2));
    expect(e.state.player.movePoints).toBe(mp + 1);
  });

  it('push respects collisions (no extra damage); no Guardia = no damage; melee only', () => {
    const e = setup(6, [ORC('orc-1', 1, 2), ORC('orc-2', 2, 2)]);
    expect(play(e, 'fallen_king_wall', p(1, 2)).ok).toBe(true);
    expect(unit(e, 'orc-1').pos).toEqual(p(1, 2));
    expect(unit(e, 'orc-1').hp).toBe(2);
    expect(unit(e, 'orc-2').hp).toBe(8);
    const dry = setup(0);
    expect(play(dry, 'fallen_king_wall', p(1, 2)).ok).toBe(true);
    expect(unit(dry, 'orc-1').hp).toBe(8);
    const far = setup(6, [ORC('orc-1', 2, 2)]);
    expect(play(far, 'fallen_king_wall', p(2, 2)).ok).toBe(false);
  });

  it('no MP loop: Única, so the +1 MP fires once per battle (the card is banished)', () => {
    const e = setup(6);
    const [uid] = setHand(e, ['fallen_king_wall']);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(1, 2) }).ok).toBe(true);
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: uid!, target: p(2, 2) }).ok).toBe(false);
    expect(e.state.player.banished?.map((c) => c.uid)).toEqual([uid]);
  });
});

describe('Corazón del Acechador (Arquero)', () => {
  const setup = (enemies = [ORC('orc-1', 4, 2)]) => battle('archer', p(0, 2), enemies, ARCHER);
  const markPrey = (e: Engine, id: string) => unit(e, id).statuses.push({ id: 'PREY', turnsLeft: 1, sourceId: e.heroId });

  it('2 base, +3 on the Presa; a survivor is Acechado (−1 walking next turn); no Concentración', () => {
    const plain = setup();
    expect(play(plain, 'stalker_heart', p(4, 2)).ok).toBe(true);
    const base = 8 - unit(plain, 'orc-1').hp;
    const prey = setup();
    markPrey(prey, 'orc-1');
    const focus = hero(prey).focus?.value ?? 0;
    expect(play(prey, 'stalker_heart', p(4, 2)).ok).toBe(true);
    expect(8 - unit(prey, 'orc-1').hp).toBe(base + 3);
    expect(hero(prey).focus?.value ?? 0).toBe(focus);
    const orc = unit(prey, 'orc-1');
    expect(orc.statuses.find((s) => s.id === 'STALKER_HOBBLE')).toMatchObject({ turnsLeft: 1 });
    expect(effectiveMoveRange(ctxFor(prey), orc)).toBe(orc.moveRange - 1);
  });

  it('the Summoner\'s Marcar Presa counts as Marcado; cleanse removes the slow; range 5 + sight', () => {
    const e = setup();
    applyStatus(ctxFor(e), unit(e, 'orc-1'), 'MARKED_PREY', 2, 'someone');
    expect(play(e, 'stalker_heart', p(4, 2)).ok).toBe(true);
    expect(unit(e, 'orc-1').hp).toBe(8 - 5);
    expect(cleanseUnit(ctxFor(e), unit(e, 'orc-1'))).toBeGreaterThan(0);
    expect(unit(e, 'orc-1').statuses.some((s) => s.id === 'STALKER_HOBBLE')).toBe(false);
    const far = setup([ORC('orc-1', 6, 2)]);
    expect(play(far, 'stalker_heart', p(6, 2)).ok).toBe(false);
  });

  it('a kill leaves nothing behind; slows never stack with Flecha de Hielo (strongest only)', () => {
    const e = setup();
    markPrey(e, 'orc-1');
    unit(e, 'orc-1').hp = 4;
    expect(play(e, 'stalker_heart', p(4, 2)).ok).toBe(true);
    expect(e.state.units.some((u) => u.id === 'orc-1')).toBe(false);
    const slow = setup();
    applyStatus(ctxFor(slow), unit(slow, 'orc-1'), 'SLOWED', 2, 'x');
    expect(play(slow, 'stalker_heart', p(4, 2)).ok).toBe(true);
    const orc = unit(slow, 'orc-1');
    expect(effectiveMoveRange(ctxFor(slow), orc)).toBe(Math.max(1, orc.moveRange - 2));
  });

  it('the slow lasts exactly the target\'s next turn', () => {
    const e = setup([ORC('orc-1', 4, 2)]);
    expect(play(e, 'stalker_heart', p(4, 2)).ok).toBe(true);
    e.dispatch(e.state.player.hand.length > 5 ? { type: 'END_TURN', discardUid: e.state.player.hand.at(-1)!.uid } : { type: 'END_TURN' });
    expect(unit(e, 'orc-1').statuses.some((s) => s.id === 'STALKER_HOBBLE')).toBe(false);
  });
});

describe('Eclipse de Ceniza (Mago)', () => {
  const setup = (enemies = [ORC('orc-1', 3, 2), ORC('orc-2', 4, 3)]) => battle('mage', p(0, 2), enemies);

  it('2×2 area anchored on the target (top-left): 3 arcane to every enemy inside', () => {
    const e = setup([ORC('orc-1', 3, 2), ORC('orc-2', 4, 3), ORC('orc-3', 5, 2)]);
    const preview = e.previewCard(setHand(e, ['ash_eclipse'])[0]!, p(3, 2));
    expect(new Set(preview.resolved!.affectedTiles.map(keyOf))).toEqual(new Set(['3,2', '4,2', '3,3', '4,3']));
    expect(play(e, 'ash_eclipse', p(3, 2)).ok).toBe(true);
    expect([unit(e, 'orc-1').hp, unit(e, 'orc-2').hp, unit(e, 'orc-3').hp]).toEqual([5, 5, 8]);
  });

  it('+2 on Quemadura (BURNING), Frío (SLOWED) or a unit on fire/ice terrain', () => {
    const e = setup([ORC('orc-1', 3, 2), ORC('orc-2', 4, 3)]);
    applyStatus(ctxFor(e), unit(e, 'orc-1'), 'BURNING', 2, 'x');
    applyStatus(ctxFor(e), unit(e, 'orc-2'), 'SLOWED', 2, 'x');
    expect(play(e, 'ash_eclipse', p(3, 2)).ok).toBe(true);
    // BURNING ticks only at its owner's turn start, so the hit itself is 3 + 2.
    expect([unit(e, 'orc-1').hp, unit(e, 'orc-2').hp]).toEqual([3, 3]);
  });

  it('approved mapping: Quemadura = Ardiendo or on fire, Frío = Ralentizado or on ice (terrain read at resolution)', () => {
    const e = setup([ORC('orc-1', 3, 2), ORC('orc-2', 4, 3), ORC('orc-3', 4, 2)]);
    createTerrain(ctxFor(e), p(3, 2), 'FIRE', 2, e.heroId);
    createTerrain(ctxFor(e), p(4, 3), 'ICE', 2, e.heroId);
    expect(play(e, 'ash_eclipse', p(3, 2)).ok).toBe(true);
    expect([unit(e, 'orc-1').hp, unit(e, 'orc-2').hp, unit(e, 'orc-3').hp]).toEqual([3, 3, 5]);
  });

  it('card texts promise no nonexistent state: no literal Frío/Quemadura, no form renewal', () => {
    for (const c of RANKED_PREMIUM_CARDS) expect(c.rulesText).not.toMatch(/Frío|Quemadura|renuev|renov/i);
    expect(DEFAULT_CONTENT.cards.ash_eclipse!.rulesText).toContain('Ardiendo o sobre fuego, o Ralentizado o sobre hielo');
    expect(SHIFTER.cards.primal_ascent!.rulesText).toContain('No cambia tu forma: aplica solo el efecto de tu forma actual');
  });

  it('2+ enemies hit: the next spell costs 1 less — once, never below 0, kills still count', () => {
    const e = setup([ORC('orc-1', 3, 2), ORC('orc-2', 3, 3)]);
    unit(e, 'orc-1').hp = 2; // dies to the hit: still counted
    expect(play(e, 'ash_eclipse', p(3, 2)).ok).toBe(true);
    expect(hero(e).costDiscounts).toEqual([{ scope: 'SPELL', amount: 1, sourceCardId: 'ash_eclipse' }]);
    const [mm1, mm2] = setHand(e, ['magic_missile', 'magic_missile']);
    expect(e.getCardCost(mm1!)).toEqual({ cost: 0, discount: 1 });
    const energy = e.state.player.energy;
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: mm1!, target: p(3, 3) }).ok).toBe(true);
    expect(e.state.player.energy).toBe(energy); // 1 − 1 = 0
    expect(hero(e).costDiscounts).toBeUndefined();
    expect(e.getCardCost(mm2!)).toEqual({ cost: 1, discount: 0 });
  });

  it('1 enemy hit: no discount; structures never count', () => {
    const e = setup([ORC('orc-1', 3, 2), ORC('orc-2', 6, 4)]);
    expect(play(e, 'ash_eclipse', p(3, 2)).ok).toBe(true);
    expect(hero(e).costDiscounts).toBeUndefined();
  });

  it('a pending discount never stacks and persists across turns (this battle)', () => {
    const e = setup();
    hero(e).costDiscounts = [{ scope: 'SPELL', amount: 1, sourceCardId: 'test' }];
    expect(play(e, 'ash_eclipse', p(3, 2)).ok).toBe(true);
    // Eclipse (cost 4) itself spent the pending one: paid 3; the new one is granted once.
    expect(hero(e).costDiscounts).toEqual([{ scope: 'SPELL', amount: 1, sourceCardId: 'ash_eclipse' }]);
    e.dispatch(e.state.player.hand.length > 5 ? { type: 'END_TURN', discardUid: e.state.player.hand.at(-1)!.uid } : { type: 'END_TURN' });
    expect(hero(e).costDiscounts).toHaveLength(1);
  });
});

describe('Ascenso Primordial (Cambiaformas)', () => {
  const setup = (form: 'bear' | 'minotaur' | null, enemies = [ORC('orc-1', 4, 2)]) => {
    const e = battle('shapeshifter', p(3, 2), enemies, SHIFTER);
    if (form) transform(ctxFor(e), hero(e), form);
    return e;
  };

  it('Humano: draws 1 and the next transformation costs 1 less (never below 0)', () => {
    const e = setup(null);
    const [asc] = setHand(e, ['primal_ascent']);
    const hand = e.state.player.hand.length;
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: asc!, target: null }).ok).toBe(true);
    expect(e.state.player.hand.length).toBe(hand); // −1 played, +1 drawn
    expect(hero(e).costDiscounts).toEqual([{ scope: 'TRANSFORM', amount: 1, sourceCardId: 'primal_ascent' }]);
    const [missile, form] = setHand(e, ['qa_primal_instinct', 'qa_minotaur_form']);
    expect(e.getCardCost(missile!)).toEqual({ cost: 0, discount: 0 }); // not a transformation (and cost 0)
    expect(e.getCardCost(form!)).toEqual({ cost: 0, discount: 1 });
    const energy = e.state.player.energy;
    expect(e.dispatch({ type: 'PLAY_CARD', cardUid: form!, target: null }).ok).toBe(true);
    expect(e.state.player.energy).toBe(energy);
    expect(hero(e).activeForm).toBe('minotaur');
    expect(hero(e).costDiscounts).toBeUndefined();
  });

  it('Oso: +2 Guardia and heals 2; no transformation, no Danza trigger', () => {
    const e = setup('bear');
    hero(e).hp -= 5;
    const hp = hero(e).hp;
    const events: string[] = [];
    e.subscribe((evs) => events.push(...evs.map((x) => x.type)));
    expect(play(e, 'primal_ascent', null).ok).toBe(true);
    expect(hero(e).shield).toBe(2);
    expect(hero(e).hp).toBe(hp + 2);
    expect(hero(e).activeForm).toBe('bear');
    expect(events).not.toContain('FORM_CHANGED');
    expect(hero(e).costDiscounts).toBeUndefined();
  });

  it('Minotauro: +1 MP and the next hit this turn pushes 1 (no collision damage), then it is spent', () => {
    const e = setup('minotaur');
    const mp = e.state.player.movePoints;
    expect(play(e, 'primal_ascent', null).ok).toBe(true);
    expect(e.state.player.movePoints).toBe(mp + 1);
    expect(hero(e).statuses.some((s) => s.id === 'PRIMAL_CHARGE')).toBe(true);
    expect(play(e, 'qa_horn_strike', p(4, 2)).ok).toBe(true);
    expect(unit(e, 'orc-1').pos).toEqual(p(5, 2));
    expect(hero(e).statuses.some((s) => s.id === 'PRIMAL_CHARGE')).toBe(false);
    unit(e, 'orc-1').pos = p(4, 2);
    expect(play(e, 'qa_horn_strike', p(4, 2)).ok).toBe(true);
    expect(unit(e, 'orc-1').pos).toEqual(p(4, 2)); // second hit: no push
  });

  it('Minotauro charge expires at the end of the turn when unused', () => {
    const e = setup('minotaur', [ORC('orc-1', 6, 4)]);
    expect(play(e, 'primal_ascent', null).ok).toBe(true);
    e.dispatch(e.state.player.hand.length > 5 ? { type: 'END_TURN', discardUid: e.state.player.hand.at(-1)!.uid } : { type: 'END_TURN' });
    expect(hero(e).statuses.some((s) => s.id === 'PRIMAL_CHARGE')).toBe(false);
  });
});

describe('Premium cards: replay, PvP and wire', () => {
  it('PvE replay: Eclipse (2 hit → discount) → discounted missile → end turn reproduces the exact state', () => {
    // A 5-card deck = the whole opening hand, so the commands are legal from the seed alone.
    const content = withHeroDeck(DEFAULT_CONTENT, 'mage', [{ cardId: 'ash_eclipse', count: 1 }, { cardId: 'magic_missile', count: 4 }]);
    const sc = scenario({ hero: { heroId: 'mage', pos: p(0, 2) }, enemies: [ORC('orc-1', 3, 2), ORC('orc-2', 4, 3)] });
    const e = makeEngine(sc, content, 4);
    const cmds: Command[] = [];
    const run = (c: Command) => {
      expect(e.dispatch(c).ok).toBe(true);
      cmds.push(c);
    };
    const uidOf = (id: string) => e.state.player.hand.find((c) => c.cardId === id)!.uid;
    run({ type: 'PLAY_CARD', cardUid: uidOf('ash_eclipse'), target: p(3, 2) });
    expect(hero(e).costDiscounts).toHaveLength(1);
    run({ type: 'PLAY_CARD', cardUid: uidOf('magic_missile'), target: unit(e, 'orc-1').pos });
    run({ type: 'END_TURN' });
    const replay = replayBattle(sc, content, 4, cmds);
    expect(replay.rejectedAt).toBeNull();
    expect(replay.state).toEqual(e.state);
  });

  it('PvP: Pacto two-summon swap + Eclipse discount are deterministic and identical in both seat views', () => {
    let s = createDuel([{ heroId: 'summoner', cards: DEFAULT_CONTENT.heroes.summoner!.deck }, { heroId: 'mage', cards: DEFAULT_CONTENT.heroes.mage!.deck }], 5);
    if (s.player.heroId !== 'champion-a') s = applyDuel(s, { type: 'END_TURN' }).state;
    s = structuredClone(s);
    const A = () => s.units.find((u) => u.id === 'champion-a')!;
    A().pos = p(0, 2);
    s.units.find((u) => u.id === 'champion-b')!.pos = p(6, 2);
    s.player.energy = 9;
    s.player.hand = [{ uid: 'f1', cardId: 'summon_fox' }, { uid: 'f2', cardId: 'summon_chicken' }, { uid: 'pact', cardId: 'double_moon_pact' }];
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'f1', target: p(1, 2) }).state;
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'f2', target: p(0, 3) }).state;
    const ownSummons = () => s.units.filter((u) => u.summon?.ownerId === 'champion-a');
    const [first, second] = ownSummons().map((u) => ({ ...u.pos }));
    const before = structuredClone(s);
    const cmd: Command = { type: 'PLAY_CARD', cardUid: 'pact', target: first!, secondary: second! };
    expect(validCommand(cmd)).toBe(true);
    const a = applyDuel(s, cmd).state,
      b = applyDuel(before, cmd).state;
    expect(a).toEqual(b);
    s = a;
    expect(ownSummons().map((u) => u.pos).sort((x, y) => x.x - y.x || x.y - y.y)).toEqual([first!, second!].sort((x, y) => x.x - y.x || x.y - y.y));
    expect(ownSummons().every((u) => u.shield === 2)).toBe(true);
    const pub = (seat: 0 | 1) => duelView(s, seat).units.map((u) => [u.id, u.pos, u.shield, u.statuses.map((x) => x.id)]);
    expect(pub(0)).toEqual(pub(1));
  });

  it('PvP: the Mage discount is public battle state and survives the turn hand-off', () => {
    let s = createDuel([{ heroId: 'mage', cards: DEFAULT_CONTENT.heroes.mage!.deck }, { heroId: 'warrior', cards: DEFAULT_CONTENT.heroes.warrior!.deck }], 3);
    if (s.player.heroId !== 'champion-a') s = applyDuel(s, { type: 'END_TURN' }).state;
    s = structuredClone(s);
    s.units.find((u) => u.id === 'champion-a')!.pos = p(0, 2);
    s.units.find((u) => u.id === 'champion-b')!.pos = p(3, 2);
    s.player.energy = 9;
    s.player.hand = [{ uid: 'ecl', cardId: 'ash_eclipse' }];
    s = applyDuel(s, { type: 'PLAY_CARD', cardUid: 'ecl', target: p(3, 2) }).state;
    // Only one enemy (the rival champion) in a duel: no discount — the 2+ clause needs summons/objectives.
    expect(s.units.find((u) => u.id === 'champion-a')!.costDiscounts).toBeUndefined();
    const view = duelView(s, 1);
    expect(view.units.find((u) => u.id === 'champion-a')).toBeTruthy();
  });

  it('wire: validCommand accepts a secondary position, refuses garbage; old commands stay byte-identical', () => {
    expect(validCommand({ type: 'PLAY_CARD', cardUid: 'x', target: { x: 1, y: 2 }, secondary: { x: 3, y: 4 } })).toBe(true);
    expect(validCommand({ type: 'PLAY_CARD', cardUid: 'x', target: { x: 1, y: 2 }, secondary: { x: 1.5, y: 4 } })).toBe(false);
    expect(validCommand({ type: 'PLAY_CARD', cardUid: 'x', target: { x: 1, y: 2 }, secondary: 'a' })).toBe(false);
    expect(validCommand({ type: 'PLAY_CARD', cardUid: 'x', target: null })).toBe(true);
  });

  it('events: discount grant/use are emitted for the presentation', () => {
    const e = battle('mage', p(0, 2), [ORC('orc-1', 3, 2), ORC('orc-2', 4, 2)]);
    const seen: import('../src/game').GameEvent[] = [];
    e.subscribe((evs) => seen.push(...evs));
    play(e, 'ash_eclipse', p(3, 2));
    play(e, 'magic_missile', p(4, 2));
    expect(ofType(seen, 'COST_DISCOUNT_GRANTED')).toHaveLength(1);
    expect(ofType(seen, 'COST_DISCOUNT_USED')[0]).toMatchObject({ cardId: 'magic_missile', paid: 0 });
  });
});

export type { GameState };
