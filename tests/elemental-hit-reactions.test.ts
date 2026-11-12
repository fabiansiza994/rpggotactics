import {VfxDirector,type DirectorHost} from '../src/presentation/vfx/VfxDirector';
import {DEFAULT_CONTENT} from '../src/game';
import {beforeEach,expect,it,vi} from 'vitest';
import {Container,Texture,TextureSource} from 'pixi.js';
import {ElementEffects} from '../src/presentation/vfx/ElementEffects';
import {loadSharedTexture} from '../src/presentation/pixi/paintedTextures';
import {damageReaction} from '../src/presentation/vfx/hitReactions';
import {universalReactionFixture} from '../src/presentation/qa/act3/universalReactionFixtures';
vi.mock('../src/presentation/pixi/paintedTextures',()=>({loadSharedTexture:vi.fn()}));
beforeEach(()=>{vi.stubGlobal('location',{hostname:'localhost'});vi.stubGlobal('matchMedia',()=>({matches:false}));vi.mocked(loadSharedTexture).mockResolvedValue(new Texture({source:new TextureSource({width:1024,height:1024})}));});
async function setup(){const actors=new Container(),fx=new ElementEffects(new Container(),actors,p=>({x:p.x*96,y:p.y*96}),new Container());await Promise.all([fx.mage.prepare(),fx.fireball.prepare()]);fx.mage.beginBatch();fx.fireball.beginBatch();return {fx,actors};}
for(const kind of ['fire','ice','arcane'] as const)for(const reduced of [false,true])it(`${kind}: finite illustrated victim layers, no input, death and scene cleanup reduced=${reduced}`,async()=>{
 const {fx,actors}=await setup();fx.reduced=reduced;let p:{x:number;y:number}|undefined={x:2,y:2};
 fx.unitReaction('victim',()=>p,kind);const pool=kind==='fire'?fx.fireball:fx.mage;
 expect(pool.snapshot.active).toBeGreaterThan(0);expect(pool.snapshot.active).toBeLessThanOrEqual(4);
 expect(actors.children.every(c=>c.eventMode==='none')).toBe(true);
 const xs=actors.children.map(c=>c.x);p={x:3,y:2};fx.tick(60);expect(actors.children.some((c,i)=>c.x>xs[i]!)).toBe(true);
 fx.tick(750);expect(pool.snapshot.active).toBe(0);expect(fx.reactionSnapshot.attached).toBe(0);
 for(let n=0;n<20;n++)fx.unitReaction('victim',()=>p,kind);
 expect(pool.snapshot.active).toBeLessThanOrEqual(4);fx.clearUnitReaction('victim');expect(pool.snapshot.active).toBe(0);
 fx.unitReaction('victim',()=>p,kind);p=undefined;fx.tick(50);expect(actors.children.every(c=>c.alpha===0)).toBe(true);
 fx.clear();expect(actors.children).toHaveLength(0);fx.destroy();
});
it('replaces fire/ice/arcane across both atlas banks without stacking',async()=>{const {fx,actors}=await setup();for(let n=0;n<20;n++)for(const kind of ['fire','ice','arcane'] as const)fx.unitReaction('same',()=>({x:2,y:2}),kind);expect(fx.fireball.snapshot.active).toBe(0);expect(fx.mage.snapshot.active).toBeLessThanOrEqual(4);expect(fx.reactionSnapshot.attached).toBe(1);fx.clear();expect(actors.children).toHaveLength(0);fx.destroy();});
it('simultaneous hits remain bounded and release every clip',async()=>{const {fx,actors}=await setup();for(let i=0;i<100;i++)fx.unitReaction('target'+i,()=>({x:i%7,y:i%5}),i%2?'ice':'arcane');expect(fx.mage.snapshot.allocated).toBeLessThanOrEqual(32);expect(fx.reactionSnapshot.attached).toBeLessThanOrEqual(48);fx.tick(750);expect(fx.mage.snapshot.active).toBe(0);expect(fx.reactionSnapshot.attached).toBe(0);expect(actors.children).toHaveLength(0);fx.destroy();});
it('A/B restores original atlas count and retains neutral/physical feedback',async()=>{const {fx}=await setup();fx.elementalHits=false;fx.unitReaction('fire',()=>({x:1,y:1}),'fire');expect(fx.fireball.snapshot.active).toBe(1);fx.unitReaction('ice',()=>({x:1,y:1}),'ice');expect(fx.mage.snapshot.active).toBe(0);fx.clear();fx.elementalHits=true;fx.unitReaction('plain',()=>({x:1,y:1}),'physical');expect(fx.mage.snapshot.active+fx.fireball.snapshot.active).toBe(0);expect(fx.reactionSnapshot.attached).toBe(1);fx.destroy();});
it('uses authoritative damage type and never flames shield-only or zero HP damage',()=>{for(const k of ['fire','ice','arcane']){for(const receiver of ['hero','enemy','summon']){const f=universalReactionFixture(k,receiver,'damage');const e=f.events.find(e=>e.type==='UNIT_DAMAGED')!;expect(damageReaction(e)).toBe(k);expect(damageReaction({...e,hpLost:0,shieldAbsorbed:3})).toBe('block');expect(damageReaction({...e,hpLost:0,shieldAbsorbed:0,armorMitigated:0})).toBe('none');}}});
for(const kind of ['fire','ice','arcane'] as const)it(`${kind}: coarse-pointer quality caps illustrated layers at three`,async()=>{vi.stubGlobal('matchMedia',()=>({matches:true}));const {fx}=await setup();fx.unitReaction('mobile',()=>({x:2,y:2}),kind);const p=kind==='fire'?fx.fireball:fx.mage;expect(p.snapshot.active).toBeLessThanOrEqual(3);fx.tick(750);expect(p.snapshot.active).toBe(0);fx.destroy();});

for(const [kind,duration] of [['fire',650],['ice',700],['arcane',600]] as const)it(`${kind}: readable residual lasts ${duration}ms without stacking`,async()=>{const {fx}=await setup();fx.unitReaction('victim',()=>({x:2,y:2}),kind);const p=kind==='fire'?fx.fireball:fx.mage;fx.tick(240);expect(p.snapshot.active).toBeGreaterThan(0);fx.tick(duration-241);expect(p.snapshot.active).toBeGreaterThan(0);fx.tick(1);expect(p.snapshot.active).toBe(0);expect(fx.reactionSnapshot.attached).toBe(0);fx.destroy();});

it('residual elemental sprites outlive presentation lock without delaying HP or recoil queue',async()=>{
 const {fx}=await setup();const f=universalReactionFixture('ice','enemy','damage');let shown=f.before;
 const host:DirectorHost={redraw:s=>{shown=s as typeof shown;},unit:()=>undefined,obstacle:()=>undefined,walk:vi.fn(),busy:vi.fn(),impulse:vi.fn(),handPulse:vi.fn(),card:id=>DEFAULT_CONTENT.cards[id],turnBanner:vi.fn()};
 const director=new VfxDirector(fx,host);director.sync(f.before);director.enqueue(f.events,f.after,false);director.tick(1);director.tick(300);
 expect(director.busy).toBe(false);expect(shown).toEqual(f.after);expect(fx.mage.snapshot.active).toBeGreaterThan(0);
 director.tick(700);expect(fx.mage.snapshot.active).toBe(0);director.clear();fx.destroy();
});
