import { PREMIUM_CURRENCY_ID } from '../../src/game';
import type { Env } from './db';
import { error, json } from './http';
import { ledgerStatement, walletView } from './store';

const ROOT = '/api/tactics/store/paypal';
const SANDBOX = 'https://api-m.sandbox.paypal.com';
const ORDERS = '/v2/checkout/orders';
const CREATE_RETRY_MS = 5 * 60 * 60 * 1000;
const packages = [
  { id: 'arcane_small', name: 'Bolsa Arcana', crystals: 350, usd: '4.99' },
  { id: 'arcane_medium', name: 'Cofre Arcano', crystals: 800, usd: '9.99' },
  { id: 'arcane_large', name: 'Tesoro Arcano', crystals: 1800, usd: '19.99' },
  { id: 'arcane_vault', name: 'Bóveda Arcana', crystals: 5000, usd: '49.99', bestValue: true },
] as const;

type Status = 'CREATED' | 'APPROVED' | 'PENDING' | 'DECLINED' | 'FULFILLED' | 'REVIEW';
type Order = {
  id: string; user_id: number; package_id: string; crystals: number; usd: string;
  paypal_order_id: string | null; checkout_url: string | null; capture_id: string | null;
  status: Status; created_at: number;
};
type Money = { currency_code?: string; value?: string };
type Capture = { id: string; amount?: Money; status?: string; final_capture?: boolean };
type PayPalOrder = {
  id: string; intent?: string; status?: string; links?: { rel: string; href: string }[];
  purchase_units?: { reference_id?: string; custom_id?: string; amount?: Money; payments?: { captures?: Capture[] } }[];
};
type Event = {
  id?: string; event_type?: string;
  resource?: { id?: string; supplementary_data?: { related_ids?: { order_id?: string; capture_id?: string } };
    disputed_transactions?: { seller_transaction_id?: string }[]; links?: { rel: string; href: string }[] };
};

function config(env: Env, request: Request) {
  if (env.PAYPAL_SANDBOX_ENABLED !== '1' || env.PAYPAL_ENVIRONMENT !== 'sandbox' || !env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET || !env.PAYPAL_WEBHOOK_ID || !env.PAYPAL_RETURN_ORIGIN) return null;
  let origin: URL;
  try { origin = new URL(env.PAYPAL_RETURN_ORIGIN); }
  catch { return null; }
  if (origin.href !== origin.origin + '/') return null;
  const hosts = [new URL(request.url).hostname, origin.hostname];
  if (hosts.some(host => /(^|\.)rpg-go-tactics\.com$|^rpggo-tactics(?:-api)?\./.test(host))) return null;
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) return null;
  return { client: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_CLIENT_SECRET, webhook: env.PAYPAL_WEBHOOK_ID, origin: origin.origin };
}

type Config = NonNullable<ReturnType<typeof config>>;

class PaymentDeclined extends Error {}

