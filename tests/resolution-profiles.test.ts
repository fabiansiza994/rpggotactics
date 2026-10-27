import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/game';
import { resolutionTiming } from '../src/presentation/vfx/resolutionProfiles';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';

describe('presentation resolution budgets', () => {
  it.each(['barrier','ice_wall','blink','force_push','arcane_burst'])('%s has a readable simple budget', key => {
    const p = resolutionTiming(key,false);
    expect(p.total).toBeGreaterThanOrEqual(700);
    expect(p.total).toBeLessThanOrEqual(1100);
  });
  it.each(['fireball','magic_missile'])('%s includes real travel and reading time', key => {
    const p=resolutionTiming(key,false);
    expect(p.travel).toBeGreaterThan(200);
    expect(p.total).toBeGreaterThanOrEqual(900);
    expect(p.total).toBeLessThanOrEqual(1300);
  });
  it('reserves emergence and settle time for summons',()=>{
    expect(resolutionTiming('custom_creature',false,true).total).toBe(1450);
  });
  it('reduced motion preserves cast, impact and read phases',()=>{
    const p=resolutionTiming('fireball',true);
    expect(p.cast).toBeGreaterThan(0);
    expect(p.travel).toBeLessThan(100);
    expect(p.read).toBeGreaterThan(100);
  });
  it('projects damage at projectile arrival, then closes preview after recovery; replay is immutable',()=>{
    const events = [
      {type:'CARD_PLAYED',cardId:'fireball',cardUid:'one',casterId:'hero',impact:{x:2,y:1},target:{x:2,y:1},direction:null,affectedTiles:[{x:2,y:1}]},
      {type:'UNIT_DAMAGED',unitId:'enemy',hpLost:3},
      {type:'CARD_RESOLVED',cardId:'fireball'},
    ] as GameEvent[];
    const saved=JSON.stringify(events);
    for(const reduced of [false,true]) {
      const plan=compileTimeline(events,id=>id,reduced);
      const projectile=plan.cues.find(c=>c.kind==='projectile')!;
      const impact=plan.cues.find(c=>c.kind==='spellImpact')!;
      const hit=plan.cues.find(c=>c.event.type==='UNIT_DAMAGED')!;
      const end=plan.cues.find(c=>c.event.type==='CARD_RESOLVED')!;
      expect(hit.at).toBe(impact.at);
      expect(hit.at).toBe(projectile.at+projectile.duration);
      expect(end.at).toBeGreaterThan(hit.at);
      expect(compileTimeline(JSON.parse(saved),id=>id,reduced)).toEqual(plan);
    }
    expect(JSON.stringify(events)).toBe(saved);
  });
});
