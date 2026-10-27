import {describe,it,expect,vi} from 'vitest';
import {createElement,isValidElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {CrystalPackages,LegalLinks} from '../src/presentation/shop/CrystalShopPanel';
import {CrystalPurchaseModal} from '../src/presentation/shop/CrystalPurchaseModal';
import type {CrystalPackageView} from '../src/presentation/shop/realMoney';
const pkg:CrystalPackageView={id:'server-package',displayName:'Server',baseCrystals:1000,bonusCrystals:235,crystals:1235,priceCOP:23456,sortOrder:1};
function buttons(node:ReactNode): {onClick():void;disabled:boolean}[]{
 if(Array.isArray(node))return node.flatMap(buttons);
 if(!isValidElement<{children?:ReactNode;onClick():void;disabled:boolean}>(node))return [];
 return node.type==='button'?[node.props]:buttons(node.props.children);
}
describe('crystal purchase surface',()=>{
 it('renders server quantities and bonus without substituting fixed package values',()=>{
  const html=renderToStaticMarkup(createElement(CrystalPackages,{packages:[pkg],busy:null,pending:false,onBuy:()=>{}}));
  expect(html).toContain('1.235');expect(html).toContain('1.000 + 235 BONUS');expect(html).toContain('23.456');expect(html).toContain('server-package');
 });
 it('delegates the selected package and disables duplicate submissions while busy or pending',()=>{
  const buy=vi.fn();buttons(CrystalPackages({packages:[pkg],busy:null,pending:false,onBuy:buy}))[0]!.onClick();expect(buy).toHaveBeenCalledExactlyOnceWith(pkg);
  expect(buttons(CrystalPackages({packages:[pkg],busy:pkg.id,pending:false,onBuy:buy}))[0]!.disabled).toBe(true);
  expect(buttons(CrystalPackages({packages:[pkg],busy:null,pending:true,onBuy:buy}))[0]!.disabled).toBe(true);
 });
 it('has an accessible closed-by-default dialog and preserves legal draft labels',()=>{
  vi.stubEnv('VITE_REAL_MONEY_PURCHASES_ENABLED','1');
  const html=renderToStaticMarkup(createElement(CrystalPurchaseModal,{open:false,onClose:()=>{},token:null,onWallet:()=>{},onAuthExpired:()=>{}}));
  expect(html).toContain('<dialog');expect(html).toContain('aria-labelledby="crystal-modal-title"');expect(html).toContain('Cerrar compra de Cristales');expect(html).not.toContain('open=""');vi.unstubAllEnvs();
  const legal=renderToStaticMarkup(createElement(LegalLinks,{legal:{termsUrl:null,refundUrl:null,privacyUrl:null,taxNote:null}}));expect(legal).toContain('pendiente de publicar');
 });
 it('mounts top-up only in the dedicated modal, retaining wallet refresh separately',()=>{
  const store=readFileSync('src/presentation/shop/StoreScreen.tsx','utf8');
  expect(store).not.toContain('<CrystalShopPanel');expect(store).toContain('<CrystalPurchaseModal');expect(store).toContain('+ Cristales');expect(store).toContain('Actualizar');expect(store).toContain('storeApi.catalog(session.token)');
 });
 it('keeps catalog, consent, order polling and wallet authority on existing APIs',()=>{
  const panel=readFileSync('src/presentation/shop/CrystalShopPanel.tsx','utf8');
  for(const contract of ['realMoneyApi.packages()','realMoneyApi.history(token)','realMoneyApi.checkout(sessionToken, pkg.id, consent)','openEpaycoCheckout(sessionId','buying.current','callbacks.current.onWallet(data.wallet)','pendingOrder()','MODO DE PRUEBA'])expect(panel).toContain(contract);
  const result=readFileSync('src/presentation/shop/PaymentResult.tsx','utf8');expect(result).toContain('¡Cristales acreditados!');expect(result).toContain('realMoneyApi.order(token, orderId, hint)');expect(result).toContain('/play?store=1&crystals=1');
 });
});
