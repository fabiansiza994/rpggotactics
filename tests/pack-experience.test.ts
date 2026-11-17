import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {existsSync} from 'node:fs';
import {EXPANSION_VISUALS,expansionVisual} from '../src/presentation/shop/expansionVisuals';
import {PackExperience} from '../src/presentation/shop/PackExperience';
import {PackConfirmation} from '../src/presentation/shop/PackConfirmation';
import {PackArt} from '../src/presentation/shop/PackArt';
import {marketFixture} from './support/marketReorg';
import type {CatalogOffer} from '../src/presentation/shop/api';
const noop=()=>{};
it('six distinct editorial covers, all local assets present; Thunder uses its published storm artwork',()=>{
 expect(Object.keys(EXPANSION_VISUALS)).toHaveLength(6);
 expect(new Set(Object.values(EXPANSION_VISUALS).map(v=>v.cover)).size).toBe(6);
 for(const v of Object.values(EXPANSION_VISUALS)){expect(existsSync('public'+v.cover)).toBe(true);expect(existsSync('public'+v.environment)).toBe(true);}
 expect(expansionVisual('thunder_god').cover).toBe('/art/mage-thunder/storm_avatar.webp');
 expect(expansionVisual('thunder_god').cover).not.toBe(expansionVisual('origins_arcanos').cover);
 expect(expansionVisual('constructor').atmosphere).toBe('arcane');
});
for(const id of Object.keys(EXPANSION_VISUALS))it('shared immersive environment and real pack art: '+id,()=>{
 const v=expansionVisual(id);const html=renderToStaticMarkup(createElement(PackExperience,{packId:'booster_'+id+'_free',children:createElement(PackArt,{packId:'booster_'+id+'_free'})}));
 expect(html).toContain('data-theme="'+id+'"');expect(html).toContain(v.environment);expect(html).toContain('pack-experience-content');expect(html.match(/class="pack-dust"/g)).toHaveLength(1);
});
it('free confirmation presents actual independent remaining counter and no crystal price or debit information',async()=>{
 const f=await marketFixture();try{const offers=(await f.catalog()).offers as CatalogOffer[];
 for(const [id,limit] of [['origins_arcanos',5],['thunder_god',3]] as const){const offer=offers.find(o=>o.id==='booster_'+id+'_free')!;const html=renderToStaticMarkup(createElement(PackConfirmation,{offer,balance:123,busy:false,onConfirm:()=>{throw Error('no acquisition during render');},onCancel:noop}));expect(html).toContain('Gratis restantes: '+limit+'/'+limit);expect(html).toContain('ABRIR SOBRE GRATIS');expect(html).not.toContain('Saldo actual');expect(html).not.toContain('Cristales');}
 }finally{f.db.sql.close();}
});
for(const count of [1,5,10])it('paid x'+count+' is deliberate: preview gives total price and never calls acquisition on render',async()=>{
 const f=await marketFixture();try{const offer=(await f.catalog()).offers.find((o:CatalogOffer)=>o.id==='booster_pack_pact_x'+count) as CatalogOffer;const snapshot=JSON.stringify(offer);const html=renderToStaticMarkup(createElement(PackConfirmation,{offer,balance:30000,busy:false,onConfirm:()=>{throw Error('must confirm explicitly');},onCancel:noop}));expect(html).toContain('COMPRAR Y ABRIR');expect(html).toContain((200*count).toLocaleString('es-CO'));expect(html).toContain(count*4+' cartas');expect(html).not.toContain('pack-cost-review');expect(JSON.stringify(offer)).toBe(snapshot);expect((await f.call('GET','/wallet')).data.wallet.balance).toBe(30000);expect(f.db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_store_purchases').get()?.n).toBe(0);
 }finally{f.db.sql.close();}
});
it('busy confirmation disables both actions, preventing repeated confirmation or cancellation in flight',async()=>{
 const f=await marketFixture();try{const offer=(await f.catalog()).offers.find((o:CatalogOffer)=>o.id==='booster_pack_pact_free') as CatalogOffer;const html=renderToStaticMarkup(createElement(PackConfirmation,{offer,balance:30000,busy:true,onConfirm:noop,onCancel:noop}));expect(html.match(/disabled=""/g)).toHaveLength(2);expect(html).toContain('Confirmando');}finally{f.db.sql.close();}
});
