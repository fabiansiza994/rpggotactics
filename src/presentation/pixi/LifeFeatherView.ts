import {Container,Graphics} from 'pixi.js';
export function drawLifeFeather(g:Graphics):void {
 g.moveTo(-3,9).bezierCurveTo(-11,3,-7,-15,4,-22).bezierCurveTo(11,-9,9,3,-3,9).fill({color:0x12101b,alpha:.98}).stroke({color:0x9d6cc5,width:1.2});
 g.moveTo(-4,14).lineTo(4,-20).stroke({color:0xc4a0ec,width:1});
 for(let i=0;i<4;i++){const y=3-i*5,x=-1+i;g.moveTo(x-5,y-2).lineTo(x,y).lineTo(x+5,y-5).stroke({color:0x775494,width:.8,alpha:.85});}
}
/** Persistent lightweight pickup, animated only by the existing paused presentation clock. */
export class LifeFeatherView {
 readonly root=new Container();private readonly body=new Graphics();private time=0;
 constructor(){
  drawLifeFeather(this.body);
  this.root.addChild(this.body);this.root.eventMode='none';
 }
 tick(ms:number,reduced:boolean){this.time+=ms;this.body.y=reduced?0:Math.sin(this.time/900)*1.8;this.body.rotation=reduced?-.18:-.18+Math.sin(this.time/1200)*.04;}
 destroy(){this.root.destroy({children:true});}
}
