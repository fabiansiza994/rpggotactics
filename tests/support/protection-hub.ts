import{SocialHub}from'../../server/src/social';import type{Env}from'../../server/src/db';
/** Real policy handler; stable test storage survives instance recreation. */
export function protectionNamespace(env:Env){const stores=new Map<string,Map<string,unknown>>(),hubs=new Map<string,SocialHub>();return{
 idFromName:(name:string)=>name,
 restart:(name:string)=>{hubs.delete(name);},
 peek:(name:string)=>structuredClone(stores.get(name)?.get('rankedProtection:v1')),
 get:(id:unknown)=>{const key=String(id);if(!hubs.has(key)){const data=stores.get(key)??new Map<string,unknown>();stores.set(key,data);hubs.set(key,new SocialHub({storage:{get:async<T>(k:string)=>structuredClone(data.get(k))as T|undefined,put:async(k:string,v:unknown)=>{data.set(k,structuredClone(v));}},getWebSockets:()=>[],acceptWebSocket:()=>{}}as unknown as ConstructorParameters<typeof SocialHub>[0],env));}return hubs.get(key)!;}
};}
