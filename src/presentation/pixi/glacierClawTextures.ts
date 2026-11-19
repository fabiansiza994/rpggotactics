import {Assets, Rectangle, Texture} from 'pixi.js';
export const CLAW_KIT_URL = '/art/vfx/glacier-claw-20/ice-hand-anatomy.png';
/** Original generated RGBA raster, runtime subtextures only; never regenerated per frame. */
export const CLAW_PARTS = [
  {name:'palm',x:40,y:30,w:440,h:455,segments:1},
  {name:'thumb',x:620,y:10,w:280,h:430,segments:2},
  {name:'index',x:180,y:520,w:160,h:465,segments:3},
  {name:'middle',x:680,y:480,w:195,h:510,segments:3},
  {name:'ring',x:180,y:1040,w:170,h:480,segments:3},
  {name:'little',x:680,y:1110,w:190,h:410,segments:3},
] as const;
export interface ClawRigTextures {palm:Texture; fingers:Texture[][]}
let cached:ClawRigTextures|undefined;
let job:Promise<void>|undefined;
export const clawRigTextures=()=>cached;
export function loadClawRig():Promise<void>{
 return job??=(async()=>{
  const sheet=await Assets.load<Texture>(CLAW_KIT_URL);
  const part=(i:number)=>{const p=CLAW_PARTS[i]!;return new Texture({source:sheet.source,frame:new Rectangle(p.x,p.y,p.w,p.h)});};
  const fingers=CLAW_PARTS.slice(1).map(p=>Array.from({length:p.segments},(_,bone)=>{
   // Base→tip with a tiny overlap at the joint; source material and anatomy stay unchanged.
   const lo=Math.max(0,Math.floor(p.h*(1-(bone+1)/p.segments))-3),hi=Math.min(p.h,Math.ceil(p.h*(1-bone/p.segments))+3);
   return new Texture({source:sheet.source,frame:new Rectangle(p.x,p.y+lo,p.w,hi-lo)});
  }));
  cached={palm:part(0),fingers};
 })().catch(error=>{job=undefined;console.warn('Glacier hand texture unavailable; authoritative status/HUD remains available.',error);});
}
