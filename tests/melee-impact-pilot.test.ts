import {beforeEach,expect,it,vi} from 'vitest';
import {Container} from 'pixi.js';
import {springOffset,hitReactionPilot} from '../src/presentation/vfx/hitReactions';
import {ElementEffects} from '../src/presentation/vfx/ElementEffects';
import {VfxDirector,type DirectorHost} from '../src/presentation/vfx/VfxDirector';
import type {UnitView} from '../src/presentation/pixi/UnitView';
import {universalReactionFixture} from '../src/presentation/qa/act3/universalReactionFixtures';
import {DEFAULT_CONTENT} from '../src/game';
beforeEach(()=>{vi.stubGlobal('location',{hostname:'localhost'});hitReactionPilot.enabled=true;hitReactionPilot.spring=true;});
it('has finite bounded recoil, one damped rebound and exact endpoints',()=>{const values=Array.from({length:241},(_,i)=>springOffset(i/240));expect(values[0]).toBe(0);expect(values[240]).toBe(0);expect(Math.max(...values)).toBeLessThanOrEqual(5);expect(Math.min(...values)).toBeLessThan(0);expect(Math.min(...values)).toBeGreaterThan(-2);expect(values.every(Number.isFinite)).toBe(true);expect(springOffset(-1)).toBe(0);expect(springOffset(2)).toBe(0);});
for(const kind of ['physical','fire','arcane'])for(const reduced of [false,true])it(`${kind}: repeated impact and cancellation restore exact body (${reduced})`,()=>{
 const f=universalReactionFixture(kind,'enemy','damage');
 const body=new Container();body.position.set(7,11);body.scale.set(.8,1.2);body.tint=0xfefefe;
 const unit={defId:'summoner',body,playAnimation:vi.fn(),holdAnimation:vi.fn(),pulseLight:vi.fn(),animateHealthChange:vi.fn(),snapHealth:vi.fn(),setFacingLock:vi.fn()} as unknown as UnitView;
 const fx=new ElementEffects(new Container(),new Container(),p=>({x:p.x*60,y:p.y*30}),new Container());
 const host:DirectorHost={redraw:vi.fn(),unit:()=>unit,obstacle:()=>undefined,walk:vi.fn(),busy:vi.fn(),impulse:vi.fn(),handPulse:vi.fn(),card:id=>DEFAULT_CONTENT.cards[id],turnBanner:vi.fn()};
 const d=new VfxDirector(fx,host);d.sync(f.before);
 const hit=(d as unknown as {hit(id:string,source:string,reduced:boolean):void}).hit.bind(d);
 const e=f.events.find(e=>e.type==='UNIT_DAMAGED')!;
 for(let i=0;i<20;i++){hit(e.unitId,e.sourceId,reduced);fx.tick(35);if(reduced)expect(body.x).toBe(7);else expect(body.x).not.toBe(7);}
 d.clear();expect([body.x,body.y,body.scale.x,body.scale.y,body.tint]).toEqual([7,11,.8,1.2,0xfefefe]);
 d.sync(f.before);hit(e.unitId,e.sourceId,reduced);fx.tick(240);expect([body.x,body.y]).toEqual([7,11]);d.destroy();expect(fx.reactionSnapshot.attached).toBe(0);
});
it('instance fallback retains the original 120ms duration and restores after impact',()=>{
 const f=universalReactionFixture('physical','enemy','damage');const body=new Container();const fx=new ElementEffects(new Container(),new Container(),p=>p,new Container());
 const d=new VfxDirector(fx,{unit:()=>({body} as UnitView),busy:vi.fn()} as unknown as DirectorHost);d.reactionSpring=false;d.sync(f.before);const e=f.events.find(e=>e.type==='UNIT_DAMAGED')!;
 (d as unknown as {hit(id:string,source:string,reduced:boolean):void}).hit(e.unitId,e.sourceId,false);fx.tick(60);expect(body.x).not.toBe(0);fx.tick(60);expect(body.x).toBe(0);d.destroy();
});
