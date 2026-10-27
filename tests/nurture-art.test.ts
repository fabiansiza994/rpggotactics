import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FINAL_CARD_ART, CARD_PAINTINGS } from '../src/presentation/assets/paintedAssets';
import { SpellArt } from '../src/presentation/react/components/SpellArt';
import { DEFAULT_CONTENT } from '../src/game';

describe('Cuidar bandada final artwork', () => {
  it('registers its own optimized WebP for both card and visual key', () => {
    const card=DEFAULT_CONTENT.cards.nurture!;
    expect(card.name).toBe('Cuidar bandada');
    const path=FINAL_CARD_ART[card.id];
    expect(path).toBe('/art/summoner-cards/nurture.webp');
    expect(CARD_PAINTINGS[card.presentation.visualKey]).toBe(path);
    const bytes=readFileSync(`public${path}`);
    expect(bytes.toString('ascii',0,4)).toBe('RIFF');
    expect(bytes.toString('ascii',8,12)).toBe('WEBP');
    expect(bytes.length).toBeLessThan(200_000);
    expect(bytes.equals(readFileSync('public/art/summoner-cards/pack_tracking.webp'))).toBe(false);
  });
  it('renders the shared final illustration without generic SVG or pending art', () => {
    for(const props of [{cardId:'nurture',spell:'nurture'}, {spell:'nurture'}]) {
      const html=renderToStaticMarkup(createElement(SpellArt,props));
      expect(html).toContain('src="/art/summoner-cards/nurture.webp"');
      expect(html).not.toContain('<svg');
      expect(html).not.toContain('ARTE PENDIENTE');
    }
  });
});
