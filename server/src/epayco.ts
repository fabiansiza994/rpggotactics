import {
  epaycoOutcome,
  orderReference,
  PACKAGE_ID,
  parseCopAmount,
  purchaseResult,
  type CrystalPackage,
  type EpaycoOutcome,
  type RealMoneyOrderStatus,
} from '../../src/game/store/realMoney';
import { PREMIUM_CURRENCY_ID } from '../../src/game';
import type { D1Database, D1PreparedStatement, Env } from './db';
import { error, json } from './http';
import { ledgerStatement, walletView } from './store';

/**
 * Real-money Cristales Arcanos through ePayco Smart Checkout (checkout-v2). SANDBOX ONLY until
 * phase 3 (qa/epayco-phase2/PRODUCTION-CHECKLIST.md).
 *
 *   client {packageId} ─► POST /store/real-money/checkout ─► order (package from D1) + Apify session
 *   ─► player pays on ePayco ─► signed confirmation ─► processConfirmation ─► ONE D1 batch:
 *   order FULFILLED + REAL_MONEY_PURCHASE ledger row + FULFILLED event (each at most once).
 *
 * The same processConfirmation handles ePayco's webhook and reconciliation (ePayco's own signed
 * record fetched by reference), so both paths enforce signature, invoice, merchant, environment,
 * currency and amount. The response page never credits anything.
 */

/** Worker vars/secrets this module reads (secrets via `wrangler secret put`, never in the repo). */
export interface EpaycoEnv extends Env {
  EPAYCO_PUBLIC_KEY?: string;
  EPAYCO_PRIVATE_KEY?: string;
  EPAYCO_P_CUST_ID_CLIENTE?: string;
  EPAYCO_P_KEY?: string;
  /** Must be exactly "true": anything else disables real-money checkout (phase 3 changes this). */
  EPAYCO_TEST_MODE?: string;
  EPAYCO_RESPONSE_URL?: string;
  EPAYCO_CONFIRMATION_URL?: string;
  /** Public legal pages shown next to the packages (https). Required before production. */
  REAL_MONEY_TERMS_URL?: string;
  REAL_MONEY_REFUND_URL?: string;
  REAL_MONEY_PRIVACY_URL?: string;
  /** Text shown under prices once the merchant decides the IVA policy (e.g. "Impuestos incluidos"). */
  REAL_MONEY_TAX_NOTE?: string;
}

interface EpaycoConfig {
  publicKey: string;
  privateKey: string;
  custId: string;
  pKey: string;
  responseUrl: string;
  confirmationUrl: string;
  testMode: boolean;
}

export const APIFY_BASE = 'https://apify.epayco.co';
export const VALIDATION_BASE = 'https://secure.epayco.co/validation/v1/reference';
export const PROVIDER = 'EPAYCO';
/** Checkout sessions per account per minute (webhooks are never limited). */
export const CHECKOUT_RATE = { sessions: 5, windowMs: 60_000 } as const;
/** One reconciliation lookup per order per window (status polling never hammers ePayco). */
export const RECONCILE_EVERY_MS = 30_000;
/**
 * Stale order policy. CREATED: the checkout never opened. PENDING without a provider reference:
 * ePayco never told us about any transaction. PENDING WITH a reference is never auto-expired
 * (cash/PSE can settle late): it is reconciled and flagged for review after STALE_REVIEW_MS.
 */
export const STALE = { createdMs: 60 * 60_000, pendingNoReferenceMs: 24 * 60 * 60_000, reviewMs: 72 * 60 * 60_000 } as const;
const HTTPS_URL = /^https:\/\/[^\s]+$/;
const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s]*$/;
const REF_PAYCO = /^[A-Za-z0-9]{6,64}$/;

/** Sandbox config, or null = real-money checkout unavailable (missing values or not test mode). */
export function epaycoConfig(env: EpaycoEnv): EpaycoConfig | null {
  if (env.EPAYCO_TEST_MODE !== 'true') return null; // phases 1–2: never anything but sandbox
  const c = {
    publicKey: env.EPAYCO_PUBLIC_KEY ?? '',
    privateKey: env.EPAYCO_PRIVATE_KEY ?? '',
    custId: env.EPAYCO_P_CUST_ID_CLIENTE ?? '',
    pKey: env.EPAYCO_P_KEY ?? '',
    responseUrl: env.EPAYCO_RESPONSE_URL ?? '',
    confirmationUrl: env.EPAYCO_CONFIRMATION_URL ?? '',
    testMode: true,
  };
  if (!c.publicKey || !c.privateKey || !c.custId || !c.pKey) return null;
  const urlOk = (u: string) => HTTPS_URL.test(u) || LOCAL_URL.test(u);
  if (!urlOk(c.responseUrl) || !HTTPS_URL.test(c.confirmationUrl)) return null;
  return c;
}

