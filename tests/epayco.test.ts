import { PURCHASE_CONSENT_VERSION } from '../src/game/store/purchaseConsent';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { COSMETICS, DEFAULT_CONTENT } from '../src/game';
import { epaycoOutcome, parseCopAmount } from '../src/game/store/realMoney';
import { handle } from '../server/src/index';
import { CHECKOUT_RATE, epaycoConfig, productionBlockers, RECONCILE_EVERY_MS, safeEqual, sessionBody, STALE, type EpaycoClient, type EpaycoEnv, type SessionRequest } from '../server/src/epayco';
import { disputeSql, expireStaleSql, packageUpdateSql, reversalSql, STALE as OPS_STALE } from '../server/scripts/payment-ops-sql.mjs';
import { addAccount, memoryD1 } from './support/d1';

type Json = Record<string, unknown> & {
  error?: { code: string };
  orderId?: string;
  sessionId?: string;
  outcome?: string;
  order?: { status: string; crystals: number; amount: number; orderId: string };
  wallet?: { balance: number };
  packages?: { id: string; priceCOP: number; crystals: number }[];
  available?: boolean;
};

const NOW = 1_800_000_000_000;
const CUST = '123456';
const PKEY = 'test_p_key_value';
let now = NOW;
let ids = 0;
let db: ReturnType<typeof memoryD1>;
let sessions: SessionRequest[];
let failSession = false;
/** ePayco's records by ref_payco (what the validation API would return). */
let records: Map<string, Record<string, string>>;
let lookups: string[];
const ENV: Partial<EpaycoEnv> = {
  REAL_MONEY_PURCHASES_ENABLED: '1',
  EPAYCO_TEST_MODE: 'true',
  EPAYCO_PUBLIC_KEY: 'pub_test',
  EPAYCO_PRIVATE_KEY: 'priv_test',
  EPAYCO_P_CUST_ID_CLIENTE: CUST,
  EPAYCO_P_KEY: PKEY,
  EPAYCO_RESPONSE_URL: 'https://rpg-go-tactics.com/store/payment-result',
  EPAYCO_CONFIRMATION_URL: 'https://api.test/api/tactics/payments/epayco/confirmation',
};
const fakeEpayco: EpaycoClient = {
  async createSession(config, req) {
    expect(config).toMatchObject({ publicKey: 'pub_test', privateKey: 'priv_test' });
    if (failSession) throw new Error('down');
    sessions.push(req);
    return { sessionId: `sess_${sessions.length}abcdef` };
  },
  async lookupReference(ref) {
    lookups.push(ref);
    return records.get(ref) ?? null;
  },
};
const deps = () => ({
  content: DEFAULT_CONTENT,
  now: () => now,
  seed: () => 7,
  epayco: fakeEpayco,
  store: { catalog: [], cosmetics: COSMETICS, newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` },
});

async function call(token: string | null, method: string, path: string, body?: unknown, env: Partial<EpaycoEnv> = ENV) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://api.test/api/tactics${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handle(req, { DB: db, ...env } as EpaycoEnv, deps());
  return { status: res.status, body: (await res.json()) as Json };
}
const declaration = () => ({adult:true,termsAccepted:true,version:PURCHASE_CONSENT_VERSION,operationId:crypto.randomUUID()});
// Existing payment scenarios now explicitly include the required per-operation declaration.
const checkout = (token: string | null, body: unknown = { packageId: 'crystals_1200' }, env?: Partial<EpaycoEnv>) => call(token, 'POST', '/store/real-money/checkout', body && typeof body === 'object' && !Array.isArray(body) ? {consent:declaration(),...body} : body, env);

const sign = (f: Record<string, string>, pKey = PKEY) =>
  createHash('sha256').update([CUST, pKey, f.x_ref_payco, f.x_transaction_id, f.x_amount, f.x_currency_code].join('^')).digest('hex');

const invoiceOf = (orderId: string) => (db.sql.prepare('SELECT invoice FROM tactics_real_money_orders WHERE order_id = ?').get(orderId) as { invoice: string }).invoice;

/** What ePayco POSTs (form-urlencoded) to the confirmation URL. */
function confirmation(orderId: string, patch: Record<string, string> = {}, opts: { pKey?: string; signature?: string } = {}) {
  const f: Record<string, string> = {
    x_cust_id_cliente: CUST,
    x_ref_payco: '68fb83729d094878e015be00',
    x_id_invoice: invoiceOf(orderId),
    x_transaction_id: '3005912345',
    x_amount: '19900',
    x_currency_code: 'COP',
    x_cod_transaction_state: '1',
    x_response: 'Aceptada',
    x_response_reason_text: '00-Aprobada',
    x_test_request: 'TRUE',
    x_customer_email: 'payer@example.com',
    x_franchise: 'VS',
    ...patch,
  };
  f.x_signature = opts.signature ?? sign(f, opts.pKey);
  return f;
}
async function webhook(fields: Record<string, string>, env: Partial<EpaycoEnv> = ENV) {
  const req = new Request('https://api.test/api/tactics/payments/epayco/confirmation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  const res = await handle(req, { DB: db, ...env } as EpaycoEnv, deps());
  return { status: res.status, body: (await res.json()) as Json };
}

const balance = (userId: number) =>
  (db.sql.prepare("SELECT balance FROM tactics_wallets WHERE user_id = ? AND currency_id = 'arcane_crystals'").get(userId) as { balance: number } | undefined)?.balance ?? 0;
const ledger = (userId: number) =>
  db.sql.prepare("SELECT amount_delta, reason, reference_id, note FROM tactics_wallet_ledger WHERE user_id = ? AND reason = 'REAL_MONEY_PURCHASE'").all(userId) as {
    amount_delta: number;
    reference_id: string;
    note: string;
  }[];
const orderRow = (orderId: string) => db.sql.prepare('SELECT * FROM tactics_real_money_orders WHERE order_id = ?').get(orderId) as Record<string, unknown>;

beforeEach(() => {
  db = memoryD1();
  for (const m of ['0017_tactics_real_money_orders.sql', '0018_tactics_real_money_ops.sql', '0021_tactics_purchase_consent.sql'])
    db.sql.exec(readFileSync(new URL(`../server/migrations/${m}`, import.meta.url), 'utf8'));
  now = NOW;
  sessions = [];
  failSession = false;
  records = new Map();
  lookups = [];
});

async function startOrder(username = 'tactics_qa_a', packageId = 'crystals_1200') {
  const account = addAccount(db, username);
  const res = await checkout(account.token, { packageId });
  expect(res.status).toBe(200);
  return { account, orderId: res.body.orderId! };
}

describe('catalog and config', () => {
  it('serves the 4 QA packages publicly; checkout available only with full sandbox config', async () => {
    const pub = await call(null, 'GET', '/store/real-money/packages');
    expect(pub.status).toBe(200);
    expect(pub.body.available).toBe(true);
    expect(pub.body.packages!.map((p) => [p.id, p.crystals, p.priceCOP])).toEqual([
      ['crystals_500', 500, 9900],
      ['crystals_1200', 1200, 19900],
      ['crystals_2700', 2700, 39900],
      ['crystals_6000', 6000, 79900],
    ]);
    expect(JSON.stringify(pub.body)).not.toMatch(/priv_test|test_p_key|pub_test/);
    expect((await call(null, 'GET', '/store/real-money/packages', undefined, { ...ENV, EPAYCO_TEST_MODE: 'false' })).body.available).toBe(false);
    expect(epaycoConfig({ ...ENV, EPAYCO_TEST_MODE: undefined } as EpaycoEnv)).toBeNull();
    expect(epaycoConfig({ ...ENV, EPAYCO_P_KEY: '' } as EpaycoEnv)).toBeNull();
    expect(epaycoConfig({ ...ENV, EPAYCO_CONFIRMATION_URL: 'http://evil.test/x' } as EpaycoEnv)).toBeNull();
  });

  it('production mode (EPAYCO_TEST_MODE != "true") cannot create a checkout in phase 1', async () => {
    const a = addAccount(db, 'alice');
    const res = await checkout(a.token, undefined, { ...ENV, EPAYCO_TEST_MODE: 'false' });
    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe('PAYMENTS_UNAVAILABLE');
    expect(sessions).toHaveLength(0);
  });
});

describe('checkout', () => {
  it('guest cannot checkout', async () => {
    const res = await checkout(null);
    expect(res.status).toBe(401);
    expect(sessions).toHaveLength(0);
  });

  it('unknown or missing package rejected', async () => {
    const a = addAccount(db, 'alice');
    for (const body of [{ packageId: 'crystals_999' }, {}, { packageId: 5 }, 'x'])
      expect((await checkout(a.token, body)).body.error?.code).toBe('UNKNOWN_PACKAGE');
    expect(sessions).toHaveLength(0);
  });

  it('creates the order and an ePayco session from server values only (forged amount/crystals/userId ignored)', async () => {
    const a = addAccount(db, 'alice');
    const b = addAccount(db, 'bob');
    const res = await checkout(a.token, { packageId: 'crystals_1200', amount: 1, price: 1, currency: 'USD', crystals: 999_999, userId: b.id, invoice: 'MINE', reward: 'x' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ orderId: expect.stringMatching(/^rmo_/), sessionId: 'sess_1abcdef', testMode: true, amount: 19900, currency: 'COP' });
    const row = orderRow(res.body.orderId!);
    expect(row).toMatchObject({ user_id: a.id, package_id: 'crystals_1200', amount: 19900, currency: 'COP', crystals: 1200, status: 'PENDING', provider: 'EPAYCO', test_mode: 1, provider_session_id: 'sess_1abcdef' });
    expect(row.invoice).toMatch(/^RGT-[0-9A-F]{32}$/);
    expect(row.invoice).not.toBe('MINE');
    const body = sessionBody(sessions[0]!);
    expect(body).toMatchObject({
      checkout_version: '2',
      currency: 'COP',
      amount: 19900,
      country: 'CO',
      lang: 'ES',
      invoice: row.invoice,
      confirmation: ENV.EPAYCO_CONFIRMATION_URL,
      response: `${ENV.EPAYCO_RESPONSE_URL}?order=${res.body.orderId}`,
    });
    expect(JSON.stringify(body)).not.toMatch(/priv_test|test_p_key/);
    expect(JSON.stringify(res.body)).not.toMatch(/priv_test|test_p_key|pub_test|RGT-/);
  });

  it('provider failure marks the order FAILED and returns a safe error', async () => {
    const a = addAccount(db, 'alice');
    failSession = true;
    const res = await checkout(a.token);
    expect(res.status).toBe(502);
    expect(res.body.error?.code).toBe('PAYMENT_PROVIDER_ERROR');
    const row = db.sql.prepare('SELECT status, failure_reason FROM tactics_real_money_orders WHERE user_id = ?').get(a.id);
    expect(row).toEqual({ status: 'FAILED', failure_reason: 'SESSION_CREATE_FAILED' });
  });

  it('rate limits checkout sessions to 5 per minute per account', async () => {
    const a = addAccount(db, 'alice');
    for (let i = 0; i < CHECKOUT_RATE.sessions; i++) expect((await checkout(a.token)).status).toBe(200);
    expect((await checkout(a.token)).status).toBe(429);
    expect((await checkout(addAccount(db, 'bob').token)).status).toBe(200);
    now += CHECKOUT_RATE.windowMs + 1;
    expect((await checkout(a.token)).status).toBe(200);
  });
});

describe('confirmation webhook', () => {
  it('valid approved webhook fulfills: one REAL_MONEY_PURCHASE ledger row, order FULFILLED', async () => {
    const { account, orderId } = await startOrder();
    const res = await webhook(confirmation(orderId));
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('FULFILLED');
    expect(balance(account.id)).toBe(1200);
    const rows = ledger(account.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount_delta: 1200, reference_id: `EPAYCO:${orderId}` });
    expect(JSON.parse(rows[0]!.note)).toEqual({ provider: 'EPAYCO', orderId, packageId: 'crystals_1200', providerTransactionId: '3005912345', amount: 19900, currency: 'COP', crystals: 1200 });
    expect(orderRow(orderId)).toMatchObject({ status: 'FULFILLED', provider_transaction_id: '3005912345', provider_reference: '68fb83729d094878e015be00', paid_at: NOW, fulfilled_at: NOW });
  });

  it('accepts "19900.00" amounts and JSON / GET deliveries', async () => {
    const { account, orderId } = await startOrder();
    const f = confirmation(orderId, { x_amount: '19900.00' });
    const res = await handle(
      new Request(`https://api.test/api/tactics/payments/epayco/confirmation?${new URLSearchParams(f)}`, { method: 'GET' }),
      { DB: db, ...ENV } as EpaycoEnv,
      deps(),
    );
    expect(res.status).toBe(200);
    expect(balance(account.id)).toBe(1200);
    const other = await startOrder('bob', 'crystals_500');
    const json = await handle(
      new Request('https://api.test/api/tactics/payments/epayco/confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmation(other.orderId, { x_amount: '9900', x_transaction_id: '3005999999', x_ref_payco: 'ref_bob_000001' })),
      }),
      { DB: db, ...ENV } as EpaycoEnv,
      deps(),
    );
    expect(json.status).toBe(200);
    expect(balance(other.account.id)).toBe(500);
  });

  it('duplicate webhook (sequential and concurrent) credits exactly once', async () => {
    const { account, orderId } = await startOrder();
    const f = confirmation(orderId);
    const results = await Promise.all([webhook(f), webhook(f)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const again = await webhook(f);
    expect(again.body.outcome).toBe('ALREADY_FULFILLED');
    expect(results.map((r) => r.body.outcome).sort()).toEqual(['ALREADY_FULFILLED', 'FULFILLED']);
    expect(ledger(account.id)).toHaveLength(1);
    expect(balance(account.id)).toBe(1200);
  });

  it('invalid signature rejected (400), nothing credited, event logged without secrets', async () => {
    const { account, orderId } = await startOrder();
    for (const f of [confirmation(orderId, {}, { pKey: 'wrong' }), confirmation(orderId, {}, { signature: 'f'.repeat(64) }), { ...confirmation(orderId), x_amount: '1' }]) {
      const res = await webhook(f);
      expect(res.status).toBe(400);
      expect(res.body.outcome).toBe('BAD_SIGNATURE');
    }
    expect(balance(account.id)).toBe(0);
    expect(orderRow(orderId).status).toBe('PENDING');
    const events = db.sql.prepare('SELECT * FROM tactics_payment_events').all() as Record<string, unknown>[];
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.signature_valid === 0)).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/payer@example|test_p_key|priv_test|[0-9a-f]{64}/);
  });

  it('malformed webhook rejected', async () => {
    const res = await webhook({ x_ref_payco: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.outcome).toBe('MALFORMED');
  });

  it('amount mismatch (signed) is not credited and is flagged for review', async () => {
    const { account, orderId } = await startOrder();
    for (const x_amount of ['9900', '19900.50', '199000']) {
      const res = await webhook(confirmation(orderId, { x_amount }));
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('AMOUNT_MISMATCH');
    }
    expect(balance(account.id)).toBe(0);
    expect(orderRow(orderId)).toMatchObject({ status: 'PENDING', needs_review: 1, failure_reason: 'AMOUNT_MISMATCH' });
  });

  it('currency mismatch is not credited', async () => {
    const { account, orderId } = await startOrder();
    expect((await webhook(confirmation(orderId, { x_currency_code: 'USD' }))).body.outcome).toBe('CURRENCY_MISMATCH');
    expect(balance(account.id)).toBe(0);
  });

  it('a production transaction (x_test_request FALSE) or another merchant is never credited to a sandbox order', async () => {
    const { account, orderId } = await startOrder();
    expect((await webhook(confirmation(orderId, { x_test_request: 'FALSE' }))).body.outcome).toBe('ENVIRONMENT_MISMATCH');
    expect((await webhook(confirmation(orderId, { x_cust_id_cliente: '999' }))).body.outcome).toBe('CUSTOMER_MISMATCH');
    expect(balance(account.id)).toBe(0);
  });

  it('unknown invoice: acknowledged, nothing credited', async () => {
    await startOrder();
    const f = confirmation((await startOrder('bob')).orderId, { x_id_invoice: 'RGT-NOPE' });
    expect((await webhook(f)).body.outcome).toBe('ORDER_NOT_FOUND');
  });

  it('pending / rejected / failed / cancelled / expired do not fulfill; a later approval does', async () => {
    const { account, orderId } = await startOrder();
    const cases: [string, string, string][] = [
      ['3', 'Pendiente', 'PENDING'],
      ['7', 'Retenida', 'PENDING'],
      ['2', 'Rechazada', 'FAILED'],
      ['4', 'Fallida', 'FAILED'],
      ['10', 'Abandonada', 'CANCELLED'],
      ['11', 'Cancelada', 'CANCELLED'],
      ['9', 'Caducada', 'EXPIRED'],
    ];
    for (const [code, text, status] of cases) {
      const res = await webhook(confirmation(orderId, { x_cod_transaction_state: code, x_response: text }));
      expect(res.status).toBe(200);
      expect(orderRow(orderId).status).toBe(status);
      expect(balance(account.id)).toBe(0);
    }
    // The player retried and paid within the same checkout: a signed approval still fulfills.
    expect((await webhook(confirmation(orderId, { x_transaction_id: '3005900002' }))).body.outcome).toBe('FULFILLED');
    expect(balance(account.id)).toBe(1200);
  });

  it('a late rejection or reversal never removes crystals automatically; reversal is flagged', async () => {
    const { account, orderId } = await startOrder();
    await webhook(confirmation(orderId));
    expect((await webhook(confirmation(orderId, { x_cod_transaction_state: '2', x_response: 'Rechazada' }))).body.outcome).toBe('IGNORED_AFTER_FULFILMENT');
    expect(orderRow(orderId).status).toBe('FULFILLED');
    expect((await webhook(confirmation(orderId, { x_cod_transaction_state: '6', x_response: 'Reversada' }))).body.outcome).toBe('REFUNDED');
    expect(orderRow(orderId)).toMatchObject({ status: 'REFUNDED', needs_review: 1 });
    expect(balance(account.id)).toBe(1200);
  });

  it('one provider transaction cannot fulfill two orders', async () => {
    const first = await startOrder('alice');
    const second = await startOrder('bob');
    await webhook(confirmation(first.orderId));
    const res = await webhook(confirmation(second.orderId));
    expect(res.body.outcome).toBe('TRANSACTION_CONFLICT');
    expect(balance(second.account.id)).toBe(0);
    expect(orderRow(second.orderId)).toMatchObject({ needs_review: 1, fulfilled_at: null });
  });

  it('webhook is public: no user session needed, and a user token adds nothing', async () => {
    const { account, orderId } = await startOrder();
    const f = confirmation(orderId);
    const req = new Request('https://api.test/api/tactics/payments/epayco/confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${account.token}` },
      body: new URLSearchParams({ ...f, x_signature: 'bad' }).toString(),
    });
    expect((await handle(req, { DB: db, ...ENV } as EpaycoEnv, deps())).status).toBe(400);
    expect(balance(account.id)).toBe(0);
  });
});

