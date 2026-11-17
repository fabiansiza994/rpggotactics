import {MarketHome} from "../src/presentation/shop/MarketHome";
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DEFAULT_CONTENT,COSMETICS,DECK_RULES,rarityOf,createProfile} from '../src/game';
import {releasedContent} from '../server/src/ritualRelease';
import {boosterOffers,expansionViews} from '../server/src/boosters';
import {MARKET_FLAGS,marketFixture} from './support/marketReorg';
import {memoryD1} from './support/d1';
import {resolvePresentationCard} from '../src/presentation/catalog/cardPresentation';
import {PackOpening} from '../src/presentation/shop/PackOpening';
import {PackBatchOpening,batchSceneKey} from '../src/presentation/shop/PackBatchOpening';
import {MarketCardPreview} from '../src/presentation/shop/MarketCardPreview';
import {BoosterOdds} from '../src/presentation/shop/BoosterOdds';
import {packSceneKey} from '../src/presentation/shop/packScene';
import type {PurchasePlan} from '../src/game/store/store';
import type {CatalogOffer} from '../src/presentation/shop/api';
const content=releasedContent(DEFAULT_CONTENT,{...MARKET_FLAGS,DB:memoryD1()});
const offers=boosterOffers({content,cosmetics:COSMETICS,rules:DECK_RULES}).filter(o=>o.booster?.packs===1&&!o.booster.freeGrant);
const pool=offers.flatMap(o=>o.contents.flatMap(c=>c.kind==='CARD'?[{offer:o,id:c.cardId}]:[]));
const storage=new Map<string,string>();
const noop=()=>{};
function opening(ids:string[],packId='booster_reserva_cazador_x1'):NonNullable<PurchasePlan['opening']>{
 return {packId,revision:'qa-persisted-snapshot',cards:ids.map(cardId=>({heroId:content.cards[cardId]?.heroId??'mage',cardId,copies:1,total:4,cap:3}))};
}
function renderSingle(o:NonNullable<PurchasePlan['opening']>){storage.set(packSceneKey('qa'),JSON.stringify({phase:'reveal',mask:15}));return renderToStaticMarkup(createElement(PackOpening,{opening:o,receiptId:'qa',onInspect:noop,onDone:noop}));}
beforeEach(()=>{storage.clear();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)});vi.stubGlobal('matchMedia',()=>({matches:true}));});
afterEach(()=>vi.unstubAllGlobals());
it('derives six real pools with exactly 149 unique eligible cards',()=>{
 expect(offers).toHaveLength(6);expect(pool).toHaveLength(149);expect(new Set(pool.map(c=>c.id)).size).toBe(149);
 expect(offers.map(o=>o.contents.length).sort((a,b)=>a-b)).toEqual([16,19,22,23,33,36]);
});
describe('every authoritative commercial card renders in the real opening and preview',()=>{
 for(const {offer,id} of pool)it(id,()=>{
  const card=resolvePresentationCard(id);expect(card,id).toBeDefined();expect(card).toEqual(content.cards[id]);
  const html=renderSingle(opening([id,id,id,id],offer.id));expect(html.match(/class="feature-card /g)).toHaveLength(4);expect(html).toContain(`data-rarity="${rarityOf(card!)}"`);expect(html).not.toContain('data-unresolved-card');
  const preview=renderToStaticMarkup(createElement(MarketCardPreview,{cardId:id,onClose:noop}));expect(preview).toContain('class="feature-card ');
  storage.set(batchSceneKey('all-cards'),JSON.stringify({index:0,summary:true}));
  const batch=renderToStaticMarkup(createElement(PackBatchOpening,{openings:[opening([id,id,id,id],offer.id)],receiptId:'all-cards',onInspect:noop,onDone:noop}));expect(batch).toContain(card!.name);
 });
});
it('reproduces the exact Cazador incident and the correct rarities',()=>{
 const ids=['stalker_step','branch_leap','executioner_arrow','smoke_arrow'];
 expect(ids.map(id=>rarityOf(resolvePresentationCard(id)!))).toEqual(['COMMON','COMMON','COMMON','UNCOMMON']);
 expect(renderSingle(opening(ids)).match(/class="feature-card /g)).toHaveLength(4);
});
for(const n of [5,10])it(`renders x${n} summary from mixed expanded catalog rarities without reinterpreting receipt`,()=>{
 const ids=['COMMON','UNCOMMON','RARE','LEGENDARY'].map(r=>pool.find(c=>rarityOf(content.cards[c.id]!)===r)!.id);
 const openings=Array.from({length:n},(_,i)=>opening(ids,offers[i%offers.length]!.id));const snapshot=JSON.stringify(openings);
 storage.set(batchSceneKey('batch'),JSON.stringify({index:n-1,summary:true}));
 const html=renderToStaticMarkup(createElement(PackBatchOpening,{openings,receiptId:'batch',onInspect:noop,onDone:noop}));
 expect(html).toContain(`${n*4} cartas obtenidas`);for(const label of ['Comunes','Infrecuentes','Raras','Legendarias'])expect(html).toContain(label);expect(JSON.stringify(openings)).toBe(snapshot);
});
it('unknown historic ID safely renders single, batch and preview, without a fake rarity',()=>{
 const unknown='historic_missing_card';const o=opening([unknown,'blink',unknown,'branch_leap']);const snapshot=JSON.stringify(o);
 const html=renderSingle(o);expect(html).toContain(`data-unresolved-card="${unknown}"`);expect(html).toContain('Tu entrega se conserva');expect(resolvePresentationCard(unknown)).toBeUndefined();
 storage.set(batchSceneKey('unknown'),JSON.stringify({index:0,summary:true}));
 const batch=renderToStaticMarkup(createElement(PackBatchOpening,{openings:[o],receiptId:'unknown',onInspect:noop,onDone:noop}));expect(batch).toContain('Sin datos visuales');
 expect(renderToStaticMarkup(createElement(MarketCardPreview,{cardId:unknown,onClose:noop}))).toContain('Datos visuales no disponibles');expect(JSON.stringify(o)).toBe(snapshot);
});
for(const baseOffer of offers)for(const quantity of [1,5,10]){
 const offer={...baseOffer,id:baseOffer.id.replace(/_x1$/,`_x${quantity}`)};
 it(`real persisted ${offer.id}: single + batch snapshot and odds render`,async()=>{
 const f=await marketFixture();try{
  const r=await f.buy(offer.id,`presentation-${offer.id}`);expect(r.status).toBe(200);
  const purchase=r.data.purchase as {purchaseId:string;granted:PurchasePlan};
  expect(renderSingle(purchase.granted.opening!)).not.toContain('data-unresolved-card');
  storage.set(batchSceneKey(purchase.purchaseId),JSON.stringify({index:0,summary:true}));
  expect(()=>renderToStaticMarkup(createElement(PackBatchOpening,{openings:purchase.granted.openings!,receiptId:purchase.purchaseId,onInspect:noop,onDone:noop}))).not.toThrow();
  const catalog=await f.catalog();const actual=catalog.offers.find((o:CatalogOffer)=>o.id===offer.id) as CatalogOffer;
  const odds=renderToStaticMarkup(createElement(BoosterOdds,{offer:actual}));expect(odds).not.toContain('÷ 0');
  const replay=await f.call('POST','/store/purchase',{offerId:offer.id,idempotencyKey:`presentation-${offer.id}`,receiptOnly:true});expect(replay.data.purchase.granted).toEqual(purchase.granted);
 }finally{f.db.sql.close();}
});
}

it("unknown inherited object keys are not cards",()=>{for(const id of ["constructor","__proto__","toString"])expect(resolvePresentationCard(id)).toBeUndefined();});

it('Market Home counts owned expanded-catalog cards instead of showing zero',()=>{
 const expansion=expansionViews({content,cosmetics:COSMETICS,rules:DECK_RULES},offers).find(e=>e.id==='reserva_cazador')!;
 const html=renderToStaticMarkup(createElement(MarketHome,{expansions:[{...expansion,cardIds:['stalker_step']}],offers:[],profile:createProfile(content),heroId:'mage',onExpansion:noop,onCategory:noop,onOffer:noop}));
 expect(html).toContain('Colección: 1/1');
});
