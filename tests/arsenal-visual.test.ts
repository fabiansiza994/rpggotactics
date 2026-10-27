import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { ARSENAL_CARDS } from '../src/game';
import { FINAL_CARD_ART, ARSENAL_CARD_ART_IDS } from '../src/presentation/assets/paintedAssets';
import { premiumIdentity } from '../src/presentation/cards/premiumTreatment';
import { CARD_IDENTITY } from '../src/presentation/assets/visualIdentity';
describe('Arsenal I visual contract', () => {
  it('provides twelve distinct bounded final artworks', () => {
    const hashes = new Set<string>();
    expect(ARSENAL_CARD_ART_IDS).toHaveLength(12);
    for (const card of ARSENAL_CARDS) {
      const path = 'public' + FINAL_CARD_ART[card.id];
      const data = readFileSync(path);
      expect(data.subarray(0, 4).toString()).toBe('RIFF');
      expect(statSync(path).size).toBeLessThan(220000);
      hashes.add(createHash('sha256').update(data).digest('hex'));
      expect(CARD_IDENTITY[card.presentation.visualKey]).toBeDefined();
    }
    expect(hashes.size).toBe(12);
  });
  it('only upgrades the three authored showcase rares, without changing definitions', () => {
    const before = JSON.stringify(ARSENAL_CARDS);
    const showcase = ARSENAL_CARDS.filter((c) => premiumIdentity(c).treatment === 'showcase');
    expect(showcase.map((c) => c.id)).toEqual(['silence_seal', 'alpha_instinct', 'guard_breaker']);
    expect(showcase.every((c) => c.rarity === 'RARE')).toBe(true);
    expect(
      ARSENAL_CARDS.filter((c) => !c.heroId).every(
        (c) => premiumIdentity(c).treatment !== 'showcase',
      ),
    ).toBe(true);
    expect(JSON.stringify(ARSENAL_CARDS)).toBe(before);
  });
  it('preserves functional source and public flags byte for byte', () => {
    const hashes = JSON.parse(
      readFileSync('qa/arsenal-visual/functional-before.json', 'utf8'),
    ) as Record<string, string>;
    for (const [path, hash] of Object.entries(hashes))
      expect(createHash('sha256').update(readFileSync(path)).digest('hex'), path).toBe(hash);
  });
});
