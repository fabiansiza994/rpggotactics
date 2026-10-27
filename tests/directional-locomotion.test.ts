import { expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import {
  VERTICAL_ASSETS,
  verticalAsset,
  verticalGeometry,
  verticalMirror,
} from '../src/presentation/qa/locomotion/directionalProfiles';
import { directionalFacing, cardinalView } from '../src/presentation/pixi/directionalFacing';
import { CharacterAnimator } from '../src/presentation/pixi/CharacterAnimator';
import { GridWalk } from '../src/presentation/pixi/GridWalk';
import {
  showcaseDirectionalRoute,
  showcaseTurnRoute,
  showcaseState,
} from '../src/presentation/qa/locomotion/showcase';
it('contains fifteen authentic front/back pairs with twelve unique illustrated poses per unit', () => {
  const audit = JSON.parse(
    readFileSync('qa/combat-depth/directional/assets.json', 'utf8'),
  ) as Record<string, { hashes: string[]; frames: number }>;
  expect(Object.keys(VERTICAL_ASSETS)).toHaveLength(15);
  for (const [id, a] of Object.entries(VERTICAL_ASSETS)) {
    expect(a.front).not.toBe(a.back);
    expect(verticalAsset(id)).toBeUndefined(); // Never registered in public/test mode.
    expect(audit[id]!.frames).toBe(12);
    expect(new Set(audit[id]!.hashes).size).toBe(12);
    for (const view of ['front', 'back'] as const) {
      expect(readFileSync('public' + a[view]).toString('ascii', 8, 12)).toBe('WEBP');
      expect(statSync('public' + a[view]).size).toBeLessThan(160000);
    }
    const g = verticalGeometry(id, 256)!,
      half = verticalGeometry(id, 128)!;
    expect(g.scale).toBeGreaterThan(0);
    expect(half.scale).toBeCloseTo(g.scale * 2);
    expect(g.anchorY).toBe(224 / 256);
    expect(g.topClearance).toBeGreaterThan(0);
  }
});
it('selects front/back from executed vectors and does not derive them by lateral mirroring', () => {
  for (const [direction, view] of [
    ['up', 'back'],
    ['down', 'front'],
    ['left', 'left'],
    ['right', 'right'],
  ] as const) {
    const route = showcaseDirectionalRoute(2, direction);
    expect(cardinalView(directionalFacing(route.from, route.path[0]!, 'S', true))).toBe(view);
    expect(route.path).toHaveLength(2);
    expect(showcaseDirectionalRoute(3, direction).path).toHaveLength(3);
  }
  for (const id of Object.keys(VERTICAL_ASSETS))
    expect(verticalMirror(id, 'front', 'walk', 0)).toBe(false);
  expect(verticalMirror('summoner', 'back', 'walk', 0)).toBe(false);
  expect(verticalMirror('summoner', 'back', 'run', 0)).toBe(true); // Rear native handedness correction.
});
it('updates view before playing the next path segment and preserves last view on idle', () => {
  const calls: string[] = [];
  let view = 'front';
  const actor = {
    root: { position: { set: () => {}, x: 0, y: 0 } },
    faceHorizontal: () => {},
    faceMovement: (from: { x: number; y: number }, to: { x: number; y: number }) => {
      view = cardinalView(directionalFacing(from, to, 'S', true));
      calls.push('face:' + view);
    },
    playAnimation: (motion: string) => {
      calls.push(motion + ':' + view);
      return true;
    },
  };
  const walk = new GridWalk(
    (p) => p,
    () => {},
    true,
  );
  walk.enqueue('u', actor, showcaseTurnRoute(), false);
  walk.tick(1200);
  expect(calls).toEqual([
    'face:back',
    'run:back',
    'face:right',
    'run:right',
    'face:front',
    'run:front',
    'face:left',
    'run:left',
    'idle:left',
  ]);
});
it('switches authored clip frame counts safely without restarting unchanged gait segments', () => {
  const frames: number[] = [];
  const animator = new CharacterAnimator(
    { idle: { count: 1, frameMs: 1000, loop: true }, walk: { count: 6, frameMs: 100, loop: true } },
    (_, f) => frames.push(f),
    () => {},
  );
  animator.play('walk');
  animator.tick(450, false);
  expect(animator.frameIndex).toBe(4);
  animator.configureGait('walk', { count: 3, frameMs: 160, loop: true });
  expect(animator.frameIndex).toBe(0);
  animator.tick(180, false);
  expect(animator.frameIndex).toBe(1);
  animator.configureGait('walk', { count: 3, frameMs: 160, loop: true });
  expect(animator.frameIndex).toBe(1);
  animator.configureGait('run', { count: 3, frameMs: 95, loop: true });
  expect(animator.play('run')).toBe(true);
  animator.tick(110, false);
  expect(animator.frameIndex).toBe(1);
  animator.play('idle');
  expect(animator.state).toBe('idle');
});
it('inspects all three appearances using actual activeForm rather than changing transform mechanics', () => {
  for (const [form, expected] of [
    ['humanoid', undefined],
    ['bear', 'bear'],
    ['minotaur', 'minotaur'],
  ] as const) {
    const s = showcaseState('qa_form_' + form);
    expect(s.units[0]!.defId).toBe('shapeshifter');
    expect(s.units[0]!.activeForm).toBe(expected);
  }
});
