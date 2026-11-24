import type {Container} from 'pixi.js';
import type {Pos} from '../../game';
import type {FxGeometry} from './ElementEffects';
import {PaintedEffectPool} from './PaintedEffectPool';
import {catalogPremiumEnabled} from './catalogRecipes';
import {hammerEntry,hammerFlight,HAMMER_CONTACT_MS} from './thunderHammerRecipe';
/** Original physical prop, existing Premium pool/clock; lightning remains in the shared bank. */
export class ThunderHammerEffects extends PaintedEffectPool{
 constructor(actors:Container,ground:Container,geometry:FxGeometry){super(actors,ground,geometry,'thunder-hammer',6,'png');}
 get requested(){return catalogPremiumEnabled();}
 descend(at:Pos,duration:number){
  const p=this.geometry.center(at),w=this.geometry.footprint(at).w;
  const entry=hammerEntry(p,w,this.geometry.boardTop?.()??0);
  this.sprite([0],p,w*1.45,duration,(t,s)=>{
   const flight=hammerFlight(entry,p,t,this.reduced);s.anchor.set(.72,.81);
   s.position.set(flight.x,flight.y);s.width=s.height=w*1.45;
   s.rotation=this.reduced?0:flight.angle-Math.PI/5;s.alpha=this.reduced ? .7 : Math.min(1,t*12);
   s.zIndex=this.geometry.depth(p)+15;
  },false,false);
 }

 contact(at:Pos){
  const p=this.geometry.center(at),w=this.geometry.footprint(at).w;
  this.sprite([0],p,w*1.45,this.reduced?120:HAMMER_CONTACT_MS,(t,s)=>{
   s.anchor.set(.72,.81);s.width=s.height=w*1.45;s.rotation=this.reduced?0:hammerFlight(hammerEntry(p,w,this.geometry.boardTop?.()??0),p,1).angle-Math.PI/5;
   s.alpha=Math.max(0,1-Math.max(0,t-.22)/.78);s.zIndex=this.geometry.depth(p)+15;
  },false,false);
 }
}
