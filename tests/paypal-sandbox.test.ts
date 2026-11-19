import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../server/src/index';
import type { Env } from '../server/src/db';
import { addAccount, memoryD1 } from './support/d1';

const host = 'https://tactics-sandbox.example';
const root = '/api/tactics/store/paypal';
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

const send = (path: string, method = 'GET', token?: string, body?: unknown, headers?: Record<string,string>) =>
  handle(new Request(host + root + path, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);

const create = (packageId = 'arcane_small', key = crypto.randomUUID()) =>
  send('/orders', 'POST', alice.token, { packageId }, { 'Idempotency-Key': key });
const balance = () => db.sql.prepare("SELECT COALESCE((SELECT balance FROM tactics_wallets WHERE user_id=? AND currency_id='arcane_crystals'),0) AS balance").get(alice.id)?.balance;
const count = () => db.sql.prepare("SELECT COUNT(*) AS count FROM tactics_wallet_ledger WHERE reason='REAL_MONEY_PURCHASE' AND reference_id LIKE 'paypal:%'").get()?.count;

function webhook(type: string, resource: unknown, id = 'EVENT00001') {
  const headers = Object.fromEntries(['auth-algo','cert-url','transmission-id','transmission-sig','transmission-time'].map(key => ['paypal-' + key, 'fixture']));
  return send('/webhook', 'POST', undefined, { id, event_type: type, resource }, headers);
}

beforeEach(() => {
  db = memoryD1();
  db.sql.exec(readFileSync(new URL('../server/migrations/0033_tactics_paypal_sandbox.sql', import.meta.url), 'utf8'));
  env = { DB: db, PAYPAL_SANDBOX_ENABLED: '1', PAYPAL_CLIENT_ID: 'fixture-public', PAYPAL_CLIENT_SECRET: 'fixture-secret', PAYPAL_WEBHOOK_ID: 'fixture-hook',
    PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_RETURN_ORIGIN: host };
  alice = addAccount(db, 'alice');
  bob = addAccount(db, 'bob');
  orderId = 'PAYPAL000001';
  result = 'COMPLETED';
  remoteStatus = 'APPROVED';
  captureCalls = createCalls = 0;
  includeCapture = loseResponse = wrongOwner = wrongCaptureValue = declineInstrument = false;
  validSignature = true;
  vi.stubGlobal('fetch', vi.fn(async (input: string, options: RequestInit) => {
    const url = new URL(input);
    expect(url.origin).toBe('https://api-m.sandbox.paypal.com');
    if (url.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'fixture-token' });
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
      return Response.json({ id: orderId, links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=' + orderId }] });
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
      reference_id: localId, custom_id: wrongOwner ? crypto.randomUUID() : localId, amount,
      payments: includeCapture ? { captures: [{ id: captureId, amount: wrongCaptureValue ? { ...amount, value: '0.01' } : amount, status: result, final_capture: true }] } : undefined,
    }] });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  db.sql.close();
});

describe('PayPal Sandbox with simulated provider responses and real SQLite ledger', () => {
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
    expect(db.sql.prepare('SELECT COUNT(*) AS count FROM tactics_paypal_events').get()?.count).toBe(1);
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
      links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/' + captureId }],
    });
    expect(response.status).toBe(200);
    const status = await send('/orders/' + localId, 'GET', alice.token);
    expect((await status.json()).order.status).toBe('REVIEW');
    expect(db.sql.prepare("SELECT capture_id FROM tactics_paypal_events WHERE event_type='PAYMENT.CAPTURE.REFUNDED'").get()?.capture_id).toBe(captureId);
    expect(balance()).toBe(350);
    expect(count()).toBe(1);
  });

  it.each([undefined, '0', 'true'])('backend remains closed without an exact opt-in (%s)', async flag => {
    env.PAYPAL_SANDBOX_ENABLED = flag;
    expect(await (await send('/catalog')).json()).toEqual({ available: false, packages: [] });
    expect((await create()).status).toBe(503);
    expect((await send('/webhook', 'POST', undefined, {})).status).toBe(503);
    expect(createCalls).toBe(0);
    expect(balance()).toBe(0);
    expect(count()).toBe(0);
  });

  it('rejects the production domain even with Sandbox opt-in', async () => {
    const response = await handle(new Request('https://rpg-go-tactics.com' + root + '/catalog'), env);
    expect(await response.json()).toEqual({ available: false, packages: [] });
    expect(createCalls).toBe(0);
  });

  it('keeps disabled routes safe before migration 0033 exists', async () => {
    db = memoryD1();
    alice = addAccount(db, 'alice');
    env.DB = db;
    env.PAYPAL_SANDBOX_ENABLED = undefined;
    expect(await (await send('/catalog')).json()).toEqual({ available: false, packages: [] });
    expect((await create()).status).toBe(503);
    expect((await send('/webhook', 'POST', undefined, {})).status).toBe(503);
    expect(createCalls).toBe(0);
  });

  it('stays unavailable when misconfigured or configured to Live', async () => {
    env.PAYPAL_ENVIRONMENT = 'live';
    const catalog = await send('/catalog');
    expect(await catalog.json()).toEqual({ available: false, packages: [] });
    expect((await create()).status).toBe(503);
    expect(createCalls).toBe(0);
  });
});
