import { describe, expect, it } from 'vitest';
import { drawCards } from '../src/game/domain/cards/deck';
import { posKey } from '../src/game/domain/core/position';
import { ctxFor, makeEngine, mutable, ofType, p, setHand, unit } from './helpers';

const keys = (ps: { x: number; y: number }[]) => ps.map(posKey).sort();

describe('card costs and validation', () => {
  it('spends energy and moves the card from hand to discard', () => {
    const engine = makeEngine({ enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(3, 2) }] });
    const [fireball] = setHand(engine, ['fireball']);
    const result = engine.dispatch({ type: 'PLAY_CARD', cardUid: fireball as string, target: p(3, 2) });
    expect(result.ok).toBe(true);
    expect(engine.state.player.energy).toBe(3);
    expect(engine.state.player.hand).toHaveLength(0);
    expect(engine.state.player.discard.at(-1)?.uid).toBe(fireball);
    const types = result.events.map((e) => e.type);
    expect(types.indexOf('CARD_PLAYED')).toBeLessThan(types.indexOf('UNIT_DAMAGED'));
    expect(types.at(-1)).toBe('CARD_RESOLVED');
  });

  it('cannot be played without enough energy', () => {
    const engine = makeEngine({ enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(3, 2) }] });
    const [fireball] = setHand(engine, ['fireball']);
    mutable(engine).player.energy = 1;
    expect(engine.getCardPlayability(fireball as string)).toMatchObject({ playable: false, reason: 'NOT_ENOUGH_ENERGY' });
    expect(engine.getValidTargets(fireball as string)).toEqual([]);
    const result = engine.dispatch({ type: 'PLAY_CARD', cardUid: fireball as string, target: p(3, 2) });
    expect(result).toMatchObject({ ok: false, error: 'NOT_ENOUGH_ENERGY' });
    expect(engine.state.player.hand).toHaveLength(1);
  });

  it('an invalid target never resolves and costs nothing', () => {
    const engine = makeEngine();
    const [missile] = setHand(engine, ['magic_missile']);
    const hpBefore = unit(engine, 'orc-1').hp;
    const result = engine.dispatch({ type: 'PLAY_CARD', cardUid: missile as string, target: p(6, 2) }); // range 6 > 4
    expect(result).toMatchObject({ ok: false, error: 'INVALID_TARGET' });
    expect(unit(engine, 'orc-1').hp).toBe(hpBefore);
    expect(engine.state.player.energy).toBe(5);
    expect(engine.state.player.hand).toHaveLength(1);
  });

  it('rejects a card that is not in hand', () => {
    const engine = makeEngine();
    expect(engine.dispatch({ type: 'PLAY_CARD', cardUid: 'nope', target: null })).toMatchObject({
      ok: false,
      error: 'CARD_NOT_IN_HAND',
    });
  });
});

