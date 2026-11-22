import {Container,Graphics} from 'pixi.js';
import type {Pos} from '../../game';
import type {AvalancheEffects} from './AvalancheEffects';
import type {MageEffects} from './MageEffects';
import type {FxGeometry} from './ElementEffects';
type Motion={g:Graphics;age:number;duration:number;step:(t:number,g:Graphics)=>void};
/** Finite faceted ice geometry on the existing scene clock; no filters or per-frame textures. */
export class IceSpellEffects {
 reduced=false;
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
 heartRelease(at:Pos,tiles:readonly Pos[]):void{
  const c=this.geometry.center(at),f=this.geometry.footprint(at);
  for(let i=0;i<(this.reduced?4:12);i++){const a=i*Math.PI/6;this.spawn(false,this.reduced?180:850,g=>this.crystal(g,6,24),(t,g)=>{g.position.set(c.x+Math.cos(a)*f.w*t*.7,c.y-25+Math.sin(a)*f.h*t*.6-t*15);g.scale.set(1-t*.5);g.rotation=a+t;g.alpha=(1-t)**2;g.zIndex=this.geometry.depth(c)+4;});}
  for(const tile of tiles){const p=this.geometry.center(tile);this.spawn(true,this.reduced?150:900,g=>{g.ellipse(0,0,f.w*.35,f.h*.3).stroke({color:0xc8f7ff,width:2,alpha:.7});},(t,g)=>{g.position.set(p.x,p.y);g.scale.set(.3+t);g.alpha=(1-t)**2;});}
 }
 avalanche(origin:Pos,tiles:readonly Pos[],duration:number,impact=false):void{
  this.snow?.play(origin,tiles,duration,impact);
 }
 tick(ms:number):void{for(let i=this.live.length-1;i>=0;i--){const a=this.live[i]!;a.age+=ms;a.step(Math.min(1,a.age/a.duration),a.g);if(a.age>=a.duration){a.g.removeFromParent();a.g.clear();this.free.push(a.g);this.live.splice(i,1);}}}
 clear():void{for(const a of this.live){a.g.removeFromParent();a.g.clear();this.free.push(a.g);}this.live.length=0;}
 destroy():void{this.clear();for(const g of this.free)g.destroy({context:true});this.free.length=0;}
}
