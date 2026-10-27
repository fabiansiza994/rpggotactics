import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RankedCrest, VictoryBadge } from '../src/presentation/ranked/RankedCosmetics';
import { RankedIntro } from '../src/presentation/ranked/RankedViews';
import { ProfileFrame } from '../src/presentation/shop/ProfileFrame';

/** Each equipped Ranked cosmetic renders only in its own slot renderer; unknown/wrong-kind ids render nothing. */
describe('Ranked cosmetic renderers', () => {
  it('crest: only RANKED_CREST ids', () => {
    expect(renderToStaticMarkup(createElement(RankedCrest, { crestId: 'crest_ranked_platinum' }))).toContain('/art/ranked-rewards/crest_ranked_platinum.svg');
    expect(renderToStaticMarkup(createElement(RankedCrest, { crestId: 'ranked_emblem_preseason_0' }))).toContain('Emblema de Pretemporada');
    for (const id of ['frame_ranked_gold_duelist', 'badge_ranked_diamond_victory', 'nope', null])
      expect(renderToStaticMarkup(createElement(RankedCrest, { crestId: id }))).toBe('');
  });

  it('victory badge: only VICTORY_BADGE ids', () => {
    expect(renderToStaticMarkup(createElement(VictoryBadge, { badgeId: 'badge_ranked_diamond_victory' }))).toContain('ranked-victory-badge');
    expect(renderToStaticMarkup(createElement(VictoryBadge, { badgeId: 'crest_ranked_platinum' }))).toBe('');
  });

  it('profile frame: Ranked frames ring the portrait; store frames keep their painted overlay; unknown = bare portrait', () => {
    const portrait = createElement('img', { src: 'p.webp', alt: '' });
    const ranked = renderToStaticMarkup(createElement(ProfileFrame, { frameId: 'frame_ranked_diamond_facet', children: portrait }));
    expect(ranked).toContain('ranked-profile-frame');
    expect(ranked).toContain('/art/ranked-rewards/frame_ranked_diamond_facet.svg');
    expect(ranked).toContain('p.webp');
    const store = renderToStaticMarkup(createElement(ProfileFrame, { frameId: 'frame_arcane_gilt', children: portrait }));
    expect(store).toContain('frame_arcane_gilt-v1.webp');
    expect(store).not.toContain('ranked-profile-frame');
    const wrongKind = renderToStaticMarkup(createElement(ProfileFrame, { frameId: 'crest_ranked_platinum', children: portrait }));
    expect(wrongKind).toContain('<img src="p.webp" alt=""/>');
    expect(wrongKind).not.toContain('profile-frame');
  });

  it('Ranked VS shows each side\'s crest beside the name (and no badge there)', () => {
    const html = renderToStaticMarkup(
      createElement(RankedIntro, {
        ranked: { rp: [120, 40], outcome: null },
        seat: 0,
        names: ['alice', 'bob'],
        champions: ['mage', 'summoner'],
        crests: ['crest_ranked_apex_preseason_0', null],
      }),
    );
    expect(html).toContain('crest_ranked_apex_preseason_0.svg');
    expect(html.match(/ranked-crest/g)).toHaveLength(1);
    expect(html).not.toContain('ranked-victory-badge');
  });
});
