import { describe, it, expect } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game';
import { premiumIdentity, premiumPointer } from '../src/presentation/cards/premiumTreatment';

describe('presentation-only premium treatment', () => {
  it('keeps common cards standard and ordinary Rare cards restrained', () => {
    expect(premiumIdentity(DEFAULT_CONTENT.cards.fireball!).treatment).toBe('none');
    expect(premiumIdentity(DEFAULT_CONTENT.cards.execution!).treatment).toBe('subtle');
  });
  it.each(['magma_fissure', 'summon_ash_hound', 'forge_strike'])(
    'world origin drives %s without changing rarity',
    (id) => {
      const card = DEFAULT_CONTENT.cards[id]!;
      const before = JSON.stringify(card);
      // Free catalog decision: a world Rare keeps the Rare finish (origin = motif + seal, never super).
      expect(premiumIdentity(card)).toMatchObject({ treatment: 'subtle', motif: 'forge' });
      expect(card.rarity).toBe('RARE');
      expect(JSON.stringify(card)).toBe(before);
    },
  );
  it('uses one registry for Drake and ritual pieces', () => {
    expect(premiumIdentity(DEFAULT_CONTENT.cards.summon_war_drake!)).toMatchObject({
      treatment: 'subtle',
      motif: 'dragon',
    });
    expect(premiumIdentity(DEFAULT_CONTENT.cards.rune_stone!)).toMatchObject({
      treatment: 'subtle',
      motif: 'spectral',
    });
  });
  it('clamps tilt and light to the surface, including degenerate bounds', () => {
    expect(premiumPointer(50, 50, { left: 0, top: 0, width: 100, height: 100 })).toMatchObject({
      x: 0,
      y: 0,
      lightX: 50,
      lightY: 50,
    });
    expect(premiumPointer(300, -50, { left: 0, top: 0, width: 100, height: 100 })).toMatchObject({
      angleX: 6,
      angleY: 6,
      lightX: 100,
      lightY: 0,
    });
    expect(
      Number.isFinite(premiumPointer(0, 0, { left: 0, top: 0, width: 0, height: 0 }).angleX),
    ).toBe(true);
  });
});
