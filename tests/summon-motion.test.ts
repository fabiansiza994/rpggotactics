import { describe, expect, it } from 'vitest';
import { SUMMON_MOTION, summonPose, summonFacingSign } from '../src/presentation/pixi/summonMotion';

describe('summon presentation lifecycle', () => {
  it.each(Object.keys(SUMMON_MOTION))(
    '%s returns to idle pose after attack/hurt and has bounded arrival/death',
    (id) => {
      for (const motion of ['attack', 'hit'] as const) {
        const start = summonPose(id, motion, 0, 0, false, false)!;
        const peak = summonPose(id, motion, 0.5, 0, false, false)!;
        const end = summonPose(id, motion, 1, 0, false, false)!;
        expect(peak.x).not.toBe(start.x);
        expect(end.x).toBeCloseTo(0);
        expect(end.rotation).toBeCloseTo(0);
      }
      expect(summonPose(id, 'arrival', 0, 0, false, false)!.alpha).toBe(0);
      expect(summonPose(id, 'arrival', 1, 0, false, false)!.alpha).toBe(1);
      expect(summonPose(id, 'death', 1, 0, false, false)!.alpha).toBe(0);
      expect(summonPose(id, 'attack', 0.5, 120, false, true)).toEqual({
        x: 0,
        y: 0,
        rotation: 0,
        scaleY: 1,
        alpha: 1,
      });
    },
  );
  it('lunges toward logical facing even when the source artwork is mirrored', () => {
    for (const id of Object.keys(SUMMON_MOTION)) {
      const sourceRight = id === 'wolf' || id === 'primordial_dragon' ? -1 : 1;
      const pose = summonPose(id, 'attack', 0.5, 0, false, false)!;
      expect(pose.x * summonFacingSign(id, sourceRight)).toBeGreaterThan(0);
      expect(pose.x * summonFacingSign(id, -sourceRight)).toBeLessThan(0);
    }
  });
  it('turtle gait stays grounded, raven lifts, wolf lunges farther than chicken', () => {
    expect(SUMMON_MOTION.turtle.lift).toBeLessThan(SUMMON_MOTION.chicken.lift);
    expect(SUMMON_MOTION.raven.lift).toBeGreaterThan(SUMMON_MOTION.fox.lift);
    expect(summonPose('wolf', 'attack', 0.5, 0, false, false)!.x).toBeGreaterThan(
      summonPose('chicken', 'attack', 0.5, 0, false, false)!.x,
    );
  });
});
