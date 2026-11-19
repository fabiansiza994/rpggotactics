import { PREMIUM_CURRENCY_ID } from '../../src/game';
import type { Env } from './db';
import { error, json } from './http';
import { ledgerStatement, walletView } from './store';
import { sandboxConfig } from './paypalSandbox';
import { liveConfig, type PayPalConfig } from './paypalLive';
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
  purchase_units?: { reference_id?: string; custom_id?: string; amount?: Money; payee?: { merchant_id?: string }; payments?: { captures?: Capture[] } }[];
};
type Event = {
  id?: string; event_type?: string;
  resource?: { id?: string; supplementary_data?: { related_ids?: { order_id?: string; capture_id?: string } };
    disputed_transactions?: { seller_transaction_id?: string }[]; links?: { rel: string; href: string }[] };
};

type Config = PayPalConfig;

class PaymentDeclined extends Error {}

async function client(cfg: Config) {
  const auth = await fetch(cfg.apiOrigin + '/v1/oauth2/token', {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(cfg.client + ':' + cfg.secret), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials', signal: AbortSignal.timeout(8000),
  });
  if (!auth.ok) throw new Error('PayPal OAuth unavailable');
  const { access_token } = await auth.json() as { access_token?: string };
  if (!access_token) throw new Error('Missing PayPal access token');
  return async <T>(path: string, body?: unknown, operation?: string): Promise<T> => {
    const response = await fetch(cfg.apiOrigin + path, {
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
const offline = () => error(503, 'PAYPAL_UNAVAILABLE', 'Los pagos PayPal no están disponibles.');
const pending = () => error(502, 'PAYPAL_RETRY', 'No pudimos verificar el pago. Consulta el pedido antes de reintentar.');

function approvalUrl(order: PayPalOrder, cfg: Config) {
  const link = order.links?.find(item => item.rel === 'payer-action' || item.rel === 'approve');
  if (!link) throw new Error('Missing approval link');
  const url = new URL(link.href);
  if (url.origin !== cfg.approvalOrigin || url.username || url.password || url.searchParams.get('token') !== order.id) throw new Error('Invalid approval link');
  return url.href;
}

function readOrder(env: Env, id: string, userId: number, cfg: Config) {
  return env.DB.prepare(`SELECT * FROM ${cfg.orders} WHERE id=? AND user_id=?`).bind(id, userId).first<Order>();
}

function captureOf(remote: PayPalOrder, local: Order, cfg: Config) {
  const unit = remote.purchase_units?.[0];
  if (remote.id !== local.paypal_order_id || remote.intent !== 'CAPTURE' || remote.purchase_units?.length !== 1 || !unit ||
      (cfg.merchant && unit.payee?.merchant_id !== cfg.merchant) || unit.reference_id !== local.id || unit.custom_id !== local.id || !exact(unit.amount, local)) throw new Error('Order mismatch');
  const captures = unit.payments?.captures ?? [];
  const capture = captures[0];
  if (captures.length > 1 || (capture && (!providerId(capture.id) || !exact(capture.amount, local) ||
      (local.capture_id && local.capture_id !== capture.id)))) throw new Error('Capture mismatch');
  return capture;
}

async function reconcile(env: Env, local: Order, remote: PayPalOrder, now: number, cfg: Config) {
  const capture = captureOf(remote, local, cfg);
  const db = env.DB;
  if (capture?.status === 'COMPLETED' && capture.final_capture === true && remote.status === 'COMPLETED') {
    const tx = cfg.ledgerPrefix + local.id;
    await db.batch([
      db.prepare(`UPDATE ${cfg.orders} SET capture_id=?, status='REVIEW'
        WHERE id=? AND EXISTS (SELECT 1 FROM ${cfg.events}
          WHERE event_type IN (${adverseEvents.map(() => '?').join(',')})
          AND (paypal_order_id=? OR capture_id=?))`).bind(capture.id, local.id, ...adverseEvents, local.paypal_order_id, capture.id),
      db.prepare(`UPDATE ${cfg.orders} SET capture_id=? WHERE id=? AND status NOT IN ('REVIEW','FULFILLED')`).bind(capture.id, local.id),
      ledgerStatement(db, {
        transactionId: tx, userId: local.user_id, currencyId: PREMIUM_CURRENCY_ID, delta: local.crystals,
        reason: 'REAL_MONEY_PURCHASE', referenceId: tx, note: capture.id, now,
      }, {
        sql: `EXISTS (SELECT 1 FROM ${cfg.orders}
          WHERE id=? AND capture_id=? AND status NOT IN ('REVIEW','FULFILLED'))
          AND NOT EXISTS (SELECT 1 FROM tactics_wallet_ledger WHERE transaction_id=?)`,
        bindings: [local.id, capture.id, tx],
      }),
      db.prepare(`UPDATE ${cfg.orders} SET status='FULFILLED' WHERE id=? AND status<>'REVIEW'
        AND EXISTS(SELECT 1 FROM tactics_wallet_ledger WHERE transaction_id=?)`).bind(local.id, tx),
    ]);
    return;
  }
  const status = capture?.status === 'PENDING' || capture?.status === 'COMPLETED' || (!capture && remote.status === 'COMPLETED') ? 'PENDING'
    : capture?.status === 'DECLINED' || capture?.status === 'FAILED' || remote.status === 'VOIDED' ? 'DECLINED'
    : capture?.status === 'REFUNDED' || capture?.status === 'PARTIALLY_REFUNDED' ? 'REVIEW'
    : remote.status === 'APPROVED' ? 'APPROVED' : 'CREATED';
  await db.prepare(`UPDATE ${cfg.orders} SET status=?,capture_id=COALESCE(?,capture_id)
    WHERE id=? AND status NOT IN ('REVIEW','FULFILLED') AND (capture_id IS NULL OR capture_id=?)`)
    .bind(status, capture?.id ?? null, local.id, capture?.id ?? null).run();
}

export async function paypalRoute(request: Request, env: Env, userId: number, now: number): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const live = path.startsWith('/api/tactics/store/paypal/live/');
  const ROOT = live ? '/api/tactics/store/paypal/live' : '/api/tactics/store/paypal';
  const cfg = live ? liveConfig(env, request) : sandboxConfig(env, request);
  if (!path.startsWith(ROOT + '/')) return null;
  if (!cfg) return offline();
  if (live && (env.REAL_MONEY_PURCHASES_ENABLED !== '1' || env.PAYPAL_LIVE_CHECKOUT_ENABLED !== '1') && request.method === 'POST') return offline();
  const db = env.DB;
  try {
    if (path === ROOT + '/orders' && request.method === 'GET') {
      const { results } = await db.prepare(`SELECT * FROM ${cfg.orders} WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).bind(userId).all<Order>();
      return json({ orders: results.map(view) });
    }
    if (path === ROOT + '/orders' && request.method === 'POST') {
      const params = await request.json().catch(() => null) as { packageId?: unknown } | null;
      const pkg = packages.find(item => item.id === params?.packageId);
      const operation = request.headers.get('Idempotency-Key') ?? '';
      if (!pkg || !uuid(operation) || !params || Object.keys(params).length !== 1) return error(400, 'BAD_PACKAGE', 'Paquete o intento inválido.');
      const id = crypto.randomUUID();
      await db.prepare(`INSERT INTO ${cfg.orders} (id,user_id,operation_id,package_id,crystals,usd,created_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,operation_id) DO NOTHING`).bind(id, userId, operation, pkg.id, pkg.crystals, pkg.usd, now).run();
      const local = await db.prepare(`SELECT * FROM ${cfg.orders} WHERE user_id=? AND operation_id=?`).bind(userId, operation).first<Order>();
      if (!local || local.package_id !== pkg.id) return error(409, 'ORDER_CONFLICT', 'Este intento corresponde a otro paquete.');
      if (local.checkout_url) return json({ order: view(local) });
      if (now - local.created_at >= CREATE_RETRY_MS) return error(409, 'ORDER_EXPIRED', 'El intento venció. Inicia otro pago.');
      const api = await client(cfg);
      const resultUrl = cfg.origin + '/play?paypal=';
      const remote = await api<PayPalOrder>(ORDERS, {
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: local.id, custom_id: local.id, amount: { currency_code: 'USD', value: local.usd }, ...(cfg.merchant ? { payee: { merchant_id: cfg.merchant } } : {}) }],
        payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW',
          return_url: resultUrl + 'approved&order=' + local.id, cancel_url: resultUrl + 'cancelled&order=' + local.id } } },
      }, local.id);
      if (!providerId(remote.id)) throw new Error('Missing order ID');
      await db.prepare(`UPDATE ${cfg.orders} SET paypal_order_id=?, checkout_url=? WHERE id=? AND paypal_order_id IS NULL`)
        .bind(remote.id, approvalUrl(remote, cfg), local.id).run();
      const saved = await readOrder(env, local.id, userId, cfg);
      if (!saved || saved.paypal_order_id !== remote.id) throw new Error('Conflicting order IDs');
      return json({ order: view(saved) });
    }
    const [, id, action] = path.slice(ROOT.length).match(/^\/orders\/([^/]+)(\/capture)?$/) ?? [];
    if (!id || !uuid(id) || request.method !== (action ? 'POST' : 'GET')) return error(404, 'NOT_FOUND', 'Pedido no encontrado.');
    const local = await readOrder(env, id, userId, cfg);
    if (!local) return error(404, 'NOT_FOUND', 'Pedido no encontrado.');
    if (local.paypal_order_id && !['FULFILLED', 'REVIEW', 'DECLINED'].includes(local.status)) {
      const api = await client(cfg);
      const remotePath = orderPath(local.paypal_order_id);
      let remote = await api<PayPalOrder>(remotePath);
      const capture = captureOf(remote, local, cfg);
      if (action && !capture && !local.capture_id && local.status !== 'PENDING' && remote.status === 'APPROVED') {
        try {
          await api(remotePath + '/capture', {}, 'c-' + local.id);
        } catch (failure) {
          remote = await api<PayPalOrder>(remotePath);
          if (!captureOf(remote, local, cfg)) {
            if (!(failure instanceof PaymentDeclined)) return pending();
            await db.prepare(`UPDATE ${cfg.orders} SET status='DECLINED' WHERE id=? AND capture_id IS NULL AND status IN ('CREATED','APPROVED')`)
              .bind(local.id).run();
            return json({ order: view((await readOrder(env, id, userId, cfg)) ?? local) });
          }
        }
        remote = await api<PayPalOrder>(remotePath);
        if (!captureOf(remote, local, cfg)) return pending();
      }
      await reconcile(env, local, remote, now, cfg);
    }
    const updated = await readOrder(env, id, userId, cfg);
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
  const live = path.startsWith('/api/tactics/store/paypal/live/');
  const ROOT = live ? '/api/tactics/store/paypal/live' : '/api/tactics/store/paypal';
  const cfg = live ? liveConfig(env, request) : sandboxConfig(env, request);
  if (path !== ROOT + '/catalog' && path !== ROOT + '/webhook') return null;
  if (path.endsWith('/catalog') && request.method === 'GET') return json({ available: !!cfg && (!live || (env.REAL_MONEY_PURCHASES_ENABLED === '1' && env.PAYPAL_LIVE_CHECKOUT_ENABLED === '1')), packages: cfg && (!live || (env.REAL_MONEY_PURCHASES_ENABLED === '1' && env.PAYPAL_LIVE_CHECKOUT_ENABLED === '1')) ? packages : [] });
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
    const linkedCapture = captureLink(up, cfg);
    if (adverseEvents.includes(type)) {
      const disputeIds = resource?.disputed_transactions?.map(item => item.seller_transaction_id).filter(providerId) ?? [];
      const relatedId = related?.capture_id ?? linkedCapture ?? (type.endsWith('.REVERSED') ? resource?.id : undefined);
      const captureIds = disputeIds.length ? disputeIds : [providerId(relatedId) ? relatedId : null];
      await db.batch(captureIds.flatMap((captureId, index) => [
        db.prepare(`INSERT INTO ${cfg.events} (id,event_type,paypal_order_id,capture_id,resource_id,received_at)
          VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(index ? event.id + ':' + index : event.id, type, orderId, captureId, resource?.id ?? null, now),
        db.prepare(`UPDATE ${cfg.orders} SET status='REVIEW' WHERE paypal_order_id=? OR capture_id=?`).bind(orderId, captureId),
      ]));
      return json({ received: true });
    }
    if (captureEvents.has(type)) {
      const captureId = providerId(resource?.id) ? resource.id : null;
      const local = await db.prepare(`SELECT * FROM ${cfg.orders} WHERE paypal_order_id=? OR capture_id=?`)
        .bind(orderId, captureId).first<Order>();
      if (local?.paypal_order_id) {
        const remote = await api<PayPalOrder>(orderPath(local.paypal_order_id));
        if (!captureId || captureOf(remote, local, cfg)?.id !== captureId) return pending();
        await reconcile(env, local, remote, now, cfg);
      }
      await db.prepare(`INSERT INTO ${cfg.events} (id,event_type,paypal_order_id,capture_id,resource_id,received_at)
        VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(event.id, type, orderId, captureId, resource?.id ?? null, now).run();
    }
    return json({ received: true });
  } catch {
    return pending();
  }
}

function captureLink(link: string | undefined, cfg: Config) {
  if (!link) return undefined;
  try { const url = new URL(link); if (!(url.origin === cfg.apiOrigin || (cfg.ledgerPrefix === 'paypal:' && url.origin === 'https://api.sandbox.paypal.com')) || url.search || url.hash || url.username || url.password) return undefined; return url.pathname.match(/^\/v2\/payments\/captures\/([A-Z0-9]{8,32})$/)?.[1]; } catch { return undefined; }
}

/** Bounded, GET-only provider reconciliation. No capture/create calls or automatic debits. */
export async function reconcileLiveOrders(env: Env, now = Date.now()) {
  const summary = { enabled: false, checked: 0, failed: 0, review: 0 };
  if (env.PAYPAL_LIVE_RECONCILIATION_ENABLED !== '1') return summary;
  const cfg = liveConfig(env, new Request('https://rpggo-tactics-api.fabiansiza994.workers.dev/'));
  if (!cfg) return summary;
  summary.enabled = true;
  const { results } = await env.DB.prepare(`SELECT * FROM ${cfg.orders}
    WHERE status <> 'REVIEW' AND next_check_at <= ? ORDER BY next_check_at,created_at,id LIMIT 10`).bind(now).all<Order & {reconcile_attempts: number}>();
  for (const local of results) {
    try {
      if (!local.paypal_order_id) {
        // A lost create response cannot be guessed or replaced with a second order.
        if (now - local.created_at >= 120000) {
          await env.DB.prepare(`UPDATE ${cfg.orders} SET status='REVIEW',review_reason='CREATE_UNLINKED',last_checked_at=? WHERE id=? AND paypal_order_id IS NULL`).bind(now,local.id).run();
          summary.review++;
        } else await env.DB.prepare(`UPDATE ${cfg.orders} SET next_check_at=? WHERE id=?`).bind(now+60000,local.id).run();
        continue;
      }
      const api = await client(cfg);
      const remote = await api<PayPalOrder>(orderPath(local.paypal_order_id));
      const capture = captureOf(remote,local,cfg);
      const ledger = await env.DB.prepare('SELECT user_id,currency_id,amount_delta,reason,reference_id FROM tactics_wallet_ledger WHERE transaction_id=?').bind(cfg.ledgerPrefix+local.id).first<{user_id:number;currency_id:string;amount_delta:number;reason:string;reference_id:string}>();
      const validLedger = !ledger || (ledger.user_id===local.user_id && ledger.currency_id===PREMIUM_CURRENCY_ID && ledger.amount_delta===local.crystals && ledger.reason==='REAL_MONEY_PURCHASE' && ledger.reference_id===cfg.ledgerPrefix+local.id);
      if (!validLedger || (local.status==='FULFILLED' && !ledger) || (ledger && (remote.status!=='COMPLETED' || capture?.status!=='COMPLETED' || capture.final_capture!==true))) {
        await env.DB.prepare(`UPDATE ${cfg.orders} SET status='REVIEW',review_reason='LEDGER_PROVIDER_MISMATCH',last_checked_at=? WHERE id=?`).bind(now,local.id).run();
        summary.review++;
      } else await reconcile(env,local,remote,now,cfg);
      await env.DB.prepare(`UPDATE ${cfg.orders} SET next_check_at=?,last_checked_at=?,reconcile_attempts=0 WHERE id=?`).bind(now+(remote.status==='COMPLETED'?86400000:60000),now,local.id).run();
      summary.checked++;
    } catch {
      const attempts=local.reconcile_attempts+1;
      await env.DB.prepare(`UPDATE ${cfg.orders} SET reconcile_attempts=reconcile_attempts+1,next_check_at=?,last_checked_at=? WHERE id=?`).bind(now+Math.min(3600000,60000*2**Math.min(attempts,6)),now,local.id).run();
      summary.failed++;
    }
  }
  // Counts only: no secrets, customer data or provider payloads in logs.
  const counts=await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${cfg.orders} WHERE status='REVIEW'`).first<{n:number}>();
  summary.review=counts?.n??summary.review;
  return summary;
}

/** Operator counts only; no public admin endpoint or financial action. */
export async function liveOperationalReport(env: Env) {
  const review = await env.DB.prepare("SELECT COUNT(*) AS n FROM tactics_paypal_live_orders WHERE status='REVIEW'").first<{n:number}>();
  const retries = await env.DB.prepare("SELECT COUNT(*) AS n FROM tactics_paypal_live_orders WHERE reconcile_attempts >= 3 AND status <> 'REVIEW'").first<{n:number}>();
  const unlinked = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tactics_paypal_live_events e WHERE NOT EXISTS (
    SELECT 1 FROM tactics_paypal_live_orders o WHERE o.paypal_order_id=e.paypal_order_id OR o.capture_id=e.capture_id)`).first<{n:number}>();
  return { review: review?.n??0, retryAttention: retries?.n??0, unlinkedEvents: unlinked?.n??0 };
}
