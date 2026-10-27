import { describe, expect, it } from 'vitest';
import { CharacterAnimator } from '../src/presentation/pixi/CharacterAnimator.ts';
import { CHARACTER_ANIMATIONS } from '../src/presentation/pixi/characterAnimations.ts';
import { idleDisplacement, idleTiming } from '../src/presentation/pixi/idleBreathing.ts';

describe('continuous battle idle', () => {
  it('holds grounded enemy idle-0 for ten seconds and restores it after actions', () => {
    const frames: [string, number][] = [];
    const animator = new CharacterAnimator(CHARACTER_ANIMATIONS.orc_warrior!.clips,
      (motion, frame) => frames.push([motion, frame]), () => {});
    animator.face('LEFT');
    for (let i = 0; i < 600; i++) animator.tick(1000 / 60, false);
    expect(frames).toEqual([['idle', 0]]);
    animator.play('walk');
    animator.tick(100, false);
    expect(animator.frameIndex).toBe(1);
    animator.play('attack');
    animator.tick(1000, false);
    expect(frames.at(-1)).toEqual(['idle', 0]);
    animator.tick(10_000, false);
    expect(animator.frameIndex).toBe(0);
    expect(animator.direction).toBe('LEFT');
    animator.reset();
    expect(frames.at(-1)).toEqual(['idle', 0]);
  });

  it('derives repeatable timing per unit, with cycles between 3 and 4 seconds', () => {
    const timings = ['mage', 'orc-1', 'orc-2', 'wolf-1', 'shaman-1', 'brute-1'].map(idleTiming);
    expect(new Set(timings.map((t) => t.offsetMs)).size).toBe(timings.length);
    for (const timing of timings) {
      expect(timing.periodMs).toBeGreaterThanOrEqual(3000);
      expect(timing.periodMs).toBeLessThanOrEqual(4000);
    }
    expect(idleTiming('orc-1')).toEqual(idleTiming('orc-1'));
  });

  it('keeps foot vertices fixed throughout the cycle, including weapon-bearing figures', () => {
    const footX: Record<string, number[]> = {
      mage: [0.375, 0.4375, 0.5625, 0.625],
      orc_warrior: [0.34375, 0.4375, 0.65625, 0.78125],
      dark_shaman: [0.40625, 0.46875, 0.5625, 0.625],
      stone_brute: [0.3125, 0.4375, 0.625, 0.75],
      shadow_wolf: [0.375, 0.53125, 0.625, 0.6875, 0.75],
    };
    for (const [id, xs] of Object.entries(footX)) {
      for (const x of xs) for (let phase = 0; phase < Math.PI * 2; phase += 0.1) {
        expect(idleDisplacement(id, x, 0.8125, phase)).toEqual({ x: 0, y: 0 });
        expect(idleDisplacement(id, x, 0.875, phase)).toEqual({ x: 0, y: 0 });
      }
    }
  });

  it('bounds displacement and uses continuous periodic curves without moving the crystal', () => {
    for (const id of Object.keys(CHARACTER_ANIMATIONS)) {
      for (let x = 0; x <= 1; x += 0.125) for (let y = 0; y <= 1; y += 0.125) {
        for (let phase = 0; phase < Math.PI * 2; phase += 0.3) {
          const d = idleDisplacement(id, x, y, phase);
          const next = idleDisplacement(id, x, y, phase + 0.001);
          const cycle = idleDisplacement(id, x, y, phase + Math.PI * 2);
          expect(Math.abs(d.x)).toBeLessThanOrEqual(0.20);
          expect(Math.abs(d.y)).toBeLessThanOrEqual(0.65);
          expect(Math.abs(next.y - d.y)).toBeLessThan(0.001);
          expect(cycle.y).toBeCloseTo(d.y, 10);
        }
      }
    }
    expect(idleDisplacement('crystal', 0.5, 0.3, 1)).toEqual({ x: 0, y: 0 });
  });
});
