import {Container,Sprite,type Texture} from 'pixi.js';
import {loadSharedTexture} from './paintedTextures';
import type {GridProjection} from './GridProjection';
import type {BoardViewModel} from './viewModel';
/** Painted core complements Phase6 live arcs; shared scene clock/cache, no private ticker. */
export class StormOrbView{
 private texture:Texture|null=null;private loading=false;private disposed=false;
 private readonly sprites=new Map<string,Sprite>();
 constructor(private readonly root:Container){}
 sync(vm:BoardViewModel,proj:GridProjection,time:number,reduced:boolean){
  const glyphs=(vm.state.glyphs??[]).filter(g=>g.glyphId==='thunder_orb'&&g.tiles.length);
  if(glyphs.length&&!this.texture&&!this.loading){this.loading=true;void loadSharedTexture('/art/vfx/storm-orb/core.png').then(t=>{if(!this.disposed)this.texture=t;}).catch(()=>console.warn('Storm orb painted core unavailable; live arcs retained.'));}
  const active=new Set<string>();
  for(const glyph of glyphs){const key=glyph.id;active.add(key);if(!this.texture)continue;
   let s=this.sprites.get(key);if(!s){s=new Sprite(this.texture);s.anchor.set(.5);s.eventMode='none';s.blendMode='add';this.root.addChild(s);this.sprites.set(key,s);}
   const mean=glyph.tiles.reduce((a,p)=>({x:a.x+p.x,y:a.y+p.y}),{x:0,y:0});
   const at=glyph.origin??{x:Math.round(mean.x/glyph.tiles.length),y:Math.round(mean.y/glyph.tiles.length)};
   const c=proj.getTileCenter(at),size=Math.max(36,Math.min(106,proj.footprint(at).w*.88));
   const pulse=reduced?0:Math.sin(time/270)*.035;
   s.position.set(c.x,c.y-38);s.width=s.height=size*(1+pulse);s.rotation=reduced?0:Math.sin(time/730)*.09;s.alpha=reduced ? .72 : .8+Math.sin(time/160)*.12;
  }
  for(const [key,s]of this.sprites)if(!active.has(key)){s.destroy();this.sprites.delete(key);}
 }
 get snapshot(){return{active:this.sprites.size,ready:!!this.texture,disposed:this.disposed};}
 destroy(){this.disposed=true;for(const s of this.sprites.values())s.destroy();this.sprites.clear();this.texture=null;}
}
