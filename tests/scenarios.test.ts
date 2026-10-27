import { describe, expect, it } from 'vitest';
import { createEngine, SCENARIOS } from '../src/game';
import { playBattle } from './support/bot';

/**
 * Acceptance: every MVP scenario can be finished (won or lost) by a player that only uses
 * regular commands. A simple greedy bot must win each scenario on at least one seed.
 */
describe('MVP scenarios are terminable', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: always ends, and can be won`, () => {
      const outcomes = [1, 2, 3, 4, 5, 6].map((seed) => playBattle(createEngine(scenario.id, seed)).outcome);
      expect(outcomes.every((o) => o !== null)).toBe(true);
      expect(outcomes.some((o) => o?.result === 'WON')).toBe(true);
    }, 60000);
  }
});