describe('targeting', () => {
  it('LINE stops at the first unit and at LoS blockers', () => {
    const engine = makeEngine({
      layout: ['.......', '.......', '.......', '.......', '.......'],
      hero: { heroId: 'mage', pos: p(1, 2) },
      enemies: [
        { id: 'orc-1', enemyId: 'orc_warrior', pos: p(3, 2) },
        { id: 'orc-2', enemyId: 'orc_warrior', pos: p(4, 2) },
      ],
    });
    const [fireball] = setHand(engine, ['fireball']);
    const preview = engine.previewCard(fireball as string, p(2, 2));
    expect(preview.valid).toBe(true);
    expect(preview.resolved?.impact).toEqual(p(3, 2));
    expect(keys(preview.resolved?.affectedTiles ?? [])).toEqual(['2,2', '3,2']);
    expect(ofType(preview.predictedEvents, 'UNIT_DAMAGED').map((e) => e.unitId)).toEqual(['orc-1']);
    // Tiles behind the first unit are not selectable in that direction.
    expect(keys(engine.getValidTargets(fireball as string))).not.toContain('4,2');
  });

  it('LINE is blocked by pillars (blocksLineOfSight)', () => {
    const engine = makeEngine({
      layout: ['.......', '.......', '...#...', '.......', '.......'],
      hero: { heroId: 'mage', pos: p(1, 2) },
      enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(5, 2) }],
    });
    const [fireball] = setHand(engine, ['fireball']);
    const targets = keys(engine.getValidTargets(fireball as string));
    expect(targets).toContain('2,2');
    expect(targets).not.toContain('3,2');
    expect(targets).not.toContain('5,2');
  });

  it('UNIT targeting respects range, faction filter and LoS', () => {
    const engine = makeEngine({
      layout: ['.......', '.......', '..#....', '.......', '.......'],
      hero: { heroId: 'mage', pos: p(0, 2) },
      enemies: [
        { id: 'orc-1', enemyId: 'orc_warrior', pos: p(3, 2) }, // behind the pillar
        { id: 'orc-2', enemyId: 'orc_warrior', pos: p(1, 0) },
      ],
    });
    const [missile, barrier] = setHand(engine, ['magic_missile', 'barrier']);
    expect(keys(engine.getValidTargets(missile as string))).toEqual(['1,0']);
    expect(keys(engine.getValidTargets(barrier as string))).toEqual(['0,2']); // ALLY includes self
  });

  it('CROSS hits a plus shape and AREA hits a square', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(0, 0) } });
    const [burst] = setHand(engine, ['arcane_burst']);
    const cross = engine.previewCard(burst as string, p(2, 1));
    expect(keys(cross.resolved?.affectedTiles ?? [])).toEqual(['1,1', '2,0', '2,1', '2,2', '3,1']);
    expect(engine.previewCard(burst as string, p(3, 3)).valid).toBe(false); // out of range 3
  });

  it('SELF with an area centres on the caster (Frost Nova excludes the caster tile)', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(3, 2) } });
    const [nova] = setHand(engine, ['frost_nova']);
    const preview = engine.previewCard(nova as string, null);
    expect(preview.resolved?.affectedTiles).toHaveLength(8);
    expect(keys(preview.resolved?.affectedTiles ?? [])).not.toContain('3,2');
  });

  it('TILE with EMPTY filter excludes occupied tiles', () => {
    const engine = makeEngine({ hero: { heroId: 'mage', pos: p(3, 2) }, enemies: [{ id: 'orc-1', enemyId: 'orc_warrior', pos: p(4, 2) }] });
    const [blink] = setHand(engine, ['blink']);
    const targets = keys(engine.getValidTargets(blink as string));
    expect(targets).not.toContain('4,2');
    expect(targets).not.toContain('3,2');
    expect(targets).toContain('6,2');
  });
});

describe('deck, discard and reshuffle', () => {
  it('reshuffles the discard pile into the deck deterministically when the deck runs out', () => {
    const run = (seed: number) => {
      const engine = makeEngine({}, undefined, seed);
      const s = mutable(engine);
      s.player.discard = [...s.player.deck, ...s.player.hand];
      s.player.deck = [];
      s.player.hand = [];
      const events: import('../src/game/domain/events').GameEvent[] = [];
      drawCards(ctxFor(engine, events), 3);
      return { hand: s.player.hand.map((c) => c.uid), events };
    };
    const a = run(7);
    const b = run(7);
    expect(a.hand).toHaveLength(3);
    expect(a.hand).toEqual(b.hand);
    expect(ofType(a.events, 'DECK_RESHUFFLED')[0]?.cardCount).toBe(30);
  });

  it('the same seed produces the same opening hand, different seeds usually differ', () => {
    const hand = (seed: number) => makeEngine({}, undefined, seed).state.player.hand.map((c) => c.cardId);
    expect(hand(123)).toEqual(hand(123));
    const variants = new Set([1, 2, 3, 4, 5].map((s) => hand(s).join()));
    expect(variants.size).toBeGreaterThan(1);
  });
});
