import {expect,it} from 'vitest';
import {handle} from '../server/src/index';
import type {Env} from '../server/src/db';
it('forwards the informed-response capability through the public socket proxy, preserving legacy markers',async()=>{
 let forwarded:Request|undefined;
 const env={DB:{},PVP_ROOMS:{idFromName:(name:string)=>name,get:()=>({fetch:async(request:Request)=>{forwarded=request;return new Response('proxy') }})}} as unknown as Env;
 const r=await handle(new Request('https://api.example/api/tactics/pvp/socket?code=ABCDEFGH&ticket=one-use-test&clientRelease=universal-cards-1&botProtocol=ranked-bots-1&responseProtocol=informed-response-2',{headers:{Upgrade:'websocket'}}),env);
 expect(r.status).toBe(200);const query=new URL(forwarded!.url).searchParams;
 expect(query.get('ticket')).toBe('one-use-test');expect(query.get('clientRelease')).toBe('universal-cards-1');expect(query.get('botProtocol')).toBe('ranked-bots-1');
 expect(query.get('responseProtocol')).toBe('informed-response-2');
});

it('does not invent the capability for an older client',async()=>{
 let forwarded:Request|undefined;
 const env={DB:{},PVP_ROOMS:{idFromName:(name:string)=>name,get:()=>({fetch:async(request:Request)=>{forwarded=request;return new Response('proxy')}})}} as unknown as Env;
 await handle(new Request('https://api.example/api/tactics/pvp/socket?code=ABCDEFGH&ticket=legacy-test&clientRelease=universal-cards-1',{headers:{Upgrade:'websocket'}}),env);
 const query=new URL(forwarded!.url).searchParams;expect(query.get('responseProtocol')).toBe('');expect(query.get('ticket')).toBe('legacy-test');
});