describe('order status', () => {
  it('owner reads safe status; other users and guests cannot', async () => {
    const { account, orderId } = await startOrder();
    const mine = await call(account.token, 'GET', `/store/real-money/orders/${orderId}`);
    expect(mine.status).toBe(200);
    expect(mine.body.order).toMatchObject({ orderId, status: 'PENDING', crystals: 1200, amount: 19900, currency: 'COP' });
    expect(JSON.stringify(mine.body)).not.toMatch(/RGT-|sess_|invoice|provider/);
    const bob = addAccount(db, 'bob');
    expect((await call(bob.token, 'GET', `/store/real-money/orders/${orderId}`)).status).toBe(404);
    expect((await call(null, 'GET', `/store/real-money/orders/${orderId}`)).status).toBe(401);
    expect((await call(account.token, 'GET', '/store/real-money/orders/../wallet')).status).not.toBe(200);
  });

  it('redirect without webhook grants nothing: status stays PENDING, balance 0', async () => {
    const { account, orderId } = await startOrder();
    // What the response page does: read the order (ref_payco in the URL is never trusted).
    const res = await call(account.token, 'GET', `/store/real-money/orders/${orderId}?ref_payco=68fb83729d094878e015be00&x_cod_response=1`);
    expect(res.body.order!.status).toBe('PENDING');
    expect(res.body.wallet!.balance).toBe(0);
    expect(balance(account.id)).toBe(0);
  });

  it('webhook without redirect: credited anyway, next login sees the balance', async () => {
    const { account, orderId } = await startOrder();
    await webhook(confirmation(orderId));
    // Player closed the browser; later reads the wallet with a fresh request.
    expect((await call(account.token, 'GET', `/store/real-money/orders/${orderId}`)).body).toMatchObject({ order: { status: 'FULFILLED' }, wallet: { balance: 1200 } });
  });
});

