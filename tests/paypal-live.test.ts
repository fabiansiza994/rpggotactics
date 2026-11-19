import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../server/src/index';
import {reconcileLiveOrders,liveOperationalReport} from '../server/src/paypal';
import type { Env } from '../server/src/db';
import { addAccount, memoryD1 } from './support/d1';

const host = 'https://rpg-go-tactics.com';
const root = '/api/tactics/store/paypal/live';
const captureId = 'CAPTURE0001';
let db: ReturnType<typeof memoryD1>;
let env: Env;
let alice: ReturnType<typeof addAccount>;
let bob: ReturnType<typeof addAccount>;
let orderId: string;
let localId: string;
let amount: { currency_code: string; value: string };
let result: string;
let remoteStatus: string;
let captureCalls: number;
let createCalls: number;
let loseResponse: boolean;
let includeCapture: boolean;
let validSignature: boolean;
let wrongOwner: boolean;
let wrongCaptureValue: boolean;
let declineInstrument: boolean;
let wrongMerchant: boolean;
let wrongCurrency: boolean;
let oauthRejected: boolean;

const send = (path: string, method = 'GET', token?: string, body?: unknown, headers?: Record<string,string>) =>
  handle(new Request(host + root + path, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);

const create = (packageId = 'arcane_small', key = crypto.randomUUID()) =>
  send('/orders', 'POST', alice.token, { packageId }, { 'Idempotency-Key': key });
const balance = () => db.sql.prepare("SELECT COALESCE((SELECT balance FROM tactics_wallets WHERE user_id=? AND currency_id='arcane_crystals'),0) AS balance").get(alice.id)?.balance;
const count = () => db.sql.prepare("SELECT COUNT(*) AS count FROM tactics_wallet_ledger WHERE reason='REAL_MONEY_PURCHASE' AND reference_id LIKE 'paypal-live:%'").get()?.count;

function webhook(type: string, resource: unknown, id = 'EVENT00001') {
  const headers = Object.fromEntries(['auth-algo','cert-url','transmission-id','transmission-sig','transmission-time'].map(key => ['paypal-' + key, 'fixture']));
  return send('/webhook', 'POST', undefined, { id, event_type: type, resource }, headers);
}

beforeEach(() => {
  db = memoryD1();
  db.sql.exec(readFileSync(new URL('../server/migrations/0034_tactics_paypal_live.sql', import.meta.url), 'utf8'));
  env = { DB: db, PAYPAL_LIVE_ENABLED: '1', PAYPAL_LIVE_CHECKOUT_ENABLED: '1', REAL_MONEY_PURCHASES_ENABLED: '1',
    PAYPAL_LIVE_ACTIVATION: 'paypal-live-v1-reviewed', PAYPAL_ENVIRONMENT: 'live',
    PAYPAL_LIVE_CLIENT_ID: 'fixture-public', PAYPAL_LIVE_CLIENT_SECRET: 'fixture-secret', PAYPAL_LIVE_WEBHOOK_ID: 'fixture-hook',
    PAYPAL_LIVE_MERCHANT_ID: 'MERCHANT0001', PAYPAL_LIVE_RETURN_ORIGIN: host };
  alice = addAccount(db, 'alice');
  bob = addAccount(db, 'bob');
  orderId = 'PAYPAL000001';
  result = 'COMPLETED';
  remoteStatus = 'APPROVED';
  captureCalls = createCalls = 0;
  includeCapture = loseResponse = wrongOwner = wrongCaptureValue = declineInstrument = false;
  validSignature = true;
  wrongMerchant = wrongCurrency = oauthRejected = false;
  vi.stubGlobal('fetch', vi.fn(async (input: string, options: RequestInit) => {
    const url = new URL(input);
    expect(url.origin).toBe('https://api-m.paypal.com');
    if (url.pathname === '/v1/oauth2/token') return oauthRejected ? new Response('', {status:401}) : Response.json({ access_token: 'fixture-token' });
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer fixture-token');
    if (url.pathname === '/v1/notifications/verify-webhook-signature') {
      expect(JSON.parse(String(options.body)).webhook_id).toBe('fixture-hook');
      return Response.json({ verification_status: validSignature ? 'SUCCESS' : 'FAILURE' });
    }
    if (url.pathname === '/v2/checkout/orders' && options.method === 'POST') {
      createCalls++;
      const unit = JSON.parse(String(options.body)).purchase_units[0];
      localId = unit.reference_id;
      amount = unit.amount;
      expect(new Headers(options.headers).get('PayPal-Request-Id')).toBe(localId);
      return Response.json({ id: orderId, links: [{ rel: 'payer-action', href: 'https://www.paypal.com/checkoutnow?token=' + orderId }] });
    }
    if (url.pathname.endsWith('/capture')) {
      captureCalls++;
      expect(new Headers(options.headers).get('PayPal-Request-Id')).toBe('c-' + localId);
      if (declineInstrument) return Response.json({ details: [{ issue: 'INSTRUMENT_DECLINED' }] }, { status: 422 });
      includeCapture = true;
      remoteStatus = 'COMPLETED';
      if (loseResponse) throw new Error('Simulated response loss after capture');
      return Response.json({ id: orderId });
    }
    expect(url.pathname).toBe('/v2/checkout/orders/' + orderId);
    return Response.json({ id: orderId, intent: 'CAPTURE', status: remoteStatus, purchase_units: [{
      payee: {merchant_id: wrongMerchant ? 'FOREIGN0001' : 'MERCHANT0001'}, reference_id: localId, custom_id: wrongOwner ? crypto.randomUUID() : localId, amount: wrongCurrency ? {...amount,currency_code:'EUR'} : amount,
      payments: includeCapture ? { captures: [{ id: captureId, amount: wrongCaptureValue ? { ...amount, value: '0.01' } : amount, status: result, final_capture: true }] } : undefined,
    }] });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  db.sql.close();
});

describe('PayPal Live with simulated provider responses and real SQLite ledger', () => {
  it.each([
    ['arcane_small', '4.99', 350], ['arcane_medium', '9.99', 800],
    ['arcane_large', '19.99', 1800], ['arcane_vault', '49.99', 5000],
  ])('credits %s exactly once', async (pkg, usd, crystals) => {
    const creation = await create(pkg);
    expect(creation.status).toBe(200);
    expect(amount).toEqual({ currency_code: 'USD', value: usd });
    const payment = await send('/orders/' + localId + '/capture', 'POST', alice.token);
    expect((await payment.json()).order.status).toBe('FULFILLED');
    expect(balance()).toBe(crystals);
    expect((await send('/orders/' + localId, 'GET', alice.token)).status).toBe(200);
    expect((await send('/orders/' + localId + '/capture', 'POST', alice.token)).status).toBe(200);
    expect((await (await send('/orders', 'GET', bob.token)).json()).orders).toEqual([]);
    expect(captureCalls).toBe(1);
    expect(count()).toBe(1);
  });

  it('reuses duplicate create attempts and leaves an unapproved or cancelled checkout unpaid', async () => {
    const key = crypto.randomUUID();
    await create('arcane_small', key);
    await create('arcane_small', key);
    expect(createCalls).toBe(1);
    expect((await create('arcane_medium', key)).status).toBe(409);
    remoteStatus = 'PAYER_ACTION_REQUIRED';
    const status = await send('/orders/' + localId, 'GET', alice.token);
    expect((await status.json()).order.status).toBe('CREATED');
    expect(captureCalls).toBe(0);
    expect(balance()).toBe(0);
  });

  it('rejects unauthenticated, foreign and manipulated requests', async () => {
    expect((await send('/orders', 'POST')).status).toBe(401);
    expect((await send('/orders', 'POST', alice.token, { packageId: 'arcane_small', usd: '0.01', crystals: 99999 },
      { 'Idempotency-Key': crypto.randomUUID() })).status).toBe(400);
    await create();
    expect((await send('/orders/' + localId + '/capture', 'POST', bob.token)).status).toBe(404);
    wrongOwner = true;
    expect((await send('/orders/' + localId + '/capture', 'POST', alice.token)).status).toBe(502);
    expect(captureCalls).toBe(0);
    wrongOwner = false;
    wrongCaptureValue = true;
    expect((await send('/orders/' + localId + '/capture', 'POST', alice.token)).status).toBe(502);
    expect(balance()).toBe(0);
  });

  it('leaves a pending payment uncredited and consumes duplicate verified events once', async () => {
    await create();
    result = 'PENDING';
    const payment = await send('/orders/' + localId + '/capture', 'POST', alice.token);
    expect((await payment.json()).order.status).toBe('PENDING');
    expect(balance()).toBe(0);
    result = 'COMPLETED';
    const resource = { id: captureId, supplementary_data: { related_ids: { order_id: orderId } } };
    validSignature = false;
    expect((await webhook('PAYMENT.CAPTURE.COMPLETED', resource)).status).toBe(400);
    expect(balance()).toBe(0);
    validSignature = true;
    const events = await Promise.all([webhook('PAYMENT.CAPTURE.COMPLETED', resource), webhook('PAYMENT.CAPTURE.COMPLETED', resource)]);
    expect(events.map(response => response.status)).toEqual([200, 200]);
    expect(balance()).toBe(350);
    expect(count()).toBe(1);
    expect(db.sql.prepare('SELECT COUNT(*) AS count FROM tactics_paypal_live_events').get()?.count).toBe(1);
  });

  it('keeps concurrent capture submissions to one ledger grant', async () => {
    await create();
    const submit = () => send('/orders/' + localId + '/capture', 'POST', alice.token);
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(count()).toBe(1);
    expect(balance()).toBe(350);
  });

  it('reports an instrument decline without credit', async () => {
    await create();
    declineInstrument = true;
    const payment = await send('/orders/' + localId + '/capture', 'POST', alice.token);
    expect((await payment.json()).order.status).toBe('DECLINED');
    expect(count()).toBe(0);
  });

  it('reconciles a successful capture after losing its response', async () => {
    await create();
    loseResponse = true;
    await send('/orders/' + localId + '/capture', 'POST', alice.token);
    const status = await send('/orders/' + localId, 'GET', alice.token);
    expect((await status.json()).order.status).toBe('FULFILLED');
    expect(captureCalls).toBe(1);
    expect(count()).toBe(1);
  });

  it.each([true, false])('audits disputes before or after fulfillment without automatic debits (%s)', async early => {
    await create();
    const dispute = () => webhook('CUSTOMER.DISPUTE.CREATED', { id: 'DISPUTE0001', disputed_transactions: [{ seller_transaction_id: captureId }] });
    if (early) expect((await dispute()).status).toBe(200);
    await send('/orders/' + localId + '/capture', 'POST', alice.token);
    if (!early) expect((await dispute()).status).toBe(200);
    const status = await send('/orders/' + localId, 'GET', alice.token);
    expect((await status.json()).order.status).toBe('REVIEW');
    expect(balance()).toBe(early ? 0 : 350);
    expect(count()).toBe(early ? 0 : 1);
  });

  it('matches a signed refund to its capture and keeps the provision auditable', async () => {
    await create();
    await send('/orders/' + localId + '/capture', 'POST', alice.token);
    const response = await webhook('PAYMENT.CAPTURE.REFUNDED', {
      id: 'REFUND0001',
      links: [{ rel: 'up', href: 'https://api-m.paypal.com/v2/payments/captures/' + captureId }],
    });
    expect(response.status).toBe(200);
    const status = await send('/orders/' + localId, 'GET', alice.token);
    expect((await status.json()).order.status).toBe('REVIEW');
    expect(db.sql.prepare("SELECT capture_id FROM tactics_paypal_live_events WHERE event_type='PAYMENT.CAPTURE.REFUNDED'").get()?.capture_id).toBe(captureId);
    expect(balance()).toBe(350);
    expect(count()).toBe(1);
  });

  it.each([undefined, '0', 'true'])('backend remains closed without an exact opt-in (%s)', async flag => {
    env.PAYPAL_LIVE_ENABLED = flag;
    expect(await (await send('/catalog')).json()).toEqual({ available: false, packages: [] });
    expect((await create()).status).toBe(503);
    expect((await send('/webhook', 'POST', undefined, {})).status).toBe(503);
    expect(createCalls).toBe(0);
    expect(balance()).toBe(0);
    expect(count()).toBe(0);
  });

  it('rejects an unapproved Live host', async () => {
    const response = await handle(new Request('https://unapproved.example' + root + '/catalog'), env);
    expect(await response.json()).toEqual({ available: false, packages: [] });
    expect(createCalls).toBe(0);
  });

  it('keeps disabled routes safe before migration 0034 exists', async () => {
    db = memoryD1();
    alice = addAccount(db, 'alice');
    env.DB = db;
    env.PAYPAL_LIVE_ENABLED = undefined;
    expect(await (await send('/catalog')).json()).toEqual({ available: false, packages: [] });
    expect((await create()).status).toBe(503);
    expect((await send('/webhook', 'POST', undefined, {})).status).toBe(503);
    expect(createCalls).toBe(0);
  });

  it('stays unavailable when misconfigured or configured to Live', async () => {
    env.PAYPAL_ENVIRONMENT = 'sandbox';
    const catalog = await send('/catalog');
    expect(await catalog.json()).toEqual({ available: false, packages: [] });
    expect((await create()).status).toBe(503);
    expect(createCalls).toBe(0);
  });
  it.each(['REAL_MONEY_PURCHASES_ENABLED', 'PAYPAL_LIVE_CHECKOUT_ENABLED', 'PAYPAL_LIVE_ENABLED', 'PAYPAL_LIVE_ACTIVATION', 'PAYPAL_ENVIRONMENT', 'PAYPAL_LIVE_CLIENT_ID', 'PAYPAL_LIVE_CLIENT_SECRET', 'PAYPAL_LIVE_WEBHOOK_ID', 'PAYPAL_LIVE_MERCHANT_ID', 'PAYPAL_LIVE_RETURN_ORIGIN'] as const)('fails closed when %s is missing', async key => {
    env[key] = undefined;
    expect(await (await send('/catalog')).json()).toEqual({available:false,packages:[]});
    expect((await create()).status).toBe(503);
    expect(createCalls).toBe(0); expect(count()).toBe(0);
  });
  it('cannot be enabled by changing one switch from the OFF deployment', async () => {
    env = {DB:db, PAYPAL_LIVE_ENABLED:'1',REAL_MONEY_PURCHASES_ENABLED:'0',PAYPAL_SANDBOX_ENABLED:'0'};
    expect((await create()).status).toBe(503); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_WEBHOOK_ID'] as const)('rejects reuse of Sandbox credential %s', async key => {
    env[key] = key === 'PAYPAL_CLIENT_ID' ? env.PAYPAL_LIVE_CLIENT_ID : key === 'PAYPAL_CLIENT_SECRET' ? env.PAYPAL_LIVE_CLIENT_SECRET : env.PAYPAL_LIVE_WEBHOOK_ID;
    expect((await create()).status).toBe(503); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects provider OAuth credentials rejected by the Live provider', async () => {
    oauthRejected=true; expect((await create()).status).toBe(502); expect(count()).toBe(0); expect(createCalls).toBe(0);
  });
  it.each(['merchant','currency'])('rejects wrong %s without capture or credit',async kind=>{
    await create();wrongMerchant=kind==='merchant';wrongCurrency=kind==='currency';
    expect((await send('/orders/'+localId+'/capture','POST',alice.token)).status).toBe(502);
    expect(captureCalls).toBe(0);expect(count()).toBe(0);
  });
  it('keeps Sandbox and Live tables and receipts isolated',async()=>{
    db.sql.exec(readFileSync(new URL('../server/migrations/0033_tactics_paypal_sandbox.sql',import.meta.url),'utf8'));
    await create(); await send('/orders/'+localId+'/capture','POST',alice.token);
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_paypal_orders').get()?.n).toBe(0);
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_paypal_live_orders').get()?.n).toBe(1);
  });
  it.each(['PAYMENT.CAPTURE.REVERSED','CUSTOMER.DISPUTE.RESOLVED'])('records %s and never auto-debits or grants again',async type=>{
    await create();await send('/orders/'+localId+'/capture','POST',alice.token);
    await webhook(type,{id:captureId,disputed_transactions:[{seller_transaction_id:captureId}]});
    await webhook(type,{id:captureId,disputed_transactions:[{seller_transaction_id:captureId}]});
    expect((await (await send('/orders/'+localId,'GET',alice.token)).json()).order.status).toBe('REVIEW');
    expect(balance()).toBe(350);expect(count()).toBe(1);
  });
  it('stops new checkouts while continuing verified reconciliation and signed events',async()=>{
    await create(); result='PENDING';await send('/orders/'+localId+'/capture','POST',alice.token);
    env.PAYPAL_LIVE_CHECKOUT_ENABLED='0';env.REAL_MONEY_PURCHASES_ENABLED='0';
    expect((await create()).status).toBe(503);result='COMPLETED';
    expect((await webhook('PAYMENT.CAPTURE.COMPLETED',{id:captureId,supplementary_data:{related_ids:{order_id:orderId}}})).status).toBe(200);
    expect(balance()).toBe(350);expect(count()).toBe(1);
  });

  it('rolls back the entire grant if the ledger transaction fails and recovers once',async()=>{
    await create();
    db.sql.exec("CREATE TRIGGER fail_live_grant BEFORE INSERT ON tactics_wallet_ledger WHEN NEW.reason='REAL_MONEY_PURCHASE' BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END");
    expect((await send('/orders/'+localId+'/capture','POST',alice.token)).status).toBe(502);
    expect(balance()).toBe(0);expect(count()).toBe(0);
    expect(db.sql.prepare('SELECT capture_id FROM tactics_paypal_live_orders WHERE id=?').get(localId)?.capture_id).toBe(null);
    db.sql.exec('DROP TRIGGER fail_live_grant');
    expect((await send('/orders/'+localId,'GET',alice.token)).status).toBe(200);
    expect(balance()).toBe(350);expect(count()).toBe(1);expect(captureCalls).toBe(1);
  });
  it('concurrent creation with one operation yields one persisted order',async()=>{
    const key=crypto.randomUUID();const responses=await Promise.all([create('arcane_small',key),create('arcane_small',key)]);
    expect(responses.map(x=>x.status)).toEqual([200,200]);
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_paypal_live_orders').get()?.n).toBe(1);
    expect(count()).toBe(0); // Provider create calls use the same stable PayPal-Request-Id.
  });

  it('scheduled reconciliation is inert when OFF, even before migration',async()=>{
    const old=db;db=memoryD1();old.sql.close();env.DB=db;
    expect((await reconcileLiveOrders(env)).enabled).toBe(false);expect(fetch).not.toHaveBeenCalled();
  });
  it('recovers a completed capture without callback, with concurrent sweeps',async()=>{
    await create();includeCapture=true;remoteStatus='COMPLETED';env.PAYPAL_LIVE_RECONCILIATION_ENABLED='1';
    const results=await Promise.all([reconcileLiveOrders(env),reconcileLiveOrders(env)]);
    expect(results.every(x=>x.failed===0)).toBe(true);expect(balance()).toBe(350);expect(count()).toBe(1);expect(captureCalls).toBe(0);
    expect(db.sql.prepare('SELECT status FROM tactics_paypal_live_orders').get()?.status).toBe('FULFILLED');
  });
  it('retries transient provider errors without forgetting the order',async()=>{
    await create();env.PAYPAL_LIVE_RECONCILIATION_ENABLED='1';oauthRejected=true;
    const now=Date.now();expect((await reconcileLiveOrders(env,now)).failed).toBe(1);
    expect((await reconcileLiveOrders(env,now+1)).checked).toBe(0);
    oauthRejected=false;includeCapture=true;remoteStatus='COMPLETED';
    expect((await reconcileLiveOrders(env,now+4000000)).failed).toBe(0);expect(balance()).toBe(350);expect(count()).toBe(1);
  });
  it('reports a provider/ledger discrepancy without inventing another grant',async()=>{
    await create();await send('/orders/'+localId+'/capture','POST',alice.token);env.PAYPAL_LIVE_RECONCILIATION_ENABLED='1';
    remoteStatus='VOIDED';includeCapture=false;
    expect((await reconcileLiveOrders(env)).review).toBe(1);expect(balance()).toBe(350);expect(count()).toBe(1);
    expect(db.sql.prepare('SELECT review_reason FROM tactics_paypal_live_orders').get()?.review_reason).toBe('LEDGER_PROVIDER_MISMATCH');
  });
  it('reports an unlinked create response instead of creating a second order',async()=>{
    await create();db.sql.prepare('UPDATE tactics_paypal_live_orders SET paypal_order_id=NULL WHERE id=?').run(localId);
    env.PAYPAL_LIVE_RECONCILIATION_ENABLED='1';expect((await reconcileLiveOrders(env,Date.now()+180000)).review).toBe(1);
    expect(createCalls).toBe(1);expect(captureCalls).toBe(0);expect(count()).toBe(0);
  });

  it('reports persistent retries, review cases and unlinked events to the operator',async()=>{
    await create();db.sql.prepare('UPDATE tactics_paypal_live_orders SET reconcile_attempts=3 WHERE id=?').run(localId);
    db.sql.prepare("INSERT INTO tactics_paypal_live_events(id,event_type,received_at) VALUES('UNKNOWN','PAYMENT.CAPTURE.COMPLETED',0)").run();
    expect(await liveOperationalReport(env)).toEqual({review:0,retryAttention:1,unlinkedEvents:1});
  });

});
