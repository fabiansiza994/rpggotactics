import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LegalLinks } from '../src/presentation/shop/CrystalShopPanel';
import { LEGAL_DRAFT_URLS, legalPages } from '../src/presentation/site/legal';

describe('Store links to existing legal drafts', () => {
  it('links all four landing documents while preserving pending publication notices', () => {
    const html = renderToStaticMarkup(createElement(LegalLinks, { legal: { termsUrl: null, refundUrl: null, privacyUrl: null, taxNote: null } }));
    for (const [id, url] of Object.entries(LEGAL_DRAFT_URLS)) {
      expect(legalPages[id]).toBeDefined();
      expect(html).toContain(`href="${url}"`);
      expect(legalPages[id]!.sections.some(([title]) => title === 'Pendiente de aprobación')).toBe(true);
    }
    expect(html.match(/pendiente de publicar/g)).toHaveLength(4);
  });
  it('preserves server-configured published URLs without treating fallback drafts as approved', () => {
    const html = renderToStaticMarkup(createElement(LegalLinks, { legal: { termsUrl: 'https://example.com/approved-terms', refundUrl: null, privacyUrl: null, taxNote: null } }));
    expect(html).toContain('href="https://example.com/approved-terms"');
    expect(html.match(/pendiente de publicar/g)).toHaveLength(3);
  });
});
