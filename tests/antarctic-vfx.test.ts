import {it,expect} from 'vitest';
import {LegendaryStatusView} from '../src/presentation/pixi/LegendaryStatusView';
import {makeEngine,unit,ctxFor} from './helpers';
import {applyStatus} from '../src/game/domain/statuses/status-rules';
import {ANTARCTIC_CARDS} from '../src/game/data/antarctic-magic';
import {FINAL_CARD_ART} from '../src/presentation/assets/paintedAssets';
import {existsSync} from 'node:fs';
it('new persistent VFX allocate once per encountered status, reuse geometry and cleanly fade/destroy',()=>{
 const e=makeEngine(),u=unit(e,e.heroId),fx=new LegendaryStatusView();
 for(const id of ['ABSOLUTE_ZERO','FROZEN','FROST_MANTLE','GLACIAL_REFLECTION','ARCANE_SKATING'] as const)applyStatus(ctxFor(e),u,id,3,u.id);
 fx.update(u);fx.advance(16,0,false);expect(fx.children.filter(c=>c.visible)).toHaveLength(5);
 const geometry=fx.children.flatMap(c=>'children' in c?c.children:[]);
 expect(geometry).toHaveLength(56); // Original2 +5 new lazily-created layers; 6 particles/layer.
 for(let i=0;i<600;i++){fx.update(JSON.parse(JSON.stringify(u)));fx.advance(16,i*16,i>300);}
 expect(fx.children.flatMap(c=>'children' in c?c.children:[])).toEqual(geometry);
 u.statuses=[];fx.update(u);fx.advance(400,10000,false);expect(fx.children.some(c=>c.visible)).toBe(false);
 fx.destroy({children:true});expect(fx.destroyed).toBe(true);
});
it('all new cards have distinct generated illustration art, never reuse another card illustration',()=>{
 const paths=ANTARCTIC_CARDS.map(c=>FINAL_CARD_ART[c.id]);expect(new Set(paths).size).toBe(16);
 for(const path of paths){expect(path).toContain('/antarctic-cards-horizontal/');expect(existsSync('public'+path)).toBe(true);}
});

it('ice sliding follows orthogonal corners without walking animation or teleporting',async()=>{
 const {GridWalk}=await import('../src/presentation/pixi/GridWalk');
 const pos={x:0,y:0,set(x:number,y:number){this.x=x;this.y=y;}},motions:string[]=[];
 const view={root:{position:pos},faceHorizontal:()=>{},playAnimation:(motion:import('../src/presentation/pixi/CharacterAnimator').CharacterMotion)=>{motions.push(motion);return true;}};
 const walk=new GridWalk(p=>p);walk.enqueue('mage',view,{from:{x:0,y:0},to:{x:1,y:1},path:[{x:1,y:0},{x:1,y:1}],mode:'SLIDE'},false);
 walk.tick(300);expect(pos.x).toBe(1);expect(pos.y).toBe(0);
 walk.tick(300);expect(pos.x).toBe(1);expect(pos.y).toBe(1);expect(motions).not.toContain('walk');expect(walk.has('mage')).toBe(false);
});