async function client(cfg: Config) {
  const auth = await fetch(SANDBOX + '/v1/oauth2/token', {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(cfg.client + ':' + cfg.secret), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials', signal: AbortSignal.timeout(8000),
  });
  if (!auth.ok) throw new Error('PayPal OAuth unavailable');
  const { access_token } = await auth.json() as { access_token?: string };
  if (!access_token) throw new Error('Missing PayPal access token');
  return async <T>(path: string, body?: unknown, operation?: string): Promise<T> => {
    const response = await fetch(SANDBOX + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json', Prefer: 'return=representation',
        ...(operation ? { 'PayPal-Request-Id': operation } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { details?: { issue?: string }[] } | null;
      if (response.status === 422 && payload?.details?.some(detail => detail.issue === 'INSTRUMENT_DECLINED' || detail.issue === 'PAYER_CANNOT_PAY')) {
        throw new PaymentDeclined();
      }
      throw new Error('PayPal API unavailable');
    }
    return await response.json() as T;
  };
}

const providerId = (id: unknown): id is string => typeof id === 'string' && /^[A-Z0-9]{8,32}$/.test(id);
const uuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const exact = (amount: Money | undefined, order: Order) => amount?.currency_code === 'USD' && amount.value === order.usd;
const orderPath = (id: string) => ORDERS + '/' + encodeURIComponent(id);
const view = (o: Order) => ({ id: o.id, packageId: o.package_id, crystals: o.crystals, usd: o.usd, status: o.status, createdAt: o.created_at, checkoutUrl: o.checkout_url });
const offline = () => error(503, 'PAYPAL_UNAVAILABLE', 'PayPal Sandbox no está disponible.');
const pending = () => error(502, 'PAYPAL_RETRY', 'No pudimos verificar el pago. Consulta el pedido antes de reintentar.');

function approvalUrl(order: PayPalOrder) {
  const link = order.links?.find(item => item.rel === 'payer-action' || item.rel === 'approve');
  if (!link) throw new Error('Missing approval link');
  const url = new URL(link.href);
  if (url.origin !== 'https://www.sandbox.paypal.com' || url.username || url.password || url.searchParams.get('token') !== order.id) throw new Error('Invalid approval link');
  return url.href;
}

function readOrder(env: Env, id: string, userId: number) {
  return env.DB.prepare('SELECT * FROM tactics_paypal_orders WHERE id=? AND user_id=?').bind(id, userId).first<Order>();
}

function captureOf(remote: PayPalOrder, local: Order) {
  const unit = remote.purchase_units?.[0];
  if (remote.id !== local.paypal_order_id || remote.intent !== 'CAPTURE' || remote.purchase_units?.length !== 1 || !unit ||
      unit.reference_id !== local.id || unit.custom_id !== local.id || !exact(unit.amount, local)) throw new Error('Order mismatch');
  const captures = unit.payments?.captures ?? [];
  const capture = captures[0];
  if (captures.length > 1 || (capture && (!providerId(capture.id) || !exact(capture.amount, local) ||
      (local.capture_id && local.capture_id !== capture.id)))) throw new Error('Capture mismatch');
  return capture;
}

async function reconcile(env: Env, local: Order, remote: PayPalOrder, now: number) {
  const capture = captureOf(remote, local);
  const db = env.DB;
  if (capture?.status === 'COMPLETED' && capture.final_capture === true && remote.status === 'COMPLETED') {
    const tx = 'paypal:' + local.id;
    await db.batch([
      db.prepare(`UPDATE tactics_paypal_orders SET capture_id=?, status='REVIEW'
        WHERE id=? AND EXISTS (SELECT 1 FROM tactics_paypal_events
          WHERE event_type IN (${adverseEvents.map(() => '?').join(',')})
          AND (paypal_order_id=? OR capture_id=?))`).bind(capture.id, local.id, ...adverseEvents, local.paypal_order_id, capture.id),
      db.prepare(`UPDATE tactics_paypal_orders SET capture_id=? WHERE id=? AND status NOT IN ('REVIEW','FULFILLED')`).bind(capture.id, local.id),
      ledgerStatement(db, {
        transactionId: tx, userId: local.user_id, currencyId: PREMIUM_CURRENCY_ID, delta: local.crystals,
        reason: 'REAL_MONEY_PURCHASE', referenceId: tx, note: capture.id, now,
      }, {
        sql: `EXISTS (SELECT 1 FROM tactics_paypal_orders
          WHERE id=? AND capture_id=? AND status NOT IN ('REVIEW','FULFILLED'))
          AND NOT EXISTS (SELECT 1 FROM tactics_wallet_ledger WHERE transaction_id=?)`,
        bindings: [local.id, capture.id, tx],
      }),
      db.prepare(`UPDATE tactics_paypal_orders SET status='FULFILLED' WHERE id=? AND status<>'REVIEW'
        AND EXISTS(SELECT 1 FROM tactics_wallet_ledger WHERE transaction_id=?)`).bind(local.id, tx),
    ]);
    return;
  }
  const status = capture?.status === 'PENDING' || capture?.status === 'COMPLETED' || (!capture && remote.status === 'COMPLETED') ? 'PENDING'
    : capture?.status === 'DECLINED' || capture?.status === 'FAILED' || remote.status === 'VOIDED' ? 'DECLINED'
    : capture?.status === 'REFUNDED' || capture?.status === 'PARTIALLY_REFUNDED' ? 'REVIEW'
    : remote.status === 'APPROVED' ? 'APPROVED' : 'CREATED';
  await db.prepare(`UPDATE tactics_paypal_orders SET status=?,capture_id=COALESCE(?,capture_id)
    WHERE id=? AND status NOT IN ('REVIEW','FULFILLED') AND (capture_id IS NULL OR capture_id=?)`)
    .bind(status, capture?.id ?? null, local.id, capture?.id ?? null).run();
}

export async function paypalRoute(request: Request, env: Env, userId: number, now: number): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(ROOT + '/')) return null;
  const cfg = config(env, request);
  if (!cfg) return offline();
  const db = env.DB;
  try {
    if (path === ROOT + '/orders' && request.method === 'GET') {
      const { results } = await db.prepare('SELECT * FROM tactics_paypal_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(userId).all<Order>();
      return json({ orders: results.map(view) });
    }
    if (path === ROOT + '/orders' && request.method === 'POST') {
      const params = await request.json().catch(() => null) as { packageId?: unknown } | null;
      const pkg = packages.find(item => item.id === params?.packageId);
      const operation = request.headers.get('Idempotency-Key') ?? '';
      if (!pkg || !uuid(operation) || !params || Object.keys(params).length !== 1) return error(400, 'BAD_PACKAGE', 'Paquete o intento inválido.');
      const id = crypto.randomUUID();
      await db.prepare(`INSERT INTO tactics_paypal_orders (id,user_id,operation_id,package_id,crystals,usd,created_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,operation_id) DO NOTHING`).bind(id, userId, operation, pkg.id, pkg.crystals, pkg.usd, now).run();
      const local = await db.prepare('SELECT * FROM tactics_paypal_orders WHERE user_id=? AND operation_id=?').bind(userId, operation).first<Order>();
      if (!local || local.package_id !== pkg.id) return error(409, 'ORDER_CONFLICT', 'Este intento corresponde a otro paquete.');
      if (local.checkout_url) return json({ order: view(local) });
      if (now - local.created_at >= CREATE_RETRY_MS) return error(409, 'ORDER_EXPIRED', 'El intento venció. Inicia otro pago.');
      const api = await client(cfg);
      const resultUrl = cfg.origin + '/play?paypal=';
      const remote = await api<PayPalOrder>(ORDERS, {
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: local.id, custom_id: local.id, amount: { currency_code: 'USD', value: local.usd } }],
        payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW',
          return_url: resultUrl + 'approved&order=' + local.id, cancel_url: resultUrl + 'cancelled&order=' + local.id } } },
      }, local.id);
      if (!providerId(remote.id)) throw new Error('Missing order ID');
      await db.prepare('UPDATE tactics_paypal_orders SET paypal_order_id=?, checkout_url=? WHERE id=? AND paypal_order_id IS NULL')
        .bind(remote.id, approvalUrl(remote), local.id).run();
      const saved = await readOrder(env, local.id, userId);
      if (!saved || saved.paypal_order_id !== remote.id) throw new Error('Conflicting order IDs');
      return json({ order: view(saved) });
    }
    const [, id, action] = path.slice(ROOT.length).match(/^\/orders\/([^/]+)(\/capture)?$/) ?? [];
    if (!id || !uuid(id) || request.method !== (action ? 'POST' : 'GET')) return error(404, 'NOT_FOUND', 'Pedido no encontrado.');
    const local = await readOrder(env, id, userId);
    if (!local) return error(404, 'NOT_FOUND', 'Pedido no encontrado.');
    if (local.paypal_order_id && !['FULFILLED', 'REVIEW', 'DECLINED'].includes(local.status)) {
      const api = await client(cfg);
      const remotePath = orderPath(local.paypal_order_id);
      let remote = await api<PayPalOrder>(remotePath);
      const capture = captureOf(remote, local);
      if (action && !capture && !local.capture_id && local.status !== 'PENDING' && remote.status === 'APPROVED') {
        try {
          await api(remotePath + '/capture', {}, 'c-' + local.id);
        } catch (failure) {
          remote = await api<PayPalOrder>(remotePath);
          if (!captureOf(remote, local)) {
            if (!(failure instanceof PaymentDeclined)) return pending();
            await db.prepare("UPDATE tactics_paypal_orders SET status='DECLINED' WHERE id=? AND capture_id IS NULL AND status IN ('CREATED','APPROVED')")
              .bind(local.id).run();
            return json({ order: view((await readOrder(env, id, userId)) ?? local) });
          }
        }
        remote = await api<PayPalOrder>(remotePath);
        if (!captureOf(remote, local)) return pending();
      }
      await reconcile(env, local, remote, now);
    }
    const updated = await readOrder(env, id, userId);
    if (!updated) return error(404, 'NOT_FOUND', 'Pedido no encontrado.');
    return json({ order: view(updated), ...(updated.status === 'FULFILLED' ? { wallet: await walletView(db, userId) } : {}) });
  } catch {
    return pending();
  }
}

