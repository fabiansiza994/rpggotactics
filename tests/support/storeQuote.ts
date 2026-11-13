/** Modern HTTP test client only: accepts the actual server quote, never bypasses the gate. */
export const STORE_QUOTE_TEST_SECRET = 'disposable-http-fixture-store-quote-secret-not-production';
export async function acceptCatalogQuote(method:string,path:string,body:unknown,catalog:()=>Promise<unknown>):Promise<unknown> {
  if(method!=='POST'||path!=='/store/purchase'||!body||typeof body!=='object'||'quoteToken' in body||'receiptOnly' in body) return body;
  const input=body as {offerId?:unknown};
  const data=await catalog() as {offers?:{id:string;purchaseQuote?:{token:string}}[]};
  const quote=data?.offers?.find(o=>o.id===input.offerId)?.purchaseQuote;
  return quote ? {...body,quoteToken:quote.token} : body;
}
