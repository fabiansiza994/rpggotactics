import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ExpansionCatalog} from '../../src/presentation/shop/ExpansionCatalog';
import {freePacksMessage,marketCardIndicators} from '../../src/presentation/shop/marketCardIndicators';
import {CARD_PRESENTATION_CONTENT as DEFAULT_CONTENT} from '../../src/presentation/catalog/cardPresentation';
import {copyLimit,DECK_RULES} from '../../src/game';
import {marketFixture} from './marketReorg';
import type {Catalog,CatalogOffer} from '../../src/presentation/shop/api';
import type {MarketExpansionView} from '../../src/game/store/market-expansions';
type LocalCatalog=Catalog & {expansions:MarketExpansionView[]};
import type {BoxSnapshot} from '../../src/game/store/boxes';

const snow=DEFAULT_CONTENT.cards.snow_soldier!;
const box=(remaining:number):BoxSnapshot=>({generation:1,version:1,revision:'v',initial:{snow_soldier:2},remaining:{snow_soldier:remaining}});
for(const [have,left]of [[0,1],[1,0],[1,1],[2,0],[9,1]])it(`distinct counts ${have}/${left} and deck limit 2`,()=>{expect(marketCardIndicators(snow,have!,box(left!))).toEqual({owned:have,remaining:left,deckLimit:2});});
it('outside-box and missing-stock cards never invent zero stock',()=>{expect(marketCardIndicators(snow,1,undefined).remaining).toBeNull();expect(marketCardIndicators(snow,1,{...box(0),initial:{},remaining:{}}).remaining).toBeNull();});
for(const remaining of [0,1,2,3,5])it(`free copy handles ${remaining} and singular correctly`,()=>{expect(freePacksMessage(remaining)).toBe(remaining?`Tienes ${remaining} ${remaining===1?'sobre gratis':'sobres gratis'}`:null);});

describe('real catalog markup uses server counts and prices',()=>{
 it('all six expansions get both compact badges; no redundant box text or clamped ownership',async()=>{
 const f=await marketFixture();try{const cat=await f.catalog() as LocalCatalog;const profile=(await f.call('GET','/state')).data.profile;
 for(const e of cat.expansions.filter((e)=>e.status==='AVAILABLE')){
 const offer=cat.offers.find((o)=>o.booster?.expansionId===e.id)!;const pool=Object.keys(offer.booster!.box!.initial);
 const html=renderToStaticMarkup(<ExpansionCatalog expansions={cat.expansions} offers={cat.offers} selectedId={e.id} onSelect={()=>{}} profile={profile} onInspect={()=>{}} onBuy={()=>{}} balance={0} busy={false}/>);
 expect(html).not.toContain('En caja:');expect(html).not.toContain('market-box-card-count');expect((html.match(/class="market-copy-indicator"/g)??[]).length).toBe(pool.length);expect((html.match(/class="market-deck-limit"/g)??[]).length).toBe(e.cardIds.length);
 for(const id of pool)expect(html).toContain(`Límite por mazo: ${copyLimit(DEFAULT_CONTENT.cards[id]!,DECK_RULES)}`);
 }
 }finally{f.db.sql.close();}});
 it('zero free removes gift copy/space; insufficient paid buttons stay disabled without visible warnings',async()=>{
 const f=await marketFixture();try{const cat=await f.catalog() as LocalCatalog,profile=(await f.call('GET','/state')).data.profile;const id='thunder_god';
 const render=(n:number,balance:number)=>renderToStaticMarkup(<ExpansionCatalog expansions={cat.expansions} offers={cat.offers.map((o)=>({...o,freeRemaining:n}))} selectedId={id} onSelect={()=>{}} profile={profile} onInspect={()=>{}} onBuy={()=>{}} balance={balance} busy={false}/>);
 for(const n of [3,2,1])expect(render(n,0)).toContain(`Tienes ${n} ${n===1?'sobre gratis':'sobres gratis'}`);
 const exhausted=render(0,0);expect(exhausted).not.toContain('market-free-packs');expect(exhausted).not.toContain('Tus primeros');expect(exhausted).not.toMatch(/>Saldo insuficiente/);
 expect((exhausted.match(/class="shop-primary" disabled=""/g)??[]).length).toBe(3);expect(exhausted).toContain('saldo insuficiente');
 const funded=render(0,2000);expect(funded).not.toContain('class="shop-primary" disabled=""');expect(funded).toContain('Comprar x10');expect(funded).toContain('500');
 }finally{f.db.sql.close();}});
 it('free purchase updates ownership/stock and free count; reset preserves benefit and ownership',async()=>{
 const f=await marketFixture();try{const before=await f.catalog() as LocalCatalog;const free=before.offers.find((o:CatalogOffer)=>o.booster?.expansionId==='antarctic_magic'&&o.booster?.freeGrant)!;const b=(await f.call('GET','/wallet')).data.wallet.balance;
 expect((await f.buy(free.id,'market21-free')).status).toBe(200);const after=await f.catalog() as LocalCatalog,offer=after.offers.find((o)=>o.id===free.id)!;expect(offer.freeRemaining).toBe(free.freeRemaining!-1);expect(Object.values(offer.booster!.box!.remaining).reduce((n,v)=>Number(n)+Number(v),0)).toBe(76);expect((await f.call('GET','/wallet')).data.wallet.balance).toBe(b);
 const profile=(await f.call('GET','/state')).data.profile;const state=offer.booster!.box!;expect((await f.call('POST','/store/box/reset',{expansionId:'antarctic_magic',generation:state.generation,version:state.version,idempotencyKey:'market21-reset'})).status).toBe(200);const reloaded=await f.catalog() as LocalCatalog;expect(reloaded.offers.find((o)=>o.id===free.id)!.freeRemaining).toBe(offer.freeRemaining);expect((await f.call('GET','/state')).data.profile).toEqual(profile);
 }finally{f.db.sql.close();}});
});
