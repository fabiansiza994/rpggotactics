import { Graphics, Text, type Container, type Sprite } from 'pixi.js';
import type { Pos } from '../../game';
import type { FxGeometry } from './ElementEffects';
import { PaintedEffectPool } from './PaintedEffectPool';
import { catalogPremiumEnabled } from './catalogRecipes';

import { pulseFootprint } from './paralyzingPulseRecipe';

/** A bounded recipe inside the existing catalog/clock. Reuses the approved thunder atlas unchanged. */
export class ParalyzingPulseEffects extends PaintedEffectPool {
  private readonly mask = new Graphics();
  private readonly masked = new Set<Sprite>();
  private area: readonly Pos[] = [];
  private waveRemaining = 0;
  private readonly labels: {text:Text;at:Pos;age:number}[] = [];
  private readonly freeLabels: Text[] = [];
  private labelCount = 0;
  constructor(private readonly actorLayer:Container, private readonly groundLayer:Container, geometry:FxGeometry) {
    super(actorLayer, groundLayer, geometry, 'thunder-premium', 32);
    this.mask.eventMode = 'none';
    this.mask.label = 'paralyzing-pulse-confirmed-area';
  }
  get requested() { return catalogPremiumEnabled(); }
  override get snapshot() { return {...super.snapshot,labels:this.labels.length,maskActive:this.waveRemaining>0}; }
  charge(from:Pos, affected:readonly Pos[], duration:number) {
    this.area = affected.map(p=>({...p}));
    const c=this.lifted(from,0.35),scale=this.geometry.footprint(from).w/96;
    for(let i=0;i<(this.reduced?1:3);i++) {
      this.sprite([0,1,2,3],c,(40+i*8)*scale,duration,(t,s)=>{
        s.mask=null;
        const a=i*2.094+t*(this.reduced?0:2.1);
        s.position.set(c.x+Math.cos(a)*15*scale,c.y+Math.sin(a)*16*scale);
        s.width=(36+12*t)*scale;s.height=13*scale;
        s.rotation=a+0.6;s.alpha=(this.reduced?0.22:0.38+0.18*t)*Math.sin(Math.PI*(0.1+0.8*t));
        s.zIndex=this.geometry.depth(this.geometry.center(from))+4;
      });
    }
    this.sprite([15],c,30*scale,duration,(t,s)=>{
      s.mask=null;s.width=s.height=(16+23*t)*scale;s.alpha=(this.reduced?0.2:0.42)*t;
      s.zIndex=this.geometry.depth(this.geometry.center(from))+3;
    });
  }
  release(from:Pos,duration:number) {
    const surface=pulseFootprint(from,this.area,this.geometry),life=duration+(this.reduced?90:180);
    // Build once per cast, never per frame. The ring cannot paint invalid diagonal tiles.
    this.detachMask();this.mask.clear();
    for(const tile of [from,...surface.tiles]) {
      const quad=this.geometry.quad(tile,0.015);
      if(quad.length>=3)this.mask.poly(quad.flatMap(p=>[p.x,p.y])).fill(0xffffff);
    }
    this.groundLayer.addChild(this.mask);
    this.waveRemaining=life;
    for(let i=0;i<(this.reduced?1:2);i++) {
      this.sprite(i?[13]:[10],surface.center,10,life,(t,s)=>{
        const progress=Math.min(1,t*life/Math.max(1,duration));
        const radius=Math.max(0.05,progress*(i?0.86:1));
        // The illustrated ring occupies 89% × 61% of its square atlas cell.
        // Compensate its transparent margins so the visible rim reaches the real tile centers.
        s.anchor.set(i?0.5:0.505,i?0.5:0.54);
        s.width=surface.rx*2*radius/(i?1:0.89);s.height=surface.ry*2*radius/(i?1:0.61);
        s.alpha=(this.reduced?0.26:i?0.22:0.72)*Math.min(1,progress*5)*Math.min(1,(1-t)*4);
        s.tint=i?0x91d7ff:0xe4f9ff;
        s.mask=this.mask;this.masked.add(s);
      },true);
    }
  }
  impact(from:Pos,affected:readonly Pos[]) {
    for(const tile of pulseFootprint(from,affected,this.geometry).tiles) {
      const c=this.geometry.center(tile),f=this.geometry.footprint(tile);
      this.sprite([13],c,f.w*0.87,this.reduced?130:320,(t,s)=>{
        s.mask=null;s.height=f.h*0.85;s.alpha=(this.reduced?0.15:0.46)*(1-t*t);
      },true);
      if(!this.reduced)this.sprite([15],c,10*f.w/96,410,(t,s)=>{
        s.mask=null;s.position.set(c.x+Math.sin(tile.x*7+tile.y)*10*t,c.y-25*t*f.w/96);
        s.alpha=0.5*(1-t);s.zIndex=this.geometry.depth(c)+3;
      });
    }
  }
  target(at:Pos) {
    const p=this.lifted(at,0.4),scale=this.geometry.footprint(at).w/96;
    this.sprite([9],p,60*scale,this.reduced?130:260,(t,s)=>{
      s.mask=null;s.alpha=(this.reduced?0.22:0.55)*(1-t*t);s.zIndex=this.geometry.depth(this.geometry.center(at))+5;
    });
    if(!this.reduced)this.sprite([11],p,57*scale,470,(t,s)=>{
      s.mask=null;s.y=p.y-8*t*scale;s.alpha=0.4*(1-t);s.zIndex=this.geometry.depth(this.geometry.center(at))+4;
    });
  }
  status(at:Pos,turns:number) {
    if(this.labels.length>=4)return;
    const text=this.freeLabels.pop()??(this.labelCount<4?(this.labelCount++,new Text({text:'',style:{fontFamily:'system-ui',fontSize:12,fontWeight:'700',fill:0xaeeaff,stroke:{color:0x09131f,width:3}}})):null);
    if(!text)return;
    text.text=`Ralentizado · ${turns} turno${turns===1?'':'s'}`;
    text.anchor.set(0.5);text.alpha=0.95;text.eventMode='none';
    const p=this.lifted(at,0.77);text.position.set(p.x,p.y);text.zIndex=this.geometry.depth(this.geometry.center(at))+7;
    this.actorLayer.addChild(text);this.labels.push({text,at,age:0});
  }
  private detachMask() {
    for(const sprite of this.masked)sprite.mask=null;
    this.masked.clear();this.mask.removeFromParent();
  }
  override tick(ms:number) {
    super.tick(ms);
    this.waveRemaining=Math.max(0,this.waveRemaining-Math.max(0,ms));
    if(!this.waveRemaining&&this.masked.size){this.detachMask();this.mask.clear();}
    for(let i=this.labels.length-1;i>=0;i--){
      const label=this.labels[i]!;label.age+=Math.max(0,ms);
      const t=label.age/(this.reduced?500:700),p=this.lifted(label.at,0.77);
      label.text.position.set(p.x,p.y-(this.reduced?0:t*9));label.text.alpha=Math.min(0.95,(1-t)*3);
      if(t>=1){label.text.removeFromParent();this.freeLabels.push(label.text);this.labels.splice(i,1);}
    }
  }
  override clear() {
    this.detachMask();this.mask.clear();this.waveRemaining=0;this.area=[];
    for(const label of this.labels){label.text.removeFromParent();this.freeLabels.push(label.text);}
    this.labels.length=0;super.clear();
  }
  override destroy() {
    super.destroy();this.mask.destroy();for(const text of this.freeLabels)text.destroy();this.freeLabels.length=0;
  }
}
