import victories from './fixtures/act3-victories.json';
import { GameEngine, DEFAULT_CONTENT, encounterFor, type Command } from '../src/game';
import { TEMPLE_CAMPAIGN } from '../src/game/data/temple-encounters';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GroundParticles } from '../src/presentation/vfx/GroundParticles';
import { Container } from 'pixi.js';
import {
  AIRBORNE_VISUALS,
  groundMaterial,
  footfallBudget,
  GROUND_PARTICLE_LIMIT,
} from '../src/presentation/vfx/groundFeel';
import { FootfallTracker } from '../src/presentation/vfx/FootfallTracker';
import { CHARACTER_ANIMATIONS, TEMPLE_GUARDIAN_EXPOSED_ANIMATION, TEMPLE_GUARDIAN_ANIMATION, clipOffset } from '../src/presentation/pixi/characterAnimations';
import { CharacterAnimator } from '../src/presentation/pixi/CharacterAnimator';

describe('Act III ground feel', () => {
  it('registers clean Guardian art normally with a distinct exposed chest',()=>{expect(CHARACTER_ANIMATIONS.temple_guardian).toBe(TEMPLE_GUARDIAN_ANIMATION);expect(TEMPLE_GUARDIAN_EXPOSED_ANIMATION.directionalUrls!.front).toContain('guardian-exposed-front');expect(TEMPLE_GUARDIAN_EXPOSED_ANIMATION.directionalUrls!.back).toBe(TEMPLE_GUARDIAN_ANIMATION.directionalUrls!.back);expect(TEMPLE_GUARDIAN_EXPOSED_ANIMATION.clips).toBe(TEMPLE_GUARDIAN_ANIMATION.clips);});
  it('replays the recorded expose/defeat ending through real authoritative events',()=>{
    const run=victories.find(r=>r.encounterId==='w3_e05'&&r.heroId==='mage')!;
    const e=new GameEngine(encounterFor(TEMPLE_CAMPAIGN,'w3_e05','mage'),DEFAULT_CONTENT,run.seed);
    // The relocating lever (3-round windows) means the kill need not follow the pull directly:
    // the last window must open before the Guardian falls, and both come from real events.
    let exposedAt=-1,defeatedAt=-1;
    run.commands.forEach((command,i)=>{const r=e.dispatch(command as Command);expect(r.ok).toBe(true);
      if(r.events.some(x=>x.type==='GUARDIAN_STATE'&&x.cue==='GUARDIAN_EXPOSED'))exposedAt=i;
      if(r.events.some(x=>x.type==='UNIT_DEFEATED'&&x.unitId==='guardian'))defeatedAt=i;});
    expect(exposedAt).toBeGreaterThanOrEqual(0);expect(defeatedAt).toBeGreaterThan(exposedAt);
    expect(e.state.outcome?.result).toBe('WON');
  });
  it('only emits on compatible surfaces, never lava/fire/void', () => {
    for (const t of ['LAVA', 'VOID', 'FIRE', 'HAZARD', 'BLOCKED', 'ARCANE'] as const)
      expect(groundMaterial(t)).toBeNull();
    expect(groundMaterial('NORMAL')).toBe('dust');
    expect(groundMaterial('ICE')).toBe('frost');
    expect(groundMaterial(undefined)).toBeNull();
  });
  it('caps compact particles and disables motion, while separating airborne units', () => {
    expect(footfallBudget(true, true, false, false)).toBe(6);
    expect(footfallBudget(true, true, true, false)).toBe(3);
    expect(footfallBudget(true, true, false, true)).toBe(0);
    expect(AIRBORNE_VISUALS.has('raven')).toBe(true);
  });
  it('emits only on actual contact frames and clears on stop', () => {
    const t = new FootfallTracker();
    expect(t.update('a', 0, 6, 0, 0, true)?.foot).toBe(0);
    expect(t.update('a', 0, 6, 3, 0, true)).toBeNull();
    expect(t.update('a', 1, 6, 5, 0, true)).toBeNull();
    expect(t.update('a', 3, 6, 8, 0, true)).toMatchObject({ foot: 1, dx: 1, dy: 0 });
    expect(t.update('a', 0, 6, 10, 0, false)).toBeNull();
    expect(t.update('a', 0, 1, 10, 0, true)).toBeNull();
    t.clear();
  });
  it('recycles bounded particle storage and expires without persistent remnants', () => {
    const layer = new Container(),
      fx = new GroundParticles(layer);
    fx.emit(0, 0, 1, 0, 200, true);
    expect(fx.activeCount).toBe(GROUND_PARTICLE_LIMIT);
    fx.tick(500, false);
    expect(fx.activeCount).toBe(0);
    fx.emit(0, 0, 0, 1, 4, false);
    fx.tick(1, true);
    expect(fx.activeCount).toBe(0);
    fx.destroy();
    expect(() => {
      fx.tick(50, false);
      fx.clear();
      fx.destroy();
    }).not.toThrow();
  });
  it('registers articulated Guardian clips with stable directional offsets', () => {
    const a = TEMPLE_GUARDIAN_ANIMATION;
    for (const m of ['idle', 'walk', 'run', 'attack', 'hit', 'death'] as const)
      expect(a.clips[m]!.count).toBeGreaterThan(1);
    expect(Object.keys(a.directionalUrls!)).toEqual(['front', 'back', 'left', 'right']);
    expect(clipOffset(a, 'death', 1)).toEqual({ x: 768, y: 1280, width: 256, height: 256 });
    for (const url of Object.values(a.directionalUrls!))
      expect(readFileSync(`public${url}`).subarray(8, 12).toString()).toBe('WEBP');
  });
  it('plays a real attack/hit/death sequence without reviving a defeated unit', () => {
    const a = TEMPLE_GUARDIAN_ANIMATION,
      frame = vi.fn();
    const animator = new CharacterAnimator(a.clips, frame, () => {});
    animator.play('attack', 240);
    animator.tick(125, false);
    expect(frame).toHaveBeenLastCalledWith('attack', 1);
    animator.play('hit');
    animator.tick(75, false);
    expect(frame).toHaveBeenLastCalledWith('hit', 1);
    animator.play('death');
    animator.tick(600, false);
    expect(animator.dead).toBe(true);
    expect(animator.play('walk')).toBe(false);
  });
});
