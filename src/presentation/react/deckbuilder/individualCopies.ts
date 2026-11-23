/** Presentation only. The competitive target does not replace authoritative DECK_RULES. */
export const PLANNED_COMPETITIVE_DECK_SIZE = 40;
export interface CopyEntry {cardId:string;count:number}
export function individualCopies(entries:readonly CopyEntry[],limit:number){
 const result:{cardId:string;copy:number}[]=[];
 for(const entry of entries){for(let copy=0;copy<entry.count&&result.length<limit;copy++)result.push({cardId:entry.cardId,copy});if(result.length>=limit)break;}
 return result;
}
/** Collection identity is cardId; ownership is never capped to the deck limit or draft remainder. */
export function collectionCopies(entries:readonly CopyEntry[],limit:number){
 const counts=new Map<string,number>();for(const e of entries)if(e.count>0)counts.set(e.cardId,(counts.get(e.cardId)??0)+e.count);
 return [...counts].slice(0,limit).map(([cardId,count])=>({cardId,copy:0,count}));
}
