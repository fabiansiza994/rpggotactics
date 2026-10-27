import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { CardBackFace, STANDARD_CARD_BACK } from '../src/presentation/cosmetics/CardBack';

describe('official standard card reverse (presentation only)', () => {
  it('uses one optimized real WebP below the art budget', () => {
    const bytes=readFileSync(`public${STANDARD_CARD_BACK}`);
    expect(bytes.subarray(0,4).toString()).toBe('RIFF');
    expect(bytes.subarray(8,12).toString()).toBe('WEBP');
    expect(bytes.length).toBeLessThan(200*1024);
  });
  it('renders the same standard source, lazy and decorative, without the provisional glyph', () => {
    const html=renderToStaticMarkup(createElement(CardBackFace,{cosmetics:{owned:[],equipped:{}}}));
    expect(html).toContain(STANDARD_CARD_BACK); expect(html).toContain('data-card-back="default"');
    expect(html).toContain('loading="lazy"'); expect(html).toContain('alt=""');
    expect(html).not.toContain('◇');
  });
  it('preserves the owned equipped premium reverse and falls back safely without ownership', () => {
    const id='cardback_premium_arcane_circle';
    const premium=renderToStaticMarkup(createElement(CardBackFace,{cosmetics:{owned:[{cosmeticId:id,kind:'CARD_BACK',acquiredAt:1}],equipped:{CARD_BACK:id}}}));
    expect(premium).toContain(`/art/ranked-premium/${id}.webp`); expect(premium).not.toContain(STANDARD_CARD_BACK);
    const unowned=renderToStaticMarkup(createElement(CardBackFace,{cosmetics:{owned:[],equipped:{CARD_BACK:id}}}));
    expect(unowned).toContain(STANDARD_CARD_BACK);
  });
});
