import {AnimatedSprite,Container,Graphics,Assets,type Spritesheet,type Texture} from 'pixi.js';
/** Deliberately disabled: the generated draft failed coherent anatomy/registration/alpha QA. */
export const CLAW_ASSET_STATUS='BLOCKED' as const;
/** Cinematic raster remains blocked; the legal card uses the procedural front/back renderer. */
export const CLAW_PRESENTATION_STATUS='PROCEDURAL' as const;
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
/** Shared frame controller: back → real unit → front. No textures, ticker, or allocations per frame. */
export class GlacierClawView {
 readonly back=new Container();readonly front=new Container();
 private fingers:{g:Graphics;x:number;y:number;side:number}[]=[];private snow:Graphics[]=[];private ground:Graphics|undefined;private fractures:Graphics|undefined;
 private sprites:AnimatedSprite[]=[];private elapsed=0;private phase:'none'|'enter'|'hold'|'release'|'fire'='none';private enhanced=false;
 constructor(private readonly atlas:ClawAtlas|undefined=shared){
  this.back.eventMode=this.front.eventMode='none';
  if(atlas)for(const [layer,root] of [[atlas.back,this.back],[atlas.front,this.front]] as const){const sprite=new AnimatedSprite({textures:layer.enter,autoUpdate:false,loop:false});sprite.anchor.set(.5,1);sprite.width=104;sprite.height=116;root.addChild(sprite);this.sprites.push(sprite);}
  this.back.visible=this.front.visible=false;
 }
 sync(active:boolean,enhanced:boolean):void {this.enhanced=enhanced;if(active&&this.phase==='none')this.show('hold');else if(!active&&['hold','enter'].includes(this.phase))this.show('release');}
 enter():void {if(this.phase!=='enter')this.show('enter');}
 release(fire=false):void {this.show(fire?'fire':'release');}
 private show(phase:typeof this.phase):void {this.phase=phase;this.elapsed=0;if(!this.atlas){this.buildProcedural();return;}this.sprites.forEach((s,i)=>{s.textures=(i?this.atlas!.front:this.atlas!.back)[phase==='release'||phase==='fire'?'release':'enter'];s.gotoAndStop(phase==='hold'?9:0);});}
 advance(ms:number,reduced:boolean):void {
  this.elapsed+=Math.max(0,ms);
  if(!this.atlas){this.advanceProcedural(reduced);return;}
  let frame=this.phase==='hold'?9:Math.floor(this.elapsed/(this.phase==='enter'?90:75));
  if(this.phase==='enter'&&(reduced||frame>=10)){this.phase='hold';frame=9;}
  if(['release','fire'].includes(this.phase)&&(reduced||frame>=6))this.phase='none';
  this.back.visible=this.front.visible=this.phase!=='none';
  this.sprites.forEach(s=>{s.gotoAndStop(Math.min(s.textures.length-1,frame));s.alpha=this.phase==='fire'?Math.max(0,1-this.elapsed/450):1;s.tint=this.phase==='fire'?0xffd7b0:this.enhanced?0xc1efff:0xffffff;});
 }
 private buildProcedural():void {
  if(this.ground)return;
  const ground=this.ground=new Graphics();this.back.addChild(ground);
  ground.ellipse(0,0,43,13).fill({color:0x70c4eb,alpha:.13});
  for(let i=0;i<9;i++){const a=i*Math.PI*2/9,r=24+(i%3)*8;ground.moveTo(Math.cos(a)*7,Math.sin(a)*3).lineTo(Math.cos(a+.12)*r*.6,Math.sin(a+.12)*r*.22).lineTo(Math.cos(a)*r,Math.sin(a)*r*.32).stroke({color:0xc6f5ff,width:1.2,alpha:.8});}
  // Two rear fingers and three front facets surround the real unit; no opaque centre.
  for(let i=0;i<5;i++){
   const side=i%2?-1:1,x=side*(20+(i%3)*8),y=i<2?-7:4,g=new Graphics(),h=42+(i%3)*8;
   g.moveTo(-8,3).lineTo(-10,-h*.4).lineTo(-4,-h*.8).lineTo(side*-7,-h).lineTo(5,-h*.82).lineTo(10,-h*.36).lineTo(9,3).closePath().fill({color:i<2?0x478fb3:0x9bdcf3,alpha:.82}).stroke({color:0xd5f7ff,width:1.3,alpha:.9});
   g.moveTo(-3,0).lineTo(-4,-h*.5).lineTo(1,-h*.82).stroke({color:0xf1ffff,width:1,alpha:.75});
   (i<2?this.back:this.front).addChild(g);this.fingers.push({g,x,y,side});
  }
  const cracks=this.fractures=new Graphics();this.front.addChild(cracks);
  for(const f of this.fingers)cracks.moveTo(f.x-5,-10).lineTo(f.x+2,-24).lineTo(f.x-3,-32).stroke({color:0xffffff,width:1,alpha:.9});
  for(let i=0;i<8;i++){const g=new Graphics();g.poly([0,-4,2,0,0,4,-2,0]).fill(0xd9faff);this.front.addChild(g);this.snow.push(g);}
 }
 private advanceProcedural(reduced:boolean):void {
  if(this.phase==='none')return;
  this.buildProcedural();
  if(this.phase==='enter'&&(reduced||this.elapsed>=900)){this.phase='hold';this.elapsed=0;}
  const releasing=this.phase==='release'||this.phase==='fire',end=this.phase==='fire'?400:500;
  if(releasing&&(reduced||this.elapsed>=end)){this.phase='none';this.back.visible=this.front.visible=false;return;}
  this.back.visible=this.front.visible=true;
  const entry=this.phase==='enter'?Math.min(1,this.elapsed/900):1,fade=releasing?Math.max(0,1-this.elapsed/end):1;
  const grow=Math.max(.02,Math.min(1,(entry-.18)/.68));
  this.ground!.alpha=Math.min(1,entry*5)*fade;
  this.fractures!.visible=releasing;
  this.fractures!.alpha=fade;
  for(const f of this.fingers){f.g.position.set(f.x+(releasing?f.side*this.elapsed*.025:0),f.y+(1-grow)*13+(releasing?this.elapsed*.035:0));f.g.scale.set(1,grow);f.g.rotation=f.side*(1-grow)*.3+(releasing?f.side*this.elapsed*.0008:0);f.g.alpha=fade*(this.enhanced?.95:.8);f.g.tint=this.phase==='fire'?0xffd8b1:this.enhanced?0xc8f7ff:0xffffff;}
  this.snow.forEach((g,i)=>{const t=reduced?0:this.elapsed/1000;g.position.set(Math.cos(i*2.4)*(27+i%3*7),-12-(i*13+t*(this.phase==='fire'?65:12))%74);g.alpha=fade*(this.enhanced?.55:.3);g.scale.set(this.phase==='fire'?1+this.elapsed/180:1);});
 }
 /** Read-only QA; presentation state never changes the authoritative status. */
 get snapshot(){return {phase:this.phase,procedural:!this.atlas,enhanced:this.enhanced,fingers:this.fingers.length,visible:this.back.visible&&this.front.visible};}
 destroy():void {this.back.destroy({children:true});this.front.destroy({children:true});this.sprites=[];}
}