/** Public legal links + tax note (null = not published yet). */
export function storeLegal(env: EpaycoEnv) {
  const url = (u: string | undefined) => (u && HTTPS_URL.test(u) ? u : null);
  return {
    termsUrl: url(env.REAL_MONEY_TERMS_URL),
    refundUrl: url(env.REAL_MONEY_REFUND_URL),
    privacyUrl: url(env.REAL_MONEY_PRIVACY_URL),
    taxNote: env.REAL_MONEY_TAX_NOTE?.trim().slice(0, 80) || null,
  };
}

/**
 * What still blocks a production launch, from config alone (documentation/ops aid; it does NOT
 * enable anything: epaycoConfig still requires test mode). Account verification, final prices and
 * legal review are human checks in PRODUCTION-CHECKLIST.md.
 */
export function productionBlockers(env: EpaycoEnv): string[] {
  const legal = storeLegal(env);
  const out: string[] = [];
  if (env.EPAYCO_TEST_MODE === 'true') out.push('TEST_MODE_ON');
  for (const k of ['EPAYCO_PUBLIC_KEY', 'EPAYCO_PRIVATE_KEY', 'EPAYCO_P_CUST_ID_CLIENTE', 'EPAYCO_P_KEY'] as const) if (!env[k]) out.push(`MISSING_${k}`);
  if (!env.EPAYCO_RESPONSE_URL?.startsWith('https://')) out.push('RESPONSE_URL_NOT_HTTPS');
  if (!env.EPAYCO_CONFIRMATION_URL?.startsWith('https://')) out.push('CONFIRMATION_URL_NOT_HTTPS');
  if (!legal.termsUrl) out.push('TERMS_NOT_PUBLISHED');
  if (!legal.refundUrl) out.push('REFUND_POLICY_NOT_PUBLISHED');
  if (!legal.privacyUrl) out.push('PRIVACY_POLICY_NOT_PUBLISHED');
  if (!legal.taxNote) out.push('TAX_POLICY_UNDECIDED');
  return out;
}

// ── ePayco client ────────────────────────────────────────────────────────────────────────

export interface SessionRequest {
  invoice: string;
  orderId: string;
  pkg: CrystalPackage;
  responseUrl: string;
  confirmationUrl: string;
}
export interface EpaycoClient {
  /** Apify login + payment/session/create. Throws on any provider/network error. */
  createSession(config: Pick<EpaycoConfig, 'publicKey' | 'privateKey'>, req: SessionRequest): Promise<{ sessionId: string }>;
  /** ePayco's own record of a transaction (same x_* fields + x_signature as the webhook); null = unknown. */
  lookupReference?(refPayco: string): Promise<Record<string, string> | null>;
}

const TIMEOUT_MS = 10_000;

async function postJson(url: string, headers: Record<string, string>, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`ePayco HTTP ${res.status}`);
  return data;
}

/** The session body: every amount/currency/description value comes from the server catalog. */
export function sessionBody(req: SessionRequest) {
  return {
    checkout_version: '2',
    name: 'RPG-GO Tactics',
    description: req.pkg.displayName,
    currency: 'COP',
    amount: req.pkg.priceCOP,
    country: 'CO',
    lang: 'ES',
    invoice: req.invoice,
    response: req.responseUrl,
    confirmation: req.confirmationUrl,
    method: 'POST',
    // Non-secret correlation only (the invoice is the authoritative link). No tax fields until the
    // IVA policy exists (taxBase/tax are optional in the session API).
    extras: { extra1: req.orderId, extra2: req.pkg.id },
  };
}

/** Flattens a record to the string fields processConfirmation reads (x_* only, capped). */
export function confirmationFields(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (data && typeof data === 'object' && !Array.isArray(data))
    for (const [k, v] of Object.entries(data)) if (/^x_[a-z0-9_]{1,40}$/.test(k) && (typeof v === 'string' || typeof v === 'number')) out[k] = String(v).slice(0, FIELD_MAX);
  return out;
}

