import {describe,it,expect,vi} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// Audit the existing auth service without changing it or copying its implementation.
const path=new URL('../../RPG-GO/worker-auth/src/index.js',import.meta.url);
describe.skipIf(!existsSync(path))('existing auth Turnstile validation remains fail-closed',()=>{
 function verifier(fetch:ReturnType<typeof vi.fn>){
  const text=readFileSync(path,'utf8');const a=text.indexOf('async function verifyTurnstile('),b=text.indexOf('async function handleRegister',a);
  return runInNewContext('('+text.slice(a,b).trim()+')',{fetch,URLSearchParams}) as (env:{TURNSTILE_SECRET?:string},token:unknown,ip?:string)=>Promise<boolean>;
 }
 it('rejects absent secret/token without asking Siteverify',async()=>{
  const fetch=vi.fn(),verify=verifier(fetch);expect(await verify({},'token')).toBe(false);expect(await verify({TURNSTILE_SECRET:'test-only'},'')).toBe(false);expect(fetch).not.toHaveBeenCalled();
 });
 it('rejects expired/duplicate/invalid tokens and verification network/JSON failures',async()=>{
  for(const codes of [['timeout-or-duplicate'],['invalid-input-response']]){
   const fetch=vi.fn().mockResolvedValue({json:async()=>({success:false,'error-codes':codes})});expect(await verifier(fetch)({TURNSTILE_SECRET:'test-only'},'invalid')).toBe(false);
  }
  for(const fetch of [vi.fn().mockRejectedValue(new Error('network')),vi.fn().mockResolvedValue({json:async()=>{throw Error('bad-json');}})])expect(await verifier(fetch)({TURNSTILE_SECRET:'test-only'},'invalid')).toBe(false);
 });
 it('requires the real server secret and Siteverify success; client flags have no effect',async()=>{
  const fetch=vi.fn().mockResolvedValue({json:async()=>({success:true})});expect(await verifier(fetch)({TURNSTILE_SECRET:'test-only'},'token','127.0.0.1')).toBe(true);const [url,opts]=fetch.mock.calls[0]!;expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');expect(opts.body.get('secret')).toBe('test-only');expect(opts.body.get('response')).toBe('token');
  const text=readFileSync(path,'utf8');expect(text.indexOf('if(!turnstileOk) return')).toBeLessThan(text.indexOf('const username = normalizeUsername(body.username)'));
 });
});
