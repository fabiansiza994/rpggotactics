import {Container,Graphics} from 'pixi.js';
/** One pooled scene object per authoritative resource; no independent ticker or textures. */
export class ScoutResourceView {
 readonly root=new Container();private readonly body=new Graphics();private time=0;private retiring=false;private fadeMs=0;
 constructor(kind:'HEAL'|'ARMOR'|'ENERGY'){
  const color=kind==='HEAL'?0x6be394:kind==='ARMOR'?0xffd78a:0xb691ff;
  this.body.ellipse(0,2,14,5).fill({color,alpha:.2});
  if(kind==='HEAL'){
   this.body.moveTo(0,0).lineTo(0,-18).stroke({color:0xd2f4b1,width:2});
   this.body.ellipse(-5,-8,6,3).fill(color);this.body.ellipse(5,-13,6,3).fill(color);
   this.body.roundRect(-2,-27,4,9,1).fill(0xffffff).roundRect(-5,-24,10,3,1).fill(0xffffff);
  }else if(kind==='ARMOR')this.body.poly([-10,-23,10,-23,8,-7,0,0,-8,-7]).fill({color,alpha:.9}).stroke({color:0xffffff,width:1.4});
  else this.body.poly([0,-30,9,-15,0,0,-9,-15]).fill(color).stroke({color:0xffffff,width:1.5});
  this.root.addChild(this.body);this.root.eventMode='none';
 }
 retire(){this.retiring=true;}
 tick(ms:number,reduced:boolean):boolean{this.time+=ms;this.body.y=reduced?0:Math.sin(this.time/700)*1.5;if(this.retiring){this.fadeMs+=ms;this.root.alpha=reduced?0:Math.max(0,1-this.fadeMs/180);}return this.retiring&&(reduced||this.fadeMs>=180);}
 destroy(){this.root.destroy({children:true});}
}
