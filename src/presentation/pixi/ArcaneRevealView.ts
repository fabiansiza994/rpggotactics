import {RevealLayerOrder} from './RevealLayerOrder';
import {Assets,Container,Graphics,PerspectiveMesh,Sprite,Texture,type Application} from 'pixi.js';
import type {GameContent,GameState} from '../../game';
import {rasterRevealCard} from '../cards/revealCardTexture';
import {readRevealFrame,revealPose,subscribeReveal} from '../cards/arcaneReveal';
import {readRevealRenderer} from '../cards/revealRenderer';
import {STANDARD_CARD_BACK} from '../cosmetics/CardBack';
/** Project one printed plane in 3D, including foreshortening and perspective divide. */
export function revealCorners(width:number,height:number,yaw:number,pitch:number,roll:number,scale:number){
 const ay=yaw*Math.PI/180,ax=pitch*Math.PI/180,az=roll*Math.PI/180,d=1100;
 return [[-width/2,-height/2],[width/2,-height/2],[width/2,height/2],[-width/2,height/2]].flatMap(([x,y])=>{const xx=x!*Math.cos(ay),z=-x!*Math.sin(ay),yy=y!*Math.cos(ax)-z*Math.sin(ax),zz=y!*Math.sin(ax)+z*Math.cos(ax),p=d/(d-zz);return[(xx*Math.cos(az)-yy*Math.sin(az))*p*scale,(xx*Math.sin(az)+yy*Math.cos(az))*p*scale];});
}
export function revealWarmupCards(content:GameContent,state:Readonly<GameState>){const heroes=new Set(state.units.filter(u=>u.kind==='HERO').map(u=>u.defId));return Object.values(content.cards).filter(c=>c.rarity==='ULTRA'&&(!c.heroId||heroes.has(c.heroId))).map(c=>c.id);}
function lightTexture(size:number,kind:'halo'|'sheen'|'rays'){
 const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d')!;
 if(kind==='halo'){const gradient=g.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);gradient.addColorStop(0,'#ffffffaa');gradient.addColorStop(.4,'#ffffff22');gradient.addColorStop(1,'#ffffff00');g.fillStyle=gradient;g.fillRect(0,0,size,size);}
 else if(kind==='sheen'){const gradient=g.createLinearGradient(0,0,size,size*.3);gradient.addColorStop(0,'#ffffff00');gradient.addColorStop(.42,'#ffffff00');gradient.addColorStop(.5,'#ffffff55');gradient.addColorStop(.58,'#ffffff00');gradient.addColorStop(1,'#ffffff00');g.fillStyle=gradient;g.fillRect(0,0,size,size);}
 else{g.translate(size/2,size/2);for(let i=0;i<12;i++){g.rotate(Math.PI/6);const grad=g.createLinearGradient(0,0,0,-size/2);grad.addColorStop(0,'#ffffff00');grad.addColorStop(.4,'#ffffff18');grad.addColorStop(1,'#ffffff00');g.fillStyle=grad;g.beginPath();g.moveTo(-5,-size*.15);g.lineTo(-size*.04,-size*.48);g.lineTo(size*.04,-size*.48);g.closePath();g.fill();}}
 return Texture.from(c);
}
let resourceProbe:(()=>{cachedFaces:number;ownedTextures:number;estimatedBytes:number;active:boolean;pending:number})|null=null;
export const revealResourceSnapshot=()=>resourceProbe?.()??{cachedFaces:0,ownedTextures:0,estimatedBytes:0,active:false,pending:0};
export class ArcaneRevealView{
 readonly root=new Container({eventMode:'none'});private faces=new Map<string,Texture>();private pending=new Map<string,Promise<void>>();private destroyed=false;private front:PerspectiveMesh;private reverse:PerspectiveMesh;private shine:PerspectiveMesh;private dim=new Graphics();private halo:Sprite;private rays:Sprite;private materials:Texture[];private back:Texture|null=null;private active='';private geometries:PerspectiveMesh['geometry'][]=[];private layout='';private offReveal:()=>void=()=>{};
 private readonly readResources=()=>this.snapshot;private readonly layers=new RevealLayerOrder(()=>this.app.canvas);
 constructor(private app:Application,private content:GameContent){resourceProbe=this.readResources;
  this.materials=[lightTexture(256,'halo'),lightTexture(256,'rays'),lightTexture(256,'sheen')];this.halo=new Sprite(this.materials[0]);this.rays=new Sprite(this.materials[1]);this.halo.anchor.set(.5);this.rays.anchor.set(.5);
  this.front=new PerspectiveMesh({texture:Texture.WHITE,verticesX:12,verticesY:12});this.reverse=new PerspectiveMesh({texture:Texture.WHITE,verticesX:12,verticesY:12});this.shine=new PerspectiveMesh({texture:this.materials[2]!,verticesX:12,verticesY:12});this.shine.blendMode='add';this.geometries=[this.front.geometry,this.reverse.geometry,this.shine.geometry];
  this.root.addChild(this.dim,this.halo,this.rays,this.reverse,this.front,this.shine);this.root.visible=false;this.offReveal=subscribeReveal(frame=>{if(!frame){this.root.visible=false;this.layers.end();}});
 }
 async prepare(ids:string[]){await Promise.all(ids.map(id=>{if(this.faces.has(id))return;let task=this.pending.get(id);if(!task){task=(async()=>{const card=this.content.cards[id];if(!card||card.rarity!=='ULTRA')return;const canvas=await rasterRevealCard(card);if(this.destroyed)return;this.faces.set(id,Texture.from(canvas));})();this.pending.set(id,task);void task.then(()=>this.pending.delete(id),()=>this.pending.delete(id));}return task;}));if(!this.back&&!this.destroyed)this.back=await Assets.load<Texture>(STANDARD_CARD_BACK);}
 get snapshot(){return{cachedFaces:this.faces.size,ownedTextures:this.materials.length+this.faces.size,estimatedBytes:[...this.materials,...this.faces.values()].reduce((sum,t)=>sum+t.width*t.height*4,0),active:this.root.visible,pending:this.pending.size};}
 tick(){const frame=readRevealFrame();if(readRevealRenderer()!=='pixi'||!frame||!this.faces.has(frame.cardId)){this.root.visible=false;this.layers.end();return;}this.layers.begin();this.root.visible=true;const w=this.app.screen.width,h=this.app.screen.height,p=revealPose(frame.progress,frame.duration<500),width=Math.min(innerWidth*(innerWidth<=600?.7:.4),innerWidth<=600?300:350,(innerHeight-(innerWidth<=600?245:230))*.716,(h-20)*.716),height=width/.716;
  if(this.active!==frame.cardId){this.active=frame.cardId;this.front.texture=this.faces.get(frame.cardId)!;this.reverse.texture=this.back??Texture.WHITE;}
  const color=({ICE:0x71dbff,THUNDER:0xab8fff,FIRE:0xff9a4d,NATURE:0x73da9c}as Record<string,number>)[this.content.cards[frame.cardId]!.presentation.element]??0xaa99ff;
  this.root.alpha=p.opacity;this.root.position.set(w/2,h*.5+p.y);const layout=w+':'+h;if(layout!==this.layout){this.layout=layout;this.dim.clear().rect(-w/2,-h*.5,w,h).fill({color:0x040711,alpha:.35});}this.dim.y=-p.y;
  this.halo.tint=color;this.halo.width=this.halo.height=width*2.1;this.halo.alpha=.6;this.rays.visible=frame.duration>=500;this.rays.tint=color;this.rays.width=this.rays.height=width*2.7;this.rays.alpha=p.release;this.rays.rotation=p.release*.32;
  const back=Math.cos(p.yaw*Math.PI/180)<0;this.front.visible=!back;this.reverse.visible=back;this.shine.visible=!back&&frame.duration>=500;const corners=revealCorners(width,height,back?p.yaw+180:p.yaw,p.pitch,p.roll,p.scale)as[number,number,number,number,number,number,number,number];
  this.front.setCorners(...corners);this.reverse.setCorners(...corners);this.shine.setCorners(...corners);this.shine.alpha=.25+.35*Math.sin(frame.progress*Math.PI);this.shine.tint=color;
 }
 destroy(){if(this.destroyed)return;this.destroyed=true;this.offReveal();this.layers.end();if(!this.root.destroyed)this.root.destroy({children:true});for(const g of this.geometries)g.destroy();this.geometries=[];for(const t of this.faces.values())t.destroy(true);this.faces.clear();for(const t of this.materials)t.destroy(true);this.materials=[];this.pending.clear();if(resourceProbe===this.readResources)resourceProbe=null;}
}
