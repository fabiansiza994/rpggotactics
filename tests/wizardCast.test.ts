import { expect, it } from 'vitest';
import {
  wizardCastPose,
  wizardCastDisplacement,
  type DirectionalCastView,
} from '../src/presentation/pixi/wizardCast';
import { CharacterAnimator } from '../src/presentation/pixi/CharacterAnimator';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import type { GameEvent } from '../src/game';

it('uses a continuous anticipation, release hold and bounded recovery', () => {
  expect(wizardCastPose(0, 110)).toEqual({ anticipation: 0, release: 0 });
  expect(wizardCastPose(55, 110)).toEqual({ anticipation: 1, release: 0 });
  expect(wizardCastPose(110, 110)).toEqual({ anticipation: 0, release: 1 });
  expect(wizardCastPose(150, 110).release).toBe(1);
  expect(wizardCastPose(220, 110).release).toBeGreaterThan(0);
  expect(wizardCastPose(290, 110)).toEqual({ anticipation: 0, release: 0 });
  expect(wizardCastPose(80, 110).release).toBeLessThan(wizardCastPose(81, 110).release);
});
it('leaves every lower-body/foot vertex fixed in all directional profiles', () => {
  for (const view of ['front3q', 'side', 'back3q', 'back'] as DirectionalCastView[])
    for (let y = 0.8; y <= 1; y += 0.025)
      for (let x = 0; x <= 1; x += 0.05)
        expect(wizardCastDisplacement(view, x, y, { anticipation: 0, release: 1 })).toEqual({
          x: 0,
          y: -0,
        });
});
it('raises each view’s casting hand while keeping the head/feet independent of tracking', () => {
  for (const [view, x, y] of [
    ['front3q', 0.4, 0.36],
    ['side', 0.48, 0.38],
    ['back3q', 0.74, 0.35],
    ['back', 0.68, 0.38],
  ] as const) {
    expect(wizardCastDisplacement(view, x, y, { anticipation: 0, release: 1 }).y).toBeLessThan(-9);
    expect(wizardCastDisplacement(view, x, y, { anticipation: 0, release: 0 })).toEqual({
      x: 0,
      y: -0,
    });
  }
});
it('reduced motion uses a short release pose, with no moving wind-up', () => {
  expect(wizardCastPose(39, 40, true)).toEqual({ anticipation: 0, release: 0 });
  expect(wizardCastPose(40, 40, true)).toEqual({ anticipation: 0, release: 1 });
  expect(wizardCastPose(140, 40, true)).toEqual({ anticipation: 0, release: 0 });
});
it.each(['fireball', 'magic_missile'])(
  '%s launch remains on the shared cast release, then returns to idle',
  (cardId) => {
    const events: GameEvent[] = [
      {
        type: 'CARD_PLAYED',
        cardUid: 'cast',
        cardId,
        casterId: 'mage',
        target: { x: 5, y: 2 },
        impact: { x: 5, y: 2 },
        affectedTiles: [{ x: 5, y: 2 }],
        direction: 'RIGHT',
      },
      ...(cardId === 'fireball'
        ? [
            {
              type: 'PROJECTILE_LAUNCHED' as const,
              sourceId: 'mage',
              from: { x: 3, y: 2 },
              to: { x: 5, y: 2 },
              direction: 'RIGHT' as const,
              hitUnitId: null,
            },
          ]
        : []),
      { type: 'CARD_RESOLVED', cardUid: 'cast', cardId },
    ];
    const plan = compileTimeline(events, (id) => id, false);
    const cast = plan.cues.find((c) => c.kind === 'cast')!,
      projectile = plan.cues.find((c) => c.kind === 'projectile')!;
    expect(projectile.at - cast.at).toBe(cast.duration);
    const animator = new CharacterAnimator(
      {
        idle: { count: 1, loop: true, frameMs: 100 },
        cast: { count: 6, loop: false, frameMs: 65 },
      },
      () => {},
      () => {},
    );
    animator.play('cast', cast.duration);
    animator.tick(cast.duration - 1, false);
    expect(animator.frameIndex).toBe(2);
    animator.tick(1, false);
    expect(animator.frameIndex).toBe(3);
    expect(wizardCastPose(projectile.at - cast.at, cast.duration).release).toBe(1);
    animator.tick(195, false);
    expect(animator.state).toBe('idle');
  },
);
