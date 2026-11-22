import {Container,Graphics} from 'pixi.js';
import {loadSharedTexture} from './paintedTextures';
import {PaintedEffectPool} from '../vfx/PaintedEffectPool';
export type ShieldMaterial='ENERGY'|'ICE';

/** Warm the shared cache through the existing presentation asset gate before shield cues. */
export async function prepareShieldMaterials(materials:readonly ShieldMaterial[]):Promise<void>{
 const mobile=typeof matchMedia!=='undefined'&&matchMedia('(max-height: 500px), (pointer: coarse)').matches;
 await Promise.all([...new Set(materials)].map(material=>{
  const id=material==='ICE'?'barrier-ice':'barrier-energy';
  return loadSharedTexture(`/art/vfx/${id}/${id}-v1-${mobile?512:1024}.png`).catch(()=>{
   console.warn('Shield illustration unavailable; combat HUD remains authoritative.');
  });
 }));
}

/** Illustrated material recipe; the existing scene clock advances all phases.
 * Rows: rear surface, clear-front surface, impact/cracks, breakup. */
class ShieldSurface extends PaintedEffectPool {
 formation=1;exit=0;broken=false;strength=1;pulse=0;side=1;clock=0;
 constructor(back:Container,front:Container,private w:number,private h:number,private material:ShieldMaterial){
  super(front,back,{center:()=>({x:0,y:0}),footprint:()=>({w,h}),quad:()=>[],depth:p=>p.y},
   material==='ICE'?'barrier-ice':'barrier-energy',10,'png');
 }
 get requested(){return true;}
 assemble():void {
  this.clear();
  for(const rear of [true,false])this.sprite([rear?0:4],{x:0,y:-this.h*.53},this.w*3.6,1e9,(_t,s)=>{
   const phase=this.reduced?0:Math.floor(this.clock/170)%4;
   s.texture=this.frames[(this.broken?12+Math.min(3,Math.floor(this.exit*4)):rear?0:4)+(this.broken?0:phase)]!;
   s.width=this.w*3.6;s.height=this.h*1.75;
   s.position.set(0,-this.h*.53);
   s.alpha=(rear?.65:.72)*(1-this.exit)*(.55+.45*this.strength);
   if(this.broken){s.y+=this.exit*this.exit*this.h*.14;s.alpha*=1-this.exit*.3;}
  },rear,false);
  this.sprite([8],{x:0,y:0},this.w*1.8,1e9,(_t,s)=>{
   const crack=1-this.strength;
   s.texture=this.frames[8+Math.min(3,Math.floor((1-this.pulse)*4))]!;
   s.width=this.w*(this.material==='ICE'?2.7:1.9);s.height=this.h*.8;
   s.position.set(this.side*this.w*.4,-this.h*.5);
   s.alpha=(this.pulse*.85+crack*(this.material==='ICE'?.38:.2))*(1-this.exit);
  });
 }
}

/** Shield lifecycle follows authoritative amounts and the director's actual impact/break events. */
export class ShieldBarrierView {
 readonly back=new Container();readonly front=new Container();
 private surface:ShieldSurface;
 private backMask=new Graphics();private frontMask=new Graphics();
 private amount=0;private peak=0;private material:ShieldMaterial='ENERGY';
 private age=0;private mode:'hold'|'break'|'expire'='hold';private dead=false;private loaded=false;
 private generation=0;private maskStep=-1;
 constructor(private width:number,private height:number){
  this.back.eventMode=this.front.eventMode='none';this.back.visible=this.front.visible=false;
  this.back.addChild(this.backMask);this.front.addChild(this.frontMask);
  this.back.mask=this.backMask;this.front.mask=this.frontMask;
  this.surface=new ShieldSurface(this.back,this.front,width,height,this.material);
 }
 private prepare():void {
  this.surface.beginBatch();if(typeof window==='undefined')return;
  const surface=this.surface,generation=++this.generation;
  void surface.prepare().then(()=>{if(this.dead||generation!==this.generation)return;
   this.loaded=surface.ready;if(this.loaded&&this.amount>0)surface.assemble();});
 }
 get stats(){return this.surface.snapshot;}
 sync(amount:number,material:ShieldMaterial=this.material):void {
  const entering=amount>0&&this.amount<=0,changed=material!==this.material;
  if(amount>0){
   this.peak=entering?amount:Math.max(this.peak,amount);
   this.back.visible=this.front.visible=true;
   if(changed){this.surface.destroy();this.material=material;this.loaded=false;
    this.surface=new ShieldSurface(this.back,this.front,this.width,this.height,material);}
   if(entering||changed){this.age=0;this.mode='hold';this.maskStep=-1;
    if(this.loaded)this.surface.assemble();else this.prepare();}
  }else if(this.amount>0&&this.mode==='hold'){this.mode='expire';this.age=0;}
  this.amount=amount;this.surface.strength=this.peak?amount/this.peak:0;
 }
 impact(side=1):void{this.surface.side=Math.sign(side)||1;this.surface.pulse=1;}
 gained():void{this.age=0;this.maskStep=-1;}
 shatter():void{if(!this.back.visible)return;this.mode='break';this.age=0;this.surface.pulse=1;}
 expire():void{if(this.back.visible){this.mode='expire';this.age=0;}}
 advance(ms:number,reduced:boolean):void {
  if(!this.back.visible)return;
  this.age+=ms;this.surface.clock+=ms;this.surface.reduced=reduced;
  this.surface.pulse=Math.max(0,this.surface.pulse-ms/420);
  this.surface.formation=this.mode==='hold'?(reduced?1:Math.min(1,this.age/620)):1;
  this.surface.exit=this.mode==='hold'?0:Math.min(1,this.age/(reduced?160:this.mode==='break'?600:420));
  this.surface.broken=this.mode==='break';
  // A growing reveal, not a stretched static dome. Update this tiny stencil only during formation.
  const step=Math.floor(this.surface.formation*24);
  if(step!==this.maskStep){this.maskStep=step;const top=-this.height*1.5*step/24;
   for(const mask of [this.backMask,this.frontMask]){
    mask.clear();
    if(this.material==='ENERGY')mask.ellipse(0,-this.height*.53,this.width*1.54,this.height*.74).fill(0xffffff);
    else mask.poly([-this.width*1.6,this.height*.15,-this.width*1.65,-this.height*.7,-this.width*.4,-this.height*1.35,this.width*.35,-this.height*1.35,this.width*1.6,-this.height*.65,this.width*1.5,this.height*.15]).fill(0xffffff);
    if(step<24)mask.rect(-this.width*3,-this.height*2,this.width*6,this.height*2+top).cut();
   }}
  this.surface.tick(ms);
  if(this.surface.exit===1){this.back.visible=this.front.visible=false;this.surface.clear();}
 }
 destroy():void{this.dead=true;this.generation++;this.surface.destroy();
  this.back.mask=this.front.mask=null;this.back.destroy({children:true});this.front.destroy({children:true});}
}
