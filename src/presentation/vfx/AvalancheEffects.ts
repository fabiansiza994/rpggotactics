import type {Container} from 'pixi.js';
import type {Pos} from '../../game';
import type {FxGeometry} from './ElementEffects';
import {PaintedEffectPool} from './PaintedEffectPool';
import {fireballPilotAllowed} from './fireballRecipe';
const FLOW=[0,1,2,3,4,5,6,7] as const;
const IMPACT=[8,9,10,11,12,13,14,15] as const;

/** One illustrated snow mass, not one miniature avalanche per affected square.
 * Uses the same bounded atlas pool, asset gate, scene clock and depth sorting as Fireball. */
export class AvalancheEffects extends PaintedEffectPool {
 constructor(actors:Container,ground:Container,geometry:FxGeometry){
  super(actors,ground,geometry,'avalanche-snow',20,'png');
 }
 get requested(){return fireballPilotAllowed();}
 play(origin:Pos,tiles:readonly Pos[],duration:number,impact=false):void {
  if(!tiles.length)return;
  const points=tiles.map(p=>this.geometry.center(p)),foot=this.geometry.footprint(tiles[0]!),
   startTile=[...tiles].sort((a,b)=>Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y))[0]!,
   start=this.geometry.center(startTile),
   center={x:points.reduce((v,p)=>v+p.x,0)/points.length,y:points.reduce((v,p)=>v+p.y,0)/points.length},
   from=this.geometry.center(origin),angle=Math.atan2(center.y-from.y,center.x-from.x),
   width=Math.max(foot.w*1.4,Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))+foot.w),
   depth=this.geometry.depth(center);
  this.blendedSprite(impact?IMPACT:FLOW,center,width,duration,(t,s)=>{
   const p=this.reduced?1:1-(1-t)**2;
   s.position.set(impact?center.x:start.x+(center.x-start.x)*p,
    (impact?center.y:start.y+(center.y-start.y)*p)-foot.h*.26);
   // Registration is held steady; flow comes from the painted sequence, not scaling a static image.
   s.width=width;s.height=width*.8;s.rotation=this.reduced?0:angle-Math.PI*.75;
   s.alpha=(this.reduced?.48:.9)*(impact?1:Math.min(1,t*8))*(impact?(1-t)**.65:1);
   s.zIndex=depth+3;
  },false,false);
  if(!impact)return;
  for(const tile of tiles.slice(0,16)){
   const p=this.geometry.center(tile);
   this.sprite([15],p,foot.w*1.2,this.reduced?200:1100,(t,s)=>{
    s.height=foot.h*.7;s.alpha=.24*(1-t)**1.5;
   },true,false);
  }
 }
}