export const defaultEpaycoClient: EpaycoClient = {
  async createSession(config, req) {
    const basic = btoa(`${config.publicKey}:${config.privateKey}`);
    const login = (await postJson(`${APIFY_BASE}/login`, { Authorization: `Basic ${basic}` })) as { token?: unknown } | null;
    const token = typeof login?.token === 'string' ? login.token : '';
    if (!token) throw new Error('ePayco login without token');
    const created = (await postJson(`${APIFY_BASE}/payment/session/create`, { Authorization: `Bearer ${token}` }, sessionBody(req))) as {
      success?: unknown;
      data?: { sessionId?: unknown };
    } | null;
    const sessionId = created?.success === true && typeof created.data?.sessionId === 'string' ? created.data.sessionId : '';
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(sessionId)) throw new Error('ePayco session without id');
    return { sessionId };
  },
  async lookupReference(refPayco) {
    if (!REF_PAYCO.test(refPayco)) return null;
    const res = await fetch(`${VALIDATION_BASE}/${refPayco}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { success?: unknown; data?: unknown } | null;
    return body?.success === true ? confirmationFields(body.data) : null;
  },
};

// ── Signature ────────────────────────────────────────────────────────────────────────────

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(text: string) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** SHA256(p_cust_id_cliente^p_key^x_ref_payco^x_transaction_id^x_amount^x_currency_code), hex. Confirmed by the sandbox E2E. */
export async function epaycoSignature(custId: string, pKey: string, f: { x_ref_payco: string; x_transaction_id: string; x_amount: string; x_currency_code: string }) {
  return sha256Hex([custId, pKey, f.x_ref_payco, f.x_transaction_id, f.x_amount, f.x_currency_code].join('^'));
}

/** Constant-time comparison of two hex strings. */
export function safeEqual(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// ── Packages (D1) ────────────────────────────────────────────────────────────────────────

interface PackageRow {
  package_id: string;
  display_name: string;
  base_crystals: number;
  bonus_crystals: number;
  price_cop: number;
  active: number;
  sort_order: number;
}
const toPackage = (r: PackageRow): CrystalPackage => ({
  id: r.package_id,
  displayName: r.display_name,
  baseCrystals: r.base_crystals,
  bonusCrystals: r.bonus_crystals,
  crystals: r.base_crystals + r.bonus_crystals,
  priceCOP: r.price_cop,
  active: r.active === 1,
  sortOrder: r.sort_order,
});
const PACKAGE_COLUMNS = 'package_id, display_name, base_crystals, bonus_crystals, price_cop, active, sort_order';

export async function activePackages(db: D1Database): Promise<CrystalPackage[]> {
  const { results } = await db.prepare(`SELECT ${PACKAGE_COLUMNS} FROM tactics_crystal_packages WHERE active = 1 ORDER BY sort_order, package_id`).all<PackageRow>();
  return results.map(toPackage);
}
async function activePackage(db: D1Database, id: unknown): Promise<CrystalPackage | null> {
  if (typeof id !== 'string' || !PACKAGE_ID.test(id)) return null;
  const row = await db.prepare(`SELECT ${PACKAGE_COLUMNS} FROM tactics_crystal_packages WHERE package_id = ? AND active = 1`).bind(id).first<PackageRow>();
  return row ? toPackage(row) : null;
}
const packageView = (p: CrystalPackage) => ({
  id: p.id,
  displayName: p.displayName,
  baseCrystals: p.baseCrystals,
  bonusCrystals: p.bonusCrystals,
  crystals: p.crystals,
  priceCOP: p.priceCOP,
  sortOrder: p.sortOrder,
});

// ── Orders ───────────────────────────────────────────────────────────────────────────────

interface OrderRow {
  order_id: string;
  user_id: number;
  package_id: string;
  invoice: string;
  amount: number;
  currency: string;
  crystals: number;
  status: RealMoneyOrderStatus;
  test_mode: number;
  provider_reference: string | null;
  provider_transaction_id: string | null;
  provider_state: string | null;
  failure_reason: string | null;
  needs_review: number;
  created_at: number;
  updated_at: number;
  paid_at: number | null;
  fulfilled_at: number | null;
  refunded_at: number | null;
  last_reconciled_at: number | null;
}

const ORDER_COLUMNS =
  'order_id, user_id, package_id, invoice, amount, currency, crystals, status, test_mode, provider_reference, provider_transaction_id, provider_state, failure_reason, needs_review, created_at, updated_at, paid_at, fulfilled_at, refunded_at, last_reconciled_at';
const ORDER_ID = /^rmo_[0-9a-f-]{36}$/;

const orderBy = (db: D1Database, column: 'order_id' | 'invoice', value: string) =>
  db.prepare(`SELECT ${ORDER_COLUMNS} FROM tactics_real_money_orders WHERE ${column} = ?`).bind(value).first<OrderRow>();

/** What the owner may see: our ids and amounts only (no invoice, provider ids, states or payloads). */
const orderView = (o: OrderRow) => ({
  orderId: o.order_id,
  reference: orderReference(o.order_id),
  packageId: o.package_id,
  status: o.status,
  result: purchaseResult(o.status, o.provider_state),
  crystals: o.crystals,
  amount: o.amount,
  currency: o.currency,
  testMode: o.test_mode === 1,
  createdAt: o.created_at,
  paidAt: o.paid_at,
  fulfilledAt: o.fulfilled_at,
});

/**
 * Stale-order policy (see STALE). Applied lazily when the owner reads orders, and globally by
 * `server/scripts/payment-ops.mjs expire-stale`. Never deletes; a late APPROVED confirmation for an
 * EXPIRED order still fulfils it (the money was taken).
 */
export function expireStaleStatements(db: D1Database, now: number, userId: number | null): D1PreparedStatement[] {
  const scope = userId === null ? '' : ' AND user_id = ?';
  const binds = (...xs: unknown[]) => (userId === null ? xs : [...xs, userId]);
  const stale = `fulfilled_at IS NULL AND ((status = 'CREATED' AND created_at < ?) OR (status = 'PENDING' AND provider_reference IS NULL AND created_at < ?))${scope}`;
  return [
    db
      .prepare(
        `INSERT OR IGNORE INTO tactics_payment_events (provider, order_id, invoice, event_type, source, processed, signature_valid, outcome, created_at)
         SELECT provider, order_id, invoice, 'EXPIRED', 'POLICY', 1, 0, 'EXPIRED_STALE', ? FROM tactics_real_money_orders WHERE ${stale}`,
      )
      .bind(now, ...binds(now - STALE.createdMs, now - STALE.pendingNoReferenceMs)),
    db
      .prepare(`UPDATE tactics_real_money_orders SET status = 'EXPIRED', expired_at = ?, failure_reason = COALESCE(failure_reason, 'STALE'), updated_at = ? WHERE ${stale}`)
      .bind(now, now, ...binds(now - STALE.createdMs, now - STALE.pendingNoReferenceMs)),
    db
      .prepare(
        `UPDATE tactics_real_money_orders SET needs_review = 1, review_reason = COALESCE(review_reason, 'STALE_PENDING_WITH_REFERENCE'), updated_at = ?
         WHERE status = 'PENDING' AND provider_reference IS NOT NULL AND needs_review = 0 AND created_at < ?${scope}`,
      )
      .bind(now, ...binds(now - STALE.reviewMs)),
  ];
}

export interface RealMoneyDeps {
  now: number;
  newId(): string;
  epayco?: EpaycoClient;
}

/** Public: catalog (from D1), availability, legal links, tax note. Guests see it with a sign-in prompt. */
export async function realMoneyPublicRoute(request: Request, env: EpaycoEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path !== '/api/tactics/store/real-money/packages' || request.method !== 'GET') return null;
  if (env.REAL_MONEY_PURCHASES_ENABLED !== '1') return json({ available: false, packages: [], code: 'PAYMENTS_DISABLED' });
  const config = epaycoConfig(env);
  const packages = config ? await activePackages(env.DB) : [];
  return json({ available: config !== null && packages.length > 0, testMode: env.EPAYCO_TEST_MODE === 'true', packages: packages.map(packageView), legal: storeLegal(env) });
}

/** Authenticated real-money routes; null = not one of them. */
export async function realMoneyRoute(request: Request, env: EpaycoEnv, userId: number, deps: RealMoneyDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const db = env.DB;
  const { now } = deps;

  if (path === '/api/tactics/store/real-money/checkout') {
    if (request.method !== 'POST') return error(405, 'BAD_METHOD', 'Método no permitido.');
    if (env.REAL_MONEY_PURCHASES_ENABLED !== '1') return error(403, 'PAYMENTS_DISABLED', 'Operación no disponible.');
    const config = epaycoConfig(env);
    if (!config) return error(503, 'PAYMENTS_UNAVAILABLE', 'La compra de Cristales no está disponible.');
    let body: unknown;
    try {
      const text = await request.text();
      body = text.length <= 4096 && text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    // Only `packageId` is read. amount/currency/crystals/userId/invoice in the body are ignored.
    const pkg = await activePackage(db, (body as { packageId?: unknown } | null)?.packageId);
    if (!pkg) return error(400, 'UNKNOWN_PACKAGE', 'Ese paquete de Cristales no existe.');

    const recent = await db
      .prepare('SELECT COUNT(*) AS n FROM tactics_real_money_orders WHERE user_id = ? AND created_at > ?')
      .bind(userId, now - CHECKOUT_RATE.windowMs)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= CHECKOUT_RATE.sessions)
      return error(429, 'RATE_LIMITED', 'Demasiados intentos de compra. Espera un minuto.', { retryAfterMs: CHECKOUT_RATE.windowMs });

    const uuid = deps.newId();
    const orderId = `rmo_${uuid}`;
    const invoice = `RGT-${uuid.replace(/-/g, '').toUpperCase()}`;
    await db
      .prepare(
        `INSERT INTO tactics_real_money_orders (order_id, user_id, package_id, invoice, provider, test_mode, amount, gross_amount, tax_policy, currency, crystals, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNDECIDED', 'COP', ?, 'CREATED', ?, ?)`,
      )
      .bind(orderId, userId, pkg.id, invoice, PROVIDER, config.testMode ? 1 : 0, pkg.priceCOP, pkg.priceCOP, pkg.crystals, now, now)
      .run();

    let sessionId: string;
    try {
      ({ sessionId } = await (deps.epayco ?? defaultEpaycoClient).createSession(config, {
        invoice,
        orderId,
        pkg,
        responseUrl: `${config.responseUrl}${config.responseUrl.includes('?') ? '&' : '?'}order=${orderId}`,
        confirmationUrl: config.confirmationUrl,
      }));
    } catch {
      await db
        .prepare("UPDATE tactics_real_money_orders SET status = 'FAILED', failure_reason = 'SESSION_CREATE_FAILED', updated_at = ? WHERE order_id = ?")
        .bind(now, orderId)
        .run();
      return error(502, 'PAYMENT_PROVIDER_ERROR', 'No pudimos iniciar el pago. Intenta nuevamente.');
    }
    await db
      .prepare("UPDATE tactics_real_money_orders SET provider_session_id = ?, status = 'PENDING', updated_at = ? WHERE order_id = ? AND status = 'CREATED'")
      .bind(sessionId, now, orderId)
      .run();
    return json({ orderId, sessionId, testMode: config.testMode, package: packageView(pkg), amount: pkg.priceCOP, currency: 'COP' });
  }

  if (path === '/api/tactics/store/real-money/orders') {
    if (request.method !== 'GET') return error(405, 'BAD_METHOD', 'Método no permitido.');
    await db.batch(expireStaleStatements(db, now, userId));
    const { results } = await db
      .prepare(`SELECT ${ORDER_COLUMNS} FROM tactics_real_money_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`)
      .bind(userId)
      .all<OrderRow>();
    return json({ orders: results.map(orderView) });
  }

  const match = /^\/api\/tactics\/store\/real-money\/orders\/([^/]+)$/.exec(path);
  if (match) {
    if (request.method !== 'GET') return error(405, 'BAD_METHOD', 'Método no permitido.');
    const id = decodeURIComponent(match[1]!);
    let order = ORDER_ID.test(id) ? await orderBy(db, 'order_id', id) : null;
    // Another account's order is indistinguishable from a missing one.
    if (!order || order.user_id !== userId) return error(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.');
    await db.batch(expireStaleStatements(db, now, userId));
    // The ref_payco ePayco appended to the response URL may only be used to LOOK UP ePayco's own
    // signed record; processConfirmation then requires that record's invoice to be this order's.
    const hint = url.searchParams.get('ref_payco');
    await reconcileOrder(env, order, deps, hint && REF_PAYCO.test(hint) ? hint : null);
    order = (await orderBy(db, 'order_id', id)) ?? order;
    return json({ order: orderView(order), wallet: await walletView(db, userId) });
  }
  return null;
}

/**
 * Reconciliation: asks ePayco for its record of the order's transaction and runs it through the
 * same checks as the webhook. Throttled per order; only non-final orders; never trusts the caller.
 * Returns true when something was processed.
 */
export async function reconcileOrder(env: EpaycoEnv, order: OrderRow, deps: RealMoneyDeps, refHint: string | null = null): Promise<boolean> {
  const config = epaycoConfig(env);
  const client = deps.epayco ?? defaultEpaycoClient;
  if (!config || !client.lookupReference) return false;
  if (!['CREATED', 'PENDING', 'EXPIRED'].includes(order.status) || order.fulfilled_at !== null) return false;
  const ref = order.provider_reference ?? refHint;
  if (!ref) return false;
  if (order.last_reconciled_at !== null && deps.now - order.last_reconciled_at < RECONCILE_EVERY_MS) return false;
  await env.DB.prepare('UPDATE tactics_real_money_orders SET last_reconciled_at = ? WHERE order_id = ?').bind(deps.now, order.order_id).run();
  let fields: Record<string, string> | null;
  try {
    fields = await client.lookupReference(ref);
  } catch {
    fields = null;
  }
  if (!fields) return false;
  await processConfirmation(env, config, fields, 'RECONCILE', deps, order.order_id);
  return true;
}

// ── Confirmation processing (webhook + reconciliation) ──────────────────────────────────

const WEBHOOK_PATH = '/api/tactics/payments/epayco/confirmation';
const FIELD_MAX = 200;

/** Reads the fields ePayco sends (query string, form-urlencoded or JSON). Strings only, capped. */
async function webhookFields(request: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (typeof v === 'string' || typeof v === 'number') out[k] = String(v).slice(0, FIELD_MAX);
  };
  new URL(request.url).searchParams.forEach((v, k) => put(k, v));
  if (request.method === 'POST') {
    const text = (await request.text()).slice(0, 64 * 1024);
    const type = request.headers.get('Content-Type') ?? '';
    if (type.includes('application/json')) {
      try {
        const data: unknown = JSON.parse(text);
        if (data && typeof data === 'object' && !Array.isArray(data)) for (const [k, v] of Object.entries(data)) put(k, v);
      } catch {
        /* malformed: fields stay empty → rejected below */
      }
    } else new URLSearchParams(text).forEach((v, k) => put(k, v));
  }
  return out;
}

