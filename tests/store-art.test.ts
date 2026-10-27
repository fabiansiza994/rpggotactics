import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { FINAL_CARD_ART } from '../src/presentation/assets/paintedAssets';
import { DEFAULT_CONTENT } from '../src/game';
describe('final store card illustrations', () => {
  it('provides distinct optimized local assets without changing VFX keys', () => {
    const storeArt=Object.values(FINAL_CARD_ART).filter(path=>path.startsWith('/art/store-cards/'));
    expect(storeArt).toHaveLength(32);
    expect(new Set(Object.values(FINAL_CARD_ART)).size).toBe(Object.keys(FINAL_CARD_ART).length);
    for (const id of ['magma_fissure', 'summon_ash_hound', 'forge_strike']) {
      expect(FINAL_CARD_ART[id]).toBe(`/art/world-rewards/${id}.webp`);
    }
    for (const [id, path] of Object.entries(FINAL_CARD_ART)) {
      expect(DEFAULT_CONTENT.cards[id], id).toBeDefined();
      expect(existsSync('public' + path), path).toBe(true);
      // Final World 2 rewards are taller 640×960 paintings; retain the existing
      // 220 KB budget for store art and bound the three new paintings separately.
      const budget = path.startsWith('/art/world-rewards/') ? 300000 : 220000;
      expect(statSync('public' + path).size, path).toBeLessThan(budget);
    }
    expect(DEFAULT_CONTENT.cards.pack_hymn!.presentation.visualKey).toBe('nurture');
    expect(DEFAULT_CONTENT.cards.entangle!.presentation.visualKey).toBe('nurture');
  });
});
