import {describe,it,expect,vi} from 'vitest';
import {MeshPlane,Texture,TextureSource} from 'pixi.js';
import {PaintedFigure} from '../src/presentation/pixi/unitArt';
import {figureOverlayWeights} from '../src/presentation/pixi/figureOverlayWeights';
import {battleRasterOptions} from '../src/presentation/pixi/battleRasterOptions';

describe('battle raster quality contract',()=>{
 it('retains source density and the 2x ceiling, with MSAA only at lower densities',()=>{
  for(const density of [1,1.25,1.5,1.75,2,3,4]){
   const options=battleRasterOptions(density);
   expect(options.resolution).toBe(Math.min(2,density));
   if(density<2)expect(options.antialias).toBe(true);
   else expect(options.antialias).toBe(false);
  }
 });
 it.each([0,-1,NaN,Infinity])('uses the safe 1x fallback for invalid density %s',d=>{
  expect(battleRasterOptions(d)).toEqual({resolution:1,antialias:true});
 });
});

describe('painted figure resource ownership',()=>{
 it('releases its mesh geometry/buffers on teardown, preserves shared art and a live clone',()=>{
  const art=new Texture({source:new TextureSource({width:128,height:256})});
  const figure=new PaintedFigure(art,'mage');figure.breathe(.3,true);
  const mesh=figure.children.find(c=>c instanceof MeshPlane) as MeshPlane;
  const geometry=mesh.geometry,buffers=[...geometry.buffers],destroyed=vi.fn();geometry.on('destroy',destroyed);
  const clone=figure.clone(),other=clone.children.find(c=>c instanceof MeshPlane) as MeshPlane;
  expect(other.geometry).not.toBe(geometry);
  figure.destroy({children:true});
  expect(destroyed).toHaveBeenCalledTimes(1);
  expect(buffers.every(b=>b.destroyed)).toBe(true);
  expect(art.destroyed).toBe(false);expect(other.geometry.buffers.length).toBeGreaterThan(0);
  clone.breathe(.8,true);clone.destroy({children:true});expect(art.destroyed).toBe(false);art.destroy(true);
 });
});

describe('cached figure overlay weights',()=>{
 it('preserves the original full-precision spatial deformation across dimensions',()=>{
  for(const[width,height]of [[128,256],[256,256],[511,333]]){
   const base=new Float32Array(Array.from({length:1089*2},(_,i)=>i%2?((i*71)%height!):((i*37)%width!)));
   const original=Array.from(base),weights=figureOverlayWeights(base,width!,height!,true);
   for(let i=0;i<base.length;i+=2){const x=base[i]!/width!,y=base[i+1]!/height!;
    expect(weights.head[i/2]).toBe(Math.max(0,1-Math.hypot((x-.5)/.2,(y-.25)/.18)));
    expect(weights.arm![i/2]).toBe(Math.max(0,1-Math.hypot((x-.36)/.15,(y-.34)/.12)));
   }
   expect(Array.from(base)).toEqual(original);
   expect(figureOverlayWeights(base,width!,height!,false).arm).toBeNull();
  }
 });
});
