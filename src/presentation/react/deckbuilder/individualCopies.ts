/** Presentation only. The competitive target does not replace authoritative DECK_RULES. */
export const PLANNED_COMPETITIVE_DECK_SIZE = 40;
export interface CopyEntry {cardId:string;count:number}
export function individualCopies(entries:readonly CopyEntry[],limit:number){
 const result:{cardId:string;copy:number}[]=[];
 for(const entry of entries){for(let copy=0;copy<entry.count&&result.length<limit;copy++)result.push({cardId:entry.cardId,copy});if(result.length>=limit)break;}
 return result;
}
