import { describe, expect, it } from 'vitest';
import { fitBattlefield } from '../src/presentation/responsive/battleFit';

describe('battlefield fit independent of logical grid', () => {
  it('fits even a very short viewport without a minimum-scale overflow', () => {
    const bounds = { left: -600, right: 600, top: -98, bottom: 736 };
    for (const [w, h] of [[700, 232], [600, 120], [320, 72], [1920, 700]]) {
      const fit = fitBattlefield(w!, h!, bounds);
      expect(fit.scale).toBeGreaterThan(0);
      expect(fit.x + bounds.left * fit.scale).toBeGreaterThanOrEqual(0);
      expect(fit.x + bounds.right * fit.scale).toBeLessThanOrEqual(w!);
      expect(fit.y + bounds.top * fit.scale).toBeGreaterThanOrEqual(0);
      expect(fit.y + bounds.bottom * fit.scale).toBeLessThanOrEqual(h!);
    }
  });
});
