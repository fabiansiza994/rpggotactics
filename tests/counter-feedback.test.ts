import { describe, expect, it, vi } from 'vitest';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { VfxDirector, type DirectorHost } from '../src/presentation/vfx/VfxDirector';
import type { ElementEffects } from '../src/presentation/vfx/ElementEffects';
import type { UnitView } from '../src/presentation/pixi/UnitView';
import type { GameState } from '../src/game';
import { counterFeedback } from '../src/presentation/qa/locomotion/counterFeedback';

describe('sequential reaction presentation', () => {
  it.each(['bear','minotaur'] as const)('orders real %s hits, reaction and impact, including reduced motion/replay', form => {
    const f = counterFeedback(form);
    const saved = JSON.stringify(f.events);
    for (const reduced of [false,true]) {
      const plan = compileTimeline(f.events,id=>id,reduced);
      const first = plan.cues.find(c=>c.event.type==='UNIT_DAMAGED')!;
      const prepare = plan.cues.find(c=>c.kind==='reactionPrepare')!;
      const attack = plan.cues.find(c=>c.kind==='event' && c.event.type==='COUNTER_ATTACK')!;
      const impact = plan.cues.find(c=>c.kind==='attackImpact' && c.event.type==='COUNTER_ATTACK')!;
      const hits = plan.cues.filter(c=>c.event.type==='UNIT_DAMAGED');
      expect(first.at).toBeGreaterThan(0);
      expect(prepare.at).toBeGreaterThan(first.at);
      expect(attack.at).toBeGreaterThan(prepare.at);
      expect(impact.at).toBe(attack.at+attack.duration);
      expect(hits[1]!.at).toBe(impact.at);
      expect(plan.duration).toBeGreaterThan(impact.at);
      expect(compileTimeline(JSON.parse(saved),id=>id,reduced)).toEqual(plan);
    }
    expect(JSON.stringify(f.events)).toBe(saved);
  });
  it('keeps consecutive exchanges separate, without recursive reactions',()=>{
    const f=counterFeedback('bear','multiple');
    const plan=compileTimeline(f.events,id=>id,false);
    const hits=plan.cues.filter(c=>c.event.type==='UNIT_DAMAGED');
    expect(hits).toHaveLength(4);
    expect(hits.map(c=>c.at)).toEqual([...hits.map(c=>c.at)].sort((a,b)=>a-b));
    expect(new Set(hits.map(c=>c.at)).size).toBe(4);
    expect(f.events.filter(e=>e.type==='COUNTER_ATTACK')).toHaveLength(2);
    expect(plan.cues.filter(c=>c.event.type==='ENEMY_ATTACKED'&&c.kind==='event')[1]!.at)
      .toBeGreaterThan(hits[1]!.at);
  });
  it.each(['defender-death','attacker-death','shield','armor'] as const)('preserves authoritative %s outcomes', variant=>{
    const f=counterFeedback('bear',variant), plan=compileTimeline(f.events,id=>id,false);
    const counters=f.events.filter(e=>e.type==='COUNTER_ATTACK');
    expect(counters).toHaveLength(variant==='defender-death'?0:1);
    if(variant.endsWith('death')) {
      const death=plan.cues.find(c=>c.event.type==='UNIT_DEFEATED'&&c.kind==='event')!;
      const removal=plan.cues.find(c=>c.kind==='commit')!;
      expect(removal.at).toBe(death.at+death.duration);
      expect(plan.duration).toBeGreaterThanOrEqual(removal.at);
    } else {
      const hit=f.events.filter(e=>e.type==='UNIT_DAMAGED')[1]!;
      expect(hit.hpLost).toBe(0);
      expect(variant==='shield'?hit.shieldAbsorbed:hit.armorMitigated).toBeGreaterThan(0);
    }
  });
  it('director publishes HP/numbers only at their impact and unlocks after recovery',()=>{
    const f=counterFeedback('bear');
    const number=vi.fn(), busy=vi.fn();
    let visible:Readonly<GameState>=f.before;
    const unit=new Proxy({defId:'shapeshifter'}, {get:(o,k)=>k==='defId'?o.defId:k==='body'?undefined:vi.fn()}) as unknown as UnitView;
    const effects=new Proxy({number}, {get:(o,k)=>k==='number'?o.number:k==='center'||k==='lift'?(p:{x:number;y:number})=>p:vi.fn(),set:()=>true}) as unknown as ElementEffects;
    const host={redraw:(s:Readonly<GameState>)=>{visible=s;},unit:()=>unit,busy,
      card:()=>undefined,walk:vi.fn(),impulse:vi.fn(),handPulse:vi.fn(),turnBanner:vi.fn(),obstacle:()=>undefined} satisfies DirectorHost;
    const director=new VfxDirector(effects,host);director.sync(f.before);director.enqueue(f.events,f.after,false);
    const plan=compileTimeline(f.events,id=>id,false), hits=plan.cues.filter(c=>c.event.type==='UNIT_DAMAGED');
    director.tick(hits[0]!.at-1); expect(number).not.toHaveBeenCalled();
    expect(visible.units[0]!.hp).toBe(18);
    director.tick(1); expect(number).toHaveBeenCalledTimes(1);expect(visible.units[0]!.hp).toBe(15);
    expect(visible.units[1]!.hp).toBe(8);
    director.tick(hits[1]!.at-hits[0]!.at-1);expect(number).toHaveBeenCalledTimes(1);
    director.tick(1);expect(number).toHaveBeenCalledTimes(2);expect(visible.units[1]!.hp).toBe(7);
    expect(director.busy).toBe(true);
    director.tick(plan.duration);expect(director.busy).toBe(false);expect(visible).toEqual(f.after);
    expect(busy.mock.calls.map(c=>c[0])).toEqual([true,false]);
  });
});
