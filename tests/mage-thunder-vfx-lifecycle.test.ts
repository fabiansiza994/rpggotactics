import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture, TextureSource } from 'pixi.js';
import { MAGE_THUNDER_EXPANSION } from '../src/game/data/mage-thunder-expansion';
import { CatalogEffects } from '../src/presentation/vfx/CatalogEffects';
import { cardRecipe, catalogPilot } from '../src/presentation/vfx/catalogRecipes';
import { loadSharedTexture } from '../src/presentation/pixi/paintedTextures';
vi.mock('../src/presentation/pixi/paintedTextures',()=>({loadSharedTexture:vi.fn()}));
beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('location',{hostname:'localhost'});vi.stubGlobal('matchMedia',()=>({matches:false}));catalogPilot.enabled=true;
 vi.mocked(loadSharedTexture).mockResolvedValue(new Texture({source:new TextureSource({width:1024,height:1024})}));
});
const geometry={center:(p:{x:number;y:number})=>({x:p.x*96,y:p.y*48}),footprint:()=>({w:96,h:48}),quad:()=>[],depth:(p:{y:number})=>p.y};
describe.each([false,true])('Thunder pools, reduced motion %s',reduced=>{
 it.each(MAGE_THUNDER_EXPANSION)('$id recycles through repeated actions, expires and cancels on scene exit',async card=>{
  const actors=new Container(),ground=new Container(),fx=new CatalogEffects(actors,ground,geometry),recipe=cardRecipe(card,[]);
  fx.reduced=reduced;fx.beginBatch();await fx.prepare([recipe]);expect(fx.handles(recipe)).toBe(true);
  for(let i=0;i<20;i++){
   fx.charge(recipe,{x:1,y:2},260,undefined,{x:3,y:2},[{x:3,y:2},{x:3,y:1},{x:3,y:3}]);
   fx.projectile(recipe,{x:1,y:2},{x:3,y:2},240);fx.impact(recipe,{x:1,y:2},{x:3,y:2},[{x:3,y:2},{x:3,y:1},{x:3,y:3}]);
   fx.thunderTarget(recipe,{x:3,y:2});fx.tick(5000);
   expect(fx.snapshot['thunder-premium'].active).toBe(0);expect(actors.children).toHaveLength(0);expect(ground.children).toHaveLength(0);
  }
  expect(fx.snapshot['thunder-premium'].allocated).toBeLessThanOrEqual(48);
  fx.charge(recipe,{x:1,y:2},260);fx.clear();expect(actors.children).toHaveLength(0);expect(ground.children).toHaveLength(0);fx.destroy();
 });
});
it('failed illustrated atlas retains the original rendering path',async()=>{
 vi.mocked(loadSharedTexture).mockRejectedValue(new Error('offline QA'));
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const fx=new CatalogEffects(new Container(),new Container(),geometry),recipe=cardRecipe(MAGE_THUNDER_EXPANSION[0]!,[]);
 fx.beginBatch();await fx.prepare([recipe]);expect(fx.handles(recipe)).toBe(false);fx.destroy();warn.mockRestore();
});
