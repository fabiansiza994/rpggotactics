import {marketOfferPrimary} from '../src/presentation/shop/market';
import {demoShowcase} from '../qa/market-20/demo-state';
import {it,expect} from 'vitest';
import {LegendaryStatusView} from '../src/presentation/pixi/LegendaryStatusView';
import {makeEngine,unit} from './helpers';
import {applyStatus} from '../src/game/domain/statuses/status-rules';
import {ctxFor} from './helpers';
import {readMarketNavigation} from '../src/presentation/shop/marketNavigation';
import {validateCatalog} from '../src/game/store/store';
import {context,packs} from '../qa/market-20/demo-state';
it('persistent graphics reuse the same 12 particles, fade on expiry and destroy with scene',()=>{
 const e=makeEngine(),h=unit(e,e.heroId),fx=new LegendaryStatusView();
 applyStatus(ctxFor(e),h,'ARCANE_INVERSION',3,h.id);applyStatus(ctxFor(e),h,'THUNDER_INCARNATION',3,h.id);
 fx.update(h);fx.advance(16,16,false);expect(fx.children.filter(c=>c.visible)).toHaveLength(2);
 const children=fx.children.flatMap(c=>'children' in c ? c.children:[]);
 for(let i=0;i<300;i++)fx.advance(16,i*16,false);
 expect(fx.children.flatMap(c=>'children' in c?c.children:[])).toEqual(children);
 expect(children).toHaveLength(16); // 2 runes +2 auras +12 particles, allocated once.
 fx.update(JSON.parse(JSON.stringify(h)));fx.advance(16,5000,true);expect(fx.children.filter(c=>c.visible)).toHaveLength(2);
 h.statuses=[];fx.update(h);fx.advance(400,5400,true);expect(fx.children.filter(c=>c.visible)).toHaveLength(0);
 fx.destroy({children:true});expect(fx.destroyed).toBe(true);
});
it('old global card deep link resolves to expansions without deleting route state',()=>{
 expect(readMarketNavigation('?market=cards&invite=old')).toEqual({category:'packs',expansionId:null});
});
it('unknown primary cannot become a direct commercial card even when its mechanics are legal',()=>{
 const source=context.content.cards.magic_missile!,card={...source,id:'unassigned_card'};
 const ctx={...context,content:{...context.content,cards:{...context.content.cards,[card.id]:card}}};
 const offer={...packs[0]!,id:'unassigned_offer',price:200,purchaseLimit:null,booster:undefined,heroId:'mage',contents:[{kind:'CARD' as const,cardId:card.id,copies:1}]};
 expect(validateCatalog([offer],ctx)).toEqual(expect.arrayContaining([expect.objectContaining({code:'MISSING_MARKET_PRIMARY'})]));
});

it('featured direct-card links resolve to their primary expansion, not a mixed card category',()=>{
 const offer=demoShowcase.find(o=>o.type==='CARD')!;
 expect(marketOfferPrimary(offer)).toBe('antarctic_magic');
});
