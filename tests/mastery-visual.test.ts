import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, statSync } from 'node:fs';
import {
  MasteryBadge,
  MasteryPanelContent,
  MasteryTitleLabel,
  masteryBand,
  type EnabledMastery,
} from '../src/presentation/mastery/MasteryViews';
import { MasteryGainView, masteryGain } from '../src/presentation/mastery/MasteryFeedback';
import { RankedIntro } from '../src/presentation/ranked/RankedViews';
import { masteryFor } from '../src/game/mastery/mastery';
const state = (xp: number, title: string | null = null): EnabledMastery => ({
  enabled: true,
  champions: { archer: { xp, level: masteryFor(xp).level } },
  titles: [],
  rewards: [],
  equippedTitleId: title,
});
const panel = (xp: number, title: string | null = null) =>
  renderToStaticMarkup(
    createElement(MasteryPanelContent, {
      heroId: 'archer',
      state: state(xp, title),
      onEquip: async () => null,
    }),
  );
describe('Mastery presentation contracts', () => {
  it('five bands, real vector assets and UI numeral, no champion or rank art replacement', () => {
    expect([1, 2, 3, 4, 5, 7, 8, 9, 10].map(masteryBand)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
    for (const name of ['initiate', 'adept', 'expert', 'master', 'sovereign'])
      expect(statSync(`public/art/mastery/${name}.svg`).size).toBeLessThan(6000);
    expect(renderToStaticMarkup(createElement(MasteryBadge, { level: 10 }))).toContain(
      'sovereign.svg',
    );
  });
  it('renders authoritative XP and level, locked catalog names and equipped state', () => {
    const one = panel(0);
    expect(one).toContain('0 / 100 XP');
    expect(one).toContain('Maestría 9 requerida');
    expect(one).toContain('Señor de la Cacería');
    const seven = panel(1600, 'mastery.archer.7');
    expect(seven).toContain('1600 / 2075 XP');
    expect(seven).toContain('✓ EQUIPADO');
    expect(seven).toContain('Maestro de la Presa');
    expect(seven).toContain('Equipar Cazador Preciso');
  });
  it('M10 is complete and has no incomplete progress bar', () => {
    const max = panel(3625);
    expect(max).toContain('Maestría máxima');
    expect(max).not.toContain('role="progressbar"');
  });
  it('reports confirmed XP, level transition and actual new reward only; no repeat grant', () => {
    const before = state(1500),
      after = {
        ...state(1545),
        rewards: [{ heroId: 'archer', level: 7, crystals: 75, reachedAt: 1 }],
      };
    expect(masteryGain(before, after, 'archer')).toMatchObject({
      xp: 45,
      oldLevel: 6,
      newLevel: 7,
      crystals: 75,
    });
    const html = renderToStaticMarkup(
      createElement(MasteryGainView, { before, after, heroId: 'archer', heroName: 'Arquero' }),
    );
    expect(html).toContain('+45');
    expect(html).toContain('Maestro de la Presa');
    expect(html).toContain('+75');
    expect(masteryGain(after, after, 'archer')).toMatchObject({ xp: 0, crystals: 0 });
    expect(
      renderToStaticMarkup(
        createElement(MasteryGainView, {
          before: after,
          after,
          heroId: 'archer',
          heroName: 'Arquero',
        }),
      ),
    ).toBe('');
  });
  it('shows valid titles beneath public names in Ranked VS; unknown title hidden', () => {
    expect(
      renderToStaticMarkup(createElement(MasteryTitleLabel, { titleId: 'private.invalid' })),
    ).toBe('');
    const html = renderToStaticMarkup(
      createElement(RankedIntro, {
        ranked: { rp: [940, 740], outcome: null },
        seat: 0,
        names: ['A', 'B'],
        champions: ['archer', 'mage'],
        titles: ['mastery.archer.7', 'mastery.mage.9'],
      }),
    );
    expect(html).toContain('Maestro de la Presa');
    expect(html).toContain('Mago Maestro');
    expect(html).toContain('Oro');
  });
  it('bounded mobile title/feedback and reduced motion; private lab only', () => {
    const css = readFileSync('src/styles/mastery.css', 'utf8');
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/text-overflow:\s*ellipsis/);
    expect(css).toContain('data-compact');
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main).toContain("location.pathname === '/mastery-visual-qa'");
    expect(main).toContain('import.meta.env.DEV');
  });
});
