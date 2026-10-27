import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONTENT } from '../src/game';
import {
  CHARACTER_ANIMATIONS,
  INFERNAL_ANIMATION_IDS,
  clipOffset,
  hasDirectionalAtlas,
} from '../src/presentation/pixi/characterAnimations';
import { CHARACTER_PAINTINGS, FINAL_CARD_ART } from '../src/presentation/assets/paintedAssets';
import { unitVisualId, unitVisualTint } from '../src/presentation/assets/visualIdentity';
import { worldRewardIdentity } from '../src/presentation/cards/worldRewardPresentation';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';

describe('World 2 final artwork contract', () => {
  for (const id of INFERNAL_ANIMATION_IDS)
    it(`${id} has unique directional assets and grounded full state lookup`, () => {
      expect(unitVisualId(id)).toBe(id);
      expect(unitVisualTint(id)).toBe(0xffffff);
      expect(hasDirectionalAtlas(id)).toBe(true);
      const layout = CHARACTER_ANIMATIONS[id]!;
      const hashes = Object.values(layout.directionalUrls!).map((url) => {
        expect(existsSync(`public${url}`)).toBe(true);
        const data = readFileSync(`public${url}`);
        expect(data.length).toBeGreaterThan(1000);
        return createHash('sha256').update(data).digest('hex');
      });
      expect(new Set(hashes).size).toBe(4);
      for (const state of [
        'idle',
        'walk',
        'attack',
        'cast',
        'hit',
        'death',
        'arrival',
        'ability',
      ] as const) {
        const clip = layout.clips[state]!;
        expect(clip).toBeDefined();
        for (let i = 0; i < clip.count; i++) {
          const offset = clipOffset(layout, state, i)!;
          expect(offset.x + offset.width).toBeLessThanOrEqual(2048);
          expect(offset.y).toBe(0);
        }
        expect(clipOffset(layout, state, clip.count)).toBeNull();
      }
      expect(existsSync(`public${CHARACTER_PAINTINGS[id]}`)).toBe(true);
    });
  it('card origin and final art follow authoritative metadata, with unchanged rarity', () => {
    for (const id of ['magma_fissure', 'summon_ash_hound', 'forge_strike']) {
      const card = DEFAULT_CONTENT.cards[id]!;
      expect(card.rarity).toBe('RARE');
      expect(worldRewardIdentity(card)?.name).toBe('Reino Infernal');
      expect(existsSync(`public${FINAL_CARD_ART[id]}`)).toBe(true);
    }
    expect(worldRewardIdentity(DEFAULT_CONTENT.cards.fireball!)).toBeNull();
    expect(
      worldRewardIdentity({ acquisition: { source: 'WORLD_COMPLETION', worldId: 'unknown' } }),
    ).toBeNull();
  });
  it('short accepted casting cues preserve their event payload in reduced motion', () => {
    const event = {
      type: 'CARD_PLAYED' as const,
      cardUid: 'qa',
      cardId: 'magma_fissure',
      casterId: 'mage',
      target: { x: 2, y: 2 },
      direction: null,
      impact: { x: 2, y: 2 },
      affectedTiles: [
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
    };
    const full = compileTimeline([event], (id) => id, false),
      reduced = compileTimeline([event], (id) => id, true);
    expect(full.cues[0]!.event).toBe(event);
    expect(reduced.cues[0]!.event).toBe(event);
    expect(full.duration).toBeGreaterThan(reduced.duration);
    expect(full.cues.find((c) => c.kind === 'cast')!.duration).toBe(240);
    expect(reduced.cues.find((c) => c.kind === 'cast')!.duration).toBe(80);
  });
});
