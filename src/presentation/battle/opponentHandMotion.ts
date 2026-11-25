import type { GameEvent } from '../../game';
export type OpponentHandMotion = 'draw'|'play'|'discard'|'trade-out'|'trade-in';
/** Counts + already public facts only. Never inspect a rival card instance or its identity. */
export function opponentHandMotions(before:number,after:number,events:readonly GameEvent[],opponentId:string):OpponentHandMotion[]{
  const plays=events.some(e=>(e.type==='CARD_PLAYED'||e.type==='CARD_CURSE_TRIGGERED')&&e.casterId===opponentId)?1:0;
  const trade=events.some(e=>e.type==='CARDS_EXCHANGED'&&(e.casterId===opponentId||e.opponentId===opponentId))?1:0;
  const delta=after-before;
  const out=Math.min(before,Math.max(-delta,plays+trade));
  const cast=Math.min(plays,out),exchanged=Math.min(trade,out-cast);
  const motions:OpponentHandMotion[]=[...Array<OpponentHandMotion>(cast).fill('play'),...Array<OpponentHandMotion>(exchanged).fill('trade-out'),...Array<OpponentHandMotion>(out-cast-exchanged).fill('discard')];
  const incoming=Math.max(0,out+delta);
  if(trade&&incoming)motions.push('trade-in');
  motions.push(...Array<OpponentHandMotion>(incoming-(trade&&incoming?1:0)).fill('draw'));
  return motions;
}
