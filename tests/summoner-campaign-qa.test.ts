import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_CONTENT, ASCENT_CAMPAIGN, parseRunSave, serializeRun } from '../src/game';
import { handle } from '../server/src/index';
import { qaCampaignSetup, QA_ENCOUNTERS } from '../server/src/campaignQa';
import { campaignHeroes } from '../src/presentation/campaignRelease';
import { addAccount, memoryD1 } from './support/d1';

afterEach(()=>vi.unstubAllEnvs());
describe('Summoner campaign QA allowlist',()=>{
 const setup=()=>{
  const db=memoryD1({ legacyProfiles: true }); const qa=addAccount(db,'tactics_qa_a'); const other=addAccount(db,'tactics_qa_a_extra');
  const call=async(token:string,method:string,path:string,body?:unknown,enabled=true)=>{
   const res=await handle(new Request('https://api.test/api/tactics'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{DB:db,SUMMONER_CAMPAIGN_QA:enabled?'1':undefined},{content:DEFAULT_CONTENT,now:()=>1000000,seed:()=>7});
   return {status:res.status,body:await res.json()};
  };return {db,qa,other,call};
 };
 it('only exact authenticated QA identities can start and prepare; impersonation is rejected',async()=>{
  const {qa,other,call}=setup();
  for(const user of [qa,other])await call(user.token,'POST','/profile',{});
  expect((await call(qa.token,'POST','/campaign/start',{heroId:'summoner'})).status).toBe(200);
  const before=(await call(other.token,'GET','/state')).body;
  expect(before.qaSummonerCampaign).toBe(false);
  expect((await call(other.token,'POST','/campaign/start',{heroId:'summoner',username:'tactics_qa_a'})).status).toBe(403);
  expect((await call(other.token,'POST','/qa/summoner/setup',{encounterId:QA_ENCOUNTERS[0],tier:'VETERAN',seed:1,username:'tactics_qa_a'})).status).toBe(403);
  for(const path of ['/campaign/victory','/campaign/reward'])expect((await call(other.token,'POST',path,{heroId:'summoner'})).status).toBe(403);
  expect((await call(other.token,'GET','/state')).body).toEqual(before);
  expect((await call(other.token,'POST','/campaign/start',{heroId:'mage'})).status).toBe(200);
 });
 it('QA access fails closed when its independent switch is absent',async()=>{
  const {qa,call}=setup();await call(qa.token,'POST','/profile',{});
  expect((await call(qa.token,'GET','/state',undefined,false)).body.qaSummonerCampaign).toBe(false);
  expect((await call(qa.token,'POST','/campaign/start',{heroId:'summoner'},false)).status).toBe(403);
  expect((await call(qa.token,'POST','/qa/summoner/setup',{},false)).status).toBe(403);
 });
 it('all 12 encounter/preset combinations are legal saves and preserve Mage, rewards and owned copies on retries',async()=>{
  const {db,qa,call}=setup();await call(qa.token,'POST','/profile',{});await call(qa.token,'POST','/campaign/start',{heroId:'mage'});
  const before=(await call(qa.token,'GET','/state')).body;
  for(const encounterId of QA_ENCOUNTERS)for(const tier of ['STARTER','MID','VETERAN']){
   const prepared=qaCampaignSetup(DEFAULT_CONTENT,encounterId,tier,123)!;
   expect(parseRunSave(serializeRun(prepared.run),ASCENT_CAMPAIGN,DEFAULT_CONTENT).status).toBe('OK');
   const result=await call(qa.token,'POST','/qa/summoner/setup',{encounterId,tier,seed:123});
   expect(result.status).toBe(200);expect(result.body.runs.mage).toEqual(before.runs.mage);expect(result.body.profile.heroes.mage).toEqual(before.profile.heroes.mage);
   expect(result.body.runs.summoner).toMatchObject({heroId:'summoner',currentEncounterId:encounterId,seed:123,status:'IN_BATTLE'});
   const repeat=await call(qa.token,'POST','/qa/summoner/setup',{encounterId,tier,seed:123});expect(repeat.body.profile).toEqual(result.body.profile);
   expect((await call(qa.token,'GET','/state')).body.runs.summoner).toEqual(result.body.runs.summoner);
  }
  expect(db.sql.prepare('SELECT COUNT(*) n FROM tactics_reward_log').get()!.n).toBe(0);
  expect((await call(qa.token,'POST','/qa/summoner/setup',{encounterId:'ascent_01_guard_post',tier:'VETERAN',seed:1})).status).toBe(422);
 });
 it('public release enables ordinary Summoner campaigns but never grants QA setup access',async()=>{
  const db=memoryD1({ legacyProfiles: true });const {token}=addAccount(db,'ordinary_player');
  const env={DB:db,SUMMONER_CAMPAIGN:'1',SUMMONER_CAMPAIGN_QA:'1'};
  const call=async(path:string,body:unknown)=>handle(new Request('https://api.test/api/tactics'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}),env,{content:DEFAULT_CONTENT,now:()=>1000000,seed:()=>7});
  expect((await call('/profile',{})).status).toBe(200);
  const started=await call('/campaign/start',{heroId:'summoner'});expect(started.status).toBe(200);
  const state=await started.json();expect(state.qaSummonerCampaign).toBe(false);expect(state.runs.summoner.heroId).toBe('summoner');
  expect((await call('/qa/summoner/setup',{encounterId:QA_ENCOUNTERS[0],tier:'VETERAN',seed:1})).status).toBe(403);
 });
 it('preview requires authoritative QA capability; public build remains hidden even for QA',()=>{
  vi.stubEnv('VITE_SUMMONER_CAMPAIGN','1');vi.stubEnv('VITE_SUMMONER_CAMPAIGN_QA','1');
  expect(campaignHeroes(false)).toEqual(['mage']);expect(campaignHeroes(true)).toEqual(['mage','summoner']);
  vi.stubEnv('VITE_SUMMONER_CAMPAIGN','');expect(campaignHeroes(true)).toEqual(['mage']);
 });
});
