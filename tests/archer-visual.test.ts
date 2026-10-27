import { PaintedFigure } from '../src/presentation/pixi/unitArt';
import { archerBattlePreviewAllowed, archerPresentationState } from '../src/presentation/qa/archer/battlePreview';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { ARCHER_ANIMATION, ARCHER_VISUAL_ID, ARCHER_RELEASE_POINTS, archerShotTiming } from '../src/presentation/qa/archer/visuals';
import { CHARACTER_ANIMATIONS, clipOffset } from '../src/presentation/pixi/characterAnimations';
import { CharacterAnimator } from '../src/presentation/pixi/CharacterAnimator';
import { locomotionClip } from '../src/presentation/pixi/locomotion';
import { DEFAULT_CONTENT } from '../src/game';
import { showcaseState } from '../src/presentation/qa/locomotion/showcase';
import { VfxDirector, type DirectorHost } from '../src/presentation/vfx/VfxDirector';
import type { ElementEffects } from '../src/presentation/vfx/ElementEffects';
import type { UnitView } from '../src/presentation/pixi/UnitView';

describe('private archer art specimen',()=>{
  it('keeps the champion out of gameplay and public animation registration',()=>{
    expect(DEFAULT_CONTENT.heroes[ARCHER_VISUAL_ID]).toBeUndefined();
    expect(CHARACTER_ANIMATIONS[ARCHER_VISUAL_ID]).toBeUndefined();
    expect(locomotionClip(ARCHER_ANIMATION,'walk')).toBe('walk');
    expect(locomotionClip(ARCHER_ANIMATION,'run')).toBe('run');
  });
  it('packages distinct directional atlases, portraits and all six clips',()=>{
    expect(new Set(Object.values(ARCHER_ANIMATION.directionalUrls!)).size).toBe(4);
    for(const url of [...Object.values(ARCHER_ANIMATION.directionalUrls!),'/art/archer/portrait.webp','/art/archer/thumbnail.webp']){
      expect(readFileSync('public'+url).toString('ascii',8,12)).toBe('WEBP');
      expect(statSync('public'+url).size).toBeLessThan(600000);
    }
    for(const motion of ['idle','walk','run','attack','hit','death'] as const){
      const count={idle:1,walk:4,run:4,attack:5,hit:3,death:4}[motion];
      expect(ARCHER_ANIMATION.clips[motion]!.count).toBe(count);
      expect(clipOffset(ARCHER_ANIMATION,motion,count-1)!.y).toBeLessThan(1536);
    }
  });
  it('holds a single stable idle frame even after a long pause',()=>{
    const frame=vi.fn(),a=new CharacterAnimator(ARCHER_ANIMATION.clips,frame,vi.fn());
    frame.mockClear();a.tick(20000,false);
    expect(a.state).toBe('idle');expect(a.frameIndex).toBe(0);expect(frame).not.toHaveBeenCalled();
    expect(ARCHER_ANIMATION.clips.idle?.animatedIdle).toBeUndefined();
  });
  it('isolates the real-board appearance from engine state and public/PvP contexts',()=>{
    const state=showcaseState('mage'),saved=JSON.stringify(state);
    const visual=archerPresentationState(state);
    expect(visual.units[0]!.defId).toBe(ARCHER_VISUAL_ID);
    expect(JSON.stringify(state)).toBe(saved);
    expect(visual.units[0]!.hp).toBe(state.units[0]!.hp);
    expect(archerBattlePreviewAllowed(true,'shapeshifterqa','127.0.0.1','?archer-visual-qa=1')).toBe(true);
    expect(archerBattlePreviewAllowed(false,'production','127.0.0.1','?archer-visual-qa=1')).toBe(false);
    expect(archerBattlePreviewAllowed(true,'shapeshifterqa','rpg-go-tactics.com','?archer-visual-qa=1')).toBe(false);
    expect(archerBattlePreviewAllowed(true,'shapeshifterqa','localhost','')).toBe(false);
    expect(ARCHER_RELEASE_POINTS.left.x).toBeLessThan(.4);
    expect(ARCHER_RELEASE_POINTS.right.x).toBeGreaterThan(.7);
  });
  it('returns attacks/hits to idle and keeps death terminal',()=>{
    const a=new CharacterAnimator(ARCHER_ANIMATION.clips,vi.fn(),vi.fn());
    a.play('attack',300);a.tick(1000,false);expect(a.state).toBe('idle');
    a.play('hit');a.tick(1000,false);expect(a.state).toBe('idle');
    a.play('death');a.tick(1000,false);expect(a.dead).toBe(true);
    expect(a.play('walk')).toBe(false);
  });
  it.each(['front','back','left','right'] as const)('uses the authored %s bow grip at the release pose',view=>{
    const state=showcaseState(ARCHER_VISUAL_ID),source=state.units[0]!;
    state.units.push({...structuredClone(source),id:'target',pos:{x:4,y:2},defId:'orc_warrior'});
    const sequence:string[]=[],grip=ARCHER_RELEASE_POINTS[view];
    const body=Object.create(PaintedFigure.prototype);
    Object.assign(body,{setAnimationFrame:()=>sequence.push('release-pose'),
      imagePoint:(x:number,y:number)=>({x:x*256,y:y*256}),toGlobal:(p:{x:number;y:number})=>p});
    const actor=new Proxy({}, {get:(_,key)=>key==='defId'?ARCHER_VISUAL_ID:key==='body'?body:
      key==='root'?{parent:{toLocal:(p:{x:number;y:number})=>p}}:
      key==='directionalFacing'?({front:'S',back:'N',left:'W',right:'E'}[view]):vi.fn()}) as unknown as UnitView;
    const arrow=vi.fn((_from:unknown,_to:unknown,_duration:number,origin:{x:number;y:number})=>{
      sequence.push('arrow');expect(origin).toEqual({x:grip.x*256,y:grip.y*256});
    });
    const fx=new Proxy({}, {get:(_,key)=>key==='physicalArrow'?arrow:vi.fn(),set:()=>true}) as unknown as ElementEffects;
    const host={unit:()=>actor,redraw:vi.fn(),busy:vi.fn(),obstacle:()=>undefined,walk:vi.fn(),
      impulse:vi.fn(),handPulse:vi.fn(),card:()=>undefined,turnBanner:vi.fn()} satisfies DirectorHost;
    const director=new VfxDirector(fx,host);director.sync(state);
    expect(director.previewArcherShot(source.id,'target',false)).toBe(true);
    director.tick(archerShotTiming(false).release);
    expect(sequence).toEqual(['release-pose','arrow']);expect(arrow).toHaveBeenCalledTimes(1);
    director.tick(10);expect(arrow).toHaveBeenCalledTimes(1);
  });
  it.each([false,true])('sequences physical release and impact with reduced=%s without changing HP',reduced=>{
    const state=showcaseState(ARCHER_VISUAL_ID), source=state.units[0]!;
    state.units.push({...structuredClone(source),id:'target',pos:{x:4,y:2},defId:'orc_warrior'});
    const saved=JSON.stringify(state), calls:string[]=[];
    const actor=(defId:string)=>new Proxy({defId},{get:(o,k)=>k==='defId'?o.defId:k==='body'?undefined:vi.fn()}) as unknown as UnitView;
    const sourceView=actor(ARCHER_VISUAL_ID),targetView=actor('orc_warrior');
    const effects=new Proxy({}, {get:(_,k)=>k==='physicalArrow'?()=>calls.push('release'):k==='physicalArrowImpact'?()=>calls.push('impact'):vi.fn(),set:()=>true}) as unknown as ElementEffects;
    const host={unit:(id:string)=>id===source.id?sourceView:targetView,redraw:vi.fn(),busy:vi.fn(),
      obstacle:()=>undefined,walk:vi.fn(),impulse:vi.fn(),handPulse:vi.fn(),card:()=>undefined,turnBanner:vi.fn()} satisfies DirectorHost;
    const director=new VfxDirector(effects,host);director.sync(state);
    expect(director.previewArcherShot(source.id,'target',reduced)).toBe(true);
    expect(director.previewArcherShot(source.id,'target',reduced)).toBe(false);
    const timing=archerShotTiming(reduced);
    director.tick(timing.release-1);expect(calls).toEqual([]);
    director.tick(1);expect(calls).toEqual(['release']);
    director.tick(timing.travel-1);expect(calls).toEqual(['release']);
    director.tick(1);expect(calls).toEqual(['release','impact']);
    director.tick(timing.recovery);expect(director.busy).toBe(false);
    expect(JSON.stringify(state)).toBe(saved);
  });
});
