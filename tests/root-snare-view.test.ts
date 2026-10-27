import { expect, it } from 'vitest';
import { Texture } from 'pixi.js';
import { RootSnareView } from '../src/presentation/pixi/RootSnareView';
it('sprouts, persists, retracts and cancels a pending removal without stale roots',()=>{
 const v=new RootSnareView(Texture.WHITE);
 expect(v.visible).toBe(false);v.setActive(true);v.advance(100,false);
 expect(v.alpha).toBe(.5);v.advance(100,false);expect(v.alpha).toBe(1);
 v.advance(5000,false);expect(v.visible).toBe(true);
 v.setActive(false);v.advance(70,false);expect(v.alpha).toBe(.5);
 v.setActive(true);v.advance(100,false);expect(v.alpha).toBe(1);
 v.setActive(false);v.advance(140,false);expect(v.visible).toBe(false);
 v.destroy({children:true});
});
it('reduced motion shows the root immediately and clears it without animated growth',()=>{
 const v=new RootSnareView(Texture.WHITE);v.setActive(true);v.advance(1,true);
 expect(v.visible).toBe(true);expect(v.scale.x).toBe(1);
 v.setActive(false);v.advance(1,true);expect(v.visible).toBe(false);v.destroy({children:true});
});
