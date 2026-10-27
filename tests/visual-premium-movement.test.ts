import { describe, expect, it, vi } from 'vitest';
import { GridWalk, walkProgress } from '../src/presentation/pixi/GridWalk';
import { CharacterAnimator } from '../src/presentation/pixi/CharacterAnimator';
import { CHARACTER_ANIMATIONS } from '../src/presentation/pixi/characterAnimations';

const p = (x: number, y = 0) => ({ x, y });
function fixture(reduced = false, directional = true) {
  const position = { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; } };
  const view = { root: { position }, faceHorizontal: vi.fn(), faceMovement: vi.fn(), playAnimation: vi.fn(() => true) };
  const done = vi.fn();
  const walk = new GridWalk(pos => ({ x: pos.x * 100, y: pos.y * 60 }), done, directional);
  const start = (path = [p(1), p(2)], to = p(3)) => walk.enqueue('hero', view, { from: p(0), path, to }, reduced);
  return { walk, view, position, done, start };
}

describe('route-continuous presentation without changing cell durations', () => {
  it('accelerates initially, crosses a straight boundary without stopping and brakes at the end', () => {
    const f = fixture(); f.start();
    f.walk.tick(299); const before = f.position.x;
    f.walk.tick(1); expect(f.position.x).toBe(100);
    f.walk.tick(1); const after = f.position.x;
    expect(100 - before).toBeCloseTo(after - 100, 2);
    expect(after - 100).toBeCloseTo(100 / 300, 3);
    f.walk.tick(598); expect(f.walk.has('hero')).toBe(true);
    f.walk.tick(1); expect(f.position).toMatchObject({ x: 300, y: 0 });
    expect(f.done).toHaveBeenCalledTimes(1);
    expect(f.view.playAnimation).toHaveBeenLastCalledWith('idle');
  });
  it('never cuts a corner and changes facing at the cell boundary', () => {
    const f = fixture(); f.start([p(1)], p(1, 1));
    f.walk.tick(299); expect(f.position.y).toBe(0);
    expect(100 - f.position.x).toBeLessThan(0.01);
    f.walk.tick(1);
    expect(f.view.faceMovement).toHaveBeenLastCalledWith(p(1), p(1, 1));
    f.walk.tick(1); expect(f.position.x).toBe(100); expect(f.position.y).toBeLessThan(0.01);
    f.walk.tick(299); expect(f.position).toMatchObject({ x: 100, y: 60 });
  });
  it.each([false, true])('preserves duration with reduced=%s and a large frame delta', reduced => {
    const f = fixture(reduced); f.start();
    f.walk.tick(reduced ? 299 : 899); expect(f.walk.has('hero')).toBe(true);
    f.walk.tick(400); expect(f.position.x).toBe(300); expect(f.done).toHaveBeenCalledTimes(1);
    f.walk.tick(400); expect(f.done).toHaveBeenCalledTimes(1);
  });
  it('is independent of frame subdivision', () => {
    const a = fixture(), b = fixture(); a.start(); b.start();
    a.walk.tick(477); for (let i = 0; i < 159; i++) b.walk.tick(3);
    expect(a.position.x).toBeCloseTo(b.position.x, 10);
  });
  it('does not jump backwards when another movement arrives mid-cell', () => {
    const f = fixture(); f.start([], p(1)); f.walk.tick(150);
    const before = f.position.x;
    f.walk.enqueue('hero', f.view, { from: p(1), path: [], to: p(2) }, false);
    f.walk.tick(0); expect(f.position.x).toBe(before);
    f.walk.tick(150); expect(f.position.x).toBe(100);
    f.walk.tick(300); expect(f.position.x).toBe(200);
  });
  it('retains queued routes and completes once', () => {
    const f = fixture(); f.start([], p(1));
    f.walk.enqueue('hero', f.view, { from: p(1), path: [p(2)], to: p(3) }, false);
    f.walk.tick(900); expect(f.position.x).toBe(300); expect(f.done).toHaveBeenCalledTimes(1);
  });
  it('cancels without changing logical position or invoking completion; can replay after clear', () => {
    const f = fixture(); f.start(); f.walk.tick(120); const x = f.position.x;
    f.walk.clear(); f.walk.tick(1000); expect(f.position.x).toBe(x); expect(f.done).not.toHaveBeenCalled();
    f.start(); f.walk.tick(900); expect(f.done).toHaveBeenCalledTimes(1);
  });
  it('retains legacy horizontal facing and walking fallback', () => {
    const f = fixture(false, false); delete (f.view as Partial<typeof f.view>).faceMovement;
    f.start(); expect(f.view.faceHorizontal).toHaveBeenCalledWith(1);
    expect(f.view.playAnimation).toHaveBeenCalledWith('walk');
  });
  it('keeps interpolation monotonic and inside each cell for every tangent pair', () => {
    for (const a of [false, true]) for (const b of [false, true]) {
      let previous = 0;
      for (let i = 0; i <= 100; i++) {
        const next = walkProgress(i / 100, a, b);
        expect(next).toBeGreaterThanOrEqual(previous); expect(next).toBeLessThanOrEqual(1);
        previous = next;
      }
      expect(walkProgress(0, a, b)).toBe(0); expect(walkProgress(1, a, b)).toBe(1);
    }
  });
});

describe('reviewed Mage idle and original fallback contracts', () => {
  it('advances the six existing Mage frames, wraps, and respects reduced motion', () => {
    const idle = CHARACTER_ANIMATIONS.mage!.clips.idle!;
    const animator = new CharacterAnimator({ idle }, vi.fn(), vi.fn());
    animator.tick(idle.frameMs + 1, false); expect(animator.frameIndex).toBe(1);
    animator.tick(idle.frameMs * 5, false); expect(animator.frameIndex).toBe(0);
    animator.tick(2000, true); expect(animator.frameIndex).toBe(0);
  });
  it('keeps Warrior single-pose idle and does not fabricate a multi-frame clip', () => {
    expect(CHARACTER_ANIMATIONS.warrior!.clips.idle!.count).toBe(1);
    expect(CHARACTER_ANIMATIONS.warrior!.clips.idle!.animatedIdle).not.toBe(true);
  });
});
