import { recordCampaignBest, pendingChampionUnlock, claimChampionUnlock } from '../src/game';
import { afterEach, describe, expect, it } from 'vitest';
import { handle } from '../server/src/index';
import { memoryD1, addAccount } from './support/d1';
import { DEFAULT_CONTENT, ASCENT_CAMPAIGN, GameEngine, createProfile, asNewPlayer, chooseStartingChampion, isChampionUnlocked, parseProfileSave, serializeProfile, currentEncounter, createRun, campaignBattleContent, DECK_RULES, type PlayerProfile, type RunState } from '../src/game';
import { claimFreeChampion } from '../src/game/collection/champion-unlocks';
import { withShapeshifterRelease } from '../src/game/data/shapeshifter-release';
import { replayBattle } from '../src/game/engine/replay';
import { newsPosition, StoreNewsCarousel } from '../src/presentation/shop/StoreNewsCarousel';
import { ShapeshifterNews } from '../src/presentation/shop/ShapeshifterNews';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const content=withShapeshifterRelease(DEFAULT_CONTENT), now=1_000_000;
let db:ReturnType<typeof memoryD1>|undefined;
afterEach(()=>{db?.sql.close();db=undefined;});
function setup(legacy=false){db=memoryD1({legacyProfiles:legacy});return addAccount(db,'tactics_qa_a');}
async function call(token:string|null,method:string,path:string,body?:unknown,flags:Record<string,string>={SHAPESHIFTER_QA:'1'}){
 const r=await handle(new Request('http://localhost/api/tactics'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),
 {DB:db!,WARRIOR_ENABLED:'1',SUMMONER_CAMPAIGN:'1',...flags},{content:DEFAULT_CONTENT,now:()=>now,seed:()=>13});
 return {status:r.status,body:await r.json() as {profile:PlayerProfile;runs:Record<string,RunState>;crystalRewards?:unknown[]}};
}
describe('Cambiaformas free release',()=>{
 it.each([false,true])('claim is permanent and idempotent for legacy=%s; no crystals/cards/rewards duplicated',async legacy=>{
  const a=setup(legacy);await call(a.token,'POST','/profile',{});
  db!.sql.prepare("INSERT INTO tactics_wallet_ledger(transaction_id,user_id,currency_id,amount_delta,balance_before,balance_after,reason,reference_id,created_at) VALUES('release-test',?,'arcane_crystals',1000,0,1000,'QA_GRANT','release-test',0)").run(a.id);
  const balanceBefore=db!.sql.prepare('SELECT balance FROM tactics_wallets WHERE user_id=?').get(a.id)!.balance;
  const before=(await call(a.token,'GET','/state')).body;
  expect(isChampionUnlocked(before.profile,'shapeshifter')).toBe(false);
  const ledgerBefore=db!.sql.prepare('SELECT COUNT(*) n FROM tactics_wallet_ledger').get()!.n;
  const first=await call(a.token,'POST','/champions/unlock',{heroId:'shapeshifter',userId:999});expect(first.status).toBe(200);
  expect(isChampionUnlocked(first.body.profile,'shapeshifter')).toBe(true);
  const repeat=await call(a.token,'POST','/champions/unlock',{heroId:'shapeshifter'});expect(repeat.status).toBe(200);
  expect(repeat.body.profile).toEqual(first.body.profile);
  expect(db!.sql.prepare('SELECT balance FROM tactics_wallets WHERE user_id=?').get(a.id)!.balance).toBe(balanceBefore);
  const deck=repeat.body.profile.heroes.shapeshifter!.decks[0]!;
  expect((await call(a.token,'PUT',`/decks/shapeshifter/${deck.id}`,{cards:deck.cards})).status).toBe(200);
  expect(db!.sql.prepare('SELECT COUNT(*) n FROM tactics_wallet_ledger').get()!.n).toBe(ledgerBefore);
  expect(db!.sql.prepare("SELECT COUNT(*) n FROM tactics_champion_unlocks WHERE user_id=? AND hero_id='shapeshifter'").get(a.id)!.n).toBe(1);
  expect(db!.sql.prepare("SELECT milestone FROM tactics_champion_unlocks WHERE user_id=? AND hero_id='shapeshifter'").get(a.id)!.milestone).toBe('FREE');
  const reload=(await call(a.token,'GET','/state')).body;
  expect(reload.profile.heroes).toEqual(first.body.profile.heroes);
  for(const id of ['mage','summoner','warrior'])expect(reload.profile.heroes[id]).toEqual(before.profile.heroes[id]);
  expect(reload.profile.heroes.shapeshifter!.decks[0]!.cards.reduce((n:number,e:{count:number})=>n+e.count,0)).toBe(30);
  expect(Object.keys(reload.profile.heroes.shapeshifter!.collection)).toHaveLength(48);
  expect(parseProfileSave(serializeProfile(reload.profile),content).status).toBe('OK');
  // Existing clients see a known milestone; FREE is optional provenance, never an unknown enum.
  expect(reload.profile.champions!.unlocks.at(-1)).toMatchObject({milestone:'ASCENT_6',source:'FREE'});
 });
 it('requires authentication, release/allowlist and ownership before decks/campaign',async()=>{
  const a=setup();await call(a.token,'POST','/profile',{});
  expect((await call(null,'POST','/champions/unlock',{heroId:'shapeshifter'})).status).toBe(401);
  expect((await call(a.token,'POST','/champions/unlock',{heroId:'shapeshifter'},{SHAPESHIFTER_QA:'0'})).status).toBe(403);
  expect((await call(a.token,'POST','/campaign/start',{heroId:'shapeshifter'})).status).toBe(403);
  const other=addAccount(db!,'not_qa');await call(other.token,'POST','/profile',{});
  expect((await call(other.token,'POST','/champions/unlock',{heroId:'shapeshifter'})).status).toBe(403);
  await call(a.token,'POST','/champions/unlock',{heroId:'shapeshifter'});
  const started=await call(a.token,'POST','/campaign/start',{heroId:'shapeshifter'});
  expect(started.status).toBe(200);expect(started.body.runs.shapeshifter!.heroId).toBe('shapeshifter');
  expect((await call(a.token,'POST','/pvp/create',{heroId:'shapeshifter'})).status).not.toBe(200);
 });
 it('preserves free pre-onboarding claims and existing milestones',()=>{
  let p=asNewPlayer(createProfile(content));const c=claimFreeChampion(p,'shapeshifter',['mage','summoner','warrior','shapeshifter']);expect(c.ok).toBe(true);if(!c.ok)return;p=c.profile;
  const start=chooseStartingChampion(p,'mage',['mage','shapeshifter']);expect(start.ok).toBe(true);if(start.ok){expect(isChampionUnlocked(start.profile,'shapeshifter')).toBe(true);expect(isChampionUnlocked(start.profile,'mage')).toBe(true);}
 });
 it('shares the opening guarantee with replay, keeps hand size, transforms deterministically',()=>{
  const profile=createProfile(content),run=createRun(ASCENT_CAMPAIGN,content,13,'shapeshifter');
  const scenario=currentEncounter(ASCENT_CAMPAIGN,run), c=campaignBattleContent(content,profile,run,DECK_RULES);
  const e=new GameEngine(scenario,c,13);expect(e.state.player.hand).toHaveLength(5);
  const card=e.state.player.hand.find(c=>e.content.cards[c.cardId]!.effects.some(f=>f.type==='TRANSFORM'))!;expect(card).toBeDefined();
  const command={type:'PLAY_CARD' as const,cardUid:card.uid,target:null};expect(e.dispatch(command).ok).toBe(true);
  const replay=replayBattle(scenario,c,13,[command]);expect(replay.rejectedAt).toBeNull();expect(replay.state).toEqual(e.state);
  expect(GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)),c,scenario).state).toEqual(e.state);
  expect(c.qaCombatDepth).toBeUndefined();
 });
 it('renders a manual, accessible carousel with the existing offer intact and a non-payment free CTA',()=>{
  const hero=renderToStaticMarkup(createElement(ShapeshifterNews,{owned:false,busy:false,canClaim:true,onClaim:()=>{},onPlay:()=>{}}));
  expect(hero).toContain('Desbloquear gratis');expect(hero).toContain('48 cartas en su catálogo');expect(hero).not.toContain('ePayco');
  const html=renderToStaticMarkup(createElement(StoreNewsCarousel,{items:[{id:'shapeshifter',label:'Cambiaformas',content:hero},{id:'ritual',label:'Ritual',content:createElement('button',{'data-price':680},'Ritual original')}]}));
  expect(html).toContain('Novedad anterior');expect(html).toContain('Novedad siguiente');expect(html).toContain('data-price="680"');expect(html).toContain('inert');
  expect(newsPosition(0,-1,2)).toBe(1);expect(newsPosition(1,1,2)).toBe(0);
 });
});


