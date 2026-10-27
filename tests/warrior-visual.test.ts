import { describe, expect, it } from 'vitest';
import { CharacterAnimator } from '../src/presentation/pixi/CharacterAnimator';
import {
  CHARACTER_ANIMATIONS,
  clipOffset,
  hasDirectionalAtlas,
  hasMartialAnimation,
} from '../src/presentation/pixi/characterAnimations';
import {
  cardinalView,
  directionalFacing,
  mageView,
} from '../src/presentation/pixi/directionalFacing';
import { unitVisualId, unitVisualTint } from '../src/presentation/assets/visualIdentity';
import { FINAL_CARD_ART } from '../src/presentation/assets/paintedAssets';

describe('authored Warrior visual contract', () => {
  it('resolves grid directions without mirrored sides or a front fallback for north', () => {
    for (const [x, y, view] of [
      [0, -1, 'back'],
      [1, -1, 'back'],
      [-1, -1, 'back'],
      [0, 1, 'front'],
      [-1, 0, 'left'],
      [1, 0, 'right'],
    ] as const)
      expect(cardinalView(directionalFacing({ x: 0, y: 0 }, { x, y }, 'S', true))).toBe(view);
    expect(hasDirectionalAtlas('warrior')).toBe(true);
    expect(hasMartialAnimation('warrior')).toBe(true);
    expect(hasMartialAnimation('mage')).toBe(false);
    expect(hasMartialAnimation('summoner')).toBe(false);
    expect(new Set(Object.values(CHARACTER_ANIMATIONS.warrior!.directionalUrls!)).size).toBe(4);
    expect(unitVisualId('warrior')).toBe('warrior');
    expect(unitVisualTint('warrior')).toBe(0xffffff);
    expect(mageView('NW')).toEqual({ view: 'back3q', mirror: true });
  });
  it('contains 44 authored poses per direction and all 15 card illustrations', () => {
    const layout = CHARACTER_ANIMATIONS.warrior!;
    for (const state of [
      'idle',
      'walk',
      'attack',
      'bash',
      'charge',
      'charge_stop',
      'guard',
      'ability',
      'hit',
      'death',
    ] as const) {
      const clip = layout.clips[state]!;
      expect(clip.count).toBeGreaterThan(state === 'idle' ? 0 : 1);
      expect(clipOffset(layout, state, clip.count - 1)).not.toBeNull();
      expect(clipOffset(layout, state, clip.count)).toBeNull();
    }
    expect(layout.clips.death!.start + layout.clips.death!.count).toBe(44);
    for (const id of [
      'heavy_strike',
      'shield_bash',
      'warrior_charge',
      'guard',
      'riposte',
      'second_wind',
      'brutal_shove',
      'steady_advance',
      'sweep',
      'grapple',
      'steel_wall',
      'bastion',
      'ram',
      'unstoppable',
      'vanguard_fury',
    ])
      expect(FINAL_CARD_ART[id]).toBe(`/art/store-cards/${id}.webp`);
  });
  it('keeps stationary idle fixed through multiple breathing periods and returns after actions', () => {
    const frames: string[] = [];
    const a = new CharacterAnimator(CHARACTER_ANIMATIONS.warrior!.clips, (m, f) => frames.push(`${m}:${f}`), () => {});
    for (let t = 0; t < 12000; t += 16) a.tick(16, false);
    expect(a.state).toBe('idle');
    expect(a.frameIndex).toBe(0);
    expect(new Set(frames)).toEqual(new Set(['idle:0']));
    for (const action of ['walk', 'attack', 'bash', 'charge', 'ability', 'hit'] as const) {
      a.reset(); a.play(action); a.tick(70, false);
      if (action === 'walk' || action === 'charge') a.play('idle');
      else a.tick(1000, false);
      expect(a.state).toBe('idle'); expect(a.frameIndex).toBe(0);
      a.tick(8000, false); expect(a.frameIndex).toBe(0);
    }
  });
  it('holds contact briefly without rewinding poses and clears the hold for reduced motion', () => {
    const a = new CharacterAnimator(
      CHARACTER_ANIMATIONS.warrior!.clips,
      () => {},
      () => {},
    );
    a.play('attack', 90);
    a.tick(60, false);
    a.contactPose();
    expect(a.frameIndex).toBe(3);
    a.hold(24);
    a.tick(24, false);
    expect(a.frameIndex).toBe(3);
    a.tick(65, false);
    expect(a.frameIndex).toBe(4);
    a.contactPose();
    expect(a.frameIndex).toBe(4);
    a.hold(24);
    a.tick(65, true);
    expect(a.frameIndex).toBe(5);
  });
  it('holds guard, returns after damage, queues riposte and completes death terminally', () => {
    const frames: string[] = [];
    const a = new CharacterAnimator(
      CHARACTER_ANIMATIONS.warrior!.clips,
      (m, f) => frames.push(`${m}:${f}`),
      () => {},
    );
    a.setRestMotion('guard');
    a.play('walk');
    expect(a.play('idle')).toBe(true);
    expect(a.state).toBe('guard');
    a.tick(400, false);
    expect(a.state).toBe('guard');
    expect(a.frameIndex).toBeGreaterThanOrEqual(3);
    a.play('hit');
    expect(a.play('attack', 55)).toBe(true);
    a.tick(120, false);
    expect(a.state).toBe('attack');
    a.tick(500, false);
    expect(a.state).toBe('guard');
    a.setRestMotion('idle');
    expect(a.state).toBe('idle');
    a.tick(600, false);
    expect(a.frameIndex).toBe(0);
    a.play('death');
    a.tick(600, false);
    expect(a.frameIndex).toBe(2);
    expect(a.play('attack')).toBe(false);
    expect(frames).toContain('death:2');
  });
});

describe('Warrior packaged assets', () => {
  it('keeps independent RGBA source poses, shared clip offsets and bounded runtime atlases', async () => {
    const { readFileSync, statSync } = await import('node:fs');
    for (const direction of ['front', 'back', 'left', 'right']) {
      expect(statSync(`public/art/animations/warrior_${direction}.webp`).size).toBeLessThan(
        1800000,
      );
      for (const state of [
        'idle',
        'walk',
        'attack',
        'bash',
        'charge',
        'charge_stop',
        'guard',
        'ability',
        'hit',
        'death',
      ] as const) {
        for (let f = 0; f < CHARACTER_ANIMATIONS.warrior!.clips[state]!.count; f++) {
          const bytes = readFileSync(
            `src/presentation/assets/painted-source/animations/warrior/warrior_${state}_${direction}_${String(f).padStart(2, '0')}.png`,
          );
          expect(bytes.readUInt32BE(16)).toBe(512);
          expect(bytes.readUInt32BE(20)).toBe(512);
          expect(bytes[25]).toBe(6);
        }
      }
    }
    expect(statSync('public/art/checkpoint05/characters/warrior.webp').size).toBeLessThan(300000);
  });
});
