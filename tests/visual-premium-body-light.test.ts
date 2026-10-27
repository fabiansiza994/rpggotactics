import { describe, expect, it, vi } from 'vitest';
import { contactShadow, cornerLight, lightEnvelope, litTint, blendLight } from '../src/presentation/pixi/localLighting';
import { idleDisplacement } from '../src/presentation/pixi/idleBreathing';
import { CharacterAnimator } from '../src/presentation/pixi/CharacterAnimator';
import { CHARACTER_ANIMATIONS } from '../src/presentation/pixi/characterAnimations';

// Headless lifecycle test: mock only the existing GPU filter; containers and geometry are real Pixi.
vi.mock('pixi.js', async importOriginal => ({
  ...await importOriginal<typeof import('pixi.js')>(),
  ColorMatrixFilter: class { enabled=true; contrast(){} brightness(){} saturate(){} destroy(){} },
}));
describe('local body light' , () => {
  it('returns to ambient without retaining an impact at the end', () => {
    expect(lightEnvelope(0, 150)).toBe(0);
    expect(lightEnvelope(150, 150)).toBe(1);
    expect(lightEnvelope(-1, 150)).toBe(0);
    expect(lightEnvelope(300, 150)).toBe(1);
    expect(litTint(0xffffff, 0xff6045, 0)).toBe(0xffffff);
    expect(lightEnvelope(1, 150)).toBeLessThan(.001);
  });
  it.each([0xff6045, 0x7be5ff, 0x9a72ff, 0xffffff, 0x80d9c5])('keeps source legible under %s', color => {
    const tint = litTint(0xffffff, color, 1);
    for (const shift of [0,8,16]) expect((tint >> shift) & 255).toBeGreaterThanOrEqual(214);
    expect(litTint(0x808080, color, 0)).toBe(0x808080);
  });
  it('shadows remain bounded and reduced motion is static', () => {
    expect(contactShadow(0,false)).toEqual({scale:1,alpha:1});
    expect(contactShadow(-20,false)).toEqual({scale:1,alpha:1});
    expect(contactShadow(100,false)).toEqual(contactShadow(20,false));
    expect(contactShadow(10,true)).toEqual({scale:1,alpha:1});
    expect(contactShadow(10,false).alpha).toBeGreaterThan(.6);
  });
  it('light is local, symmetric and zero away from existing corner lamps', () => {
    expect(cornerLight(.5,.5,8,8)).toBeGreaterThan(0);
    expect(cornerLight(.5,.5,8,8)).toBeCloseTo(cornerLight(7.5,7.5,8,8));
    expect(cornerLight(4,4,8,8)).toBe(0);
    expect(cornerLight(-.15,-.15,8,8)).toBe(.42);
  });
});
describe('authored poses with anchored procedural breathing', () => {
  it.each(['warrior','summoner','qa_form_bear','qa_form_minotaur'])('%s preserves feet and loop continuity', id => {
    for(let phase=0;phase<7;phase+=.2) for(let x=0;x<=1;x+=.1) {
      expect(idleDisplacement(id,x,.85,phase)).toEqual({x:0,y:0});
      const p=idleDisplacement(id,x,.43,phase);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(.2);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(.65);
      const loop=idleDisplacement(id,x,.43,phase+Math.PI*2);
      expect(loop.x).toBeCloseTo(p.x);expect(loop.y).toBeCloseTo(p.y);
    }
    expect(idleDisplacement(id,.5,.43,Math.PI)).not.toEqual({x:0,y:0});
  });
  it('keeps warrior authored attack/contact and terminal death', () => {
    const seen: string[]=[];
    const a=new CharacterAnimator(CHARACTER_ANIMATIONS.warrior!.clips,(m,f)=>seen.push(`${m}:${f}`),()=>{});
    a.play('attack',180);a.tick(180,false);expect(seen.at(-1)).toBe('attack:3');
    a.play('hit');a.tick(500,false);expect(a.state).toBe('idle');
    a.play('death');a.tick(1000,false);expect(a.state).toBe('death');
    expect(a.play('attack')).toBe(false);
    a.reset();expect(a.state).toBe('idle');
  });
});

it('pulse hue converges continuously back to ambience', () => {
  expect(blendLight(0x70bce8, 0xff6045, 0)).toBe(0x70bce8);
  expect(blendLight(0x70bce8, 0xff6045, 1)).toBe(0xff6045);
  expect(blendLight(0x70bce8, 0xff6045, lightEnvelope(1,150))).toBe(0x70bce8);
});
it('UnitView cancels body light and shadow on reset; disposal owns all local objects', async () => {
  const { UnitView } = await import('../src/presentation/pixi/UnitView');
  const view = new UnitView('warrior');
  view.setAmbientLight(0xffa447,.4);
  view.pulseLight(0xff6045,150);
  view.tick(40,false,false);
  const ambient = litTint(0xffffff,0xffa447,.4);
  expect(view.body.tint).not.toBe(ambient);
  view.resetMotion();
  expect(view.body.tint).toBe(ambient);
  view.tick(500,false,false);
  expect(view.body.tint).toBe(ambient);
  const children = [...view.scaler.children];
  view.destroy();
  expect(children.every(c=>c.destroyed)).toBe(true);
});
