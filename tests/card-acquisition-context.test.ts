import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CardAcquisition} from '../src/presentation/shop/CardAcquisition';
import {MarketCardPreview} from '../src/presentation/shop/MarketCardPreview';
const render=(context:'editor'|'collection'|'market',cardId:string)=>renderToStaticMarkup(createElement(CardAcquisition,{context,cardId}));
for(const context of ['editor','collection'] as const){
 it(`${context} shows starter source and direct expansion action`,()=>{
  const html=render(context,'magic_missile');expect(html).toContain('Cómo conseguir');expect(html).toContain('Copia inicial incluida');expect(html).toContain('Orígenes Arcanos');expect(html).toContain('Ir a la expansión');
 });
 it(`${context} keeps Ranked exclusive source without a booster link`,()=>{
  const html=render(context,'arcane_exchange');expect(html).toContain('Ranked');expect(html).toContain('Actualmente no aparece en sobres');expect(html).not.toContain('Ir a la expansión');
 });
 it(`${context} keeps Ultra source without a booster link`,()=>{
  const html=render(context,'summon_pact_golem');expect(html).toContain('0 % en sobres');expect(html).not.toContain('Ir a la expansión');
 });
}
for(const id of ['magic_missile','branch_leap','arcane_exchange','summon_pact_golem'])it(`market never shows acquisition for ${id}`,()=>{
 expect(render('market',id)).toBe('');
 const html=renderToStaticMarkup(createElement(MarketCardPreview,{cardId:id,onClose:()=>{}}));expect(html).toContain('feature-card');expect(html).not.toContain('Cómo conseguir');expect(html).not.toContain('Ir a la expansión');
});