export type ConfirmationOutcome =
  | 'FULFILLED'
  | 'ALREADY_FULFILLED'
  | 'BAD_SIGNATURE'
  | 'MALFORMED'
  | 'ORDER_NOT_FOUND'
  | 'REFERENCE_MISMATCH'
  | 'CUSTOMER_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'ENVIRONMENT_MISMATCH'
  | 'TRANSACTION_CONFLICT'
  | 'STATE_PENDING'
  | 'STATE_FAILED'
  | 'STATE_EXPIRED'
  | 'STATE_CANCELLED'
  | 'REFUNDED'
  | 'DUPLICATE_REFUND'
  | 'STATE_UNKNOWN'
  | 'IGNORED_AFTER_FULFILMENT'
  | 'IGNORED_AFTER_REFUND'
  | 'NOT_CONFIGURED'
  | 'FULFILMENT_ERROR';

type Source = 'WEBHOOK' | 'RECONCILE';
const REQUIRED = ['x_ref_payco', 'x_transaction_id', 'x_amount', 'x_currency_code', 'x_signature', 'x_id_invoice'] as const;

/**
 * Verifies and applies one ePayco confirmation (webhook body or reconciliation record). Every call
 * writes ONE audit row (no PII, no signature, no keys). `expectOrderId` (reconciliation) requires
 * the record's invoice to belong to that order.
 */
