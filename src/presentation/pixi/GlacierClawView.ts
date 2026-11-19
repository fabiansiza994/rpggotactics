import {Container,Graphics,Assets,Sprite,type Spritesheet,type Texture} from 'pixi.js';
/** New raster rig is a local visual candidate; the old rejected atlas remains disabled. */
export const CLAW_ASSET_STATUS='CANDIDATE' as const;
/** The production controller now uses textured articulated fingers, not vector hand facets. */
export const CLAW_PRESENTATION_STATUS='ARTICULATED_SPRITES' as const;
export interface ClawAtlas {back:Record<'enter'|'release',Texture[]>;front:Record<'enter'|'release',Texture[]>}
let shared:ClawAtlas|undefined;
/** Call only after an artist-approved atlas replaces the rejected draft; cached by Pixi Assets. */
export async function loadApprovedClawAtlas(url:string,approved:boolean):Promise<ClawAtlas|undefined>{
 if(!approved)return undefined;
 if(shared)return shared;
 const sheet=await Assets.load<Spritesheet>(url);
 const frames=(layer:string,phase:string):Texture[]=>{const value=sheet.animations[`${layer}_${phase}`];if(!value)throw Error('Missing claw phase '+layer+' '+phase);return value;};
 const atlas={back:{enter:frames('back','enter'),release:frames('back','release')},front:{enter:frames('front','enter'),release:frames('front','release')}};
 for(const layer of [atlas.back,atlas.front])if(layer.enter?.length!==10||layer.release?.length!==6)throw Error('Claw atlas requires paired 10-frame entry and 6-frame release');
 shared=atlas;return atlas;
}

