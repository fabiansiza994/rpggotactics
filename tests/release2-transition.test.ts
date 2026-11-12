import {describe,it,expect,vi,afterEach} from 'vitest';
import {PvPMatchRoom,compatibleReadySeats} from '../server/src/pvp';
import {handle} from '../server/src/index';
import {memoryD1,addAccount} from './support/d1';
import {contentTransition} from '../server/src/contentTransition';
import {contentReleaseUrl} from '../src/presentation/cloud/contentRelease';
import {request} from '../src/presentation/cloud/http';

afterEach(()=>vi.unstubAllGlobals());
describe('Release 2 staged activation and emergency pause',()=>{
 it('keeps auth destinations unchanged and marks all Tactics calls without changing headers or payload',async()=>{
  expect(contentReleaseUrl('https://auth.example/api/login')).toBe('https://auth.example/api/login');
  expect(new URL(contentReleaseUrl('https://api.example/api/tactics/state?x=1')).searchParams.get('clientRelease')).toBe('thunder-release-2');
  const fetcher=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetcher);
  await request('https://api.example','/api/tactics/store/purchase',{method:'POST',body:{offerId:'card_thunder_discharge'},token:'fake-local',timeoutMs:1000});
  expect(fetcher.mock.calls[0]![0]).toContain('clientRelease=thunder-release-2');
  expect(fetcher.mock.calls[0]![1].headers).toEqual({'Content-Type':'application/json',Authorization:'Bearer fake-local'});
 });
 it('maintenance rejects old and new clients before persistent state is touched, while health/preflight remain usable',async()=>{
  const db=memoryD1();try{
   const env={DB:db,RELEASE2_MAINTENANCE:'1',RELEASE2_CLIENT_REQUIRED:'1'};const before=db.sql.prepare('SELECT total_changes() AS n').get();
   for(const path of ['state','store/catalog','store/purchase','campaign/reward','ranked/queue','pvp/create','decks/mage/main'])for(const marker of ['', '?clientRelease=thunder-release-2']){
    const res=await handle(new Request('https://api.example/api/tactics/'+path+marker,{method:path==='state'||path==='store/catalog'?'GET':'POST',body:path==='state'||path==='store/catalog'?undefined:'{}',headers:{'Content-Type':'application/json'}}),env);expect(res.status).toBe(503);
   }
   expect(db.sql.prepare('SELECT total_changes() AS n').get()).toEqual(before);
   expect((await handle(new Request('https://api.example/api/tactics/health'),env)).status).toBe(200);
   expect((await handle(new Request('https://api.example/api/tactics/state',{method:'OPTIONS'}),env)).status).toBe(204);
   expect((await handle(new Request('https://api.example/api/tactics/pvp/socket?code=ABCDEFGH'),env)).status).toBe(426);
   expect(contentTransition(new Request('https://api.example/api/tactics/pvp/socket?clientRelease=thunder-release-2'),env)).toBeNull();
   expect((await handle(new Request('https://api.example/api/tactics/pvp/connect?clientRelease=thunder-release-2',{method:'POST',body:'{}'}),env)).status).toBe(401);
  }finally{db.sql.close();}
 });
 it('activation blocks stale clients, admits the new client and still requires real authentication',async()=>{
  const db=memoryD1();try{
   const a=addAccount(db,'transition_qa'),env={DB:db,RELEASE2_MAINTENANCE:'0',RELEASE2_CLIENT_REQUIRED:'1'};
   const call=(marker:string,token?:string)=>handle(new Request('https://api.example/api/tactics/state'+marker,{headers:token?{Authorization:'Bearer '+token}:{}}),env);
   expect((await call('',a.token)).status).toBe(426);expect((await call('?clientRelease=wrong',a.token)).status).toBe(426);
   expect((await call('?clientRelease=thunder-release-2')).status).toBe(401);expect((await call('?clientRelease=thunder-release-2',a.token)).status).toBe(200);
   expect(contentTransition(new Request('https://api.example/api/tactics/pvp/socket?clientRelease=thunder-release-2'),env)).toBeNull();
  }finally{db.sql.close();}
 });
 it('pre-existing lobby readiness is not reused until both seats have the new client',()=>{expect(compatibleReadySeats([{},{}])).toBe(false);expect(compatibleReadySeats([{clientRelease:'thunder-release-2'},{}])).toBe(false);expect(compatibleReadySeats([{clientRelease:'thunder-release-2'},{clientRelease:'thunder-release-2'}])).toBe(true);});
 it('a stale socket cannot receive or command a new-release match',async()=>{
  const db=memoryD1();try{let loaded:Promise<unknown>=Promise.resolve();
   const ctx:ConstructorParameters<typeof PvPMatchRoom>[0]={storage:{get:async<T,>()=>({contentRelease:'thunder-release-2'} as T),put:async()=>{},setAlarm:async()=>{},deleteAlarm:async()=>{}},blockConcurrencyWhile:fn=>{const p=fn();loaded=p;return p;},acceptWebSocket:()=>{},getWebSockets:()=>[]};
   const room=new PvPMatchRoom(ctx,{DB:db,RELEASE2_CLIENT_REQUIRED:'1'});await loaded;
   const close=vi.fn(),send=vi.fn();const socket={deserializeAttachment:()=>({seat:0}),close,send} as unknown as Parameters<PvPMatchRoom['webSocketMessage']>[0];
   await room.webSocketMessage(socket,JSON.stringify({type:'ping'}));expect(close).toHaveBeenCalledWith(1008,'CLIENT_UPDATE_REQUIRED');expect(send).not.toHaveBeenCalled();
  }finally{db.sql.close();}
 });
 it('private smoke requires a real authenticated allowlisted QA account and the new client',async()=>{
  const db=memoryD1();try{const qa=addAccount(db,'tactics_qa_a'),other=addAccount(db,'player');const env={DB:db,RELEASE2_MAINTENANCE:'1',RELEASE2_CLIENT_REQUIRED:'1',RELEASE2_QA_USERS:'tactics_qa_a,tactics_qa_b'};
  const call=(token:string,marker=true)=>handle(new Request('https://api.example/api/tactics/state'+(marker?'?clientRelease=thunder-release-2':''),{headers:{Authorization:'Bearer '+token}}),env);
  expect((await call(qa.token)).status).toBe(200);expect((await call(qa.token,false)).status).toBe(426);expect((await call(other.token)).status).toBe(503);expect((await call('tactics_qa_a')).status).toBe(503);
  }finally{db.sql.close();}
 });
 it('pausing retains granted cards, saved decks and purchase history without downgrading the content',async()=>{
  const db=memoryD1({legacyProfiles:true});try{
   const a=addAccount(db,'transition_qa');const env={DB:db,RELEASE2_CLIENT_REQUIRED:'1'};
   await handle(new Request('https://api.example/api/tactics/profile?clientRelease=thunder-release-2',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:'{}'}),env);
   db.sql.prepare("INSERT INTO tactics_player_cards VALUES(?,'mage','thunder_discharge',1,1,'NORMAL_DROP',0)").run(a.id);
   const snapshot=()=>JSON.stringify(['tactics_player_cards','tactics_decks','tactics_store_purchases'].map(t=>db.sql.prepare('SELECT * FROM '+t).all()));const before=snapshot();
   expect((await handle(new Request('https://api.example/api/tactics/store/purchase?clientRelease=thunder-release-2',{method:'POST',body:'{}'}),{...env,RELEASE2_MAINTENANCE:'1'})).status).toBe(503);expect(snapshot()).toBe(before);
  }finally{db.sql.close();}
 });
});
