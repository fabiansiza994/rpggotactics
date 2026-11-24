import {expect,it,vi} from 'vitest';
import {CONTENT_RELEASE,PREVIOUS_CONTENT_RELEASE,supportsRoomRelease,canRunRoomRules} from '../src/game/pvp/content-release';
import {PvPMatchRoom} from '../server/src/pvp';
import {memoryD1} from './support/d1';
import {contentTransition} from '../server/src/contentTransition';
it('keeps old protocol pairs together and rejects cross-boundary clients',()=>{
 expect(supportsRoomRelease(PREVIOUS_CONTENT_RELEASE,PREVIOUS_CONTENT_RELEASE)).toBe(true);
 expect(supportsRoomRelease(CONTENT_RELEASE,PREVIOUS_CONTENT_RELEASE)).toBe(false);
 expect(supportsRoomRelease(PREVIOUS_CONTENT_RELEASE,CONTENT_RELEASE)).toBe(false);
 expect(supportsRoomRelease(CONTENT_RELEASE,CONTENT_RELEASE)).toBe(true);
 expect(supportsRoomRelease(undefined,CONTENT_RELEASE)).toBe(false);
});
it('immutable engine marker survives rehydration, never infers old rules from a client',()=>{
 for(const release of [undefined,PREVIOUS_CONTENT_RELEASE,CONTENT_RELEASE]) {
 const room=JSON.parse(JSON.stringify({game:{pendingCast:{deadline:123}},result:null,rulesRelease:release}));
 expect(canRunRoomRules(room)).toBe(release===CONTENT_RELEASE);
 expect(room.game.pendingCast.deadline).toBe(123);
 }
 expect(canRunRoomRules({game:null,result:null})).toBe(true);
});
it.each([undefined,PREVIOUS_CONTENT_RELEASE])('old active room %s is preserved, never timed out, bot-driven or settled by the new engine',async release=>{
 const db=memoryD1(); const snapshot={contentRelease:release,rulesRelease:release,game:{pendingCast:{deadline:0}},result:null};
 let loaded=Promise.resolve();const put=vi.fn(),del=vi.fn();
 const ctx:ConstructorParameters<typeof PvPMatchRoom>[0]={storage:{get:async<T,>()=>structuredClone(snapshot) as T,put,setAlarm:vi.fn(),deleteAlarm:del},blockConcurrencyWhile:fn=>{const p=fn();loaded=p.then(()=>{});return p;},acceptWebSocket:vi.fn(),getWebSockets:()=>[]};
 const room=new PvPMatchRoom(ctx,{DB:db,RELEASE2_CLIENT_REQUIRED:'1'});await loaded;
 for(const client of [PREVIOUS_CONTENT_RELEASE,CONTENT_RELEASE])for(const path of ['connect','ready','rematch']){
 const response=await room.fetch(new Request('https://room/'+path,{method:'POST',headers:{'X-Pvp-User':'1','X-Pvp-Client-Release':client},body:'{}'}));
 expect(response.status).toBe(503);expect((await response.json() as {error:{code:string}}).error.code).toBe('ROOM_RULES_UNAVAILABLE');
 }
 const close=vi.fn(),send=vi.fn();await room.webSocketMessage({deserializeAttachment:()=>({seat:0,clientRelease:CONTENT_RELEASE}),close,send} as unknown as Parameters<PvPMatchRoom['webSocketMessage']>[0],JSON.stringify({type:'resync'}));
 expect(close).toHaveBeenCalledWith(1012,'ROOM_RULES_UNAVAILABLE');expect(send).not.toHaveBeenCalled();
 await room.webSocketClose({deserializeAttachment:()=>({seat:0})} as unknown as Parameters<PvPMatchRoom['webSocketClose']>[0]);await room.alarm();expect(put).not.toHaveBeenCalled();expect(del).not.toHaveBeenCalled();db.sql.close();
});
it('drain stops admission and rematch; release checks cannot be bypassed for a new room',()=>{
 for(const path of ['pvp/create','pvp/ready','pvp/rematch','ranked/queue','ranked/bot']){
 const req=new Request(`https://local/api/tactics/${path}?clientRelease=${CONTENT_RELEASE}`);
 expect(contentTransition(req,{CONTENT_RELEASE_DRAIN:'1'} as never)?.status).toBe(503);
 expect(contentTransition(new Request(`https://local/api/tactics/${path}?clientRelease=${PREVIOUS_CONTENT_RELEASE}`),{RELEASE2_CLIENT_REQUIRED:'1'} as never)?.status).toBe(426);
 }
});
