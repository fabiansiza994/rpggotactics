import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Sprite, Texture, TextureSource } from 'pixi.js';
import { DEFAULT_CONTENT, GameEngine, type GameEvent } from '../src/game';
import { makeEngine, mutable, p, setHand } from './helpers';
import { CatalogEffects } from '../src/presentation/vfx/CatalogEffects';
import { catalogBatch, catalogEventRecipes, cardRecipe, catalogPilot } from '../src/presentation/vfx/catalogRecipes';
import { isThunderPremium, thunderConnection, THUNDER_TIMING } from '../src/presentation/vfx/thunderRecipe';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { resolutionTiming } from '../src/presentation/vfx/resolutionProfiles';
import { ElementEffects, type FxGeometry } from '../src/presentation/vfx/ElementEffects';
import { VfxDirector, type DirectorHost } from '../src/presentation/vfx/VfxDirector';
import { loadSharedTexture } from '../src/presentation/pixi/paintedTextures';
vi.mock('../src/presentation/pixi/paintedTextures', () => ({ loadSharedTexture: vi.fn() }));
const geometry: FxGeometry = {center:q=>({x:q.x*96,y:q.y*48}), footprint:()=>({w:96,h:48}), quad:()=>[], depth:q=>q.y};
beforeEach(()=>{
 vi.stubGlobal('location',{hostname:'localhost'}); vi.stubGlobal('matchMedia',()=>({matches:false}));
 catalogPilot.enabled=true;
 vi.mocked(loadSharedTexture).mockReset().mockResolvedValue(new Texture({source:new TextureSource({width:1024,height:1024})}));
});
function resolve(id:string, multiple=false, shield=false) {
 const e=makeEngine({hero:{heroId:'mage',pos:p(1,2)}, enemies:(multiple?[p(3,2),p(3,1),p(3,3),p(2,2),p(4,2)]:[p(3,2)]).map((pos,i)=>({id:'victim'+i,enemyId:'orc_warrior',pos}))});
 mutable(e).player.energy=10;
 if(shield)for(const u of mutable(e).units.filter(u=>u.faction==='ENEMY'))u.shield=10;
 setHand(e,[id]);const before=structuredClone(e.state), cmd={type:'PLAY_CARD' as const,cardUid:e.state.player.hand[0]!.uid,target:p(3,2)};
 const result=e.dispatch(cmd);if(!result.ok)throw Error(result.error);
 return {before,after:e.state,events:result.events,cmd,scenario:e.scenario};
}
describe('Thunder Premium 3 — only the two approved cards',()=>{
 it('keeps the other thunder recipes and timings unchanged',()=>{
  for(const id of ['chain_lightning','arcane_overload','paralyzing_pulse']){
   expect(isThunderPremium(id)).toBe(false);expect(cardRecipe(DEFAULT_CONTENT.cards[id]!,[]).bank).toBe('mage-elements');
  }
  expect(resolutionTiming('chain_lightning',false).travel).toBe(260);
  for(const id of ['thunder_discharge','tempest_judgment'])expect(cardRecipe(DEFAULT_CONTENT.cards[id]!,[]).bank).toBe('thunder-premium');
 });
 it.each([96,220,450])('anchors a continuous %ipx beam at both real screen points',length=>{
  const a={x:21,y:80},b={x:21+length,y:110}, plan=thunderConnection(a,b,96);
  expect(plan.points[0]).toEqual(a);expect(plan.points.at(-1)).toEqual(b);
  expect(plan.points.length).toBeLessThanOrEqual(7);expect(plan.branches).toBeGreaterThan(0);
  expect(plan.distance).toBeCloseTo(Math.hypot(length,30));
  expect(thunderConnection(a,b,96,true).branches).toBe(0);
 });
 it('differentiates short, medium and long paths without fixed projectile size',()=>{
  expect([96,220,450].map(x=>thunderConnection(p(0,0),p(x,0),96).tier)).toEqual(['short','medium','long']);
 });
 it.each(['thunder_discharge','tempest_judgment'])('%s: contact precedes HP, hits once, replay unchanged, clear cancels all',async id=>{
  const f=resolve(id,id==='tempest_judgment'), timeline=compileTimeline(f.events,x=>x,false);
  const impact=timeline.cues.find(c=>c.kind==='spellImpact')!;
  for(const cue of timeline.cues.filter(c=>c.event.type==='UNIT_DAMAGED'))expect(cue.at).toBe(impact.at);
  if(id==='tempest_judgment')expect(timeline.duration).toBe(1360);
  const replay=GameEngine.fromSnapshot(f.before,DEFAULT_CONTENT,f.scenario);expect(replay.dispatch(f.cmd)).toMatchObject({ok:true,events:f.events});expect(replay.state).toEqual(f.after);
  const actors=new Container(),ground=new Container(),fx=new ElementEffects(actors,ground,geometry,new Container());
  await fx.catalog.prepare(catalogEventRecipes(f.events,x=>DEFAULT_CONTENT.cards[x]));
  let shown=f.before;
  const host:DirectorHost={redraw:s=>{shown=structuredClone(s);},unit:()=>undefined,obstacle:()=>undefined,walk:()=>{},busy:()=>{},impulse:vi.fn(),handPulse:()=>{},card:x=>DEFAULT_CONTENT.cards[x],turnBanner:()=>{}};
  const d=new VfxDirector(fx,host), numbers=vi.spyOn(fx,'number'), reactions=vi.spyOn(fx,'unitReaction');d.sync(f.before);d.enqueue(f.events,f.after,false);
  d.tick(impact.at-1);expect(numbers).not.toHaveBeenCalled();expect(shown.units.map(u=>u.hp)).toEqual(f.before.units.map(u=>u.hp));
  d.tick(1);expect(numbers).toHaveBeenCalledTimes(id==='tempest_judgment'?5:1);expect(reactions).toHaveBeenCalledTimes(id==='tempest_judgment'?5:1);
  const damage=f.events.filter(e=>e.type==='UNIT_DAMAGED');expect(damage).toHaveLength(id==='tempest_judgment'?5:1);
  expect(fx.catalog.snapshot['thunder-premium']!.peak).toBeLessThanOrEqual(48);
  d.tick(1000);expect(shown.units.map(u=>u.hp)).toEqual(f.after.units.map(u=>u.hp));
  d.clear();expect(fx.catalog.snapshot['thunder-premium']!.active).toBe(0);d.destroy();
 });
 it('blocked damage produces shield feedback without fake HP loss',()=>{
  const f=resolve('thunder_discharge',false,true),hits=f.events.filter(e=>e.type==='UNIT_DAMAGED');
  expect(hits).toHaveLength(1);expect(hits[0]).toMatchObject({hpLost:0,shieldAbsorbed:3});
  expect(f.after.units.find(u=>u.id==='victim0')!.hp).toBe(f.before.units.find(u=>u.id==='victim0')!.hp);
 });
 it('bounds pools, expires only cosmetic scars after two rounds, reduced mode avoids branches',async()=>{
  const actors=new Container(),ground=new Container(),fx=new CatalogEffects(actors,ground,geometry),r=cardRecipe(DEFAULT_CONTENT.cards.tempest_judgment!,[]);
  await fx.prepare([r]);fx.beginBatch();fx.advanceRound(4);
  for(let i=0;i<20;i++){fx.impact(r,p(0,0),p(2,2),[p(2,2),p(3,2)]);fx.tick(1000);}
  expect(fx.snapshot['thunder-premium']!.allocated).toBeLessThanOrEqual(48);expect(fx.snapshot['thunder-premium']!.active).toBe(2);
  fx.advanceRound(5);expect(fx.snapshot['thunder-premium']!.active).toBe(2);fx.advanceRound(6);expect(fx.snapshot['thunder-premium']!.active).toBe(0);
  fx.reduced=true;fx.projectile(cardRecipe(DEFAULT_CONTENT.cards.thunder_discharge!,[]),p(0,0),p(4,0),60,{x:10,y:20});expect(fx.snapshot['thunder-premium']!.active).toBe(1);
  fx.clear();expect(actors.children.length+ground.children.length).toBe(0);fx.destroy();
 });
 it('discharge sparks are brief and do not leave a turn-persistent ground decal',async()=>{
  const fx=new CatalogEffects(new Container(),new Container(),geometry),r=cardRecipe(DEFAULT_CONTENT.cards.thunder_discharge!,[]);
  await fx.prepare([r]);fx.beginBatch();fx.impact(r,p(0,0),p(2,2),[p(2,2)]);fx.tick(1000);expect(fx.snapshot['thunder-premium']!.active).toBe(0);fx.destroy();
 });
 it('keeps custom caster anchor and proportional beam length at arbitrary scale',async()=>{
  const actors=new Container(),fx=new CatalogEffects(actors,new Container(),geometry),r=cardRecipe(DEFAULT_CONTENT.cards.thunder_discharge!,[]);
  await fx.prepare([r]);fx.beginBatch();fx.projectile(r,p(0,0),p(4,2),180,{x:17,y:23});fx.tick(90);
  expect((actors.children[0] as Sprite).position.x).toBe(17);expect((actors.children[0] as Sprite).position.y).toBe(23);
  fx.clear();fx.destroy();
 });
 it('atlas failure preserves original handling and can retry without gameplay change',async()=>{
  const fx=new CatalogEffects(new Container(),new Container(),geometry),r=cardRecipe(DEFAULT_CONTENT.cards.tempest_judgment!,[]);
  vi.mocked(loadSharedTexture).mockRejectedValueOnce(Error('QA missing atlas'));await fx.prepare([r]);fx.beginBatch();expect(fx.handles(r)).toBe(false);
  await fx.prepare([r]);expect(fx.handles(r)).toBe(true);fx.clear();fx.destroy();
 });
 it('confirmed damage events carry the recipe; no inferred targets or status additions',()=>{
  const f=resolve('tempest_judgment',true);const batch=catalogBatch(f.events,x=>DEFAULT_CONTENT.cards[x]);
  for(const e of f.events.filter((e:GameEvent)=>e.type==='UNIT_DAMAGED'))expect(batch.get(e)?.variant).toBe('tempest_judgment');
  expect(f.events.some(e=>e.type==='STATUS_APPLIED')).toBe(false);
  expect(resolutionTiming('tempest_judgment',true).total).toBeLessThan(THUNDER_TIMING.tempest_judgment.cast);
 });
 it.each(['thunder_discharge','tempest_judgment'])('%s death stays after contact and a cancelled pre-impact sequence cannot emit late HP',async id=>{
  const f=resolve(id),before=structuredClone(f.before);before.units.find(u=>u.id==='victim0')!.hp=1;
  const engine=GameEngine.fromSnapshot(before,DEFAULT_CONTENT,f.scenario),result=engine.dispatch(f.cmd);expect(result.ok).toBe(true);if(!result.ok)return;
  const plan=compileTimeline(result.events,x=>x,false),impact=plan.cues.find(c=>c.kind==='spellImpact')!;
  expect(plan.cues.find(c=>c.event.type==='UNIT_DEFEATED')!.at).toBeGreaterThan(impact.at);
  const fx=new ElementEffects(new Container(),new Container(),geometry,new Container());await fx.catalog.prepare(catalogEventRecipes(result.events,x=>DEFAULT_CONTENT.cards[x]));
  const number=vi.spyOn(fx,'number');const host:DirectorHost={redraw:()=>{},unit:()=>undefined,obstacle:()=>undefined,walk:()=>{},busy:()=>{},impulse:()=>{},handPulse:()=>{},card:x=>DEFAULT_CONTENT.cards[x],turnBanner:()=>{}};
  const d=new VfxDirector(fx,host);d.sync(before);d.enqueue(result.events,engine.state,false);d.tick(100);d.clear();d.tick(2000);
  expect(number).not.toHaveBeenCalled();expect(fx.catalog.snapshot['thunder-premium']!.active).toBe(0);
  d.sync(engine.state);d.tick(1000);expect(number).not.toHaveBeenCalled();d.destroy();
 });

});