export async function processConfirmation(
  env: EpaycoEnv,
  config: EpaycoConfig,
  f: Record<string, string>,
  source: Source,
  deps: { now: number; newId(): string },
  expectOrderId: string | null = null,
): Promise<{ status: number; outcome: ConfirmationOutcome }> {
  const db = env.DB;
  const { now } = deps;
  const stateCode = f.x_cod_transaction_state || f.x_cod_response || '';
  let order: OrderRow | null = null;
  let signatureValid = false;

  const event = (outcome: ConfirmationOutcome, eventType: string, processed: 0 | 1, detail: string | null = null) =>
    db
      .prepare(
        `INSERT INTO tactics_payment_events (provider, order_id, invoice, provider_reference, provider_transaction_id, state_code, response_text, response_reason, amount, currency, test_request, signature_valid, outcome, event_type, source, processed, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        PROVIDER,
        order?.order_id ?? null,
        f.x_id_invoice ?? null,
        f.x_ref_payco ?? null,
        f.x_transaction_id ?? null,
        stateCode || null,
        f.x_response ?? null,
        f.x_response_reason_text ?? null,
        f.x_amount ?? null,
        f.x_currency_code ?? null,
        f.x_test_request ?? null,
        signatureValid ? 1 : 0,
        outcome,
        eventType,
        source,
        processed,
        detail,
        now,
      );
  const done = async (outcome: ConfirmationOutcome, status = 200, eventType = 'CONFIRMATION') => {
    await event(outcome, eventType, 0).run();
    return { status, outcome };
  };

  if (REQUIRED.some((k) => !f[k])) return done('MALFORMED', 400);
  const expected = await epaycoSignature(config.custId, config.pKey, {
    x_ref_payco: f.x_ref_payco!,
    x_transaction_id: f.x_transaction_id!,
    x_amount: f.x_amount!,
    x_currency_code: f.x_currency_code!,
  });
  signatureValid = safeEqual(expected, f.x_signature!);
  if (!signatureValid) return done('BAD_SIGNATURE', 400);

  order = await orderBy(db, 'invoice', f.x_id_invoice!);
  if (!order) return done('ORDER_NOT_FOUND');
  if (expectOrderId && order.order_id !== expectOrderId) {
    order = null; // a reference that belongs to another order: touch nothing
    return done('REFERENCE_MISMATCH');
  }
  const review = async (reason: ConfirmationOutcome) => {
    await db
      .prepare('UPDATE tactics_real_money_orders SET needs_review = 1, failure_reason = ?, review_reason = ?, updated_at = ? WHERE order_id = ?')
      .bind(reason, reason, now, order!.order_id)
      .run();
    return done(reason);
  };
  if (f.x_cust_id_cliente && f.x_cust_id_cliente !== config.custId) return review('CUSTOMER_MISMATCH');
  // Environments never mix: a production transaction cannot pay a test order and vice versa.
  const testRequest = f.x_test_request ? f.x_test_request.toUpperCase() === 'TRUE' : null;
  if (testRequest !== null && testRequest !== (order.test_mode === 1)) return review('ENVIRONMENT_MISMATCH');
  if (f.x_currency_code !== order.currency) return review('CURRENCY_MISMATCH');
  if (parseCopAmount(f.x_amount) !== order.amount) return review('AMOUNT_MISMATCH');

  const outcome: EpaycoOutcome = epaycoOutcome(stateCode, f.x_response);
  const stateText = `${stateCode}${f.x_response ? ` ${f.x_response}` : ''}`.slice(0, 60) || null;

  if (outcome === 'REVERSED') return refund(order, stateText);

  if (order.fulfilled_at !== null) {
    if (outcome === 'APPROVED') return done('ALREADY_FULFILLED', 200, 'DUPLICATE');
    return done('IGNORED_AFTER_FULFILMENT');
  }

  if (outcome !== 'APPROVED') {
    const status: Partial<Record<EpaycoOutcome, RealMoneyOrderStatus>> = { PENDING: 'PENDING', FAILED: 'FAILED', EXPIRED: 'EXPIRED', CANCELLED: 'CANCELLED' };
    const next = status[outcome];
    await db
      .prepare(
        `UPDATE tactics_real_money_orders SET status = COALESCE(?, status), provider_state = ?, provider_reference = COALESCE(provider_reference, ?),
           failure_reason = CASE WHEN ? IN ('FAILED', 'EXPIRED', 'CANCELLED') THEN ? ELSE failure_reason END, updated_at = ?
         WHERE order_id = ? AND fulfilled_at IS NULL AND status NOT IN ('REFUNDED', 'DISPUTED')`,
      )
      .bind(next ?? null, stateText, f.x_ref_payco, next ?? '', f.x_response_reason_text?.slice(0, 120) ?? next ?? null, now, order.order_id)
      .run()
      .catch(() => undefined); // a reference already bound to another order: keep the state update out
    const map: Record<EpaycoOutcome, ConfirmationOutcome> = {
      APPROVED: 'FULFILLED',
      PENDING: 'STATE_PENDING',
      FAILED: 'STATE_FAILED',
      EXPIRED: 'STATE_EXPIRED',
      CANCELLED: 'STATE_CANCELLED',
      REVERSED: 'REFUNDED',
      UNKNOWN: 'STATE_UNKNOWN',
    };
    return done(map[outcome]);
  }
  if (order.status === 'REFUNDED' || order.status === 'DISPUTED') return review('IGNORED_AFTER_REFUND');

  // Approved, signed, right invoice/amount/currency/environment: credit once, atomically.
  const ledgerTxn = `txn_${deps.newId()}`;
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE tactics_real_money_orders SET status = 'FULFILLED', provider_reference = ?, provider_transaction_id = ?, provider_state = ?,
             failure_reason = NULL, expired_at = NULL, ledger_transaction_id = ?, paid_at = COALESCE(paid_at, ?), fulfilled_at = ?, updated_at = ?
           WHERE order_id = ?`,
        )
        .bind(f.x_ref_payco, f.x_transaction_id, stateText, ledgerTxn, now, now, now, order.order_id),
      ledgerStatement(db, {
        transactionId: ledgerTxn,
        userId: order.user_id,
        currencyId: PREMIUM_CURRENCY_ID,
        delta: order.crystals,
        reason: 'REAL_MONEY_PURCHASE',
        referenceId: `${PROVIDER}:${order.order_id}`,
        note: JSON.stringify({
          provider: PROVIDER,
          orderId: order.order_id,
          packageId: order.package_id,
          providerTransactionId: f.x_transaction_id,
          amount: order.amount,
          currency: order.currency,
          crystals: order.crystals,
        }),
        now,
      }),
      // Part of the same transaction: the unique (order, FULFILLED, processed) index is one more guard.
      event('FULFILLED', 'FULFILLED', 1),
    ]);
  } catch {
    // Rolled back. A concurrent duplicate already fulfilled it → idempotent success; a provider
    // transaction already bound to another order → review; anything else → 500 so ePayco retries.
    const fresh = await orderBy(db, 'order_id', order.order_id);
    if (fresh?.fulfilled_at !== null && fresh?.fulfilled_at !== undefined) return done('ALREADY_FULFILLED', 200, 'DUPLICATE');
    const taken = await db
      .prepare('SELECT order_id FROM tactics_real_money_orders WHERE provider = ? AND (provider_transaction_id = ? OR provider_reference = ?) AND order_id <> ?')
      .bind(PROVIDER, f.x_transaction_id, f.x_ref_payco, order.order_id)
      .first<{ order_id: string }>();
    if (taken) return review('TRANSACTION_CONFLICT');
    await event('FULFILMENT_ERROR', 'CONFIRMATION', 0).run().catch(() => undefined);
    return { status: 500, outcome: 'FULFILMENT_ERROR' };
  }
  return { status: 200, outcome: 'FULFILLED' };

  /**
   * ePayco reversal (state 6). Marks the order REFUNDED once (unique processed REFUNDED event);
   * a repeat is recorded as DUPLICATE_REFUND and changes nothing. Crystals are NOT debited
   * automatically (they may be spent; the ledger can never go below 0): fulfilled orders are
   * flagged for review and handled with the controlled reversal in payment-ops.mjs.
   */
  async function refund(o: OrderRow, state: string | null) {
    if (o.status === 'REFUNDED') return done('DUPLICATE_REFUND', 200, 'DUPLICATE');
    const granted = o.fulfilled_at !== null;
    try {
      await db.batch([
        event('REFUNDED', 'REFUNDED', 1, granted ? 'CRYSTALS_GRANTED_NOT_DEBITED' : 'NOTHING_GRANTED'),
        db
          .prepare(
            `UPDATE tactics_real_money_orders SET status = 'REFUNDED', refunded_at = ?, provider_state = ?, needs_review = ?,
               review_reason = CASE WHEN ? = 1 THEN 'REFUND_AFTER_FULFILMENT' ELSE review_reason END, updated_at = ?
             WHERE order_id = ?`,
          )
          .bind(now, state, granted ? 1 : o.needs_review, granted ? 1 : 0, now, o.order_id),
      ]);
    } catch {
      return done('DUPLICATE_REFUND', 200, 'DUPLICATE'); // a concurrent refund event won
    }
    return { status: 200, outcome: 'REFUNDED' as const };
  }
}

/** Public confirmation endpoint (no user session: trust comes from the signature + order checks). */
export async function epaycoWebhookRoute(request: Request, env: EpaycoEnv, deps: { now: number; newId(): string }): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path !== WEBHOOK_PATH) return null;
  if (request.method !== 'POST' && request.method !== 'GET') return error(405, 'BAD_METHOD', 'Método no permitido.');
  const f = await webhookFields(request);
  const config = epaycoConfig(env);
  if (!config) {
    await env.DB.prepare(
      "INSERT INTO tactics_payment_events (provider, signature_valid, outcome, event_type, source, processed, created_at) VALUES (?, 0, 'NOT_CONFIGURED', 'CONFIRMATION', 'WEBHOOK', 0, ?)",
    )
      .bind(PROVIDER, deps.now)
      .run();
    return json({ received: false, outcome: 'NOT_CONFIGURED' }, 503);
  }
  const { status, outcome } = await processConfirmation(env, config, f, 'WEBHOOK', deps);
  // 200 = received and handled (ePayco stops retrying); 400 = not a valid ePayco call; 500 = retry.
  return status === 500 ? error(500, 'SERVER_ERROR', 'Error interno.') : json({ received: status === 200, outcome }, status);
}
