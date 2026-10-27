import { describe, expect, it } from 'vitest';
import {
  RANKED_RULES,
  RANKED_TIERS,
  applyRp,
  formatRp,
  milestoneTiers,
  rankChange,
  rankFor,
  rankedOutcome,
  rankedPublicConfig,
  tierFloorRp,
} from '../src/game/ranked/ranked';

describe('rank calculation (integers, derived from RP only)', () => {
  it.each([
    [0, 'Hierro III', 0, 100],
    [99, 'Hierro III', 0, 100],
    [100, 'Hierro II', 100, 200],
    [299, 'Hierro I', 200, 300],
    [300, 'Bronce III', 300, 400],
    [599, 'Bronce I', 500, 600],
    [600, 'Plata III', 600, 700],
    [1460, 'Platino I', 1400, 1500],
    [1500, 'Diamante III', 1500, 1600],
    [1799, 'Diamante I', 1700, null],
  ])('%i RP → %s', (rp, label, floor, next) => {
    const r = rankFor(rp);
    expect(r.label).toBe(label);
    expect(r.floorRp).toBe(floor);
    expect(r.nextRp).toBe(next);
    expect(Number.isInteger(r.progress)).toBe(true);
  });

  it('max tier: Diamante I has no ceiling and keeps accumulating RP', () => {
    expect(rankFor(1800).label).toBe('Diamante I');
    expect(rankFor(99_999)).toMatchObject({ tierId: 'DIAMOND', division: 'I', rp: 99_999, nextRp: null, progress: 100 });
  });

  it('0 lower bound: never negative, junk input reads as 0', () => {
    expect(applyRp(0, RANKED_RULES.delta.LOSS)).toBe(0);
    expect(applyRp(5, RANKED_RULES.delta.ABANDON)).toBe(0);
    expect(rankFor(-50).rp).toBe(0);
    expect(rankFor(Number.NaN).label).toBe('Hierro III');
    expect(rankFor(12.5).rp).toBe(0);
  });

  it('loss near a boundary demotes; win across it promotes, with tier transitions', () => {
    expect(rankChange(305, applyRp(305, RANKED_RULES.delta.LOSS))).toBe('TIER_DOWN'); // Bronce III → Hierro I
    expect(rankChange(290, applyRp(290, RANKED_RULES.delta.WIN))).toBe('TIER_UP'); // Hierro I → Bronce III
    expect(rankChange(190, 210)).toBe('DIVISION_UP');
    expect(rankChange(205, 193)).toBe('DIVISION_DOWN');
    expect(rankChange(150, 170)).toBe('SAME');
    expect(rankChange(1790, 1810)).toBe('SAME'); // top
  });

  it('thresholds come from config (100 RP × 3 divisions per tier)', () => {
    expect(RANKED_TIERS.map((_, i) => tierFloorRp(i))).toEqual([0, 300, 600, 900, 1200, 1500]);
    expect(rankedPublicConfig().tiers.map((t) => [t.id, t.minRp])).toEqual([
      ['IRON', 0], ['BRONZE', 300], ['SILVER', 600], ['GOLD', 900], ['PLATINUM', 1200], ['DIAMOND', 1500],
    ]);
  });

  it('outcomes: win/loss/abandon/draw; surrender is a loss, timeout and walking out are abandons', () => {
    expect(rankedOutcome(1, 1, 'CHAMPION_DEFEATED')).toBe('WIN');
    expect(rankedOutcome(2, 1, 'CHAMPION_DEFEATED')).toBe('LOSS');
    expect(rankedOutcome(2, 1, 'SURRENDER')).toBe('LOSS');
    expect(rankedOutcome(2, 1, 'OPPONENT_DISCONNECTED')).toBe('ABANDON');
    expect(rankedOutcome(2, 1, 'ABANDONED')).toBe('ABANDON');
    expect(rankedOutcome(2, 0, 'BOTH_DISCONNECTED')).toBe('DRAW');
    expect(RANKED_RULES.delta).toEqual({ WIN: 20, LOSS: -12, ABANDON: -20, DRAW: 0 });
  });

  it('milestones by tier floor; formatting', () => {
    expect(milestoneTiers(299)).toEqual([]);
    expect(milestoneTiers(600).map((t) => [t.id, t.milestoneCrystals])).toEqual([['BRONZE', 50], ['SILVER', 100]]);
    expect(formatRp(1460)).toBe('1.460 RP');
    expect(formatRp(85)).toBe('85 RP');
  });
});