const adverseEvents = [
  'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED',
  'CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED',
];
const captureEvents = new Set(['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED']);

export async function paypalPublicRoute(request: Request, env: Env, now: number): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== ROOT + '/catalog' && path !== ROOT + '/webhook') return null;
  const cfg = config(env, request);
  if (path.endsWith('/catalog') && request.method === 'GET') return json({ available: !!cfg, packages: cfg ? packages : [] });
  if (!cfg || request.method !== 'POST' || !path.endsWith('/webhook')) return offline();
  const signature = Object.fromEntries(['auth_algo', 'cert_url', 'transmission_id', 'transmission_sig', 'transmission_time']
    .map(key => [key, request.headers.get('paypal-' + key.replaceAll('_', '-'))]));
  if (Object.values(signature).some(value => !value)) return error(400, 'BAD_SIGNATURE', 'Firma requerida.');
  const raw = await request.text();
  if (raw.length > 131072) return error(413, 'BODY_TOO_LARGE', 'Evento demasiado grande.');
  let event: Event;
  try { event = JSON.parse(raw) as Event; }
  catch { return error(400, 'BAD_EVENT', 'Evento inválido.'); }
  if (!event?.id || !event.event_type) return error(400, 'BAD_EVENT', 'Evento inválido.');
  const db = env.DB;
  try {
    const api = await client(cfg);
    const verified = await api<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', {
      ...signature, webhook_id: cfg.webhook, webhook_event: event,
    });
    if (verified.verification_status !== 'SUCCESS') return error(400, 'BAD_SIGNATURE', 'Firma inválida.');
    const type = event.event_type;
    const resource = event.resource;
    const related = resource?.supplementary_data?.related_ids;
    const orderId = providerId(related?.order_id) ? related.order_id : null;
    const up = resource?.links?.find(link => link.rel === 'up')?.href;
    const linkedCapture = up?.match(/^https:\/\/api(?:-m)?\.sandbox\.paypal\.com\/v2\/payments\/captures\/([A-Z0-9]{8,32})$/)?.[1];
    if (adverseEvents.includes(type)) {
      const disputeIds = resource?.disputed_transactions?.map(item => item.seller_transaction_id).filter(providerId) ?? [];
      const relatedId = related?.capture_id ?? linkedCapture ?? (type.endsWith('.REVERSED') ? resource?.id : undefined);
      const captureIds = disputeIds.length ? disputeIds : [providerId(relatedId) ? relatedId : null];
      await db.batch(captureIds.flatMap((captureId, index) => [
        db.prepare(`INSERT INTO tactics_paypal_events (id,event_type,paypal_order_id,capture_id,resource_id,received_at)
          VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(index ? event.id + ':' + index : event.id, type, orderId, captureId, resource?.id ?? null, now),
        db.prepare("UPDATE tactics_paypal_orders SET status='REVIEW' WHERE paypal_order_id=? OR capture_id=?").bind(orderId, captureId),
      ]));
      return json({ received: true });
    }
    if (captureEvents.has(type)) {
      const captureId = providerId(resource?.id) ? resource.id : null;
      const local = await db.prepare('SELECT * FROM tactics_paypal_orders WHERE paypal_order_id=? OR capture_id=?')
        .bind(orderId, captureId).first<Order>();
      if (local?.paypal_order_id) {
        const remote = await api<PayPalOrder>(orderPath(local.paypal_order_id));
        if (!captureId || captureOf(remote, local)?.id !== captureId) return pending();
        await reconcile(env, local, remote, now);
      }
      await db.prepare(`INSERT INTO tactics_paypal_events (id,event_type,paypal_order_id,capture_id,resource_id,received_at)
        VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(event.id, type, orderId, captureId, resource?.id ?? null, now).run();
    }
    return json({ received: true });
  } catch {
    return pending();
  }
}
