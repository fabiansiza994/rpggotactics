import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture, TextureSource, Sprite } from 'pixi.js';
import { DEFAULT_CONTENT, GameEngine, createProfile } from '../src/game';
import { applyDuel, createDuel, duelView, validateLoadout } from '../src/game/pvp/duel';
import { makeEngine, mutable, p, setHand } from './helpers';
import { CatalogEffects } from '../src/presentation/vfx/CatalogEffects';
import { ParalyzingPulseEffects } from '../src/presentation/vfx/ParalyzingPulseEffects';
import { PULSE_TIMING, pulseFootprint } from '../src/presentation/vfx/paralyzingPulseRecipe';
import { catalogBatch, catalogEventRecipes, catalogPilot } from '../src/presentation/vfx/catalogRecipes';
import { compileTimeline } from '../src/presentation/vfx/spellTimeline';
import { resolutionTiming } from '../src/presentation/vfx/resolutionProfiles';
import { ElementEffects, type FxGeometry } from '../src/presentation/vfx/ElementEffects';
import { VfxDirector, type DirectorHost } from '../src/presentation/vfx/VfxDirector';
import { loadSharedTexture } from '../src/presentation/pixi/paintedTextures';
vi.mock('../src/presentation/pixi/paintedTextures',()=>({loadSharedTexture:vi.fn()}));
const geometry:FxGeometry={center:q=>({x:q.x*96,y:q.y*48}),footprint:()=>({w:96,h:48}),quad:q=>[{x:q.x*96-48,y:q.y*48-24},{x:q.x*96+48,y:q.y*48-24},{x:q.x*96+48,y:q.y*48+24},{x:q.x*96-48,y:q.y*48+24}],depth:q=>q.y};
beforeEach(()=>{vi.stubGlobal('location',{hostname:'localhost'});vi.stubGlobal('matchMedia',()=>({matches:false}));catalogPilot.enabled=true;vi.mocked(loadSharedTexture).mockReset().mockResolvedValue(new Texture({source:new TextureSource({width:1024,height:1024})}));});
function fixture(multiple=false,shield=false){
 const positions=multiple?[p(3,2),p(1,2),p(2,1),p(2,3),p(3,3)]:[p(3,2),p(3,3)];
 const engine=makeEngine({hero:{heroId:'mage',pos:p(2,2)},enemies:positions.map((pos,i)=>({id:'pulse'+i,enemyId:'orc_warrior',pos}))});
 mutable(engine).player.energy=10;setHand(engine,['paralyzing_pulse']);if(shield)for(const u of mutable(engine).units.filter(u=>u.faction==='ENEMY'))u.shield=10;
 const before=structuredClone(engine.state),command={type:'PLAY_CARD' as const,cardUid:engine.state.player.hand[0]!.uid,target:null};const r=engine.dispatch(command);if(!r.ok)throw Error(r.error);
 return {before,after:engine.state,events:r.events,command,scenario:engine.scenario};
}
describe('Pulso Paralizante premium — scope, mechanics and authoritative presentation',()=>{
 it('preserves its real SLOWED rule, price and four-tile cross',()=>{
  const card=DEFAULT_CONTENT.cards.paralyzing_pulse!;expect(card.cost).toBe(2);expect(card.targeting).toEqual({type:'SELF',area:{shape:'CROSS',radius:1,includeCenter:false}});
  expect(card.effects).toContainEqual({type:'APPLY_STATUS',status:'SLOWED',duration:1,to:'ENEMIES'});
 });
 it.each([false,true])('one/multiple targets %s: no damage or status reaches a diagonal target',multiple=>{
  const f=fixture(multiple),hits=f.events.filter(e=>e.type==='UNIT_DAMAGED'),statuses=f.events.filter(e=>e.type==='STATUS_APPLIED');
  expect(hits).toHaveLength(multiple?4:1);expect(statuses).toHaveLength(multiple?4:1);
  for(const e of hits)expect(e).toMatchObject({hpLost:1});
  for(const e of statuses)expect(e).toMatchObject({status:'SLOWED',turnsLeft:1});
  const outside=f.after.units.find(u=>u.pos.x===3&&u.pos.y===3)!;expect(outside.hp).toBe(outside.maxHp);expect(outside.statuses).toEqual([]);
  const replay=GameEngine.fromSnapshot(f.before,DEFAULT_CONTENT,f.scenario);expect(replay.dispatch(f.command)).toMatchObject({ok:true,events:f.events});expect(replay.state).toEqual(f.after);
 });
 it.each([false,true])('normal/reduced %s: the wave arrives exactly with HP/status cues',reduced=>{
  const f=fixture(true),plan=compileTimeline(f.events,x=>x,reduced),wave=plan.cues.find(c=>c.kind==='projectile')!,impact=plan.cues.find(c=>c.kind==='spellImpact')!;
  expect(wave.duration).toBeGreaterThan(0);expect(impact.at).toBe(wave.at+wave.duration);
  for(const cue of plan.cues.filter(c=>['UNIT_DAMAGED','STATUS_APPLIED'].includes(c.event.type)))expect(cue.at).toBe(impact.at);
  expect(resolutionTiming('paralyzing_pulse',false).total).toBe(1100);
 });
 it('does not change Tempest, Discharge or other card timing budgets',()=>{
  expect(resolutionTiming('tempest_judgment',false)).toMatchObject({cast:520,travel:120,aftermath:560,read:160,total:1360});
  expect(resolutionTiming('thunder_discharge',false)).toMatchObject({cast:240,travel:180,aftermath:360,read:180,total:960});
  expect(resolutionTiming('chain_lightning',false).travel).toBe(260);
 });
 it('derives projected radius from real affected tile centers and deduplicates the footprint',()=>{
  const surface=pulseFootprint(p(2,2),[p(3,2),p(1,2),p(2,1),p(2,3),p(3,2)],geometry);
  expect(surface.tiles).toHaveLength(4);expect(surface.center).toEqual({x:192,y:96});expect(surface.rx).toBe(96);expect(surface.ry).toBe(48);
 });
 it('renders an expanding masked ring and frees the mask, sprites and labels after repeated casts',async()=>{
  const actors=new Container(),ground=new Container(),fx=new ParalyzingPulseEffects(actors,ground,geometry),tiles=[p(3,2),p(1,2),p(2,1),p(2,3)];
  await fx.prepare();fx.beginBatch();
  fx.charge(p(2,2),tiles,PULSE_TIMING.cast);fx.tick(280);fx.release(p(2,2),300);fx.tick(100);
  const ring=ground.children.find(x=>x instanceof Sprite) as Sprite;expect(ring.mask).toBeTruthy();const firstWidth=ring.width;
  fx.tick(150);expect(ring.width).toBeGreaterThan(firstWidth);expect(fx.snapshot.maskActive).toBe(true);
  fx.clear();expect(actors.children.length+ground.children.length).toBe(0);
  for(let n=0;n<30;n++){
   fx.charge(p(2,2),tiles,280);fx.tick(280);fx.release(p(2,2),300);fx.tick(300);fx.impact(p(2,2),tiles);
   for(const tile of tiles){fx.target(tile);fx.status(tile,1);}fx.tick(1200);
   expect(fx.snapshot.active).toBe(0);expect(fx.snapshot.labels).toBe(0);expect(fx.snapshot.maskActive).toBe(false);expect(actors.children.length+ground.children.length).toBe(0);
  }
  expect(fx.snapshot.allocated).toBeLessThanOrEqual(32);fx.destroy();
 });
 it('reduced motion uses one ring, fewer sprites and the shared 512 atlas on coarse pointers',async()=>{
  vi.stubGlobal('matchMedia',()=>({matches:true}));const fx=new ParalyzingPulseEffects(new Container(),new Container(),geometry);await fx.prepare();fx.beginBatch();fx.reduced=true;
  expect(loadSharedTexture).toHaveBeenCalledWith('/art/vfx/thunder-premium/thunder-premium-v1-512.webp');fx.charge(p(2,2),[p(3,2)],80);fx.tick(80);fx.release(p(2,2),60);expect(fx.snapshot.active).toBe(1);fx.clear();expect(fx.snapshot.maskActive).toBe(false);fx.destroy();
 });
 it('catalog loads only the shared thunder atlas for this recipe and retains original fallback on failure',async()=>{
  const f=fixture(),recipes=catalogEventRecipes(f.events,x=>DEFAULT_CONTENT.cards[x]),fx=new CatalogEffects(new Container(),new Container(),geometry);
  vi.mocked(loadSharedTexture).mockRejectedValueOnce(Error('QA offline'));await fx.prepare(recipes);fx.beginBatch();const recipe=catalogBatch(f.events,x=>DEFAULT_CONTENT.cards[x]).get(f.events.find(e=>e.type==='CARD_PLAYED')!)!;
  expect(fx.handles(recipe)).toBe(false);await fx.prepare(recipes);expect(fx.handles(recipe)).toBe(true);expect(fx.snapshot['mage-elements']!.ready).toBe(false);expect(fx.snapshot['pact-summon']!.ready).toBe(false);fx.destroy();
 });
 it('director emits four reactions and real SLOWED labels at contact; cancellation prevents late hits',async()=>{
  const f=fixture(true),fx=new ElementEffects(new Container(),new Container(),geometry,new Container());await fx.catalog.prepare(catalogEventRecipes(f.events,x=>DEFAULT_CONTENT.cards[x]));
  const numbers=vi.spyOn(fx,'number'),reaction=vi.spyOn(fx,'unitReaction'),labels=vi.spyOn(fx.catalog,'pulseStatus');let shown=f.before;
  const host:DirectorHost={redraw:s=>{shown=structuredClone(s);},unit:()=>undefined,obstacle:()=>undefined,walk:()=>{},busy:()=>{},impulse:()=>{},handPulse:()=>{},card:x=>DEFAULT_CONTENT.cards[x],turnBanner:()=>{}};
  const d=new VfxDirector(fx,host);d.sync(f.before);d.enqueue(f.events,f.after,false);d.tick(579);expect(numbers).not.toHaveBeenCalled();expect(shown.units.map(u=>u.hp)).toEqual(f.before.units.map(u=>u.hp));
  d.tick(1);expect(numbers).toHaveBeenCalledTimes(4);expect(reaction).toHaveBeenCalledTimes(4);expect(labels).toHaveBeenCalledTimes(4);d.tick(1600);expect(shown.units.map(u=>u.hp)).toEqual(f.after.units.map(u=>u.hp));expect(fx.catalog.snapshot['paralyzing-pulse'].active).toBe(0);
  d.clear();d.sync(f.before);numbers.mockClear();d.enqueue(f.events,f.after,false);d.tick(400);d.clear();d.tick(2000);expect(numbers).not.toHaveBeenCalled();expect(fx.catalog.snapshot['paralyzing-pulse']).toMatchObject({active:0,labels:0,maskActive:false});d.destroy();
 });
 it('blocking still applies only the actual SLOWED outcome without invented HP loss',()=>{
  const f=fixture(false,true);expect(f.events.find(e=>e.type==='UNIT_DAMAGED')).toMatchObject({hpLost:0,shieldAbsorbed:1});
  expect(f.events.find(e=>e.type==='STATUS_APPLIED')).toMatchObject({status:'SLOWED',turnsLeft:1});
 });
 it('Ranked/Casual share the same authoritative resolution and both views preserve the real status',()=>{
  const load=validateLoadout(createProfile(DEFAULT_CONTENT),'mage');
  for(const ranked of [false,true]){
   const state=createDuel([load,load],77,'DUEL','classic',DEFAULT_CONTENT,ranked);const owner=state.units.find(u=>u.id===state.player.heroId)!,other=state.units.find(u=>u.kind==='HERO'&&u.id!==owner.id)!;owner.pos=p(2,2);other.pos=p(3,2);state.player.energy=10;state.player.hand=[{uid:'pulse',cardId:'paralyzing_pulse'}];
   const command={type:'PLAY_CARD' as const,cardUid:'pulse',target:null},result=applyDuel(state,command);expect(result).toEqual(applyDuel(JSON.parse(JSON.stringify(state)),command));
   const views=[duelView(result.state,0),duelView(result.state,1)];expect(views[0]!.units.map(u=>({id:u.id,hp:u.hp,statuses:u.statuses}))).toEqual(views[1]!.units.map(u=>({id:u.id,hp:u.hp,statuses:u.statuses})));
   expect(result.state.units.find(u=>u.id===other.id)!.statuses).toContainEqual(expect.objectContaining({id:'SLOWED',turnsLeft:1}));
  }
 });
});