describe('pure helpers', () => {
  it('maps ePayco states; only code 1 / Aceptada approves', () => {
    expect(epaycoOutcome('1')).toBe('APPROVED');
    expect(epaycoOutcome('', 'Aceptada')).toBe('APPROVED');
    for (const c of ['2', '3', '4', '6', '7', '8', '9', '10', '11', '12', 'x']) expect(epaycoOutcome(c, 'Aceptada')).not.toBe('APPROVED');
    expect(epaycoOutcome(null, null)).toBe('UNKNOWN');
  });
  it('parses COP amounts strictly', () => {
    expect(parseCopAmount('19900')).toBe(19900);
    expect(parseCopAmount('19900.00')).toBe(19900);
    for (const v of ['19900.5', '19,900', '-1', '1e5', '', ' ', null]) expect(parseCopAmount(v)).toBeNull();
  });
  it('safeEqual is case-insensitive and length-safe', () => {
    expect(safeEqual('abc', 'ABC')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('seeded catalog: unique ids, whole-peso prices, no bonus yet', () => {
    const rows = db.sql.prepare('SELECT package_id, price_cop, bonus_crystals FROM tactics_crystal_packages').all() as { package_id: string; price_cop: number; bonus_crystals: number }[];
    expect(new Set(rows.map((p) => p.package_id)).size).toBe(4);
    expect(rows.every((p) => Number.isInteger(p.price_cop) && p.price_cop > 0 && p.bonus_crystals === 0)).toBe(true);
  });
});

// ── Phase 2: production prep ─────────────────────────────────────────────────────────────

const events = (orderId: string) =>
  db.sql.prepare('SELECT event_type, processed, outcome, source FROM tactics_payment_events WHERE order_id = ? ORDER BY id').all(orderId) as {
    event_type: string;
    processed: number;
    outcome: string;
    source: string;
  }[];
const processedOf = (orderId: string, type: string) => events(orderId).filter((e) => e.processed === 1 && e.event_type === type).length;
const setCreated = (orderId: string, createdAt: number) => db.sql.prepare('UPDATE tactics_real_money_orders SET created_at = ? WHERE order_id = ?').run(createdAt, orderId);

describe('phase 2 — ledger reason', () => {
  it('credits with REAL_MONEY_PURCHASE + one processed FULFILLED event; historic PURCHASE_CURRENCY rows untouched', async () => {
    const { account, orderId } = await startOrder();
    // A sandbox credit from phase 1 (old reason) stays exactly as it was.
    db.sql
      .prepare("INSERT INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, note, created_at) VALUES ('txn_old', ?, 'arcane_crystals', 500, 0, 500, 'PURCHASE_CURRENCY', 'EPAYCO:rmo_old', '{}', 1)")
      .run(account.id);
    await webhook(confirmation(orderId));
    expect(ledger(account.id)).toHaveLength(1);
    expect(db.sql.prepare("SELECT COUNT(*) AS n FROM tactics_wallet_ledger WHERE reason = 'PURCHASE_CURRENCY'").get()).toEqual({ n: 1 });
    expect(balance(account.id)).toBe(1700);
    expect(processedOf(orderId, 'FULFILLED')).toBe(1);
    await webhook(confirmation(orderId));
    expect(processedOf(orderId, 'FULFILLED')).toBe(1);
    expect(events(orderId).at(-1)).toMatchObject({ event_type: 'DUPLICATE', processed: 0, outcome: 'ALREADY_FULFILLED' });
  });
});

describe('phase 2 — refunds and disputes', () => {
  const reverse = (orderId: string) => confirmation(orderId, { x_cod_transaction_state: '6', x_response: 'Reversada' });

  it('refund after fulfilment: REFUNDED, review flag, no automatic debit, one processed event', async () => {
    const { account, orderId } = await startOrder();
    await webhook(confirmation(orderId));
    const res = await webhook(reverse(orderId));
    expect(res.body.outcome).toBe('REFUNDED');
    expect(orderRow(orderId)).toMatchObject({ status: 'REFUNDED', needs_review: 1, review_reason: 'REFUND_AFTER_FULFILMENT', refunded_at: NOW });
    expect(balance(account.id)).toBe(1200);
    expect(processedOf(orderId, 'REFUNDED')).toBe(1);
  });

  it('duplicate refund changes nothing and is recorded as unprocessed', async () => {
    const { orderId } = await startOrder();
    await webhook(confirmation(orderId));
    await webhook(reverse(orderId));
    now += 1000;
    const again = await webhook(reverse(orderId));
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe('DUPLICATE_REFUND');
    expect(processedOf(orderId, 'REFUNDED')).toBe(1);
    expect(orderRow(orderId).refunded_at).toBe(NOW);
  });

  it('refund of a never-fulfilled order: REFUNDED without review; a later approval does not credit', async () => {
    const { account, orderId } = await startOrder();
    await webhook(reverse(orderId));
    expect(orderRow(orderId)).toMatchObject({ status: 'REFUNDED', needs_review: 0 });
    expect((await webhook(confirmation(orderId))).body.outcome).toBe('IGNORED_AFTER_REFUND');
    expect(balance(account.id)).toBe(0);
    expect(orderRow(orderId).needs_review).toBe(1);
  });

  it('dispute (ops SQL): DISPUTED once, reason recorded, no sensitive data; repeat is a no-op', async () => {
    const { orderId } = await startOrder();
    await webhook(confirmation(orderId));
    db.sql.exec(disputeSql({ order: orderId, reason: 'contracargo banco', now: NOW + 5 }));
    db.sql.exec(disputeSql({ order: orderId, reason: 'contracargo banco', now: NOW + 9 }));
    expect(orderRow(orderId)).toMatchObject({ status: 'DISPUTED', disputed_at: NOW + 5, needs_review: 1, review_reason: 'DISPUTE: contracargo banco' });
    expect(processedOf(orderId, 'DISPUTED')).toBe(1);
    const ev = db.sql.prepare("SELECT * FROM tactics_payment_events WHERE event_type = 'DISPUTED'").get() as Record<string, unknown>;
    expect(ev).toMatchObject({ amount: '19900', currency: 'COP', provider_reference: '68fb83729d094878e015be00', detail: 'contracargo banco', source: 'ADMIN' });
    expect(() => disputeSql({ order: orderId, reason: "x'; DROP TABLE users;--", now: 1 })).toThrow();
    expect(() => disputeSql({ order: 'rmo_x', reason: 'ok', now: 1 })).toThrow();
  });

  it('controlled reversal (ops SQL): debits once and never below zero', async () => {
    const { account, orderId } = await startOrder();
    await webhook(confirmation(orderId));
    await webhook(reverse(orderId));
    db.sql.exec(reversalSql({ order: orderId, now: NOW + 1, transactionId: 'txn_rev_aaaaaaaa' }));
    expect(balance(account.id)).toBe(0);
    expect(() => db.sql.exec(reversalSql({ order: orderId, now: NOW + 2, transactionId: 'txn_rev_bbbbbbbb' }))).toThrow(); // same reference
    // Spent crystals: the reversal aborts instead of going negative.
    const second = await startOrder('bob');
    await webhook(confirmation(second.orderId, { x_transaction_id: '3005900077', x_ref_payco: 'ref_bob_000002' }));
    await webhook(confirmation(second.orderId, { x_transaction_id: '3005900077', x_ref_payco: 'ref_bob_000002', x_cod_transaction_state: '6', x_response: 'Reversada' }));
    db.sql
      .prepare("INSERT INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, created_at) VALUES ('txn_spend', ?, 'arcane_crystals', -1000, 1200, 200, 'STORE_PURCHASE', 'pur_x', 1)")
      .run(second.account.id);
    expect(() => db.sql.exec(reversalSql({ order: second.orderId, now: NOW + 3, transactionId: 'txn_rev_cccccccc' }))).toThrow();
    expect(balance(second.account.id)).toBe(200);
    // Not refunded/disputed → nothing to reverse.
    const third = await startOrder('carol');
    await webhook(confirmation(third.orderId, { x_transaction_id: '3005900088', x_ref_payco: 'ref_carol_00003' }));
    db.sql.exec(reversalSql({ order: third.orderId, now: NOW + 4, transactionId: 'txn_rev_dddddddd' }));
    expect(balance(third.account.id)).toBe(1200);
  });
});

describe('phase 2 — stale orders and reconciliation', () => {
  it('stale policy: CREATED > 1 h and PENDING without reference > 24 h expire; PENDING with reference is only flagged', async () => {
    expect(OPS_STALE).toEqual(STALE);
    const a = await startOrder('alice');
    const b = await startOrder('alice2');
    const c = await startOrder('alice3');
    db.sql.prepare("UPDATE tactics_real_money_orders SET status = 'CREATED' WHERE order_id = ?").run(a.orderId);
    setCreated(a.orderId, NOW - STALE.createdMs - 1);
    setCreated(b.orderId, NOW - STALE.pendingNoReferenceMs - 1);
    await webhook(confirmation(c.orderId, { x_cod_transaction_state: '3', x_response: 'Pendiente' }));
    setCreated(c.orderId, NOW - STALE.reviewMs - 1);
    for (const who of [a, b, c]) await call(who.account.token, 'GET', '/store/real-money/orders');
    expect(orderRow(a.orderId)).toMatchObject({ status: 'EXPIRED', expired_at: NOW });
    expect(orderRow(b.orderId)).toMatchObject({ status: 'EXPIRED' });
    expect(orderRow(c.orderId)).toMatchObject({ status: 'PENDING', needs_review: 1, review_reason: 'STALE_PENDING_WITH_REFERENCE' });
    expect(processedOf(a.orderId, 'EXPIRED')).toBe(1);
    // Global ops command is idempotent and matches.
    db.sql.exec(expireStaleSql(NOW + 1));
    expect(processedOf(a.orderId, 'EXPIRED')).toBe(1);
  });

  it('a late approved confirmation for an EXPIRED order still fulfils (the money was taken)', async () => {
    const { account, orderId } = await startOrder();
    setCreated(orderId, NOW - STALE.pendingNoReferenceMs - 1);
    await call(account.token, 'GET', `/store/real-money/orders/${orderId}`);
    expect(orderRow(orderId).status).toBe('EXPIRED');
    expect((await webhook(confirmation(orderId))).body.outcome).toBe('FULFILLED');
    expect(orderRow(orderId)).toMatchObject({ status: 'FULFILLED', expired_at: null });
    expect(balance(account.id)).toBe(1200);
  });

  it('reconciliation via ref_payco hint: ePayco signed record fulfils, throttled, idempotent', async () => {
    const { account, orderId } = await startOrder();
    records.set('68fb83729d094878e015be00', confirmation(orderId));
    const res = await call(account.token, 'GET', `/store/real-money/orders/${orderId}?ref_payco=68fb83729d094878e015be00`);
    expect(res.body.order).toMatchObject({ status: 'FULFILLED', result: 'APPROVED' });
    expect(res.body.wallet!.balance).toBe(1200);
    expect(events(orderId).at(-1)).toMatchObject({ source: 'RECONCILE', event_type: 'FULFILLED', processed: 1 });
    await call(account.token, 'GET', `/store/real-money/orders/${orderId}?ref_payco=68fb83729d094878e015be00`);
    expect(lookups).toHaveLength(1); // final orders are never looked up again
    expect(ledger(account.id)).toHaveLength(1);
  });

  it('reconciliation of a pending order with a known reference is throttled per order', async () => {
    const { account, orderId } = await startOrder();
    await webhook(confirmation(orderId, { x_cod_transaction_state: '3', x_response: 'Pendiente' }));
    records.set('68fb83729d094878e015be00', confirmation(orderId, { x_cod_transaction_state: '3', x_response: 'Pendiente' }));
    await call(account.token, 'GET', `/store/real-money/orders/${orderId}`);
    await call(account.token, 'GET', `/store/real-money/orders/${orderId}`);
    expect(lookups).toHaveLength(1);
    now += RECONCILE_EVERY_MS;
    records.set('68fb83729d094878e015be00', confirmation(orderId));
    expect((await call(account.token, 'GET', `/store/real-money/orders/${orderId}`)).body.order!.status).toBe('FULFILLED');
    expect(lookups).toHaveLength(2);
  });

  it('reconciliation never trusts the caller: foreign reference, forged record, other owner', async () => {
    const mine = await startOrder('alice');
    const other = await startOrder('bob');
    // The hint points at ePayco's (valid, signed) record of BOB's order.
    records.set('refofbob000001', confirmation(other.orderId, { x_ref_payco: 'refofbob000001' }));
    const res = await call(mine.account.token, 'GET', `/store/real-money/orders/${mine.orderId}?ref_payco=refofbob000001`);
    expect(res.body.order!.status).toBe('PENDING');
    expect(orderRow(other.orderId).status).toBe('PENDING');
    expect(balance(mine.account.id) + balance(other.account.id)).toBe(0);
    expect(events(mine.orderId).length + events(other.orderId).length).toBe(0); // REFERENCE_MISMATCH rows carry no order
    // A record that does not carry ePayco's signature.
    now += RECONCILE_EVERY_MS;
    records.set('forgedref00001', { ...confirmation(mine.orderId), x_signature: 'f'.repeat(64) });
    await call(mine.account.token, 'GET', `/store/real-money/orders/${mine.orderId}?ref_payco=forgedref00001`);
    expect(orderRow(mine.orderId).status).toBe('PENDING');
    // Another account cannot even trigger a lookup on my order.
    expect((await call(other.account.token, 'GET', `/store/real-money/orders/${mine.orderId}?ref_payco=x`)).status).toBe(404);
  });
});

describe('phase 2 — history, pricing, environment, config', () => {
  it('purchase history: owner only, newest first, safe fields', async () => {
    const a = await startOrder('alice');
    now += 1000;
    const second = await checkout(a.account.token, { packageId: 'crystals_500' });
    await startOrder('bob');
    const res = await call(a.account.token, 'GET', '/store/real-money/orders');
    const orders = res.body.orders as { orderId: string; reference: string; result: string; amount: number; crystals: number }[];
    expect(orders.map((o) => o.orderId)).toEqual([second.body.orderId, a.orderId]);
    expect(orders[0]).toMatchObject({ amount: 9900, crystals: 500, result: 'PENDING', reference: expect.stringMatching(/^[0-9A-F]{10}$/) });
    expect(JSON.stringify(res.body)).not.toMatch(/RGT-|sess_|invoice|provider|3005912345/);
    expect((await call(null, 'GET', '/store/real-money/orders')).status).toBe(401);
  });

  it('result mapping exposed by the server: REJECTED vs FAILED', async () => {
    const a = await startOrder('alice');
    const b = await startOrder('bob');
    await webhook(confirmation(a.orderId, { x_cod_transaction_state: '2', x_response: 'Rechazada' }));
    await webhook(confirmation(b.orderId, { x_cod_transaction_state: '4', x_response: 'Fallida', x_ref_payco: 'refb0000001', x_transaction_id: '3005911111' }));
    expect((await call(a.account.token, 'GET', `/store/real-money/orders/${a.orderId}`)).body.order).toMatchObject({ result: 'REJECTED' });
    expect((await call(b.account.token, 'GET', `/store/real-money/orders/${b.orderId}`)).body.order).toMatchObject({ result: 'FAILED' });
  });

  it('prices come from the D1 catalog only; changes affect new orders; inactive packages disappear', async () => {
    const a = await startOrder('alice', 'crystals_500');
    db.sql.exec(packageUpdateSql({ pkg: 'crystals_500', priceCOP: 10900, bonusCrystals: 50, now: NOW }));
    const pub = await call(null, 'GET', '/store/real-money/packages');
    expect(pub.body.packages![0]).toMatchObject({ id: 'crystals_500', priceCOP: 10900, crystals: 550 });
    const b = await checkout(a.account.token, { packageId: 'crystals_500', amount: 9900 });
    expect(b.body).toMatchObject({ amount: 10900 });
    expect(orderRow(b.body.orderId!)).toMatchObject({ amount: 10900, gross_amount: 10900, crystals: 550, tax_policy: 'UNDECIDED', tax_amount: null, net_amount: null });
    expect(orderRow(a.orderId)).toMatchObject({ amount: 9900, crystals: 500 });
    db.sql.exec(packageUpdateSql({ pkg: 'crystals_6000', active: false, now: NOW }));
    expect((await call(null, 'GET', '/store/real-money/packages')).body.packages!.map((p) => p.id)).not.toContain('crystals_6000');
    expect((await checkout(a.account.token, { packageId: 'crystals_6000' })).body.error?.code).toBe('UNKNOWN_PACKAGE');
    expect(() => packageUpdateSql({ pkg: 'crystals_500', priceCOP: -5, now: 1 })).toThrow();
  });

  it('a sandbox transaction can never pay a production order (and vice versa)', async () => {
    const a = addAccount(db, 'alice');
    db.sql
      .prepare(
        `INSERT INTO tactics_real_money_orders (order_id, user_id, package_id, invoice, provider, test_mode, amount, currency, crystals, status, created_at, updated_at)
         VALUES ('rmo_00000000-0000-4000-8000-00000000abcd', ?, 'crystals_1200', 'RGT-PROD0001', 'EPAYCO', 0, 19900, 'COP', 1200, 'PENDING', ?, ?)`,
      )
      .run(a.id, NOW, NOW);
    const res = await webhook(confirmation('rmo_00000000-0000-4000-8000-00000000abcd', { x_test_request: 'TRUE' }));
    expect(res.body.outcome).toBe('ENVIRONMENT_MISMATCH');
    expect(balance(a.id)).toBe(0);
  });

  it('legal links/tax note are served from config; production blockers are listed, nothing enabled', async () => {
    const pub = await call(null, 'GET', '/store/real-money/packages');
    expect(pub.body.legal).toEqual({ termsUrl: null, refundUrl: null, privacyUrl: null, taxNote: null });
    const env = { ...ENV, REAL_MONEY_TERMS_URL: 'https://rpg-go-tactics.com/terminos', REAL_MONEY_REFUND_URL: 'http://insecure', REAL_MONEY_TAX_NOTE: 'Impuestos incluidos' };
    expect((await call(null, 'GET', '/store/real-money/packages', undefined, env)).body.legal).toEqual({
      termsUrl: 'https://rpg-go-tactics.com/terminos',
      refundUrl: null,
      privacyUrl: null,
      taxNote: 'Impuestos incluidos',
    });
    expect(productionBlockers(ENV as EpaycoEnv)).toEqual(['TEST_MODE_ON', 'TERMS_NOT_PUBLISHED', 'REFUND_POLICY_NOT_PUBLISHED', 'PRIVACY_POLICY_NOT_PUBLISHED', 'TAX_POLICY_UNDECIDED']);
    // Even a "complete" production config cannot open checkout in this phase.
    const prod = { ...env, EPAYCO_TEST_MODE: 'false', REAL_MONEY_REFUND_URL: 'https://x.test/r', REAL_MONEY_PRIVACY_URL: 'https://x.test/p' } as EpaycoEnv;
    expect(productionBlockers(prod)).toEqual([]);
    expect(epaycoConfig(prod)).toBeNull();
  });
});


describe('18+ declaration and per-operation contract acceptance',()=>{
  it.each([undefined, null, false, {}, {adult:false,termsAccepted:true}, {adult:'true',termsAccepted:true}, {adult:true,termsAccepted:false}])('rejects omission or non-adult confirmation without changing orders, sessions or balance: %j',async consent=>{
    const a=addAccount(db,'buyer');
    const res=await call(a.token,'POST','/store/real-money/checkout',{packageId:'crystals_500',consent});
    expect(res.status).toBe(422);expect(res.body.error?.code).toBe('PURCHASE_CONSENT_REQUIRED');
    expect(balance(a.id)).toBe(0);expect(sessions).toHaveLength(0);
    expect(db.sql.prepare('SELECT COUNT(*) n FROM tactics_real_money_orders').get()?.n).toBe(0);
    expect(db.sql.prepare('SELECT COUNT(*) n FROM tactics_purchase_consents').get()?.n).toBe(0);
  });
  it('rejects obsolete version, invalid nonce, or purported acceptance from another order',async()=>{
    const a=addAccount(db,'buyer');
    for(const patch of [{version:'obsolete'},{operationId:'previous-order'},{adult:1},{termsAccepted:'yes'}]){
      expect((await checkout(a.token,{packageId:'crystals_500',consent:{...declaration(),...patch}})).status).toBe(422);
    }
    expect(balance(a.id)).toBe(0);
  });
  it('persists only minimal declaration tied to server account/order/time; rejects cross-order/account replay',async()=>{
    const a=addAccount(db,'buyer'), b=addAccount(db,'other'), consent=declaration();
    const first=await checkout(a.token,{packageId:'crystals_500',consent,acceptedAt:0,userId:b.id});expect(first.status).toBe(200);
    const saved=db.sql.prepare('SELECT * FROM tactics_purchase_consents').get()!;
    expect(saved).toMatchObject({user_id:a.id,order_id:first.body.orderId,operation_id:consent.operationId,accepted_at:NOW,adult_declared:1,terms_accepted:1,version:PURCHASE_CONSENT_VERSION});
    for(const token of [a.token,b.token])expect((await checkout(token,{packageId:'crystals_1200',consent})).status).toBe(409);
    expect((await checkout(a.token,{packageId:'crystals_500',consent:{...consent,operationId:consent.operationId.toUpperCase()}})).status).toBe(409);
    expect(db.sql.prepare('SELECT COUNT(*) n FROM tactics_real_money_orders').get()?.n).toBe(1);expect(sessions).toHaveLength(1);expect(balance(a.id)).toBe(0);expect(balance(b.id)).toBe(0);
    expect(()=>db.sql.prepare("UPDATE tactics_purchase_consents SET version='forged'").run()).toThrow();
    expect((await checkout(a.token,{packageId:'crystals_1200',consent:declaration()})).status).toBe(200);
  });
  it('keeps playing independent of age declarations and rejects undocumented alternate checkout routes',async()=>{
    const a=addAccount(db,'player');expect((await call(a.token,'POST','/profile',{})).status).toBe(200);
    expect((await call(a.token,'GET','/state')).status).toBe(200);
    expect((await call(a.token,'POST','/champions/start',{heroId:'mage'})).status).toBe(200);
    expect((await call(a.token,'POST','/campaign/start',{heroId:'mage'})).status).toBe(200);
    expect(db.sql.prepare('SELECT COUNT(*) n FROM tactics_purchase_consents').get()?.n).toBe(0);
    expect((await call(a.token,'POST','/store/checkout',{packageId:'crystals_500'})).status).toBe(404);
  });
});


describe('purchase declaration transaction safety',()=>{
 it('preserves an existing crystal balance when an underage declaration is rejected',async()=>{
  const a=addAccount(db,'buyer');
  db.sql.prepare("INSERT INTO tactics_wallet_ledger(transaction_id,user_id,currency_id,amount_delta,balance_before,balance_after,reason,reference_id,created_at) VALUES('qa-credit',?,'arcane_crystals',700,0,700,'QA_GRANT','age-test',0)").run(a.id);
  const rejected=await checkout(a.token,{packageId:'crystals_500',consent:{...declaration(),adult:false}});
  expect(rejected.status).toBe(422);expect(balance(a.id)).toBe(700);expect(db.sql.prepare('SELECT COUNT(*) n FROM tactics_wallet_ledger').get()?.n).toBe(1);
 });
 it('rolls back a second concurrent order sharing the declaration',async()=>{
  const a=addAccount(db,'buyer'),consent=declaration();
  const results=await Promise.all([checkout(a.token,{packageId:'crystals_500',consent}),checkout(a.token,{packageId:'crystals_1200',consent})]);
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(sessions).toHaveLength(1);
  expect(db.sql.prepare('SELECT COUNT(*) n FROM tactics_real_money_orders').get()?.n).toBe(1);expect(db.sql.prepare('SELECT COUNT(*) n FROM tactics_purchase_consents').get()?.n).toBe(1);
 });
});

describe('commercial checkpoint — failed credit recovery',()=>{
 it('rolls back a failed crystal credit, retains consent and recovers from a signed provider lookup exactly once',async()=>{
  const {account,orderId}=await startOrder();const f=confirmation(orderId);
  // Fault injection belongs only to this isolated in-memory test database.
  db.sql.exec("CREATE TRIGGER checkpoint_credit_failure BEFORE INSERT ON tactics_wallet_ledger WHEN NEW.reason='REAL_MONEY_PURCHASE' BEGIN SELECT RAISE(ABORT,'simulated temporary write failure'); END;");
  expect((await webhook(f)).status).toBe(500);
  expect(orderRow(orderId).status).toBe('PENDING');expect(orderRow(orderId).fulfilled_at).toBeNull();expect(balance(account.id)).toBe(0);expect(ledger(account.id)).toHaveLength(0);
  expect(db.sql.prepare('SELECT order_id FROM tactics_purchase_consents WHERE order_id=?').get(orderId)?.order_id).toBe(orderId);
  db.sql.exec('DROP TRIGGER checkpoint_credit_failure');
  records.set(f.x_ref_payco!,f);
  const restored=await call(account.token,'GET',`/store/real-money/orders/${orderId}?ref_payco=${f.x_ref_payco}`);
  expect(restored.body.order?.status).toBe('FULFILLED');expect(balance(account.id)).toBe(1200);
  expect((await webhook(f)).body.outcome).toBe('ALREADY_FULFILLED');expect(ledger(account.id)).toHaveLength(1);
 });
});

describe('payment shutdown preserves history', () => {
 it('blocks new orders but still reconciles and reads a historical sandbox order once', async () => {
  const { account, orderId } = await startOrder();
  const off = { ...ENV, REAL_MONEY_PURCHASES_ENABLED: '0' };
  const blocked = await checkout(account.token, { packageId: 'crystals_1200' }, off);
  expect(blocked.body.error?.code).toBe('PAYMENTS_DISABLED');
  const fields = confirmation(orderId);
  expect((await webhook(fields, off)).status).toBe(200);
  const paid = balance(account.id);
  expect(paid).toBeGreaterThan(0);
  await webhook(fields, off);
  expect(balance(account.id)).toBe(paid);
  expect((await call(account.token, 'GET', '/store/real-money/orders', undefined, off)).status).toBe(200);
  expect(db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_real_money_orders').get()).toMatchObject({n:1});
 });
});
