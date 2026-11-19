import {Container,Graphics}from'pixi.js';
export type ShieldMaterial='ENERGY'|'ICE';
type Pane={g:Graphics;x:number;y:number;a:number;front:boolean};
/** Unit-local volume, reconstructed from shield provenance; HP chrome lives outside these layers. */
export class ShieldBarrierView {
 readonly back=new Container();readonly front=new Container();private panes:Pane[]=[];
 private amount=0;private material:ShieldMaterial='ENERGY';private clock=0;private pulse=0;private age=0;private mode:'hold'|'break'|'expire'='hold';private side=1;private initialized=false;private built=false;private peak=0;private readonly flash=new Graphics();private readonly fractures=new Graphics();
 constructor(private width:number,private height:number){this.back.eventMode=this.front.eventMode='none';this.back.visible=this.front.visible=false;}
 private build():void{
  for(const p of this.panes)p.g.destroy({context:true});this.panes=[];
  const ice=this.material==='ICE',w=this.width,h=this.height;
  // Two hemispheres of irregular convex plates: transparent central volume, bright side facets.
  for(const front of [false,true])for(let i=0;i<7;i++){
   const a=-Math.PI+i*Math.PI/6,x=Math.cos(a)*w*.82,y=-h*.46+Math.sin(a)*(front?h*.16:-h*.13),g=new Graphics(),edge=ice?0xb5eeff:0xffe2a1;
   const top=-h*.4*(.65+.35*Math.sin(i*Math.PI/6)),bottom=h*.35*(.7+.3*Math.sin(i*Math.PI/6)),pw=w*.38;
   g.poly([-pw*.8,top*.6,0,top,pw*.78,top*.55,pw, bottom*.7,0,bottom,-pw,bottom*.6]).fill({color:ice?0x72bedc:0x8b80cd,alpha:front?.085:.045}).stroke({color:edge,width:ice?1.6:1,alpha:front?.47:.18});
   if(ice){g.poly([0,top,pw*.78,top*.55,0,bottom]).fill({color:0xd4f6ff,alpha:.13});g.moveTo(-pw*.7,top*.6).lineTo(0,bottom).stroke({color:0x8ed1e8,width:.7,alpha:.3});}
   else{g.moveTo(-pw*.35,-7).lineTo(0,-15).lineTo(pw*.35,-7).lineTo(0,1).closePath().stroke({color:0xffe4b4,width:1,alpha:.4});g.moveTo(0,5).lineTo(0,12).stroke({color:0xffdf94,width:1,alpha:.35});}
   g.position.set(x,y);(front?this.front:this.back).addChild(g);this.panes.push({g,x,y,a,front});
  }
  this.flash.clear().poly([-9,0,0,-18,9,0,0,18]).stroke({color:ice?0xf0ffff:0xfff4c8,width:2,alpha:.9});
  this.fractures.clear().moveTo(-w*.6,-h*.7).lineTo(-w*.14,-h*.48).lineTo(-w*.3,-h*.27).moveTo(-w*.14,-h*.48).lineTo(w*.3,-h*.57).lineTo(w*.6,-h*.45).stroke({color:0xe0fbff,width:1,alpha:.7});
  this.front.addChild(this.fractures,this.flash);
 }
 sync(amount:number,material:ShieldMaterial='ENERGY'):void{
  if(amount>0&&(!this.built||material!==this.material)){this.material=material;this.build();this.built=true;}
  if(amount>0){if(this.amount<=0)this.peak=amount;else this.peak=Math.max(this.peak,amount);this.mode='hold';this.age=0;this.back.visible=this.front.visible=true;}
  else if(this.amount>0&&this.mode==='hold'){this.mode='expire';this.age=0;}
  this.fractures.alpha=this.material==='ICE'&&this.peak?Math.max(0,1-amount/this.peak)*.6:0;
  this.amount=amount;this.initialized=true;
 }
 impact(side=1):void{this.side=side;this.pulse=240;}
 gained():void{this.pulse=300;}
 shatter():void{if(!this.initialized)return;this.mode='break';this.age=0;this.pulse=160;}
 expire():void{if(this.back.visible){this.mode='expire';this.age=0;}}
 advance(ms:number,reduced:boolean):void{
  if(!this.back.visible)return;this.clock+=ms;this.age+=ms;this.pulse=Math.max(0,this.pulse-ms);
  const exit=this.mode==='hold'?0:Math.min(1,this.age/(reduced?160:this.mode==='break'?470:300));
  this.flash.position.set(Math.sign(this.side||1)*this.width*.5,-this.height*.5);this.flash.alpha=this.pulse/300;
  this.front.alpha=this.back.alpha=1-exit;const breathe=reduced?1:1+Math.sin(this.clock/1400)*.008;this.front.scale.set(breathe);this.back.scale.set(breathe);
  for(const p of this.panes){const local=this.pulse/300*(Math.sign(p.x||1)===Math.sign(this.side)?1:.2),burst=this.mode==='break'&&!reduced?exit:0;
   p.g.position.set(p.x+Math.cos(p.a)*burst*this.width*.5,p.y+burst*(p.front?14:-10));p.g.rotation=burst*Math.sin(p.a)*.65;
   p.g.alpha=.82+Math.min(.18,local);p.g.scale.set(1+local*(reduced?0:.06));
  }
  if(exit===1){this.front.visible=this.back.visible=false;}
 }
 destroy():void{if(!this.built){this.flash.destroy({context:true});this.fractures.destroy({context:true});}this.back.destroy({children:true});this.front.destroy({children:true});this.panes=[];}
}