it('public release verifies one real campaign victory and retries rewards without touching other champions',async()=>{
 setup(true);const a=addAccount(db!,'public_player'),flags={SHAPESHIFTER_ENABLED:'1',SHAPESHIFTER_QA:'0'};
 await call(a.token,'POST','/profile',{},flags);
 const before=(await call(a.token,'GET','/state',undefined,flags)).body.profile;
 expect((await call(a.token,'POST','/champions/unlock',{heroId:'shapeshifter'},flags)).status).toBe(200);
 const started=(await call(a.token,'POST','/campaign/start',{heroId:'shapeshifter'},flags)).body;
 const run=started.runs.shapeshifter!,scenario=currentEncounter(ASCENT_CAMPAIGN,run);
 const e=new GameEngine(scenario,campaignBattleContent(content,started.profile,run,DECK_RULES),13);
 // A bounded melee playthrough uses only ordinary commands; the generic bot stops at ranged distance.
 const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
 while(!e.state.outcome && e.state.round<=20){
  const hero=e.state.units.find(unit=>unit.id===e.heroId)!;
  const needsBear=e.state.player.hand.some(card=>e.content.cards[card.cardId]!.category==='ATTACK'&&e.content.cards[card.cardId]!.requiredForms?.includes('bear'));
  const needsMinotaur=e.state.player.hand.some(card=>e.content.cards[card.cardId]!.category==='ATTACK'&&e.content.cards[card.cardId]!.requiredForms?.includes('minotaur'));
  const desired=needsBear?'bear':needsMinotaur?'minotaur':undefined;
  const form=e.state.player.hand.find(card=>e.content.cards[card.cardId]!.effects.some(effect=>effect.type==='TRANSFORM'&&(!desired||effect.formId===desired)));
  if(form&&(!hero.activeForm||(desired&&hero.activeForm!==desired)))e.dispatch({type:'PLAY_CARD',cardUid:form.uid,target:null});
  const foes=e.state.units.filter(unit=>unit.faction==='ENEMY');
  const nearest=(pos:{x:number;y:number})=>Math.min(...foes.map(unit=>distance(pos,unit.pos)));
  if(nearest(hero.pos)>1){const step=e.getLegalMoves().sort((a,b)=>nearest(a.pos)-nearest(b.pos))[0];if(step)e.dispatch({type:'MOVE_UNIT',unitId:e.heroId,to:step.pos});}
  for(let action=0;action<20&&!e.state.outcome;action++){
   const playable=e.state.player.hand.filter(card=>e.getCardPlayability(card.uid).playable && !e.content.cards[card.cardId]!.effects.some(effect=>effect.type==='TRANSFORM'));
   const card=playable.find(card=>e.content.cards[card.cardId]!.targeting.type==='SELF'||e.getValidTargets(card.uid).length>0);if(!card)break;
   const def=e.content.cards[card.cardId]!;if(!e.dispatch({type:'PLAY_CARD',cardUid:card.uid,target:def.targeting.type==='SELF'?null:e.getValidTargets(card.uid)[0]!}).ok)break;
  }
  if(!e.state.outcome){const discard=e.state.player.hand.length>5?e.state.player.hand.at(-1)?.uid:undefined;e.dispatch(discard?{type:'END_TURN',discardUid:discard}:{type:'END_TURN'});}
 }
 expect(e.state.outcome?.result).toBe('WON');
 const proof={encounterId:scenario.id,seed:13,commands:JSON.parse(JSON.stringify(e.history))};
 const won=await call(a.token,'POST','/campaign/victory',{heroId:'shapeshifter',proof},flags);expect(won.status).toBe(200);
 const again=await call(a.token,'POST','/campaign/victory',{heroId:'shapeshifter',proof},flags);
 // Retry restores the same state/wallet but never replays a just-credited notification.
 const {crystalRewards:firstNotices,...firstState}=won.body;
 const {crystalRewards:retryNotices,...retryState}=again.body;
 expect(Array.isArray(firstNotices)).toBe(true);expect(retryNotices).toEqual([]);
 expect(retryState).toEqual(firstState);
 const pending=won.body.runs.shapeshifter!;
 if(pending.status==='CHOOSING_REWARD'){
  const reward={heroId:'shapeshifter',optionId:pending.rewardOptions[0]!.id,encounterId:pending.currentEncounterId};
  const first=await call(a.token,'POST','/campaign/reward',reward,flags);expect(first.status).toBe(200);
  const second=await call(a.token,'POST','/campaign/reward',reward,flags);expect(second.body).toEqual(first.body);
 }
 const restored=(await call(a.token,'GET','/state',undefined,flags)).body;
 expect(restored.runs.shapeshifter!.completedEncounterIds).toContain(scenario.id);
 for(const id of ['mage','summoner','warrior'])expect(restored.profile.heroes[id]).toEqual(before.heroes[id]);
});


