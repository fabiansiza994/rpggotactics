import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {marketFixture} from './support/marketReorg';
import {ExpansionProduct,EXPANSION_SPOTLIGHTS,expansionSpotlight} from '../src/presentation/shop/ExpansionProduct';
import type {MarketExpansionView} from '../src/game/store/market-expansions';
import type {CatalogOffer} from '../src/presentation/shop/api';
it('all six editorial protagonists are real, included in the live booster and render as game cards alongside the existing pack',async()=>{
 const f=await marketFixture();try{const catalog=await f.catalog();const offers=catalog.offers as CatalogOffer[];
 const expansions=catalog.expansions as MarketExpansionView[];
 expect(Object.keys(EXPANSION_SPOTLIGHTS)).toHaveLength(6);
 for(const e of expansions.filter(e=>e.status==='AVAILABLE')){
  const card=expansionSpotlight(e,offers);expect(card?.id).toBe(EXPANSION_SPOTLIGHTS[e.id]);
  const html=renderToStaticMarkup(createElement(ExpansionProduct,{expansion:e,offers,owned:7,onSelect:()=>{throw Error('must only navigate on user input');}}));
  expect(html).toContain('data-card-id="'+card!.id+'"');expect(html).toContain('arcane-pack');expect(html).toContain('7/'+e.cardIds.length);expect(html).not.toContain(e.description);expect(html).not.toContain('Ver detalles');
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain('painted-card-art');expect(html).not.toContain('data-art-pending');
 }
 }finally{f.db.sql.close();}
});
it('missing or retired pool membership suppresses the hero; future expansions never advertise obtainable cards or active freebies',async()=>{
 const f=await marketFixture();try{const c=await f.catalog();const e=(c.expansions as MarketExpansionView[]).find(e=>e.id==='thunder_god')!;
 expect(expansionSpotlight(e,[])).toBeUndefined();
 const future={...e,status:'COMING_SOON' as const};
 const html=renderToStaticMarkup(createElement(ExpansionProduct,{expansion:future,offers:c.offers,owned:7,onSelect:()=>{}}));
 expect(html).toContain('PRÓXIMAMENTE');expect(html).not.toContain('sobres gratis');expect(html).not.toContain('data-card-id');expect(html).not.toContain('arcane-pack');
 }finally{f.db.sql.close();}
});
