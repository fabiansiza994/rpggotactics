import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GuideRelease } from '../src/presentation/site/ChampionGuides';
vi.stubEnv('VITE_ARCHER_ENABLED', '1');
vi.stubEnv('VITE_SHAPESHIFTER_ENABLED', '1');
const { ChampionGuides, guideContent, guideVisible } =
  await import('../src/presentation/site/ChampionGuides');
import { championGuideHref } from '../src/presentation/site/championGuideLinks';
const release: GuideRelease = {
  warrior: true,
  shapeshifter: true,
  archer: true,
  rituals: true,
  archerCampaign: true,
};
describe('published champion guides', () => {
  it('provides stable per-champion destinations and safe unknown fallback', () => {
    for (const id of ['mage', 'summoner', 'warrior', 'shapeshifter', 'archer']) {
      expect(championGuideHref(id)).toBe(`https://rpg-go-tactics.com/#champion-${id}`);
      expect(guideContent(release).heroes[id]).toBeDefined();
    }
    expect(championGuideHref('future')).toBe('https://rpg-go-tactics.com/#champions');
  });
  it('does not expose unreleased champions or QA through public visibility', () => {
    const off = { ...release, warrior: false, archer: false, shapeshifter: false };
    expect(guideVisible('mage', off)).toBe(true);
    for (const id of ['archer', 'warrior', 'shapeshifter', 'unknown'])
      expect(guideVisible(id, off)).toBe(false);
    expect(guideContent(off).heroes.archer).toBeUndefined();
  });
  it('renders Archer anchor and live focus/card facts, hides unreleased arrows and rituals', () => {
    const html = renderToStaticMarkup(createElement(ChampionGuides, { release }));
    expect(html).toContain('id="champion-archer"');
    expect(html).toContain('href="#champion-archer"');
    expect(html).toContain('Tiro al Corazón');
    expect(html).toContain('No se gana pasivamente');
    expect(html).toContain('Flecha de Rebote');
    const hidden = renderToStaticMarkup(
      createElement(ChampionGuides, {
        release: { ...release, rituals: false, archerCampaign: false },
      }),
    );
    expect(hidden).not.toContain('Flechas especiales');
    expect(hidden).not.toContain('<strong>Rituales:');
  });
});