import {clawRigTextures,type ClawRigTextures} from './glacierClawTextures';
import {clawPose,type ClawPhase} from './glacierClawMotion';
type Finger={root:Container;frontRoot:Container;bones:Container[];sprites:Sprite[];x:number;y:number;spread:number;curl:number;length:number};
/** Existing UnitView back→unit→front layering, driven by its existing advance/sync lifecycle. */
export class GlacierClawView {
 readonly back=new Container();readonly front=new Container();
 private palm?:Sprite;private fingers:Finger[]=[];private particles:Graphics[]=[];
 private ground=new Graphics();private elapsed=0;private phase:ClawPhase='none';private enhanced=false;
 constructor(private readonly textures:ClawRigTextures|undefined=clawRigTextures()){
  this.back.eventMode=this.front.eventMode='none';
  this.ground.ellipse(0,0,40,12).fill({color:0x082b3a,alpha:.35}).ellipse(0,0,34,9).stroke({color:0x77ddff,width:1,alpha:.35});
  for(let i=0;i<8;i++){const a=i*Math.PI/4;this.ground.moveTo(Math.cos(a)*9,Math.sin(a)*3).lineTo(Math.cos(a+.1)*26,Math.sin(a+.1)*8).lineTo(Math.cos(a)*39,Math.sin(a)*12).stroke({color:0xa6edff,width:1,alpha:.65});}
  this.back.addChild(this.ground);
  if(textures){
   this.palm=new Sprite(textures.palm);this.palm.anchor.set(.5,1);this.palm.width=86;this.palm.height=78;this.palm.position.set(0,9);this.back.addChild(this.palm);
   // A single palm with four knuckles across its crown. Thumb opposes the fingers,
   // instead of following the radial crystal/cuff silhouette of the previous pose.
   const specs=[{x:36,y:-15,spread:.72,curl:1.05,length:44},{x:-27,y:-57,spread:-.35,curl:1.4,length:48},{x:-9,y:-66,spread:-.1,curl:1.35,length:53},{x:10,y:-64,spread:.12,curl:-1.4,length:49},{x:28,y:-54,spread:.36,curl:-1.45,length:39}];
   specs.forEach((spec,i)=>{const root=new Container(),frontRoot=new Container(),bones:Container[]=[],sprites:Sprite[]=[];
    this.back.addChild(root);this.front.addChild(frontRoot);
    textures.fingers[i]!.forEach((tex,j)=>{const joint=new Container(),sprite=new Sprite(tex);sprite.anchor.set(.5,1);sprite.width=i===0?23:i===4?16:20;sprite.height=spec.length/textures.fingers[i]!.length+3;joint.addChild(sprite);
     // Proximal phalanges sit behind the real unit; bent middle/distal phalanges
     // cross in front. Both layers use the same forward kinematics, no duplicate digits.
     (i===0||j>0?frontRoot:root).addChild(joint);bones.push(joint);sprites.push(sprite);});
    this.fingers.push({root,frontRoot,bones,sprites,...spec});});
  }
  for(let i=0;i<10;i++){const g=new Graphics();g.poly([0,-3,2,0,0,4,-2,0]).fill({color:0xc5f6ff,alpha:.8});this.front.addChild(g);this.particles.push(g);}
  this.back.visible=this.front.visible=false;
 }
 sync(active:boolean,enhanced:boolean):void{this.enhanced=enhanced;if(active&&this.phase==='none')this.show('hold');else if(!active&&(this.phase==='hold'||this.phase==='enter'))this.show('release');}
 enter():void{if(this.phase!=='enter')this.show('enter');}
 release(fire=false):void{if(this.phase!=='none'&&this.phase!=='release'&&this.phase!=='fire')this.show(fire?'fire':'release');}
 private show(phase:ClawPhase):void{this.phase=phase;this.elapsed=0;}
 advance(ms:number,reduced:boolean):void{
  if(this.phase==='none')return;
  this.elapsed+=Math.max(0,ms);const pose=clawPose(this.phase,this.elapsed,reduced),fire=this.phase==='fire',exit=this.phase==='release'||fire;
  this.phase=pose.phase;this.back.visible=this.front.visible=this.phase!=='none';if(this.phase==='none')return;
  const tint=fire?0xffd5ac:this.enhanced?0xd2f7ff:0xffffff;
  this.ground.alpha=pose.ground*pose.alpha;this.ground.scale.set(.8+pose.ground*.2);
  if(this.palm){this.palm.y=7+(1-pose.rise)*25+pose.fracture*14;this.palm.alpha=pose.rise*pose.alpha*.92;this.palm.tint=tint;this.palm.rotation=exit?pose.fracture*.16:(1-pose.close)*-.12;this.palm.x=(1-pose.close)*-3;}
  for(const [digit,f] of this.fingers.entries()){
   const x=f.x+(exit?Math.sign(f.x)*pose.fracture*32:0),y=f.y+(1-pose.rise)*45+pose.fracture*18;
   // Palm-facing approach, then opposed thumb and hooked fingers wrap the torso.
   const rotation=digit===0?f.spread+(-1.18-f.spread)*pose.close:f.spread*(1-pose.close*.65);
   for(const root of [f.root,f.frontRoot]){root.position.set(x,y);root.rotation=rotation;root.alpha=pose.rise*pose.alpha;root.scale.set(1,Math.max(.1,pose.rise));}
   let bx=0,by=0,depth=0,angle=0;const length=f.length/f.bones.length;
   f.bones.forEach((bone,i)=>{
    if(digit===0){
     if(i>0){bx+=Math.sin(angle)*length;by-=Math.cos(angle)*length;angle+=f.curl*pose.close;}
     bone.position.set(bx,by);bone.scale.set(1,1);bone.rotation=angle;
    }else{
     // Curl ABOUT the knuckle's horizontal axis, towards the viewer, not sideways
     // into a crystal crown. Proximal→middle→distal preserve physical connectivity.
     const flex=[1.25,2.85,3.6][i]!*pose.close,dy=-Math.cos(flex)*length,dz=Math.sin(flex)*length;
     bone.position.set(0,by-depth*.22);bone.rotation=0;
     const projected=-(dy-dz*.22)/length;bone.scale.set(1+Math.max(0,depth)/250,Math.abs(projected)<.035?.035:projected);
     by+=dy;depth+=dz;
    }
    if(exit){bone.x+=(i%2?1:-1)*pose.fracture*9;bone.y+=pose.fracture*i*6;bone.rotation+=(i%2?1:-1)*pose.fracture*.7;}
    const sprite=f.sprites[i]!;sprite.tint=tint;sprite.alpha=fire?1-pose.fracture*.5:1;
   });
  }
  this.particles.forEach((g,i)=>{const time=reduced?0:this.elapsed/1000,r=exit?28+pose.fracture*36:30+(i%3)*7;g.position.set(Math.cos(i*2.399)*r,-6-(i*11+time*(fire?72:16))%72);g.tint=fire?0xffc799:0xc6f4ff;g.alpha=pose.alpha*(exit?.85:this.enhanced?.5:.22);g.visible=!reduced;});
 }
 get snapshot(){return {phase:this.phase,procedural:false,enhanced:this.enhanced,fingers:this.fingers.length,textured:!!this.textures,visible:this.back.visible&&this.front.visible};}
 destroy():void{this.back.destroy({children:true});this.front.destroy({children:true});this.fingers=[];this.particles=[];}
}
