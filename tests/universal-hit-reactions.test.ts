import { loadSharedTexture } from '../src/presentation/pixi/paintedTextures';
import { beforeEach, expect, it, vi } from 'vitest';
import { Container, Texture, TextureSource } from 'pixi.js';
import { damageReaction, hitReactionPilot, universalReactionsEnabled } from '../src/presentation/vfx/hitReactions';
import { ElementEffects } from '../src/presentation/vfx/ElementEffects';
import { VfxDirector, type DirectorHost } from '../src/presentation/vfx/VfxDirector';
import type { UnitView } from '../src/presentation/pixi/UnitView';
import { universalReactionFixture } from '../src/presentation/qa/act3/universalReactionFixtures';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { DEFAULT_CONTENT, type GameState, type EventOfType } from '../src/game';
vi.mock('../src/presentation/pixi/paintedTextures',()=>({loadSharedTexture:vi.fn()}));
beforeEach(()=>{vi.stubGlobal('location',{hostname:'localhost'});vi.stubGlobal('matchMedia',()=>({matches:false}));hitReactionPilot.enabled=true;});
const damage=(type:EventOfType<'UNIT_DAMAGED'>['damageType']):EventOfType<'UNIT_DAMAGED'>=>({type:'UNIT_DAMAGED',unitId:'victim',sourceId:'source',damageType:type,pos:{x:2,y:2},rawAmount:100,hpLost:1,hpAfter:5,armorMitigated:0,shieldAbsorbed:0});
it('uses only confirmed element and HP/mitigation, never raw damage/empowered as a critical',()=>{
 for(const [type,kind] of [['PHYSICAL','physical'],['FIRE','fire'],['ICE','ice'],['ARCANE','arcane'],['FORCE','force']] as const){const e=damage(type);expect(damageReaction(e)).toBe(kind);expect(damageReaction({...e,hpLost:0})).toBe('none');expect(damageReaction({...e,hpLost:0,shieldAbsorbed:3})).toBe('block');expect(damageReaction({...e,hpLost:0,armorMitigated:3})).toBe('block');expect(damageReaction({...e,hpLost:0,coverMitigated:3})).toBe('block');}
});
it('universal rollout remains local and has an explicit original fallback',()=>{expect(universalReactionsEnabled()).toBe(true);hitReactionPilot.enabled=false;expect(universalReactionsEnabled()).toBe(false);hitReactionPilot.enabled=true;vi.stubGlobal('location',{hostname:'rpg-go-tactics.com'});expect(universalReactionsEnabled()).toBe(false);});
it.each([false,true])('reuses the bounded graphics pool, replaces attached layers and clears death/scene effects (reduced=%s)',reduced=>{
 const above=new Container(),actors=new Container(),ground=new Container(),fx=new ElementEffects(above,actors,p=>({x:p.x*96,y:p.y*96}),ground);fx.reduced=reduced;
 const position=()=>({x:2,y:2});
 for(const kind of ['physical','fire','ice','arcane','force','block','heal'] as const){for(let i=0;i<10;i++)fx.unitReaction('same-victim',position,kind);expect(fx.reactionSnapshot.attached).toBe(1);expect(actors.children).toHaveLength(1);fx.tick(750);expect(fx.reactionSnapshot.attached).toBe(0);}
 for(let i=0;i<100;i++)fx.unitReaction('victim-'+i,position,'ice');expect(fx.reactionSnapshot.attached).toBeLessThanOrEqual(48);fx.clearUnitReaction('victim-0');expect(fx.reactionSnapshot.attached).toBeLessThanOrEqual(47);fx.clear();expect(fx.reactionSnapshot.attached).toBe(0);expect(actors.children).toHaveLength(0);fx.destroy();
});
it('reaction follows current victim anchor, keeps depth and cannot intercept input',()=>{const actors=new Container(),fx=new ElementEffects(new Container(),actors,p=>({x:p.x*96,y:p.y*96}),new Container());let pos={x:1,y:1};fx.unitReaction('victim',()=>pos,'ice');const g=actors.children[0]!;const x=g.x;pos={x:2,y:2};fx.tick(60);expect(g.x).toBeGreaterThan(x);expect(g.eventMode).toBe('none');fx.clearUnitReaction('victim');expect(actors.children).toHaveLength(0);fx.destroy();});
for(const kind of ['physical','fire','ice','arcane','force','heal'])for(const receiver of ['enemy','hero','summon']){
 it(`${kind} → ${receiver}: real rules, HP projection, exactly one reaction and replay cleanup`,()=>{
  const f=universalReactionFixture(kind,receiver,'damage'),saved=JSON.stringify(f.after);
  const number=vi.fn(),reaction=vi.fn(),clearReaction=vi.fn(),animations=new ElementEffects(new Container(),new Container(),p=>({x:p.x*96,y:p.y*96}),new Container());
  const body=new Container();body.position.set(7,11);
  const unit={defId:'summoner',body,directionalFacing:'E',playAnimation:vi.fn(),pulseLight:vi.fn(),animateHealthChange:vi.fn(),snapHealth:vi.fn(),setFacingLock:vi.fn()} as unknown as UnitView;
  const fx=new Proxy({number,unitReaction:reaction,clearUnitReaction:clearReaction,animate:animations.animate.bind(animations),clear:animations.clear.bind(animations),fireball:{ready:false,beginBatch:vi.fn(),clearReaction:vi.fn()}},{get:(o,k)=>k in o?o[k as keyof typeof o]:k==='lift'||k==='center'?(p:unknown)=>p:vi.fn(),set:()=>true}) as unknown as ElementEffects;
  let visible:Readonly<GameState>=f.before;
  const host:DirectorHost={redraw:s=>{visible=s;},unit:()=>unit,obstacle:()=>undefined,walk:vi.fn(),busy:vi.fn(),impulse:vi.fn(),handPulse:vi.fn(),card:id=>DEFAULT_CONTENT.cards[id],turnBanner:vi.fn()};
  const director=new VfxDirector(fx,host);director.sync(f.before);director.enqueue(f.events,f.after,false);director.tick(2000);animations.tick(2000);
  expect(reaction).toHaveBeenCalledOnce();expect(reaction.mock.calls[0]![2]).toBe(kind);expect(number).toHaveBeenCalledOnce();expect(visible.units.find(u=>u.id===f.targetId)?.hp).toBe(f.after.units.find(u=>u.id===f.targetId)?.hp);expect(body.position.x).toBe(7);expect(body.position.y).toBe(11);expect(JSON.stringify(f.after)).toBe(saved);
  const plan=compileTimeline(f.events,id=>id,false);expect(compileTimeline(JSON.parse(JSON.stringify(f.events)),id=>id,false)).toEqual(plan);
  director.clear();director.sync(f.after);director.tick(3000);expect(reaction).toHaveBeenCalledOnce();animations.destroy();
 });
}
it.each(['shield','armor','death'])('real physical %s events select correct reaction without fake HP',outcome=>{const f=universalReactionFixture('physical','summon',outcome);const hit=f.events.find(e=>e.type==='UNIT_DAMAGED')!;expect(damageReaction(hit)).toBe(outcome==='death'?'physical':'block');if(outcome!=='death')expect(hit.hpLost).toBe(0);else expect(f.events.some(e=>e.type==='UNIT_DEFEATED')).toBe(true);});

it('illustrated fire switches to ice without duplicate victim layers; a zero-result event does not clear a valid reaction',async()=>{
 vi.mocked(loadSharedTexture).mockResolvedValue(new Texture({source:new TextureSource({width:1024,height:1024})}));
 const actors=new Container(),fx=new ElementEffects(new Container(),actors,p=>({x:p.x*96,y:p.y*96}),new Container());
 await fx.fireball.prepare();fx.fireball.beginBatch();
 const pos=()=>({x:2,y:2});fx.unitReaction('victim',pos,'fire');expect(fx.fireball.snapshot.active).toBe(4);fx.unitReaction('victim',pos,'none');expect(fx.fireball.snapshot.active).toBe(4);
 fx.unitReaction('victim',pos,'ice');expect(fx.fireball.snapshot.active).toBe(0);expect(fx.reactionSnapshot.attached).toBe(1);fx.clearUnitReaction('victim');expect(fx.reactionSnapshot.attached).toBe(0);expect(actors.children).toHaveLength(0);fx.destroy();
});
