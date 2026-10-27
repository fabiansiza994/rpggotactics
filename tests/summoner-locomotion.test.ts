import { expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import {
  CHARACTER_ANIMATIONS,
  QA_SUMMONER_ANIMATIONS,
} from '../src/presentation/pixi/characterAnimations';
import { CharacterAnimator } from '../src/presentation/pixi/CharacterAnimator';
import { SUMMONER_LOCOMOTION } from '../src/presentation/qa/locomotion/summonerLocomotion';
import { showcaseRoute, showcaseState } from '../src/presentation/qa/locomotion/showcase';
import { locomotionRoute } from '../src/presentation/pixi/locomotion';
it('registers seven private, bounded, distinct illustrated gait atlases', () => {
  expect(Object.keys(QA_SUMMONER_ANIMATIONS)).toHaveLength(7);
  let total = 0;
  for (const [id, layout] of Object.entries(QA_SUMMONER_ANIMATIONS)) {
    expect(CHARACTER_ANIMATIONS[id]).toBeUndefined();
    expect(layout.locomotionOnly).toBe(true);
    expect(layout.clips.walk?.count).toBe(3);
    expect(layout.clips.run?.count).toBe(3);
    expect(layout.clips.walk?.start).not.toBe(layout.clips.run?.start);
    expect(layout.clips.walk!.frameMs).toBeGreaterThan(layout.clips.run!.frameMs);
    const file = `public${layout.url}`;
    expect(readFileSync(file).toString('ascii', 8, 12)).toBe('WEBP');
    expect(statSync(file).size).toBeLessThan(200000);
    total += statSync(file).size;
  }
  expect(total).toBeLessThan(1100000);
});
it('keeps continuous run frames across path segments and returns to idle', () => {
  const animator = new CharacterAnimator(
    QA_SUMMONER_ANIMATIONS.chicken!.clips,
    () => {},
    () => {},
  );
  animator.play('run');
  animator.tick(80, false);
  expect(animator.frameIndex).toBe(1);
  animator.play('run');
  expect(animator.frameIndex).toBe(1);
  animator.faceHorizontal(-1);
  expect(animator.direction).toBe('LEFT');
  animator.faceHorizontal(1);
  expect(animator.direction).toBe('RIGHT');
  animator.play('idle');
  expect(animator.state).toBe('idle');
});
it('uses executed routes for slow/fast motion in either direction', () => {
  for (const direction of [1, -1] as const)
    for (const steps of [2, 3] as const) {
      const route = showcaseRoute(steps, direction);
      expect(locomotionRoute(route).mode).toBe(steps === 2 ? 'walk' : 'run');
      expect(locomotionRoute(route).segments).toHaveLength(steps);
      expect(route.to.x - route.from.x).toBe(steps * direction);
    }
});
it('provides repeatable visual fixtures for every requested species without save or command changes', () => {
  for (const id of Object.keys(SUMMONER_LOCOMOTION) as (keyof typeof SUMMONER_LOCOMOTION)[]) {
    const a = showcaseState(id),
      b = showcaseState(id);
    expect(a).toEqual(b);
    expect(a.units).toHaveLength(1);
    expect(a.units[0]!.defId).toBe(id);
  }
});

it('maps atlas reference alpha bounds to master size and ground without per-state scaling', async () => {
  const { gaitGeometry, sourceFacingSign } =
    await import('../src/presentation/qa/locomotion/gaitGeometry');
  const { default: geometry } =
    await import('../src/presentation/qa/locomotion/frameGeometry.json');
  const { characterSpec, spriteScale, TILE } =
    await import('../src/presentation/pixi/renderContract');
  for (const [id, g] of Object.entries(geometry)) {
    const spec = characterSpec(id),
      full = gaitGeometry(id, spec, TILE, 256)!,
      half = gaitGeometry(id, spec, TILE, 128)!;
    expect(full.scale * g.referenceVisibleHeight).toBeCloseTo(
      spriteScale(spec, g.masterHeight, TILE) * g.masterVisibleHeight,
    );
    expect(half.scale).toBeCloseTo(full.scale * 2);
    expect(full.anchorY).toBe(224 / 256);
    expect(full.topClearance).toBeCloseTo(full.scale * g.gaitVisibleHeight - full.supportOffset);
    expect(full.supportOffset).toBeCloseTo(
      (g.masterBottom - spec.anchorY * g.masterHeight) * spriteScale(spec, g.masterHeight, TILE),
    );
    for (const motion of ['walk', 'run'])
      expect(sourceFacingSign(id, motion)).toBe(
        SUMMONER_LOCOMOTION[id as keyof typeof SUMMONER_LOCOMOTION].nativeFacing === 'LEFT'
          ? -1
          : 1,
      );
  }
  expect(sourceFacingSign('fox', 'idle')).toBe(1);
  expect(sourceFacingSign('fox', 'walk')).toBe(-1);
  expect(sourceFacingSign('primordial_dragon', 'idle')).toBe(-1);
  expect(sourceFacingSign('primordial_dragon', 'run')).toBe(-1);
});
it('includes every catalog summon in the visual inspector', async () => {
  const { DEFAULT_CONTENT } = await import('../src/game');
  for (const id of Object.keys(DEFAULT_CONTENT.summons ?? {})) {
    expect(showcaseState(id).units[0]!.defId).toBe(id);
  }
  const inspector = readFileSync(
    'src/presentation/qa/locomotion/SummonerLocomotionLab.tsx',
    'utf8',
  );
  expect(inspector).toContain('...DEFAULT_CONTENT.summons');
  const view = readFileSync('src/presentation/pixi/UnitView.ts', 'utf8');
  expect(view).toContain('this.applyFacing(this.animator.direction)');
});
