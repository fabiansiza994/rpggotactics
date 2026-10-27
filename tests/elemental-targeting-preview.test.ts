import { beforeEach, expect, it, vi } from 'vitest';
import { Texture, TextureSource } from 'pixi.js';
import { ElementalTargetingPreview } from '../src/presentation/vfx/ElementalTargetingPreview';
import type { BoardViewModel } from '../src/presentation/pixi/viewModel';
import type { GridProjection } from '../src/presentation/pixi/GridProjection';
import { loadSharedTexture } from '../src/presentation/pixi/paintedTextures';
import { makeEngine, setHand } from './helpers';
vi.mock('../src/presentation/pixi/paintedTextures', () => ({loadSharedTexture:vi.fn()}));
beforeEach(()=>vi.mocked(loadSharedTexture).mockResolvedValue(new Texture({source:new TextureSource({width:1024,height:1024})})));
const geometry={center:()=>({x:0,y:0}),footprint:()=>({w:90,h:50}),quad:()=>[],depth:()=>0};
const projection={getTileCenter:(p:{x:number;y:number})=>p,footprint:geometry.footprint,getInsetPolygon:()=>[{x:0,y:0},{x:90,y:0},{x:90,y:50},{x:0,y:50}]} as unknown as GridProjection;
const model=(valid=true)=>({interactive:true,preview:{valid,element:'FIRE',tiles:[{x:1,y:2},{x:2,y:2}],impact:{x:2,y:2},predicted:[]}} as unknown as BoardViewModel);
it('reuses sprites through repeated aims, fades cancellation and rejects invalid previews',async()=>{
 const fx=new ElementalTargetingPreview(geometry);fx.sync(model(),projection);await fx.prepare();fx.tick(200);
 expect(fx.snapshot.active).toBe(2);const count=fx.snapshot.allocated;
 for(let i=0;i<50;i++){fx.sync(model(),projection);fx.tick(16);}
 expect(fx.snapshot.allocated).toBe(count);
 fx.sync(model(false),projection);fx.tick(200);expect(fx.snapshot.active).toBe(0);
 fx.sync(model(),projection);fx.tick(200);expect(fx.snapshot.allocated).toBe(count);
 fx.reset();expect(fx.snapshot.active).toBe(0);fx.destroy();
});
it('does not resurrect a cancelled preview after asynchronous loading',async()=>{
 const fx=new ElementalTargetingPreview(geometry);fx.sync(model(),projection);fx.reset();await fx.prepare();fx.tick(200);expect(fx.snapshot.active).toBe(0);fx.destroy();
});
it('Fireball footprint stops at the intermediate enemy without changing engine state',()=>{
 const e=makeEngine({enemies:[{id:'near',enemyId:'orc_warrior',pos:{x:2,y:2}},{id:'far',enemyId:'orc_warrior',pos:{x:4,y:2}}]});
 const [uid]=setHand(e,['fireball']);const before=JSON.stringify(e.state);
 const preview=e.previewCard(uid!,{x:2,y:2});expect(preview.valid).toBe(true);
 expect(preview.resolved?.impact).toEqual({x:2,y:2});
 expect(preview.resolved?.affectedTiles.every(p=>p.x<=2)).toBe(true);
 expect(JSON.stringify(e.state)).toBe(before);
});
for(const element of ['ICE','ARCANE','FORCE','SHIELD','TELEPORT','NEUTRAL'] as const) it(`${element}: exact footprint, reduced motion and scene cleanup`,async()=>{
 const fx=new ElementalTargetingPreview(geometry),vm=model();vm.preview!.element=element;fx.reduced=true;
 fx.sync(vm,projection);await fx.prepare();fx.tick(200);expect(fx.snapshot.active).toBe(2);
 const allocated=fx.snapshot.allocated;fx.tick(5000);expect(fx.snapshot.allocated).toBe(allocated);
 vm.interactive=false;fx.sync(vm,projection);fx.tick(200);expect(fx.snapshot.active).toBe(0);fx.destroy();
});
it('invalid blocked line remains invalid and never invents cells beyond collision',()=>{
 const e=makeEngine({layout:['.......','.......','..#....','.......','.......']});const [uid]=setHand(e,['fireball']);
 const result=e.previewCard(uid!,{x:4,y:2});
 expect(result.valid).toBe(false);
});
it('Frost Nova highlights exactly its eight real neighbors, excluding caster',()=>{
 const e=makeEngine({hero:{heroId:'mage',pos:{x:3,y:2}}});const [uid]=setHand(e,['frost_nova']);
 const p=e.previewCard(uid!,null);expect(p.valid).toBe(true);
 expect(p.resolved!.affectedTiles).toHaveLength(8);
 expect(p.resolved!.affectedTiles).not.toContainEqual({x:3,y:2});
 for(const cell of p.resolved!.affectedTiles)expect(Math.max(Math.abs(cell.x-3),Math.abs(cell.y-2))).toBe(1);
});
it('Bastion highlights only the adjacent target, not an invented cross',()=>{
 const e=makeEngine({hero:{heroId:'warrior',pos:{x:2,y:2}},enemies:[{id:'near',enemyId:'orc_warrior',pos:{x:3,y:2}}]});const [uid]=setHand(e,['bastion_blow']);
 const p=e.previewCard(uid!,{x:3,y:2});expect(p.valid).toBe(true);expect(p.resolved!.affectedTiles).toEqual([{x:3,y:2}]);
 const result=e.dispatch({type:'PLAY_CARD',cardUid:uid!,target:{x:3,y:2}});expect(result.ok).toBe(true);
});
