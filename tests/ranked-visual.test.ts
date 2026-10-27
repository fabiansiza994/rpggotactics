import { describe, expect, it } from 'vitest';
import { createElement, type ComponentType, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, statSync } from 'node:fs';
import { RANKED_TIERS, rankFor, tierFloorRp } from '../src/game/ranked/ranked';
import { RankShield, RANK_SHIELD_ART } from '../src/presentation/ranked/RankShield';
import {
  RankedIntro,
  RankedPanel,
  RankedResult,
  RankedHistoryBadge,
} from '../src/presentation/ranked/RankedViews';
import { QA_RANKED_RESULTS } from '../src/presentation/ranked/RankedVisualQa';
const render = <P extends object>(component: ComponentType<P>, props: NoInfer<P>) =>
  renderToStaticMarkup(createElement(component, props));
describe('ranked presentation contracts', () => {
  it('uses six real WebP shields, one asset per tier with three UI divisions', () => {
    expect(Object.keys(RANK_SHIELD_ART)).toHaveLength(6);
    for (const [i, tier] of RANKED_TIERS.entries()) {
      const path = RANK_SHIELD_ART[tier.id];
      expect(statSync(`public${path}`).size).toBeLessThan(45000);
      expect(readFileSync(`public${path}`).subarray(8, 12).toString()).toBe('WEBP');
      for (const offset of [0, 100, 200]) {
        const rp = tierFloorRp(i) + offset;
        const html = render(RankShield, { rp });
        expect(html).toContain(`src="${path}"`);
        expect(html).toContain(`data-division="${rankFor(rp).division}"`);
        expect(html).not.toContain('<svg');
      }
    }
  });
  it('derives real initial and next division values and distinguishes queue states', () => {
    const base: ComponentProps<typeof RankedPanel> = {
      profile: {
        enabled: true,
        rp: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        milestones: [],
        queue: { state: 'IDLE' },
      },
      queue: { state: 'IDLE' },
      busy: false,
      error: '',
      blocked: null,
      championName: 'Mago',
      onSearch: () => {},
      onCancel: () => {},
    };
    const initial = render(RankedPanel, base);
    expect(initial).toContain('HIERRO III');
    expect(initial).toContain('100 RP para Hierro II');
    expect(initial).toContain('Buscar partida');
    expect(initial).toContain('Rangos y puntuación pueden ajustarse');
    const gold = render(RankedPanel, { ...base, profile: { ...base.profile, rp: 925 } });
    expect(gold).toContain('75 RP para Oro II');
    const search = render(RankedPanel, {
      ...base,
      queue: { state: 'SEARCHING', since: Date.now(), heroId: 'mage' },
    });
    expect(search).toContain('Buscando rival');
    expect(search).toContain('Cancelar búsqueda');
    expect(
      render(RankedPanel, { ...base, queue: { state: 'MATCHED', code: 'private-room-id' } }),
    ).toContain('Rival encontrado');
  });
  it('renders actual outcome/delta/promotion/cap/abandon without computing a payout', () => {
    for (const key of [
      'victory',
      'defeat',
      'division',
      'promotion',
      'demotion',
      'capped',
      'abandon',
    ]) {
      const outcome = QA_RANKED_RESULTS[key]!;
      const html = render(RankedResult, { ranked: { rp: [0, 0], outcome } });
      expect(html).toContain(`data-outcome="${outcome.outcome}"`);
      expect(html).toContain(`${Math.abs(outcome.rpDelta)} RP`);
      expect(html).toContain(rankFor(outcome.rpAfter).label.toUpperCase());
      if (key === 'promotion') {
        expect(html).toContain('NUEVO RANGO');
        expect(html).toContain('+150');
      }
      if (key === 'division') expect(html).toContain('ASCENSO');
      if (key === 'demotion') {
        expect(html).toContain('RANGO ACTUALIZADO');
        expect(html).not.toContain('NUEVO RANGO');
      }
      if (key === 'capped') expect(html).toContain('PARTIDA SIN CAMBIO DE RP');
      if (key === 'abandon') expect(html).toContain('Abandono');
    }
    expect(render(RankedResult, { ranked: { rp: [0, 0], outcome: null } })).toContain(
      'Aplicando resultado',
    );
  });
  it('shows only public matchup fields and reuses shields in history', () => {
    const html = render(RankedIntro, {
      ranked: { rp: [900, 300], outcome: null },
      seat: 1,
      names: ['Jugador A', 'Jugador B'],
      champions: ['mage', 'archer'],
    });
    expect(html).toContain('Jugador A');
    expect(html).toContain('Jugador B');
    expect(html).toContain('VS');
    expect(html).toContain('Bronce III');
    expect(html).toContain('Oro III');
    expect(html).not.toMatch(/email|deck|user_id|roomCode/i);
    const history = render(RankedHistoryBadge, { rp: 900, delta: 20 });
    expect(history).toContain('rank-gold.webp');
    expect(history).toContain('+20 RP');
  });
  it('keeps animation reduced-motion safe and private QA absent from public entry paths', () => {
    const css = readFileSync('src/styles/ranked.css', 'utf8');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('animation: none !important');
    expect(css).toContain('var(--rp-to)');
    const entry = readFileSync('src/main.tsx', 'utf8');
    expect(entry).toContain('import.meta.env.DEV');
    expect(entry).toContain("'/ranked-visual-qa'");
  });
});
