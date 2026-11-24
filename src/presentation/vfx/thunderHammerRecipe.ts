/** Presentation budgets only. Server resolution never reads these values. */
export const HAMMER_TIMING={cast:500,travel:640,aftermath:1100,read:160} as const;
export const HAMMER_CONTACT_MS=320;
export type HammerPoint={x:number;y:number};
/** Propelled entry: immediate forward velocity and an aggressive final burn, no hovering hold. */
export function hammerDescent(t:number,reduced=false){
 const p=Math.max(0,Math.min(1,t));
 return reduced?1:.16*p+.84*Math.pow(p,2.7);
}
export function hammerEntry(at:HammerPoint,tileWidth:number,boardTop=0):HammerPoint{
 const scale=tileWidth/96;
 return{x:at.x-200*scale,y:Math.min(boardTop-140*scale,at.y-380*scale)};
}
export function hammerFlight(entry:HammerPoint,at:HammerPoint,t:number,reduced=false){
 const p=hammerDescent(t,reduced),dx=at.x-entry.x,dy=at.y-entry.y,length=Math.hypot(dx,dy)||1;
 return{x:entry.x+dx*p,y:entry.y+dy*p,ux:dx/length,uy:dy/length,angle:Math.atan2(dy,dx),progress:p};
}
