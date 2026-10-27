import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_CONTENT } from '../src/game';
import { CardPremiumFx } from '../src/presentation/react/components/CardPremiumFx';
import { PremiumRewardArt } from '../src/presentation/ranked/RankedPremiumTrack';
import { RANKED_PREMIUM_ITEMS } from '../src/game/ranked/premiumTrack';
import { readFileSync } from 'node:fs';

describe('shared artwork foil presentation', () => {
  const card=DEFAULT_CONTENT.cards.double_moon_pact!;
  it('uses one decorative shared foil for premium, richer finish for showcase, no rule mutation', () => {
    const before=JSON.stringify(card);
    const html=renderToStaticMarkup(createElement(CardPremiumFx,{def:card}));
    expect(html).toContain('data-art-foil="prismatic"'); expect(html).toContain('data-rarity-finish="super"');
    expect(html.match(/class="cp-foil"/g)).toHaveLength(1); expect(html).toContain('aria-hidden="true"');
    const showcase={...card,presentation:{...card.presentation,premiumTreatment:'showcase' as const}};
    expect(renderToStaticMarkup(createElement(CardPremiumFx,{def:showcase}))).toContain('data-rarity-finish="secret"');
    expect(JSON.stringify(card)).toBe(before);
  });
  it('leaves common and rare art without a holographic overlay', () => {
    for(const rarity of ['COMMON','RARE'] as const) expect(renderToStaticMarkup(createElement(CardPremiumFx,{def:{...card,rarity}}))).toBe('');
  });
  it('adds the same overlay to premium reward art while cosmetic avatars remain unchanged', () => {
    const item=RANKED_PREMIUM_ITEMS.find(i=>i.cardId===card.id)!;
    expect(renderToStaticMarkup(createElement(PremiumRewardArt,{item:{...item,status:'LOCKED'}}))).toContain('data-art-foil="prismatic"');
    const avatar=RANKED_PREMIUM_ITEMS.find(i=>i.type==='AVATAR')!;
    expect(renderToStaticMarkup(createElement(PremiumRewardArt,{item:{...avatar,status:'LOCKED'}}))).not.toContain('cp-foil');
  });
  it('clips effects, simplifies compact cards and respects reduced motion without perpetual animation', () => {
    const css=readFileSync('src/styles/art-foil.css','utf8');
    expect(css).toContain('contain:paint'); expect(css).toContain('pointer-events:none');
    expect(css).toContain("[data-premium-surface='compact']"); expect(css).toContain('prefers-reduced-motion:reduce');
    expect(css).not.toContain('infinite'); expect(css).not.toContain('blur(');
  });
});
