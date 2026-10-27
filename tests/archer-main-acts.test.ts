import { beforeEach, describe, expect, it } from 'vitest';
import { ARCHER_HUNT_CAMPAIGN, ASCENT_CAMPAIGN, INFERNAL_CAMPAIGN, DEFAULT_CONTENT, DECK_RULES, GameEngine, campaignBattleContent, createRun, currentEncounter, encounterFor, encounterOrder, parseRunSave, serializeRun, validateWorlds, worldContext, worldsView, type CampaignDef, type GameContent, type PlayerProfile, type RunState, type WorldView } from '../src/game';
import { withArcher } from '../src/game/data/archer';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { handle } from '../server/src/index';
import { memoryD1, addAccount } from './support/d1';
import { playBattle } from './support/bot';
const full = withArcher(withShapeshifterRelease(DEFAULT_CONTENT));
const weak: GameContent = { ...full, enemies: Object.fromEntries(Object.entries(full.enemies).map(([id,e])=>[id,{...e,maxHp:1,armor:0}])) };
type State = { profile:PlayerProfile; runs:Record<string,RunState|null>; worldRuns:Record<string,Record<string,RunState|null>>; worlds:Record<string,{worlds:WorldView[]}>; error?:{code:string} };
let db:ReturnType<typeof memoryD1>;let tx=0;
const env={ARCHER_ENABLED:'1',WORLD_2_ENABLED:'1',SUMMONER_CAMPAIGN:'1',SHAPESHIFTER_ENABLED:'1',WARRIOR_ENABLED:'1',ARCHER_CAMPAIGN_ENABLED:'1'};
async function call(token:string,method:string,path:string,body?:unknown,flags=env){
 const res=await handle(new Request('https://test/api/tactics'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{DB:db,...flags},{content:weak,now:()=>2_000_000,seed:()=>11,store:{catalog:[],cosmetics:{},newId:()=>`main-${++tx}`}});
 return {status:res.status,body:await res.json() as State};
}
function put(id:number,run:RunState){db.sql.prepare('INSERT INTO tactics_hero_campaign_runs (user_id,campaign_id,hero_id,run_json,save_version,updated_at) VALUES (?,?,?,?,1,1) ON CONFLICT(user_id,campaign_id,hero_id) DO UPDATE SET run_json=excluded.run_json').run(id,run.campaignId,run.heroId,serializeRun(run));}
const runOf=(s:State,c:CampaignDef)=>c.id==='ascent'?s.runs.archer!:s.worldRuns[c.id]!.archer!;
function proof(s:State,c:CampaignDef,run:RunState){
 for(let seed=1;seed<=4;seed++){
  const engine=new GameEngine(currentEncounter(c,run),campaignBattleContent(weak,s.profile,run,DECK_RULES),seed);playBattle(engine,30,undefined,{archer:true,terrainAware:true,antiStall:true});
  if(engine.state.outcome?.result==='WON')return {encounterId:run.currentEncounterId,seed,commands:JSON.parse(JSON.stringify(engine.history))};
 }
 throw Error('No fixture win for '+run.currentEncounterId);
}
const balance=(id:number)=>(db.sql.prepare("SELECT balance FROM tactics_wallets WHERE user_id=? AND currency_id='arcane_crystals'").get(id) as {balance:number}|undefined)?.balance??0;
beforeEach(()=>{db=memoryD1({legacyProfiles:true});});
describe('shared main acts and champion stories',()=>{
 it('explicit compatibility, unchanged encounter IDs, legacy saves and independent world types',()=>{
  expect(validateWorlds(worldContext(()=>true),full)).toEqual([]);
  for(const c of [ASCENT_CAMPAIGN,INFERNAL_CAMPAIGN]){
   expect(c.kind).toBe('MAIN_ACT');expect(c.heroIds).toEqual(['mage','summoner','warrior','shapeshifter','archer']);expect(encounterOrder(c)).toHaveLength(10);
   for(const e of c.encounters){const a=encounterFor(c,e.id,'archer');expect(a.layout).toEqual(e.layout);expect(a.objectives).toEqual(e.objectives);new GameEngine(a,full,1);}
   for(const hero of c.heroIds)expect(parseRunSave(serializeRun(createRun(c,full,1,hero)),c,full).status).toBe('OK');
  }
  expect(ARCHER_HUNT_CAMPAIGN.kind).toBe('CHAMPION_STORY');expect(ARCHER_HUNT_CAMPAIGN.heroIds).toEqual(['archer']);
  const views=worldsView(worldContext(()=>true),{},{},'archer');expect(views.map(w=>[w.id,w.kind])).toEqual([['world_1','MAIN_ACT'],['world_2','MAIN_ACT'],['world_3','MAIN_ACT'],['archer_act_1','CHAMPION_STORY']]);
  expect(views[1]!.completionReward?.cardId).toBeNull();
 });
 it('main acts do not depend on story flag; server rejects locked worlds, foreign stories and forged proofs',async()=>{
  const {token}=addAccount(db,'ordinary');await call(token,'POST','/profile',{});
  const flags={...env,ARCHER_CAMPAIGN_ENABLED:'0'};
  expect((await call(token,'POST','/campaign/start',{heroId:'archer',campaignId:'ascent'},flags)).status).toBe(200);
  expect((await call(token,'POST','/campaign/start',{heroId:'archer',campaignId:'archer_hunt'},flags)).body.error?.code).toBe('WORLD_LOCKED');
  expect((await call(token,'POST','/campaign/start',{heroId:'mage',campaignId:'archer_hunt'})).body.error?.code).toBe('UNKNOWN_CAMPAIGN');
  expect((await call(token,'POST','/campaign/start',{heroId:'archer',campaignId:'infernal'})).body.error?.code).toBe('WORLD_LOCKED');
  expect((await call(token,'POST','/campaign/victory',{heroId:'archer',campaignId:'ascent',proof:{encounterId:'hunt_01_trail',seed:1,commands:[]}})).status).toBe(422);
  expect((await call(token,'POST','/campaign/start',{heroId:'archer'}, {...env,ARCHER_ENABLED:'0'})).status).toBe(403);
 });
 it('plays I–X and XI–XX, resumes every step, isolates all champions/story, grants no foreign/story cards and never repays a completion',async()=>{
  const {id,token}=addAccount(db,'legacy');await call(token,'POST','/profile',{});
  for(const hero of ['mage','summoner','warrior','shapeshifter'])put(id,{...createRun(ASCENT_CAMPAIGN,full,7,hero),completedEncounterIds:[ASCENT_CAMPAIGN.start],currentEncounterId:encounterOrder(ASCENT_CAMPAIGN)[1]!.id});
  const story=await call(token,'POST','/campaign/start',{heroId:'archer',campaignId:'archer_hunt'});const savedStory=story.body.worldRuns.archer_hunt!.archer;const others=story.body.runs;
  for(const c of [ASCENT_CAMPAIGN,INFERNAL_CAMPAIGN]){
   let s=(await call(token,'POST','/campaign/start',{heroId:'archer',campaignId:c.id})).body;
   for(const e of encounterOrder(c)){
    const run=runOf(s,c);expect(run.currentEncounterId).toBe(e.id);
    const p=proof(s,c,run);const won=await call(token,'POST','/campaign/victory',{heroId:'archer',campaignId:c.id,proof:p});expect(won.status).toBe(200);
    const again=await call(token,'POST','/campaign/victory',{heroId:'archer',campaignId:c.id,proof:p});expect(runOf(again.body,c)).toEqual(runOf(won.body,c));s=won.body;
    const reward=runOf(s,c).rewardOptions[0];if(reward){expect(reward.kind!=='ADD_CARD'||!full.cards[reward.cardId]?.heroId||full.cards[reward.cardId]?.heroId==='archer').toBe(true);const claim={heroId:'archer',campaignId:c.id,optionId:reward.id,encounterId:e.id};const claimed=await call(token,'POST','/campaign/reward',claim);expect(claimed.status).toBe(200);const repeat=await call(token,'POST','/campaign/reward',claim);expect(repeat.body.profile).toEqual(claimed.body.profile);}
    s=(await call(token,'GET','/state')).body;
    expect(s.worldRuns.archer_hunt!.archer).toEqual(savedStory);
    for(const hero of ['mage','summoner','warrior','shapeshifter'])expect(s.runs[hero]).toEqual(others[hero]);
   }
   expect(runOf(s,c)).toMatchObject({status:'COMPLETED',completedEncounterIds:encounterOrder(c).map(e=>e.id)});
  }
  expect(balance(id)).toBe(250);
  const state=(await call(token,'GET','/state')).body;
  expect(state.worlds.archer!.worlds.find(w=>w.id==='world_2')?.completionReward).toMatchObject({granted:true,cardId:null});
  for(const card of ['ice_arrow','fire_arrow','poison_arrow','rebound_arrow','smoke_arrow','predator_eye'])expect(state.profile.heroes.archer!.collection[card]).toBeUndefined();
  await call(token,'POST','/campaign/start',{heroId:'archer',campaignId:'infernal'});
  const ids=encounterOrder(INFERNAL_CAMPAIGN).map(e=>e.id);put(id,{...createRun(INFERNAL_CAMPAIGN,full,11,'archer'),currentEncounterId:ids.at(-1)!,completedEncounterIds:ids.slice(0,-1)});
  const s=(await call(token,'GET','/state')).body;expect((await call(token,'POST','/campaign/victory',{heroId:'archer',campaignId:'infernal',proof:proof(s,INFERNAL_CAMPAIGN,runOf(s,INFERNAL_CAMPAIGN))})).status).toBe(200);expect(balance(id)).toBe(250);
 },30000);
});
