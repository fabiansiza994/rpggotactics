import { createElement } from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RANKED_TRACK_CARDS } from '../src/game/data/ranked-cards';
import { RANKED_TRACK, RANKED_COSMETICS, rankedTrackView } from '../src/game/ranked/rewardTrack';
import { RankedRewardsDialog, RankedCardFace } from '../src/presentation/ranked/RankedRewardsTrack';
import { RankedRewardUnlock } from '../src/presentation/ranked/RankedRewardUnlock';
import { RankedCosmeticPreview } from '../src/presentation/ranked/RankedCosmeticPreview';
import { FINAL_CARD_ART } from '../src/presentation/assets/paintedAssets';
import { premiumIdentity } from '../src/presentation/cards/premiumTreatment';
const view = () =>
  rankedTrackView({ rp: 893, peakRp: 905, firstValidRanked: true, granted: {}, milestones: [] });
describe('Ranked reward visual contracts', () => {
  it('18 real nodes and divisions, current and peak, no loss on demotion', () => {
    const html = renderToStaticMarkup(
      createElement(RankedRewardsDialog, { view: view(), onClose: () => {}, onRefresh: () => {} }),
    );
    expect(html.match(/class="rrt-node"/g)).toHaveLength(18);
    expect(html).toContain('TÚ ESTÁS AQUÍ');
    expect(html).toContain('MÁXIMO ALCANZADO');
    expect(html).toContain('Las recompensas no se pierden.');
    expect(html).toContain('893 RP');
    expect(html).toContain('data-status="LOCKED"');
    expect(html).toContain('data-status="UNLOCKED"');
  });
  it('claimed cards retain provenance and full rules; locked cards remain previewable', () => {
    const v = view();
    const node = v.nodes.find((n) => n.items.some((i) => i.cardId === 'siege_leap'))!;
    expect(node.status).toBe('LOCKED');
    for (const card of RANKED_TRACK_CARDS) {
      const html = renderToStaticMarkup(createElement(RankedCardFace, { card }));
      expect(html).toContain(card.name);
      expect(html).toContain(card.rulesText.replaceAll('&', '&amp;'));
      expect(html).toContain(`data-rarity="${card.rarity}"`);
    }
  });
  it('nine individual WebP illustrations, no shared or placeholder art', () => {
    const hashes = [];
    for (const card of RANKED_TRACK_CARDS) {
      const path = FINAL_CARD_ART[card.id]!;
      expect(path).toBe(`/art/ranked-cards/${card.id}.webp`);
      const bytes = readFileSync('public' + path);
      expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
      expect(bytes.length).toBeLessThan(180000);
      hashes.push(createHash('sha256').update(bytes).digest('hex'));
    }
    expect(new Set(hashes).size).toBe(9);
  });
  it('six original cosmetics have real assets and explicit ownership without fake equip', () => {
    expect(Object.keys(RANKED_COSMETICS)).toHaveLength(6);
    for (const cosmetic of Object.values(RANKED_COSMETICS)) {
      expect(existsSync(`public/art/ranked-rewards/${cosmetic.id}.svg`)).toBe(true);
      expect(
        renderToStaticMarkup(
          createElement(RankedCosmeticPreview, { cosmeticId: cosmetic.id, owned: true }),
        ),
      ).toContain('EN PROPIEDAD');
      expect(
        renderToStaticMarkup(createElement(RankedCosmeticPreview, { cosmeticId: cosmetic.id })),
      ).toContain('BLOQUEADO');
    }
  });
  it('rare presentation keeps the Rare finish (super is Legendary only) without changing any rarity or effect', () => {
    for (const id of ['siege_leap', 'tracking_arrow', 'arcane_exchange']) {
      const card = RANKED_TRACK_CARDS.find((c) => c.id === id)!;
      expect(card.rarity).toBe('RARE');
      expect(['subtle', 'showcase']).toContain(premiumIdentity(card).treatment);
    }
  });
  it('one compact panel for multiple authoritative grants, none for an empty list', () => {
    const cards = RANKED_TRACK.flatMap((n) => n.items)
      .filter((i) => i.type === 'CARD')
      .slice(0, 3);
    const rewards = cards.map((c) => ({
      rewardId: c.rewardId,
      type: 'CARD' as const,
      itemId: c.cardId!,
      heroId: c.heroId!,
      granted: c.quantity,
    }));
    const html = renderToStaticMarkup(createElement(RankedRewardUnlock, { rewards }));
    expect(html).toContain('NUEVAS RECOMPENSAS');
    expect(html.match(/class="rrt-unlock-card"/g)).toHaveLength(3);
    expect(html).not.toContain('role="dialog"');
    expect(renderToStaticMarkup(createElement(RankedRewardUnlock, { rewards: [] }))).toBe('');
  });
  it('motion and loopback QA remain presentation-only', () => {
    const css = readFileSync('src/styles/ranked-rewards.css', 'utf8');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toMatch(/scroll-snap-type:\s*x proximity/);
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main).toContain(
      "import.meta.env.DEV && ['localhost','127.0.0.1','[::1]'].includes(location.hostname) && location.pathname === '/ranked-rewards-visual-qa'",
    );
  });
});
