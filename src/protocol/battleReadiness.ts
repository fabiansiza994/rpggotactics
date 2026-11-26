/** Operational admission gate; deliberately outside the combat/content engines. */
export const READINESS_PROTOCOL='battle-readiness-1';
/** Matches the existing 60s reconnection policy. No RP settlement before activation. */
export const PREPARATION_TIMEOUT_MS=60_000;
export interface BattlePreparation {
 id:string;
 phase:'PREPARING'|'ACTIVE'|'ABORTED';
 deadline:number;
 readySeats:number[];
 activeAt?:number;
 abortedAt?:number;
}
export function newPreparation(matchId:string,now:number):BattlePreparation{return{id:matchId,phase:'PREPARING',deadline:now+PREPARATION_TIMEOUT_MS,readySeats:[]};}
export function preparationBlocks(p:BattlePreparation|undefined):boolean{return !!p&&p.phase!=='ACTIVE';}
export function acknowledgePreparation(p:BattlePreparation,matchId:unknown,seat:number,requiredSeats:readonly number[],now:number):'ignored'|'expired'|'waiting'|'started'{
 if(matchId!==p.id||!requiredSeats.includes(seat)||p.phase!=='PREPARING')return'ignored';
 if(now>=p.deadline)return'expired';
 if(!p.readySeats.includes(seat))p.readySeats.push(seat);
 if(requiredSeats.every(s=>p.readySeats.includes(s))){p.phase='ACTIVE';p.activeAt=now;return'started';}
 return'waiting';
}
export function abortPreparation(p:BattlePreparation,now:number):boolean{if(p.phase!=='PREPARING')return false;p.phase='ABORTED';p.abortedAt=now;return true;}
