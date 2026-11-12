import { describe, expect, it, vi, afterEach } from 'vitest';
import { premiumVfxEnabled } from '../src/presentation/vfx/premiumVfxRelease';
import { fireballPilotAllowed } from '../src/presentation/vfx/fireballRecipe';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ALL_RELEASED } from './support/drops';
import { DEFAULT_CONTENT, DECK_RULES, STORE_CATALOG, PRICE_LADDER, COSMETICS, createProfile, ownedFor, heroProfile, validateDeck, rarityOf, rollReward } from '../src/game';
import { MAGE_THUNDER_CORE } from '../src/game/data/mage-thunder-core';
import { MAGE_THUNDER_EXPANSION } from '../src/game/data/mage-thunder-expansion';
import { handle } from '../server/src/index';
import { PVP_CONTENT } from '../server/src/pvp';
import { validateLoadout } from '../src/game/pvp/duel';
import { addAccount, memoryD1 } from './support/d1';
import { p, makeEngine, setHand } from './helpers';
import { cardRecipe } from '../src/presentation/vfx/catalogRecipes';
import { FINAL_CARD_ART } from '../src/presentation/assets/paintedAssets';
import { validateCatalog } from '../src/game/store/store';

const cards=[...MAGE_THUNDER_CORE,...MAGE_THUNDER_EXPANSION];
const nature=['grasping_roots','venom_thorns','vital_sap','entangled_forest','rebirth_bloom'];
const envFlags={SHAPESHIFTER_ENABLED:'1',WARRIOR_ENABLED:'1',ARCHER_ENABLED:'1',FREE_CATALOG_ENABLED:'1'};
const context={content:DEFAULT_CONTENT,rules:DECK_RULES,cosmetics:COSMETICS};
describe('Release 2 boundary and acquisition',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('Premium is explicitly available in production and can be disabled without local-only gates',()=>{vi.stubEnv('DEV',false);vi.stubEnv('VITE_PREMIUM_VFX_ENABLED','1');expect(premiumVfxEnabled()).toBe(true);expect(fireballPilotAllowed()).toBe(true);vi.stubEnv('VITE_PREMIUM_VFX_ENABLED','0');expect(premiumVfxEnabled()).toBe(false);expect(fireballPilotAllowed()).toBe(false);});
 it('registers exactly 15 Thunder cards, with no Nature definitions, rewards, offers or assets',()=>{
  expect(Object.values(DEFAULT_CONTENT.cards).filter(c=>c.tags.includes('thunder')).map(c=>c.id).sort()).toEqual(cards.map(c=>c.id).sort());
  for(const id of nature){expect(DEFAULT_CONTENT.cards[id]).toBeUndefined();expect(PVP_CONTENT.cards[id]).toBeUndefined();expect(FINAL_CARD_ART[id]).toBeUndefined();expect(STORE_CATALOG.some(o=>o.contents.some(c=>c.kind==='CARD'&&c.cardId===id))).toBe(false);}
  expect(Object.values(DEFAULT_CONTENT.cards).filter(c=>c.tags.includes('nature'))).toEqual([]);
  expect(DEFAULT_CONTENT.cards.arcane_surge!.heroId).toBe('mage');
 });
 it('uses existing rarity prices and keeps catalog validation valid',()=>{expect(validateCatalog(STORE_CATALOG,{...context,content:ALL_RELEASED})).toEqual([]);});
 it.each(cards)('$id has individual art, recipe, one-copy offer and no login grant',card=>{
  expect(DEFAULT_CONTENT.cards[card.id]).toEqual(card);expect(PVP_CONTENT.cards[card.id]).toEqual(card);
  expect(existsSync(new URL('../public'+FINAL_CARD_ART[card.id],import.meta.url))).toBe(true);
  expect(cardRecipe(card,[]).variant).toBe(card.id);
  const offer=STORE_CATALOG.find(o=>o.id===`card_${card.id}`);if(card.id==='storm_avatar'){expect(offer).toBeUndefined();return;}expect(offer!.price).toBe(PRICE_LADDER.card[rarityOf(card)]);expect(offer!.contents).toEqual([{kind:'CARD',cardId:card.id,copies:1}]);
  expect(ownedFor(createProfile(DEFAULT_CONTENT),'mage',DEFAULT_CONTENT)(card.id)).toBe(0);
 });
 it('keeps published hotfixes and the approved Mobile 3 canvas intact',()=>{
  // Only BattleCanvas hash advances for the approved presentation-only Mobile 3 presentation hook and lane.
  const publishedHashes={ "src/presentation/pvp/eligibility.ts": "282e6478f69770ac04721eb93664916ca4e50f8213ae99b69ca6044f76ed0f6a", "src/presentation/pixi/BattleCanvas.ts": "018253b636fbf86c877572a71d30de34205b3da1f6d04556a11823b36677543b", "src/presentation/pixi/RotatingSections.ts": "8bccef1f9fb5cf07853d9110f4feecfd2ef24f9ed62a5e06f5be71c5d92ed155", "src/presentation/vfx/visualProjection.ts": "95399a2c9476b34442e3b680b3d0c00fd2df4f10945bcb0fdc1d852178c5c065", "src/presentation/store/battleStore.ts": "dd542c0b7f1fe06548c73ca98ea2666459f061335b54006c6d049813f91e9c57"};
  for(const [path,hash] of Object.entries(publishedHashes))expect(createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex')).toBe(hash);
 });
 it.each(nature)('%s cannot be equipped, acquired or played even by a forged request',async id=>{
  const db=memoryD1({legacyProfiles:true});try{
   const a=addAccount(db,'release2_qa'),env={DB:db,...envFlags};
   const request=(path:string,body?:unknown,method=body?'POST':'GET')=>handle(new Request('http://localhost/api/tactics/'+path,{method,headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env);
   await request('profile',{});
   const cat=await (await request('store/catalog')).json() as {offers:Array<{id:string}>};expect(cat.offers.some(o=>o.id===`card_${id}`)).toBe(false);
   expect((await request('store/purchase',{offerId:`card_${id}`,idempotencyKey:'reject-nature-0001'})).ok).toBe(false);
   const profile=createProfile(DEFAULT_CONTENT),h=heroProfile(profile,'mage',DEFAULT_CONTENT);h.collection[id]={copies:1,acquired:1};h.decks[0]!.cards=[...h.decks[0]!.cards,{cardId:id,count:1}];expect(()=>validateLoadout(profile,'mage',PVP_CONTENT)).toThrow('INVALID_DECK');
   const e=makeEngine({hero:{heroId:'mage',pos:p(1,1)},enemies:[{id:'enemy',enemyId:'orc_warrior',pos:p(2,1)}]});const [uid]=setHand(e,[id]);expect(e.dispatch({type:'PLAY_CARD',cardUid:uid!,target:p(2,1)}).ok).toBe(false);
  }finally{db.sql.close();}
 });
 it.each(cards.filter(c=>c.id!=='storm_avatar'))('$id purchase is authoritative, idempotent and persists ownership',async card=>{
  const db=memoryD1({legacyProfiles:true});try{
   const a=addAccount(db,'release2_qa');const request=(path:string,body?:unknown)=>handle(new Request('http://localhost/api/tactics/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),{DB:db,...envFlags});
   await request('profile',{});
   db.sql.prepare("INSERT INTO tactics_wallet_ledger (transaction_id,user_id,currency_id,amount_delta,balance_before,balance_after,reason,reference_id,note,created_at) VALUES (?,?, 'arcane_crystals',1000,0,1000,'QA_GRANT','release2','local test',0)").run('qa-'+card.id,a.id);
   const buy=()=>request('store/purchase',{offerId:`card_${card.id}`,idempotencyKey:'purchase-'+card.id,price:1});const first=await buy();expect(first.status).toBe(200);const receipt=await first.json() as {purchase:{price:number;purchaseId:string}};expect(receipt.purchase.price).toBe(PRICE_LADDER.card[rarityOf(card)]);
   const repeat=await (await buy()).json() as {purchase:{purchaseId:string};replayed:boolean};expect(repeat.replayed).toBe(true);expect(repeat.purchase.purchaseId).toBe(receipt.purchase.purchaseId);
   const state=await (await request('state')).json() as {profile:ReturnType<typeof createProfile>};expect(ownedFor(state.profile,'mage',DEFAULT_CONTENT)(card.id)).toBe(1);
   const hero=heroProfile(state.profile,'mage',DEFAULT_CONTENT);const deck=structuredClone(hero.decks[0]!.cards);const out=deck.find(c=>c.count>0)!;out.count--;const corrected=deck.filter(c=>c.count);corrected.push({cardId:card.id,count:1});expect(validateDeck(corrected,'mage',ownedFor(state.profile,'mage',DEFAULT_CONTENT),DEFAULT_CONTENT,DECK_RULES)).toEqual([]);
  }finally{db.sql.close();}
 });
 it('normal rewards cannot return Nature',()=>{
  const profile=createProfile(DEFAULT_CONTENT);for(let seed=1;seed<=80;seed++){const offer=rollReward({content:DEFAULT_CONTENT,heroId:'mage',owned:ownedFor(profile,'mage',DEFAULT_CONTENT),seed,poolId:'BOSS',count:3,pity:0,rules:DECK_RULES});expect(JSON.stringify(offer)).not.toMatch(/grasping_roots|venom_thorns|vital_sap|entangled_forest|rebirth_bloom/);}
 });
});
