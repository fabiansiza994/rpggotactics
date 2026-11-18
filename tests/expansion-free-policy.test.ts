import {it,expect} from 'vitest';
import {marketFixture,MARKET_FLAGS} from './support/marketReorg';
import {DEFAULT_CONTENT,COSMETICS,DECK_RULES,ownedFor} from '../src/game';
import {releasedContent} from '../server/src/ritualRelease';
import {MARKET_EXPANSIONS,freePackAllowance} from '../src/game/store/market-expansions';
import {boosterOffers,expansionViews} from '../server/src/boosters';
import {memoryD1} from './support/d1';
import type {CatalogOffer} from '../src/presentation/shop/api';
const ids=['origins_arcanos','thunder_god','antarctic_magic','pack_pact','warrior_promise','reserva_cazador'];
const content=releasedContent(DEFAULT_CONTENT,{...MARKET_FLAGS,DB:memoryD1()});
const ctx={content,cosmetics:COSMETICS,rules:DECK_RULES};
const freeId=(id:string)=>`booster_${id}_free`;
it('permanent default: 5 Origins + 3 for every enabled expansion, total 20; identical paid pools and weights',()=>{
 const offers=boosterOffers(ctx),free=offers.filter(o=>o.booster?.freeGrant);expect(free).toHaveLength(6);expect(free.reduce((n,o)=>n+o.purchaseLimit!,0)).toBe(20);
 for(const id of ids){const f=free.find(o=>o.id===freeId(id))!,paid=offers.find(o=>o.id===`booster_${id}_x1`)!;expect(f.purchaseLimit).toBe(id==='origins_arcanos'?5:3);expect(f.contents).toEqual(paid.contents);expect(f.booster!.weights).toEqual({COMMON:55,UNCOMMON:30,RARE:12,LEGENDARY:3,ULTRA:0});expect(f.booster!.revision).toBe(paid.booster!.revision);expect(f.price).toBe(0);expect(f.giftable).toBe(false);}
});
it('future published definitions default to 3, but future/invalid pools grant nothing early',()=>{
 const e=MARKET_EXPANSIONS.find(e=>e.id==='pack_pact')!;
 expect(boosterOffers(ctx,undefined,undefined,[{...e,status:'COMING_SOON'}])).toEqual([]);
 expect(boosterOffers(ctx,undefined,undefined,[{...e,cardIds:[]}])).toEqual([]);
 expect(boosterOffers(ctx,undefined,undefined,[{...e}]).find(o=>o.booster?.freeGrant)?.purchaseLimit).toBe(3);
 for(const id of ['furia_elemental','aliados_oscuridad','camino_luz']){const future={...e,id,status:'COMING_SOON' as const};expect(freePackAllowance(future)).toBe(0);expect(freePackAllowance({...future,status:'AVAILABLE'})).toBe(3);expect(boosterOffers(ctx,undefined,undefined,[{...future,status:'AVAILABLE'}])).toEqual([]);}
 const views=expansionViews(ctx,boosterOffers(ctx));for(const e of views.filter(e=>e.status!=='AVAILABLE')){expect(e.packs).toHaveLength(0);expect(e.freePacksPerPlayer).toBe(0);}
});
for(const legacyProfiles of [true,false])it(`${legacyProfiles?'existing':'new'} account gets independent benefits regardless of prior paid packs, starter ownership and launch reward`,async()=>{
 const f=await marketFixture({legacyProfiles});try{
  if(legacyProfiles){await f.call('POST','/store/launch-reward/claim',{});for(const id of ids)expect((await f.buy(`booster_${id}_x1`,'paid-'+id)).status).toBe(200);}
  const c=await f.catalog();for(const id of ids)expect(c.offers.find((o:CatalogOffer)=>o.id===freeId(id)).freeRemaining).toBe(id==='origins_arcanos'?5:3);
  const before=(await f.call('GET','/wallet')).data.wallet.balance;await f.buy(freeId('thunder_god'),'first-free');const fresh=await f.catalog();expect(fresh.offers.find((o:CatalogOffer)=>o.id===freeId('thunder_god')).freeRemaining).toBe(2);for(const id of ids.filter(id=>id!=='thunder_god'))expect(fresh.offers.find((o:CatalogOffer)=>o.id===freeId(id)).freeRemaining).toBe(id==='origins_arcanos'?5:3);expect((await f.call('GET','/wallet')).data.wallet.balance).toBe(before);
 }finally{f.db.sql.close();}
});
for(const id of ids)it(`${id}: full entitlement, reject extra free, no charge, four cards, receipt replay and paid packs remain usable`,async()=>{
 const f=await marketFixture();try{
  const limit=id==='origins_arcanos'?5:3;const beforeWallet=(await f.call('GET','/wallet')).data.wallet.balance;
  const decks=f.db.sql.prepare('SELECT * FROM tactics_decks ORDER BY deck_id').all();
  for(let n=0;n<limit;n++){
   const before=(await f.call('GET','/state')).data.profile;const r=await f.buy(freeId(id),'free-claim-'+n);expect(r.status).toBe(200);const p=r.data.purchase;expect(p.price).toBe(0);expect(p.granted.opening.cards).toHaveLength(4);expect(p.granted.cards.reduce((s:number,c:{copies:number})=>s+c.copies,0)).toBe(4);
   const after=(await f.call('GET','/state')).data.profile;for(const c of p.granted.cards){expect(ownedFor(after,c.heroId,content)(c.cardId)).toBe(ownedFor(before,c.heroId,content)(c.cardId)+c.copies);expect(ownedFor(after,c.heroId,content)(c.cardId)).toBe(c.total);}
   const replay=await f.call('POST','/store/purchase',{offerId:freeId(id),idempotencyKey:'free-claim-'+n,receiptOnly:true});expect(replay.status).toBe(200);expect(replay.data.replayed).toBe(true);expect(replay.data.purchase).toEqual(p);expect((await f.call('GET','/state')).data.profile).toEqual(after);expect((await f.catalog()).offers.find((o:CatalogOffer)=>o.id===freeId(id)).freeRemaining).toBe(limit-n-1);
  }
  const state=(await f.call('GET','/state')).data.profile;const rejected=await f.buy(freeId(id),'excess-qa');expect(rejected.status).toBe(409);expect((await f.call('GET','/state')).data.profile).toEqual(state);expect((await f.call('GET','/wallet')).data.wallet.balance).toBe(beforeWallet);expect(f.db.sql.prepare('SELECT * FROM tactics_decks ORDER BY deck_id').all()).toEqual(decks);
  for(const n of [1,5,10])expect((await f.catalog()).offers.find((o:CatalogOffer)=>o.id===`booster_${id}_x${n}`).availability.purchasable).toBe(true);
 }finally{f.db.sql.close();}
});
for(const id of ids.slice(1))it(`${id}: 12 concurrent tabs cannot exceed three, same-key retries remain one grant`,async()=>{
 const f=await marketFixture();try{
  const offer=(await f.catalog()).offers.find((o:CatalogOffer)=>o.id===freeId(id));const body={offerId:offer.id,quoteToken:offer.purchaseQuote.token,packRevision:offer.booster.revision,packFormat:'GENERAL_BATCH_V1',boxFormat:'FINITE_BOX_V1'};
  const results=await Promise.all(Array.from({length:12},(_,i)=>f.call('POST','/store/purchase',{...body,idempotencyKey:'qa-tab-'+i})));expect(results.filter(r=>r.status===200)).toHaveLength(1);for(let n=0;n<2;n++)expect((await f.buy(offer.id,'refreshed-tab-'+n)).status).toBe(200);
  expect(f.db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_store_purchases').get()?.n).toBe(3);expect((await f.call('GET','/wallet')).data.wallet.balance).toBe(30000);expect((await f.catalog()).offers.find((o:CatalogOffer)=>o.id===offer.id).freeRemaining).toBe(0);
  const winner=results.find(r=>r.status===200)!.data.purchase;const row=f.db.sql.prepare('SELECT idempotency_key FROM tactics_store_purchases WHERE purchase_id=?').get(winner.purchaseId)!;const replays=await Promise.all(Array.from({length:6},()=>f.call('POST','/store/purchase',{...body,idempotencyKey:row.idempotency_key})));expect(replays.every(r=>r.status===200&&r.data.replayed&&r.data.purchase.purchaseId===winner.purchaseId)).toBe(true);expect(f.db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_store_purchases').get()?.n).toBe(3);
 }finally{f.db.sql.close();}
});
it('new auth session and fresh catalog preserve counters, cards and receipt',async()=>{
 const f=await marketFixture();try{
  const r=await f.buy(freeId('thunder_god'),'session-free');const before=(await f.call('GET','/state')).data.profile;const old=f.account.token;f.db.sql.prepare('DELETE FROM sessions WHERE token=?').run(old);f.db.sql.prepare('INSERT INTO sessions(token,username,created_at,expires_at) VALUES(?,?,?,?)').run('local-new-session','market_local_qa',Date.now(),Date.now()+3600000);f.account.token='local-new-session';expect((await f.catalog()).offers.find((o:CatalogOffer)=>o.id===freeId('thunder_god')).freeRemaining).toBe(2);expect((await f.call('GET','/state')).data.profile).toEqual(before);const replay=await f.call('POST','/store/purchase',{offerId:freeId('thunder_god'),idempotencyKey:'session-free',receiptOnly:true});expect(replay.data.purchase).toEqual(r.data.purchase);
 }finally{f.db.sql.close();}
});
it('pool revision/membership changes never reset entitlement or reinterpret an old receipt',async()=>{
 const e=MARKET_EXPANSIONS.find(e=>e.id==='pack_pact')!,originalRevision=e.pack!.policy.revision,originalIds=e.cardIds;const f=await marketFixture();try{
  const r=await f.buy(freeId(e.id),'old-revision');e.pack!.policy.revision='qa-new-revision';e.cardIds=e.cardIds.filter(id=>id!==e.cardIds.find(id=>content.cards[id]?.rarity==='COMMON'));
  expect((await f.catalog()).offers.find((o:CatalogOffer)=>o.id===freeId(e.id)).freeRemaining).toBe(2);const replay=await f.call('POST','/store/purchase',{offerId:freeId(e.id),idempotencyKey:'old-revision',receiptOnly:true});expect(replay.data.purchase).toEqual(r.data.purchase);for(let i=0;i<2;i++)expect((await f.buy(freeId(e.id),'new-rev-'+i)).status).toBe(200);expect((await f.buy(freeId(e.id),'fourth-qa')).status).toBe(409);
 }finally{e.pack!.policy.revision=originalRevision;e.cardIds=originalIds;f.db.sql.close();}
});
it('legacy Origins offer id counts even without newer snapshot metadata; benefit is not reset',async()=>{
 const f=await marketFixture();try{await f.buy('booster_origins_arcanos_free','historic');f.db.sql.prepare("UPDATE tactics_store_purchases SET offer_json='{}' WHERE offer_id='booster_origins_arcanos_free'").run();expect((await f.catalog()).offers.find((o:CatalogOffer)=>o.id==='booster_origins_arcanos_free').freeRemaining).toBe(4);}finally{f.db.sql.close();}
});
it('different offer variants of one expansion share the same atomic free entitlement',async()=>{
 const f=await marketFixture();try{
  const original=boosterOffers(ctx).find(o=>o.id===freeId('pack_pact'))!;const alias={...original,id:'booster_pack_pact_variant_free'};f.deps.store.catalog=[...f.deps.store.catalog,alias];
  const c=await f.catalog();const offers=[c.offers.find((o:CatalogOffer)=>o.id===original.id),c.offers.find((o:CatalogOffer)=>o.id===alias.id)];
  const r=await Promise.all(Array.from({length:10},(_,i)=>{const o=offers[i%2];return f.call('POST','/store/purchase',{offerId:o.id,idempotencyKey:'variant-tab-'+i,quoteToken:o.purchaseQuote.token,packRevision:o.booster.revision,packFormat:'GENERAL_BATCH_V1',boxFormat:'FINITE_BOX_V1'});}));
  expect(r.filter(r=>r.status===200)).toHaveLength(1);for(let n=0;n<2;n++)expect((await f.buy(offers[n%2].id,'fresh-variant-'+n)).status).toBe(200);const after=await f.catalog();for(const o of offers)expect(after.offers.find((x:CatalogOffer)=>x.id===o.id).freeRemaining).toBe(0);expect((await f.call('GET','/wallet')).data.wallet.balance).toBe(30000);
 }finally{f.db.sql.close();}
});
