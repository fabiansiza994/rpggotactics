import type {GameState} from '../../game/domain/state';
import {Container,Graphics,Text} from 'pixi.js';
import type {Pos} from '../../game';
import type {AvalancheEffects} from './AvalancheEffects';
import type {MageEffects} from './MageEffects';
import type {FxGeometry} from './ElementEffects';
type Motion={g:Graphics;age:number;duration:number;step:(t:number,g:Graphics)=>void};
/** Finite faceted ice geometry on the existing scene clock; no filters or per-frame textures. */
export class IceSpellEffects {
 reduced=false;
 private hearts=new Map<string,{g:Graphics;shadow:Graphics;phase:number;at:Pos;targetId?:string;joining?:Graphics;joinedAt?:number}>();
 private clock=0;
 private skyMinY=-Infinity;
 private followUnit?: (id:string)=>{x:number;y:number;height?:number}|undefined;
 private fallingHearts=new Set<string>();
 /** Reconstructed from public snapshots, without replaying cast/reveal on reconnect. */
 syncHearts(state:Readonly<GameState>,followUnit?:(id:string)=>{x:number;y:number;height?:number}|undefined,skyMinY=-Infinity):void{
  this.skyMinY=skyMinY;
  this.followUnit=followUnit;
  const active=state.outcome?[]:(state.glyphs??[]).filter(g=>g.winterHeart&&!this.fallingHearts.has(g.id));
  const ids=new Set(active.map(g=>g.id));
  for(const [id,view] of this.hearts)if(!ids.has(id)){view.g.destroy({children:true,context:true});view.shadow.destroy({context:true});this.hearts.delete(id);}
  for(const glyph of active){
   const heart=glyph.winterHeart!,target=state.units.find(u=>u.id===heart.targetId),at=target?.pos??heart.lastKnown;
   let view=this.hearts.get(glyph.id);
   if(!view){const g=new Graphics();g.eventMode='none';this.actors.addChild(g);const shadow=new Graphics();shadow.eventMode='none';this.ground.addChild(shadow);view={g,shadow,phase:0,at};this.hearts.set(glyph.id,view);}
   view.at={...at};view.targetId=target?.id;
   if(view.phase!==heart.phase){view.g.clear();for(const child of view.g.removeChildren())child.destroy();this.heartFragments(view.g,view.phase!==0&&heart.phase===2?1:heart.phase);
    if(view.phase!==0&&heart.phase===2){const joining=new Graphics();this.heartFragments(joining,1,1);view.g.addChild(joining);view.joining=joining;view.joinedAt=this.clock;}
    const label=new Text({text:`${heart.phase}/3`,style:{fontSize:11,fill:0xe7faff,fontWeight:'bold'}});label.anchor.set(.5);label.position.set(0,43);view.g.addChild(label);view.phase=heart.phase;}
   this.positionHeart(view);
  }
 }
 private heartFragments(g:Graphics,count:number,offset=0):void{
  // Registered pieces of ONE silhouette, not differently scaled whole hearts.
  const pieces=[[-2,-11,-18,-27,-32,-16,-29,4,-2,5],[2,-11,18,-27,32,-16,29,4,2,5],[-25,7,0,33,25,7,0,-7]];
  for(let i=offset;i<offset+count;i++)g.poly(pieces[i]!).fill({color:[0x57b7e6,0xc0f6ff,0x87dbf2][i]!,alpha:.83}).stroke({color:0xe6fcff,width:1.2,alpha:.9});
 }
 private positionHeart(view:{g:Graphics;shadow:Graphics;at:Pos;targetId?:string;joining?:Graphics;joinedAt?:number}):void{
  if(view.joining){const t=this.reduced?1:Math.min(1,(this.clock-(view.joinedAt??0))/420);view.joining.position.set((1-t)*35,-(1-t)*20);view.joining.alpha=t;if(t>=1){view.joining.destroy({context:true});delete view.joining;this.heartFragments(view.g,1,1);}}
  const c=(view.targetId?this.followUnit?.(view.targetId):undefined)??this.geometry.center(view.at),s=this.geometry.footprint(view.at).w/96;
  const height=('height' in c&&typeof c.height==='number'?c.height:100*s);
  view.g.position.set(c.x,Math.max(this.skyMinY+45*s,c.y-height*2.8)+(this.reduced?0:Math.sin(this.clock/900)*2*s));
  view.shadow.clear().ellipse(c.x,c.y,28*s,11*s).fill({color:0x214357,alpha:.25}).stroke({color:0xb9f4ff,width:s,alpha:.45});
  view.g.scale.set(s*.85);view.g.zIndex=this.geometry.depth(c)+1000;
 }
 heartFall(at:Pos,tiles:readonly Pos[],id:string):void{
  this.fallingHearts.add(id);const old=this.hearts.get(id);const skyY=old?.g.y;const startX=old?.g.x;
  if(old){old.g.destroy({children:true,context:true});old.shadow.destroy({context:true});this.hearts.delete(id);}
  const c=this.geometry.center(at),s=this.geometry.footprint(at).w/96;let released=false;
  this.spawn(false,this.reduced?180:660,g=>this.heartFragments(g,3),(t,g)=>{
   const fall=Math.max(0,(t-.3)/.7);const start=skyY??Math.max(this.skyMinY+45*s,c.y-280*s);g.position.set((startX??c.x)+(c.x-(startX??c.x))*fall*fall,c.y-(c.y-start)*(1-fall*fall));g.scale.set(s*.85);g.zIndex=this.geometry.depth(c)+1000;
   if(t>=1&&!released){released=true;this.heartRelease(at,tiles);}
  });
 }
 private live:Motion[]=[];private free:Graphics[]=[];private made=0;private light=typeof matchMedia!=='undefined'&&matchMedia('(max-width:600px), (pointer:coarse)').matches;
 constructor(private actors:Container,private ground:Container,private geometry:FxGeometry,private painted?:MageEffects,private snow?:AvalancheEffects){}
 get stats(){return {active:this.live.length,created:this.made,free:this.free.length};}
 private spawn(ground:boolean,duration:number,paint:(g:Graphics)=>void,step:Motion['step']):void{
  const g=this.free.pop()??(this.made<96?(this.made++,new Graphics()):undefined);if(!g)return;
  g.clear();g.alpha=1;g.rotation=0;g.scale.set(1);g.position.set(0);g.eventMode='none';paint(g);(ground?this.ground:this.actors).addChild(g);step(0,g);this.live.push({g,age:0,duration:Math.max(1,duration),step});
 }
 private crystal(g:Graphics,w:number,h:number):void{
  g.poly([0,-h,w*.55,-h*.3,w*.35,0,-w*.45,0,-w*.65,-h*.35]).fill({color:0x478cb8,alpha:.82});
  g.poly([0,-h,w*.55,-h*.3,0,-h*.18]).fill({color:0xcdf8ff,alpha:.92});
  g.poly([0,-h,0,-h*.18,-w*.45,0,-w*.65,-h*.35]).fill({color:0x6fd5ed,alpha:.8});
  g.moveTo(0,-h).lineTo(0,-h*.18).lineTo(w*.35,0).stroke({color:0xf1feff,width:1,alpha:.85});
 }
 charge(at:Pos,duration:number):void{
  const c=this.geometry.center(at),f=this.geometry.footprint(at),s=f.w/96;
  for(let i=0;i<(this.reduced?3:8);i++){const a=i*Math.PI/4,r=42*s;
   this.spawn(true,duration,g=>this.crystal(g,9*s,20*s),(t,g)=>{g.position.set(c.x+Math.cos(a)*r*(1-t*.6),c.y+Math.sin(a)*r*f.h/f.w*(1-t*.6));g.alpha=(this.reduced?.25:.62)*Math.sin(Math.PI*t);g.scale.set(.4+t*.6);});
  }
 }
 comet(at:Pos,duration:number):void{
  this.painted?.iceComet(at,duration);
  const c=this.geometry.center(at),s=this.geometry.footprint(at).w/96,dx=170*s,dy=230*s;
  this.spawn(false,duration,g=>{
   // A tapering frozen wake and an asymmetric three-dimensional crystalline core.
   for(let i=5;i>0;i--)g.poly([-36-i*13,-(8+i*2),18,0,-36-i*13,8+i*2]).fill({color:i%2?0x64c9ef:0xb9efff,alpha:.035+(5-i)*.016});
   g.poly([29,0,-14,-19,-39,-4,-21,19]).fill({color:0x1e557d,alpha:.95});
   g.poly([29,0,-14,-19,-10,-3]).fill(0xd9fbff);
   g.poly([29,0,-10,-3,-21,19]).fill(0x78d9ef);
   g.poly([-14,-19,-39,-4,-10,-3]).fill(0x4596bc);
   g.moveTo(-14,-19).lineTo(29,0).lineTo(-21,19).stroke({color:0xf1ffff,width:1.5});
  },(t,g)=>{const p=this.reduced?t:t*t;g.position.set(c.x-dx*(1-p),c.y-dy*(1-p));g.rotation=Math.atan2(dy,dx);g.scale.set(s*(.65+.35*t));g.alpha=this.reduced?.55:1;g.zIndex=this.geometry.depth(c)+8;});
  if(this.reduced)return;
  for(let i=0;i<7;i++)this.spawn(false,duration,g=>this.crystal(g,5*s,12*s),(t,g)=>{const p=Math.max(0,t-i*.035),u=p*p;g.position.set(c.x-dx*(1-u)-(i%2?9:-9)*s,c.y-dy*(1-u)+i*3*s);g.rotation=t+i;g.alpha=.5*Math.sin(Math.PI*t);g.zIndex=this.geometry.depth(c)+7;});
 }
 impact(at:Pos,affected:readonly Pos[],comet=false):void{
  const c=this.geometry.center(at),f=this.geometry.footprint(at),s=f.w/96,tiles=affected.length?affected:[at];
  const radius=Math.max(f.w*.7,...tiles.map(p=>{const a=this.geometry.center(p);return Math.hypot(a.x-c.x,(a.y-c.y)*f.w/f.h)+f.w*.4;}));
  this.painted?.iceBloom(at,radius*2);
  this.spawn(true,this.reduced?160:440,g=>{const points:number[]=[];for(let i=0;i<40;i++){const a=i*Math.PI/20,r=radius*(i%2?1:.95);points.push(Math.cos(a)*r,Math.sin(a)*r*f.h/f.w);}g.poly(points).stroke({color:0xc9f7ff,width:3,alpha:.8});g.poly(points).fill({color:0x78cfe9,alpha:.07});},(t,g)=>{g.position.set(c.x,c.y);g.scale.set(this.reduced?.9:.15+.85*(1-(1-t)**3));g.alpha=(1-t)**2;});
  const count=Math.min(this.reduced?3:this.light?12:24,tiles.length*2);
  for(let i=0;i<count;i++){const tile=tiles[Math.floor(i*tiles.length/count)]!,p=this.geometry.center(tile),angle=i*2.39996,w=(10+i%3*3)*s,h=(comet?43:31)*s+(i%4)*7*s,delay=Math.min(.4,Math.hypot(p.x-c.x,p.y-c.y)/Math.max(1,radius)*.25);
   this.spawn(false,this.reduced?180:620,g=>this.crystal(g,w,h),(t,g)=>{const u=Math.max(0,(t-delay)/(1-delay));g.position.set(p.x+Math.cos(angle)*9*s,p.y+Math.sin(angle)*5*s);g.scale.set(1,Math.min(1,u*7));g.alpha=u===0?0:Math.min(1,(1-u)*4);g.zIndex=this.geometry.depth(p)+2;});
   if(!this.reduced&&(!this.light||i<6))this.spawn(false,520,g=>this.crystal(g,4*s,9*s),(t,g)=>{g.position.set(c.x+Math.cos(angle)*(14+76*t)*s,c.y+Math.sin(angle)*28*t*s-Math.sin(Math.PI*t)*55*s);g.rotation=angle+t*3;g.alpha=(1-t)**1.4;g.zIndex=this.geometry.depth(c)+7;});
  }
  // Residual frost is confined to the server-confirmed affected footprint.
  for(const tile of tiles.slice(0,25)){const p=this.geometry.center(tile);this.spawn(true,this.reduced?180:760,g=>{for(let i=0;i<3;i++){const x=(i-1)*10*s;g.moveTo(x-7,3).lineTo(x,-5).lineTo(x+5,1).stroke({color:0xa8e7f0,width:1,alpha:.35});}},(t,g)=>{g.position.set(p.x,p.y);g.alpha=(1-t)*.7;});}
 }
 heart(at:Pos,duration:number):void{
  const c=this.geometry.center(at),scale=this.geometry.footprint(at).w/96;
  this.charge(at,duration);
  this.spawn(false,duration,g=>{
   g.poly([0,-12,-18,-27,-32,-16,-29,4,0,33,29,4,32,-16,18,-27]).fill({color:0x174f80,alpha:.95});
   g.poly([0,-12,-18,-27,-29,4,0,33]).fill({color:0x57b7e6,alpha:.88});
   g.poly([0,-12,18,-27,29,4,0,33]).fill({color:0xc0f6ff,alpha:.85});
   g.moveTo(0,-12).lineTo(-5,1).lineTo(5,8).lineTo(0,29).stroke({color:0xf5ffff,width:2.5,alpha:.95});
  },(t,g)=>{g.position.set(c.x,c.y-45*scale);g.scale.set(scale*(.2+.8*Math.min(1,t*3))*(1+Math.sin(t*Math.PI*4)*.04));g.rotation=Math.sin(t*Math.PI)*.09;g.alpha=Math.min(1,t*5)*(1-Math.max(0,t-.85)*4);g.zIndex=this.geometry.depth(c)+6;});
 }
 winterPulse(tiles:readonly Pos[]):void{
  if(!tiles.length)return;
  const points=tiles.map(p=>this.geometry.center(p)),left=Math.min(...points.map(p=>p.x))-70,right=Math.max(...points.map(p=>p.x))+70,y=points.reduce((n,p)=>n+p.y,0)/points.length;
  this.spawn(false,this.reduced?120:480,g=>{for(let i=0;i<3;i++)g.moveTo(-50,i*8).quadraticCurveTo(0,-15+i*8,50,i*8).stroke({color:0xd6f8ff,width:1.5,alpha:.6});},(t,g)=>{g.position.set(left+(right-left)*t,y-35);g.alpha=Math.sin(t*Math.PI)*.7;g.zIndex=10000;});
 }
 heartRelease(at:Pos,tiles:readonly Pos[]):void{
  const c=this.geometry.center(at),f=this.geometry.footprint(at);
  for(let i=0;i<(this.reduced?4:12);i++){const a=i*Math.PI/6;this.spawn(false,this.reduced?180:850,g=>this.crystal(g,6,24),(t,g)=>{g.position.set(c.x+Math.cos(a)*f.w*t*.7,c.y-25+Math.sin(a)*f.h*t*.6-t*15);g.scale.set(1-t*.5);g.rotation=a+t;g.alpha=(1-t)**2;g.zIndex=this.geometry.depth(c)+4;});}
  for(const tile of tiles){const p=this.geometry.center(tile);this.spawn(true,this.reduced?150:900,g=>{g.ellipse(0,0,f.w*.35,f.h*.3).stroke({color:0xc8f7ff,width:2,alpha:.7});},(t,g)=>{g.position.set(p.x,p.y);g.scale.set(.3+t);g.alpha=(1-t)**2;});}
 }
 avalanche(origin:Pos,tiles:readonly Pos[],duration:number,impact=false):void{
  this.snow?.play(origin,tiles,duration,impact);
 }
 tick(ms:number):void{this.clock+=ms;for(const view of this.hearts.values())this.positionHeart(view);for(let i=this.live.length-1;i>=0;i--){const a=this.live[i]!;a.age+=ms;a.step(Math.min(1,a.age/a.duration),a.g);if(a.age>=a.duration){a.g.removeFromParent();a.g.clear();this.free.push(a.g);this.live.splice(i,1);}}}
 clear():void{this.followUnit=undefined;this.fallingHearts.clear();for(const view of this.hearts.values()){view.g.destroy({children:true,context:true});view.shadow.destroy({context:true});}this.hearts.clear();for(const a of this.live){a.g.removeFromParent();a.g.clear();this.free.push(a.g);}this.live.length=0;}
 destroy():void{this.clear();for(const g of this.free)g.destroy({context:true});this.free.length=0;}
}
