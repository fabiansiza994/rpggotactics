import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { rankedTrackView } from '../src/game/ranked/rewardTrack';
import { RankedRewardsDialog } from '../src/presentation/ranked/RankedRewardsTrack';

describe('Ranked reward navigation hierarchy', () => {
  it('identifies the next reward and its league separately from current position and ownership', () => {
    const view = rankedTrackView({
      rp: 893,
      peakRp: 905,
      firstValidRanked: true,
      granted: {},
      milestones: [],
    });
    const html = renderToStaticMarkup(
      createElement(RankedRewardsDialog, { view, onClose() {}, onRefresh() {} }),
    );
    expect(html.match(/data-next="true"/g)).toHaveLength(1);
    expect(html).toContain('SIGUIENTE');
    expect(html).toContain('TÚ ESTÁS AQUÍ');
    expect(html).toContain('rpg-scroll-x');
    expect(html).toContain('rpg-scroll-y rpg-scroll-panel');
    expect(html).toMatch(/aria-pressed="true">Oro/);
    expect(html).toContain('aria-label="Cerrar recompensas"');
  });
});
