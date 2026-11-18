import {describe,it,expect} from 'vitest';
import {DEFAULT_CONTENT,DECK_RULES,GameEngine,copyLimit,validateDeck,createProfile} from '../src/game';
import {makeEngine,mutable,p,setHand,unit,ctxFor} from './helpers';
import {applyStatus,expireTurnStartStatuses,decrementStatuses} from '../src/game/domain/statuses/status-rules';
import {spawnSummon,summonLimitFor,summonCapacityOf,summonUsage} from '../src/game/domain/summons/summons';
import {dealDamage} from '../src/game/domain/combat/damage';
import {snowTurnEnd} from '../src/game/domain/combat/snow';
import {createDuel,applyDuel,duelView,validateLoadout} from '../src/game/pvp/duel';
import {getValidTargets} from '../src/game/domain/cards/targeting';
import {botCandidates} from '../src/game/ai/ranked-bot';
import {marketFixture} from './support/marketReorg';
const setup=()=>{const e=makeEngine({hero:{heroId:'mage',pos:p(1,2)}});mutable(e).player.energy=30;return e;};
const hero=(e:GameEngine)=>unit(e,e.heroId);
const world=(e:GameEngine,turns=10)=>applyStatus(ctxFor(e),hero(e),'ABSOLUTE_ZERO',turns,e.heroId);
const cast=(e:GameEngine,to=p(2,2))=>{const [uid]=setHand(e,['snow_soldier']);return e.dispatch({type:'PLAY_CARD',cardUid:uid!,target:to});};
const soldiers=(e:GameEngine)=>e.state.units.filter(u=>u.defId==='snow_soldier');
const restore=(e:GameEngine)=>GameEngine.fromSnapshot(JSON.parse(JSON.stringify(e.state)),e.content,e.scenario);
describe('owner-scoped Snow Soldier cap',()=>{
 it('base one, upgraded two, third rejected before energy/card consumption',()=>{
  const e=setup();expect(cast(e).ok).toBe(true);expect(cast(e,p(2,1)).ok).toBe(false);world(e);expect(cast(e,p(2,1)).ok).toBe(true);
  const [uid]=setHand(e,['snow_soldier']);const energy=e.state.player.energy;
  expect(e.getCardPlayability(uid!).playable).toBe(false);expect(e.dispatch({type:'PLAY_CARD',cardUid:uid!,target:p(1,1)}).ok).toBe(false);
  expect(e.state.player.energy).toBe(energy);expect(e.state.player.hand[0]?.uid).toBe(uid);expect(soldiers(e)).toHaveLength(2);
 });
 it('spawn path cannot bypass upgraded cap or mutate capacity',()=>{
  const e=setup(),ctx=ctxFor(e),h=hero(e),capacity=summonCapacityOf(e.content,h);world(e);
  expect(spawnSummon(ctx,h,'snow_soldier',p(2,2))).not.toBeNull();expect(spawnSummon(ctx,h,'snow_soldier',p(2,1))).not.toBeNull();expect(spawnSummon(ctx,h,'snow_soldier',p(1,1))).toBeNull();
  expect(summonCapacityOf(e.content,h)).toBe(capacity);expect(summonUsage(e.state,h.id)).toBe(0);
 });
 it('expiry preserves both and blocks replacements until fewer than one remain',()=>{
  let e=setup();world(e,1);cast(e);cast(e,p(2,1));expireTurnStartStatuses(ctxFor(e),hero(e));e=restore(e);
  expect(soldiers(e)).toHaveLength(2);expect(cast(e,p(1,1)).ok).toBe(false);
  dealDamage(ctxFor(e),soldiers(e)[0]!,99,'orc-1','PHYSICAL','DIRECT_MELEE');expect(cast(e,p(1,1)).ok).toBe(false);
  dealDamage(ctxFor(e),soldiers(e)[0]!,99,'orc-1','PHYSICAL','DIRECT_MELEE');expect(cast(e,p(1,1)).ok).toBe(true);
 });
 it('death under owner climate permits one replacement, with original stats/age/readiness',()=>{
  let e=setup();world(e);cast(e);cast(e,p(2,1));const s=soldiers(e)[0]!;dealDamage(ctxFor(e),s,99,'orc-1','PHYSICAL','DIRECT_MELEE');e=restore(e);
  expect(cast(e).ok).toBe(true);expect(soldiers(e)).toHaveLength(2);expect(cast(e,p(1,1)).ok).toBe(false);
  expect(soldiers(e)[1]).toMatchObject({hp:5,moveRange:2,summon:{capacityCost:0,meltTurnsLeft:5,readyRound:e.state.round+1}});
 });
 it('rival climate or expired status never grants two; other creatures retain limits',()=>{
  const e=setup(),h=hero(e);applyStatus(ctxFor(e),unit(e,'orc-1'),'ABSOLUTE_ZERO',10,'orc-1');expect(cast(e).ok).toBe(true);expect(cast(e,p(2,1)).ok).toBe(false);
  h.statuses=[{id:'ABSOLUTE_ZERO',turnsLeft:0}];expect(summonLimitFor(e.content.summons!.snow_soldier!,h)).toBe(1);world(e);
  expect(summonLimitFor({id:'wolf',maxPerOwner:1},h)).toBe(1);expect(summonLimitFor({id:'turtle'},h)).toBeUndefined();
 });
 it('bot candidate generator follows same legality before and after climate/second soldier',()=>{
  const e=setup();cast(e);setHand(e,['snow_soldier']);const can=()=>botCandidates(mutable(e),DEFAULT_CONTENT).some(c=>c.type==='PLAY_CARD'&&c.cardUid===e.state.player.hand[0]?.uid);
  expect(can()).toBe(false);world(e);expect(can()).toBe(true);expect(cast(e,p(2,1)).ok).toBe(true);setHand(e,['snow_soldier']);expect(can()).toBe(false);
 });
 it('PvP both seats, JSON recovery, rival ownership and duplicate command rejection',()=>{
  const profile=createProfile(DEFAULT_CONTENT);let s=createDuel([validateLoadout(profile,'mage'),validateLoadout(profile,'mage')],42);
  const owner=s.units.find(u=>u.id===s.player.heroId)!,rival=s.units.find(u=>u.kind==='HERO'&&u.id!==owner.id)!;
  applyStatus({state:s,content:DEFAULT_CONTENT,emit:()=>{}},rival,'ABSOLUTE_ZERO',10,rival.id);
  const cells=()=>getValidTargets({state:s,content:DEFAULT_CONTENT,emit:()=>{}},s.units.find(u=>u.id===owner.id)!,DEFAULT_CONTENT.cards.snow_soldier!.targeting);
  s.player.energy=30;s.player.hand=['a','b','c'].map(uid=>({uid,cardId:'snow_soldier'}));
  s=applyDuel(s,{type:'PLAY_CARD',cardUid:'a',target:cells()[0]!}).state;
  expect(()=>applyDuel(s,{type:'PLAY_CARD',cardUid:'b',target:cells()[0]!})).toThrow();
  applyStatus({state:s,content:DEFAULT_CONTENT,emit:()=>{}},s.units.find(u=>u.id===owner.id)!,'ABSOLUTE_ZERO',10,owner.id);
  s=applyDuel(s,{type:'PLAY_CARD',cardUid:'b',target:cells()[0]!}).state;s=JSON.parse(JSON.stringify(s));
  for(const seat of [0,1] as const)expect(duelView(s,seat).units.filter(u=>u.defId==='snow_soldier'&&u.summon?.ownerId===owner.id)).toHaveLength(2);
  expect(()=>applyDuel(s,{type:'PLAY_CARD',cardUid:'b',target:cells()[0]!})).toThrow();expect(()=>applyDuel(s,{type:'PLAY_CARD',cardUid:'c',target:cells()[0]!})).toThrow();
 });
});
describe('Snow War deck exception and two real activations',()=>{
 for(const n of [1,2,3])it(`${n} copies: server save and reload`,async()=>{
  const f=await marketFixture();try{
   f.db.sql.prepare("INSERT INTO tactics_player_cards(user_id,hero_id,card_id,copies,acquired,source,unlocked_at) VALUES(?,'mage','snow_war',3,3,'QA_LOCAL',0)").run(f.account.id);
   const profile=(await f.call('GET','/state')).data.profile,deck=profile.heroes.mage.decks.find((d:{id:string})=>d.id===profile.heroes.mage.activeDeckId);
   const cards=[...deck.cards.map((c:{cardId:string,count:number})=>c.cardId==='magic_missile'?{...c,count:c.count-n}:c).filter((c:{count:number})=>c.count>0),{cardId:'snow_war',count:n}];
   expect(validateDeck(cards,'mage',()=>100,DEFAULT_CONTENT,DECK_RULES).some(i=>i.code==='COPY_LIMIT')).toBe(n===3);
   const r=await f.call('PUT',`/decks/mage/${deck.id}`,{cards});expect(r.status).toBe(n===3?422:200);
   if(n<3)expect((await f.call('GET','/state')).data.profile.heroes.mage.decks.find((d:{id:string})=>d.id===deck.id).cards.find((c:{cardId:string})=>c.cardId==='snow_war').count).toBe(n);
  }finally{f.db.sql.close();}
 });
 it('keeps rarity/cost/effects, soldier max2 and all unrelated rare/unique limits',()=>{
  expect(DEFAULT_CONTENT.cards.snow_war).toMatchObject({rarity:'RARE',cost:3,maxCopies:2,effects:[{type:'APPLY_STATUS',status:'SNOW_WAR',duration:5,to:'CASTER'}]});
  expect(copyLimit(DEFAULT_CONTENT.cards.snow_soldier!,DECK_RULES)).toBe(2);expect(copyLimit(DEFAULT_CONTENT.cards.glacier_claw!,DECK_RULES)).toBe(1);expect(copyLimit({...DEFAULT_CONTENT.cards.snow_war!,unique:true},DECK_RULES)).toBe(1);
 });
 it('both distinct copies work sequentially after normal expiry, preserving once-per-turn shots',()=>{
  let e=setup();const ids=setHand(e,['snow_war','snow_war']);expect(e.dispatch({type:'PLAY_CARD',cardUid:ids[0]!,target:null}).ok).toBe(true);
  const hp=unit(e,'orc-1').hp;snowTurnEnd(ctxFor(e),hero(e));const damaged=unit(e,'orc-1').hp;expect(damaged).toBeLessThan(hp);e=restore(e);snowTurnEnd(ctxFor(e),hero(e));expect(unit(e,'orc-1').hp).toBe(damaged);
  for(let i=0;i<5;i++)decrementStatuses(ctxFor(e),hero(e));expect(hero(e).statuses.some(s=>s.id==='SNOW_WAR')).toBe(false);
  expect(e.dispatch({type:'PLAY_CARD',cardUid:ids[1]!,target:null}).ok).toBe(true);expect(hero(e).statuses.filter(s=>s.id==='SNOW_WAR')).toHaveLength(1);expect(e.state.player.hand).toHaveLength(0);
 });
});
