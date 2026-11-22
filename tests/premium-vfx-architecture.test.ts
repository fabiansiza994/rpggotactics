import {describe,it,expect} from 'vitest';
import {Container,Texture} from 'pixi.js';
import {AvalancheEffects} from '../src/presentation/vfx/AvalancheEffects';
import {ShieldBarrierView} from '../src/presentation/pixi/ShieldBarrierView';
class ReadyMage extends AvalancheEffects {
 get requested(){return true;}
 loadFixture(){this.frames=Array(16).fill(Texture.EMPTY);this.beginBatch();}
}
describe('Premium visual resource lifecycle',()=>{
 it('snow front stays in the confirmed footprint, reuses bounded sprites and drains',()=>{
  const actors=new Container(),ground=new Container(),fx=new ReadyMage(actors,ground,{
   center:p=>({x:p.x*96,y:p.y*48}),footprint:()=>({w:96,h:48}),quad:()=>[],depth:p=>p.y,
  });fx.loadFixture();
  const tiles=[{x:2,y:2},{x:3,y:2},{x:4,y:2}];
  fx.play({x:1,y:2},tiles,900);
  expect(fx.snapshot.active).toBeGreaterThan(0);
  const allocated=fx.snapshot.allocated;
  fx.tick(300);const first=actors.children.map(s=>[s.x,s.y]);fx.tick(200);
  expect(actors.children.map(s=>[s.x,s.y])).not.toEqual(first);
  for(const s of actors.children)expect(s.x).toBeGreaterThan(96);
  fx.tick(1000);expect(fx.snapshot.active).toBe(0);
  fx.play({x:1,y:2},tiles,900);expect(fx.snapshot.allocated).toBe(allocated);
  fx.clear();expect(actors.children.length+ground.children.length).toBe(0);fx.destroy();
 });
 it('rejects empty footprints without inventing an avalanche origin',()=>{
  const a=new Container(),g=new Container(),fx=new ReadyMage(a,g,{
   center:p=>p,footprint:()=>({w:96,h:48}),quad:()=>[],depth:p=>p.y,
  });fx.loadFixture();fx.play({x:0,y:0},[],800);expect(fx.snapshot.active).toBe(0);fx.destroy();
 });
 for(const material of ['ENERGY','ICE']as const)it(`${material}: repeated snapshots never duplicate layers, event-driven exit cleans`,()=>{
  const v=new ShieldBarrierView(40,100);v.sync(6,material);
  const count=v.front.children.length+v.back.children.length;
  for(let i=0;i<100;i++){v.sync(6,material);v.advance(16,false);}
  expect(v.front.children.length+v.back.children.length).toBe(count);
  v.impact(-1);v.sync(3,material);v.advance(100,false);expect(v.front.visible).toBe(true);
  v.sync(0,material);v.shatter();v.advance(650,false);expect(v.front.visible).toBe(false);
  v.sync(6,material);v.sync(0,material);v.expire();v.advance(400,true);expect(v.back.visible).toBe(false);v.destroy();
 });
});
