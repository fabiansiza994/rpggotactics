import {afterEach,describe,expect,it,vi} from 'vitest';
import {mountTurnstile,verificationMessage,type TurnstileApi,type VerificationState} from '../src/presentation/security/turnstile';

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
function widget(){
 const render=vi.fn<(element:HTMLElement,options:Record<string,unknown>)=>string>(()=>'widget');
 const api:TurnstileApi={render,remove:vi.fn()};
 const onToken=vi.fn(),onState=vi.fn<(state:VerificationState)=>void>();
 const start=()=>mountTurnstile({} as HTMLElement,{siteKey:'public-key',onToken,onState,load:async()=>api});
 return {api,render,onToken,onState,start};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
describe('Turnstile mount generations (no bypass)',()=>{
 it('delivers success, clears expired/error/timeout tokens and handles unsupported',async()=>{
  const w=widget();const stop=w.start();await flush();
  const opts=w.render.mock.calls[0]![1];
  (opts.callback as (token:string)=>void)('test-token');expect(w.onToken).toHaveBeenLastCalledWith('test-token');
  for(const callback of ['expired-callback','timeout-callback','unsupported-callback','error-callback']){
   (opts[callback] as (code:string)=>void)('200500');expect(w.onToken).toHaveBeenLastCalledWith(null);
  }
  stop();expect(w.api.remove).toHaveBeenCalledExactlyOnceWith('widget');
  (opts.callback as (token:string)=>void)('stale-token');expect(w.onToken).toHaveBeenLastCalledWith(null);
 });
 it('unmount before script resolves never renders a late or duplicate widget',async()=>{
  let resolve!:(api:TurnstileApi)=>void;const w=widget();
  const stop=mountTurnstile({} as HTMLElement,{siteKey:'key',onToken:w.onToken,onState:w.onState,load:()=>new Promise(r=>{resolve=r;})});
  stop();resolve(w.api);await flush();expect(w.render).not.toHaveBeenCalled();
 });
 it('clean retry removes old widget and ignores old callbacks',async()=>{
  const w=widget(),stop=w.start();await flush();const old=w.render.mock.calls[0]![1];
  stop();const stop2=w.start();await flush();(old.callback as (token:string)=>void)('old');expect(w.onToken).toHaveBeenLastCalledWith(null);
  expect(w.render).toHaveBeenCalledTimes(2);stop2();expect(w.api.remove).toHaveBeenCalledTimes(2);
 });
 it('failed script and SDK render never produce a verified token',async()=>{
  const onToken=vi.fn(),onState=vi.fn();
  mountTurnstile({} as HTMLElement,{siteKey:'key',onToken,onState,load:async()=>{throw Error('network');}});await flush();
  expect(onToken).toHaveBeenLastCalledWith(null);expect(onState).toHaveBeenLastCalledWith({kind:'load-error'});
  const w=widget();w.render.mockImplementation(()=>{throw Error('SDK');});w.start();await flush();expect(w.onState).toHaveBeenLastCalledWith({kind:'challenge-error'});expect(w.onToken).toHaveBeenLastCalledWith(null);
 });
 it('distinguishes configuration, expiry and service errors without exposing raw errors',()=>{
  expect(verificationMessage({kind:'challenge-error',code:'110200'})).toContain('configurada');
  expect(verificationMessage({kind:'challenge-error',code:'200500'})).toContain('Cloudflare');
  expect(verificationMessage({kind:'expired'})).toContain('caducó');
  expect(verificationMessage({kind:'verified'})).toBeNull();
 });
});
describe('singleton script loader recovery',()=>{
 async function loader(){vi.resetModules();const scripts:{onload:null|(()=>void);onerror:null|(()=>void);remove:ReturnType<typeof vi.fn>}[]=[];
  vi.stubGlobal('window',{});vi.stubGlobal('document',{createElement:()=>{const s={onload:null,onerror:null,remove:vi.fn()};scripts.push(s);return s;},head:{appendChild:vi.fn()}});
  return {scripts,...await import('../src/presentation/security/turnstile')};
 }
 it('shares one pending load and retries when onload has no API',async()=>{
  const l=await loader();const a=l.loadTurnstile(),b=l.loadTurnstile();expect(a).toBe(b);const failed=expect(a).rejects.toThrow();l.scripts[0]!.onload!();await failed;expect(l.scripts[0]!.remove).toHaveBeenCalled();
  const retry=l.loadTurnstile();const api={render:vi.fn(),remove:vi.fn(),ready:vi.fn(()=>{throw Error('async-ready-not-supported');})};window.turnstile=api;l.scripts[1]!.onload!();expect(await retry).toBe(api);expect(api.ready).not.toHaveBeenCalled();expect(l.scripts).toHaveLength(2);
 });
 it('evicts a stalled script after a bounded wait',async()=>{
  vi.useFakeTimers();const l=await loader();const a=l.loadTurnstile();const failed=expect(a).rejects.toThrow();await vi.advanceTimersByTimeAsync(l.TURNSTILE_LOAD_TIMEOUT);await failed;expect(l.scripts[0]!.remove).toHaveBeenCalled();
 });
 it('script error is recoverable and never cached forever',async()=>{
  const l=await loader();const a=l.loadTurnstile();const failed=expect(a).rejects.toThrow();l.scripts[0]!.onerror!();await failed;
  const retry=l.loadTurnstile();window.turnstile={render:vi.fn(),remove:vi.fn()};l.scripts[1]!.onload!();await retry;expect(l.scripts).toHaveLength(2);
 });
});
