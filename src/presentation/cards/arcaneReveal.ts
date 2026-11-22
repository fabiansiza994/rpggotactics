import type {CardDefinition,EventOfType,GameEvent} from '../../game';
import type {PresentationBatch} from '../events/presentationBus';
export type RevealMode='full'|'reduced'|'off';
export const REVEAL_SETTINGS_KEY='rpggo:ultra-revelation:v2';
const preferenceListeners=new Set<()=>void>();
let mode:RevealMode|undefined;
export function readRevealMode():RevealMode{if(mode)return mode;try{const stored=localStorage.getItem(REVEAL_SETTINGS_KEY);mode=stored==='off'||stored==='reduced'?stored:'full';}catch{mode='full';}return mode;}
export function writeRevealMode(value:RevealMode){mode=value;try{localStorage.setItem(REVEAL_SETTINGS_KEY,value);}catch{/* Device preference works without storage. */}for(const fn of preferenceListeners)fn();}
export function subscribeRevealMode(fn:()=>void){preferenceListeners.add(fn);return()=>{preferenceListeners.delete(fn);};}
export type RevealPlan={id:string;duration:number};
/** Bounded, presentation-only memory. Revision is authoritative in PvP; no token or game data persists. */
export class RevealLedger{
 private readonly seen=new Set<string>();
 claim(events:readonly GameEvent[],card:(id:string)=>CardDefinition|undefined,batch:PresentationBatch|undefined,reduced:boolean,preference:RevealMode):Map<GameEvent,RevealPlan>{
  const accepted=new Map<GameEvent,RevealPlan>();
  if(!batch?.key)return accepted;
  events.forEach((e,index)=>{if(e.type!=='CARD_PLAYED'||card(e.cardId)?.rarity!=='ULTRA')return;
   const id=`${batch.key}:${index}:${e.casterId}:${e.cardUid}`;if(this.seen.has(id))return;
   this.seen.add(id);while(this.seen.size>512)this.seen.delete(this.seen.values().next().value!);
   if(batch.live&&preference!=='off')accepted.set(e,{id,duration:reduced||preference==='reduced'?320:2200});
  });return accepted;
 }
}
export const revealLedger=new RevealLedger();
export type RevealFrame=RevealPlan&{cardId:string;casterId:string;progress:number;skip():void};
let frame:RevealFrame|null=null;
const listeners=new Set<(frame:RevealFrame|null)=>void>();
export function readRevealFrame(){return frame;}
export function presentReveal(next:RevealFrame|null){frame=next;for(const fn of listeners)fn(next);}
export function subscribeReveal(fn:(frame:RevealFrame|null)=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
/** Geometry only: CSS 3D transforms; never advances gameplay or starts a second frame clock. */
export function revealPose(progress:number,reduced=false){
 const p=Math.max(0,Math.min(1,progress)),enter=Math.min(1,p/.3),exit=Math.max(0,(p-.78)/.22),ease=1-(1-enter)**3;
 return {yaw:reduced?0:p<.38?-160*(1-Math.min(1,p/.38))**2:p<.78?Math.sin((p-.38)/.4*Math.PI)*5:exit*22,
 pitch:reduced?0:12*(1-ease)-exit*8,roll:reduced?0:-8*(1-ease)+exit*4,
 scale:reduced?1:.72+.28*ease-exit*.16,y:reduced?0:60*(1-ease)-exit*54,
 opacity:p===1?0:Math.min(1,p/.08)*(1-exit),light:25+p*65,release:Math.max(0,(p-.55)/.45)};
}
export type UltraCast=EventOfType<'CARD_PLAYED'>;

/** Hide only the newly activated viewport climate until the existing impact cue. */
export function worldRevealPending(active:boolean){if(typeof document!=='undefined')document.body?.toggleAttribute?.('data-arcane-world-pending',active);}
