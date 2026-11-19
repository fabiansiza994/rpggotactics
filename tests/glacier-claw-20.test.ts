import {it,expect} from 'vitest';
import {Texture,Sprite} from 'pixi.js';
import {GlacierClawView} from '../src/presentation/pixi/GlacierClawView';
import {clawPose} from '../src/presentation/pixi/glacierClawMotion';
import {CLAW_PARTS} from '../src/presentation/pixi/glacierClawTextures';
const textures={palm:Texture.EMPTY,fingers:Array.from({length:5},(_,i)=>Array<Texture>(i===0?2:3).fill(Texture.EMPTY))};
it('six parts and exactly five digits with anatomical thumb/two and other/three joints',()=>{expect(CLAW_PARTS.map(x=>x.segments)).toEqual([1,2,3,3,3,3]);const v=new GlacierClawView(textures);v.sync(true,false);v.advance(0,false);expect(v.snapshot).toMatchObject({phase:'hold',textured:true,fingers:5,procedural:false,visible:true});v.destroy();});
it('invocation→rise→grip→hold continuous phases with no perpetual entry replay',()=>{
 expect(clawPose('enter',150)).toMatchObject({rise:0,close:0});expect(clawPose('enter',440).rise).toBeCloseTo(.5);expect(clawPose('enter',780).close).toBeCloseTo(.5);expect(clawPose('enter',940).phase).toBe('hold');
 const v=new GlacierClawView(textures);v.enter();v.advance(500,false);v.sync(true,true);v.advance(450,false);expect(v.snapshot.phase).toBe('hold');const nodes=[...v.back.children,...v.front.children];for(let i=0;i<400;i++){v.sync(true,true);v.advance(16,false);}expect([...v.back.children,...v.front.children]).toEqual(nodes);v.destroy();
});
it('reconnect builds hold directly and repeated removal does not restart release',()=>{const v=new GlacierClawView(textures);v.sync(true,false);v.advance(0,false);expect(v.snapshot.phase).toBe('hold');v.sync(false,false);v.advance(200,false);v.sync(false,false);v.advance(180,false);expect(v.snapshot).toMatchObject({phase:'none',visible:false});v.destroy();});
it('fire is faster and reduced motion settles/cleans without hiding status',()=>{const v=new GlacierClawView(textures);v.enter();v.advance(0,true);expect(v.snapshot.phase).toBe('hold');v.release(true);v.advance(321,false);expect(v.snapshot.visible).toBe(false);v.enter();v.advance(0,true);v.release();v.advance(0,true);expect(v.snapshot.visible).toBe(false);v.destroy();expect(v.front.destroyed).toBe(true);});
it('missing art never invents a vector hand or throws',()=>{const v=new GlacierClawView(undefined);v.sync(true,false);v.advance(100,false);expect(v.snapshot.textured).toBe(false);expect(v.snapshot.fingers).toBe(0);v.destroy();});

it('proximal phalanges stay behind the unit and distal phalanges grip in front without duplicate sprites',()=>{const v=new GlacierClawView(textures);v.enter();v.advance(950,false);const count=(root:import('pixi.js').Container):number=>root.children.reduce((n,c)=>n+Number(c instanceof Sprite)+('children' in c?count(c as import('pixi.js').Container):0),0);expect(count(v.back)).toBe(5);expect(count(v.front)).toBe(10);v.destroy();});

it('hand scale follows real small/medium/large render heights without changing units',async()=>{const{clawScaleForUnit}=await import('../src/presentation/pixi/glacierClawMotion');const{characterSpec,visualHeight,TILE}=await import('../src/presentation/pixi/renderContract');const sizes=['chicken','mage','temple_guardian'].map(id=>visualHeight(characterSpec(id),TILE));const scales=sizes.map(h=>clawScaleForUnit(h));expect(scales[0]).toBeLessThan(scales[1]!);expect(scales[1]).toBeLessThan(scales[2]!);for(let i=0;i<3;i++)expect(112*scales[i]!).toBeCloseTo(sizes[i]!,0);expect(clawScaleForUnit(sizes[2]!,1.2)).toBeGreaterThan(scales[2]!);});
