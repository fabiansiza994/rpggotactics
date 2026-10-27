import { describe, expect, it } from 'vitest';
import {
  MASTERY_CHAMPIONS,
  MASTERY_MAX_LEVEL,
  MASTERY_REWARDS,
  MASTERY_TITLES,
  TITLE_LEVELS,
  masteryFor,
  masteryLevelXp,
  masteryNumeral,
  titleById,
  titleName,
  titlesFor,
} from '../src/game/mastery/mastery';

describe('mastery curve (integers, level derived from total XP)', () => {
  it('cumulative thresholds', () => {
    expect(Array.from({ length: MASTERY_MAX_LEVEL }, (_, i) => masteryLevelXp(i + 1))).toEqual([0, 100, 250, 450, 725, 1075, 1525, 2075, 2775, 3625]);
  });
  it.each([
    [0, 1],
    [99, 1],
    [100, 2],
    [249, 2],
    [250, 3],
    [724, 4],
    [725, 5],
    [3624, 9],
    [3625, 10],
  ])('%i XP → Maestría %i', (xp, level) => expect(masteryFor(xp).level).toBe(level));
  it('max level keeps XP, no next threshold; junk reads as 0 (legacy start = Maestría 1)', () => {
    expect(masteryFor(99_999)).toMatchObject({ level: 10, nextXp: null, progress: 100, xp: 99_999 });
    expect(masteryFor(-5)).toMatchObject({ level: 1, xp: 0 });
    expect(masteryFor(Number.NaN).level).toBe(1);
    expect(masteryFor(620 - 450 + 450)).toMatchObject({ level: 4, intoLevel: 170, levelSize: 275 });
  });
});

describe('titles catalog', () => {
  it('6 titles per champion at 1/3/5/7/9/10 with stable ids and a name for each', () => {
    expect(TITLE_LEVELS).toEqual([1, 3, 5, 7, 9, 10]);
    for (const c of MASTERY_CHAMPIONS) {
      const list = titlesFor(c);
      expect(list.map((t) => t.id)).toEqual(TITLE_LEVELS.map((l) => `mastery.${c}.${l}`));
      for (const t of list) expect(titleName(t.id)).toBeTruthy();
    }
    expect(new Set(MASTERY_TITLES.map((t) => titleName(t.id))).size).toBe(MASTERY_TITLES.length);
    expect(titleName('mastery.mage.7')).toBe('Perfeccionista en Magia');
    expect(titleName('mastery.archer.10')).toBe('Señor de la Cacería');
    expect(titleById('mastery.mage.2')).toBeUndefined();
    expect(titleName('nope')).toBeNull();
    // Primordial lore stays with the Dragón Primordial.
    expect(MASTERY_TITLES.some((t) => /Primordial/.test(titleName(t.id)!))).toBe(false);
  });
  it('rewards: one-time, moderate crystals, cosmetics only as hooks; numerals', () => {
    expect(MASTERY_REWARDS.reduce((n, r) => n + r.crystals, 0)).toBe(400);
    expect(MASTERY_REWARDS.find((r) => r.level === 10)!.cosmetic).toBe('MASTERY_EMBLEM');
    expect([1, 4, 7, 9, 10].map(masteryNumeral)).toEqual(['I', 'IV', 'VII', 'IX', 'X']);
  });
});
