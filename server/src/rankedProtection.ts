import type {Env} from './db';
export const PROTECTION_WINDOW_MS=30*60_000;
export type ProtectionKind='VOLUNTARY'|'PREVENTIVE';
export interface ProtectionEvent{id:string;room:string;at:number;kind:ProtectionKind}
export interface ProtectionState{events:ProtectionEvent[];voluntaryUntil:number;preventiveUntil:number}
export const emptyProtection=():ProtectionState=>({events:[],voluntaryUntil:0,preventiveUntil:0});
export function protectionView(s:ProtectionState,now:number){const until=Math.max(s.voluntaryUntil,s.preventiveUntil);return{serverNow:now,until:until>now?until:0,reason:until>now?(s.voluntaryUntil>=s.preventiveUntil?'VOLUNTARY':'PREVENTIVE'):null};}
export function applyProtection(s:ProtectionState,e:ProtectionEvent,now:number){
 s.events=s.events.filter(x=>x.at>now-PROTECTION_WINDOW_MS);
 if(e.at<=now-PROTECTION_WINDOW_MS||s.events.some(x=>x.id===e.id))return;
 if(e.at>now+1000||!e.id||!e.room||!['VOLUNTARY','PREVENTIVE'].includes(e.kind))throw Error('INVALID_PROTECTION_EVENT');
 s.events.push(e);const count=s.events.filter(x=>x.kind===e.kind&&x.at>e.at-PROTECTION_WINDOW_MS&&x.at<=e.at).length;
 if(e.kind==='VOLUNTARY'){const seconds=count===1?0:count===2?30:count===3?120:300;s.voluntaryUntil=Math.max(s.voluntaryUntil,e.at+seconds*1000);}
 else if(count>=3)s.preventiveUntil=Math.max(s.preventiveUntil,e.at+60_000);
}
export async function protectionRpc(env:Env,userId:number,event?:ProtectionEvent){
 if(!Number.isSafeInteger(userId)||userId<=0)throw Error('PROTECTION_UNAVAILABLE');
 if(!env.SOCIAL_HUBS)throw Error('PROTECTION_UNAVAILABLE');
 const r=await env.SOCIAL_HUBS.get(env.SOCIAL_HUBS.idFromName('user:'+userId)).fetch(new Request('https://hub/ranked-protection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event})}));
 if(!r.ok)throw Error('PROTECTION_UNAVAILABLE');return await r.json() as ReturnType<typeof protectionView>;
}
