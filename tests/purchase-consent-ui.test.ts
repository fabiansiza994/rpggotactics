import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PurchaseConfirmation } from '../src/presentation/shop/PurchaseConfirmation';
import { AGE_DECLARATION, PURCHASE_CONSENT_VERSION, validPurchaseConsent } from '../src/game/store/purchaseConsent';

describe('purchase confirmation only',()=>{
 it('starts unchecked, cannot continue, and links all four draft policies without collecting DOB or documents',()=>{
  const html=renderToStaticMarkup(createElement(PurchaseConfirmation,{pkg:{id:'crystals_500',displayName:'500 Cristales',crystals:500,baseCrystals:500,bonusCrystals:0,priceCOP:9900,sortOrder:1},operationId:crypto.randomUUID(),busy:false,testMode:true,onCancel:()=>{},onConfirm:()=>{throw Error('must not auto confirm');}}));
  expect(html).toContain(AGE_DECLARATION);expect(html).not.toContain('checked=""');expect(html).toContain('type="submit" class="shop-primary" disabled');
  for(const path of ['terms','privacy','delivery','refunds'])expect(html).toContain(`https://rpg-go-tactics.com/${path}`);
  expect(html).toContain('No tengo 18 años');expect(html).toContain('documentos en revisión');expect(html).not.toContain('type="date"');
 });
 it('requires strict booleans, current version and operation ID',()=>{
  const valid={adult:true,termsAccepted:true,version:PURCHASE_CONSENT_VERSION,operationId:crypto.randomUUID()};
  expect(validPurchaseConsent(valid)).toBe(true);expect(validPurchaseConsent({...valid,adult:false})).toBe(false);expect(validPurchaseConsent({...valid,termsAccepted:false})).toBe(false);expect(validPurchaseConsent({...valid,version:'old'})).toBe(false);
 });
});