it('free fourth champion does not consume the starting choice or either legacy progression milestone',async()=>{
 const available=['mage','summoner','warrior','shapeshifter'];let profile=asNewPlayer(createProfile(content));
 expect(chooseStartingChampion(profile,'shapeshifter',available)).toMatchObject({ok:false,error:'NOT_AVAILABLE'});
 const start=chooseStartingChampion(profile,'mage',available);expect(start.ok).toBe(true);if(!start.ok)return;profile=start.profile;
 const free=claimFreeChampion(profile,'shapeshifter',available);expect(free.ok).toBe(true);if(!free.ok)return;profile=free.profile;
 profile=recordCampaignBest(profile,3);expect(pendingChampionUnlock(profile,available)?.options).toEqual(['summoner','warrior']);
 const warrior=claimChampionUnlock(profile,'warrior',available);expect(warrior.ok).toBe(true);if(!warrior.ok)return;profile=recordCampaignBest(warrior.profile,6);
 const summoner=claimChampionUnlock(profile,'summoner',available);expect(summoner.ok).toBe(true);if(!summoner.ok)return;expect(available.every(id=>isChampionUnlocked(summoner.profile,id))).toBe(true);
 const account=setup();await call(account.token,'POST','/profile',{});
 expect((await call(account.token,'POST','/champions/start',{heroId:'shapeshifter'})).status).toBe(403);
});
