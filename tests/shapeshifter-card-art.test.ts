import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_CONTENT } from '../src/game';
import { shapeshifterCatalog } from '../src/game/data/shapeshifter-catalog';
import {
  SHAPESHIFTER_CARD_ART,
  SHAPESHIFTER_NEW_ART_IDS,
} from '../src/presentation/assets/shapeshifterCards';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe('Shapeshifter own card paintings', () => {
  it('assigns thirty unique, real WebP resources with no aliases to other cards', () => {
    const cards = Object.values(shapeshifterCatalog(DEFAULT_CONTENT).cards).filter(
      (c) => c.heroId === 'shapeshifter' && !c.tags.includes('primordial-legacy'),
    );
    expect(cards).toHaveLength(30);
    expect(SHAPESHIFTER_NEW_ART_IDS).toHaveLength(28);
    expect(new Set(cards.map((c) => SHAPESHIFTER_CARD_ART[c.id])).size).toBe(30);
    const hashes = new Set<string>();
    for (const card of cards) {
      const path = 'public' + SHAPESHIFTER_CARD_ART[card.id];
      expect(existsSync(path)).toBe(true);
      const bytes = readFileSync(path);
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
      expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
      hashes.add(createHash('sha256').update(bytes).digest('hex'));
      if ((SHAPESHIFTER_NEW_ART_IDS as readonly string[]).includes(card.id)) expect(bytes.length).toBeLessThan(200_000);
    }
    expect(hashes.size).toBe(30);
  });
  it('renders every card through the existing illustration component in the private QA mode', async () => {
    vi.stubEnv('MODE', 'shapeshifterqa');
    vi.stubEnv('DEV', true);
    vi.stubGlobal('location', { hostname: '127.0.0.1' });
    vi.resetModules();
    const { SpellArt } = await import('../src/presentation/react/components/SpellArt');
    for (const [id, url] of Object.entries(SHAPESHIFTER_CARD_ART)) {
      const html = renderToStaticMarkup(createElement(SpellArt, { cardId: id, spell: 'barrier' }));
      expect(html).toContain(`src="${url}"`);
      expect(html).toContain('data-final-art="true"');
      expect(html).not.toContain('ARTE PENDIENTE');
    }
  });
});
