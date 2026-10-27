import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_CONTENT,
  ARSENAL_EXPANSION,
  TACTICAL_EXPANSION,
  SHOWCASE_STORE_EXPANSION,
  RITUAL_EXPANSION,
  STORE_CATALOG,
  COSMETICS,
  DECK_RULES,
  validOffers,
} from '../src/game';
import { releasedContent } from '../server/src/ritualRelease';
import type { Env } from '../server/src/db';
import { guestRewardContent, world2BuildEnabled } from '../src/presentation/campaignRelease';
afterEach(() => vi.unstubAllEnvs());
describe('isolated content release switches', () => {
  it('defaults off and releases each set independently without mutating content', () => {
    const before = JSON.stringify(DEFAULT_CONTENT);
    expect(releasedContent(DEFAULT_CONTENT, {} as Env)).toBe(DEFAULT_CONTENT);
    for (const [flag, id] of [
      ['ARSENAL_CARDS_ENABLED', ARSENAL_EXPANSION],
      ['TACTICAL_CARDS_ENABLED', TACTICAL_EXPANSION],
      ['STORE_SHOWCASE_ENABLED', SHOWCASE_STORE_EXPANSION],
    ] as const)
      expect(
        releasedContent(DEFAULT_CONTENT, { [flag]: '1' } as unknown as Env).releasedExpansions,
      ).toContain(id);
    expect(JSON.stringify(DEFAULT_CONTENT)).toBe(before);
  });
  it('releases six premium bundles only when all required sets are released', () => {
    const premium = STORE_CATALOG.filter(
      (o) => o.type === 'CHAMPION_PACK' && o.tags.includes('premium'),
    );
    const released = releasedContent(DEFAULT_CONTENT, {
      ARSENAL_CARDS_ENABLED: '1',
      TACTICAL_CARDS_ENABLED: '1',
      STORE_SHOWCASE_ENABLED: '1',
      SUMMONER_RITUALS_ENABLED: '1',
    } as Env);
    expect(new Set(released.releasedExpansions)).toEqual(
      new Set([ARSENAL_EXPANSION, TACTICAL_EXPANSION, SHOWCASE_STORE_EXPANSION, RITUAL_EXPANSION]),
    );
    const offers = validOffers(STORE_CATALOG, {
      content: released,
      cosmetics: COSMETICS,
      rules: DECK_RULES,
    });
    expect(premium).toHaveLength(6);
    expect(premium.every((o) => offers.some((v) => v.id === o.id))).toBe(true);
    const off = validOffers(STORE_CATALOG, {
      content: DEFAULT_CONTENT,
      cosmetics: COSMETICS,
      rules: DECK_RULES,
    });
    expect(premium.every((o) => !off.some((v) => v.id === o.id))).toBe(true);
  });
  it('coordinates guest acquisition while keeping World 2 off', () => {
    vi.stubEnv('VITE_ARSENAL_CARDS', '1');
    vi.stubEnv('VITE_TACTICAL_CARDS', '1');
    vi.stubEnv('VITE_STORE_SHOWCASE', '1');
    vi.stubEnv('VITE_WORLD_2_ENABLED', '0');
    expect(guestRewardContent().releasedExpansions).toEqual(
      expect.arrayContaining([ARSENAL_EXPANSION, TACTICAL_EXPANSION, SHOWCASE_STORE_EXPANSION]),
    );
    expect(world2BuildEnabled()).toBe(false);
  });
});
