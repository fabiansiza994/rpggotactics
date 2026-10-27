import type { PurchaseConsent } from '../../game/store/purchaseConsent';
import { FINAL_ORDER_STATUSES, type PurchaseResult, type RealMoneyOrderStatus } from '../../game/store/realMoney';
import { CLOUD_CONFIG } from '../cloud/config';
import { request, type CloudResult } from '../cloud/http';
import type { Wallet } from './api';

/**
 * Real-money Cristales client (server/src/epayco.ts). The client sends only a package id and
 * opens ePayco's hosted checkout; it never decides a price and never credits crystals — the wallet
 * changes only after ePayco's signed confirmation reaches the Worker.
 */

export interface CrystalPackageView {
  id: string;
  displayName: string;
  baseCrystals: number;
  bonusCrystals: number;
  crystals: number;
  priceCOP: number;
  sortOrder: number;
}
/** Published legal pages + tax note (null = not published yet: the UI shows a placeholder). */
export interface StoreLegal {
  termsUrl: string | null;
  refundUrl: string | null;
  privacyUrl: string | null;
  taxNote: string | null;
}
export interface RealMoneyCatalog {
  available: boolean;
  testMode: boolean;
  packages: CrystalPackageView[];
  legal: StoreLegal;
}
export interface CheckoutResponse {
  orderId: string;
  sessionId: string;
  testMode: boolean;
  package: CrystalPackageView;
  amount: number;
  currency: 'COP';
}
export interface OrderView {
  orderId: string;
  /** Short reference safe to show / quote to support. */
  reference: string;
  packageId: string;
  status: RealMoneyOrderStatus;
  result: PurchaseResult;
  crystals: number;
  amount: number;
  currency: string;
  testMode: boolean;
  createdAt: number;
  paidAt: number | null;
  fulfilledAt: number | null;
}
export interface OrderResponse {
  order: OrderView;
  wallet: Wallet;
}

export const realMoneyApi = {
  packages: () => request<RealMoneyCatalog>(CLOUD_CONFIG.apiUrl, '/api/tactics/store/real-money/packages', { timeoutMs: CLOUD_CONFIG.timeoutMs }),
  /** Package id and per-operation declaration; financial values remain server-authoritative. */
  checkout: (token: string, packageId: string, consent: PurchaseConsent) =>
    request<CheckoutResponse>(CLOUD_CONFIG.apiUrl, '/api/tactics/store/real-money/checkout', {
      method: 'POST',
      token,
      body: { packageId, consent },
      timeoutMs: CLOUD_CONFIG.timeoutMs,
    }),
  /**
   * `refPayco` (from ePayco's redirect) is only a LOOKUP hint: the server fetches ePayco's signed
   * record for it and accepts it only if it belongs to this order.
   */
  order: (token: string, orderId: string, refPayco?: string | null) =>
    request<OrderResponse>(
      CLOUD_CONFIG.apiUrl,
      `/api/tactics/store/real-money/orders/${encodeURIComponent(orderId)}${refPayco ? `?ref_payco=${encodeURIComponent(refPayco)}` : ''}`,
      { token, timeoutMs: CLOUD_CONFIG.timeoutMs },
    ),
  history: (token: string) => request<{ orders: OrderView[] }>(CLOUD_CONFIG.apiUrl, '/api/tactics/store/real-money/orders', { token, timeoutMs: CLOUD_CONFIG.timeoutMs }),
};

/** The order the player last opened a checkout for (the response page falls back to it). */
export const PENDING_ORDER_KEY = 'rpg-go-tactics:pending-crystal-order';
export function rememberPendingOrder(orderId: string | null): void {
  try {
    if (orderId) localStorage.setItem(PENDING_ORDER_KEY, orderId);
    else localStorage.removeItem(PENDING_ORDER_KEY);
  } catch {
    /* best effort */
  }
}
export function pendingOrder(): string | null {
  try {
    return localStorage.getItem(PENDING_ORDER_KEY);
  } catch {
    return null;
  }
}

export const isFinalStatus = (status: RealMoneyOrderStatus): boolean => FINAL_ORDER_STATUSES.includes(status);

/** Player-facing text for the server's purchase result (the ONLY input: never URL params or callbacks). */
export function resultText(result: PurchaseResult | null): { title: string; tone: 'wait' | 'good' | 'bad' } {
  switch (result) {
    case 'APPROVED':
      return { title: 'Pago aprobado. Tus Cristales ya están en tu cuenta.', tone: 'good' };
    case 'PENDING':
      return { title: 'Estamos verificando tu pago.', tone: 'wait' };
    case 'REJECTED':
      return { title: 'Pago rechazado por el medio de pago. No se acreditaron Cristales.', tone: 'bad' };
    case 'FAILED':
      return { title: 'El pago no se completó. No se acreditaron Cristales.', tone: 'bad' };
    case 'REVIEW':
      return { title: 'Este pago está en revisión. Si tienes dudas, repórtalo con la referencia.', tone: 'bad' };
    case 'VERIFYING':
    default:
      return { title: 'Estamos verificando tu pago…', tone: 'wait' };
  }
}

/** Short label for the purchase history list. */
export const RESULT_LABEL: Record<PurchaseResult, string> = {
  VERIFYING: 'Verificando',
  APPROVED: 'Aprobado',
  PENDING: 'Pendiente',
  REJECTED: 'Rechazado',
  FAILED: 'No completado',
  REVIEW: 'En revisión',
};

/**
 * Polls the order until it reaches a final status, `maxMs` passes or `stop()` is called. Reports
 * every successful read; network errors are retried silently (the webhook may arrive later).
 */
export function pollOrder(
  read: () => Promise<CloudResult<OrderResponse>>,
  onUpdate: (data: OrderResponse) => void,
  opts: { intervalMs?: number; maxMs?: number; onAuthError?: () => void; schedule?: (fn: () => void, ms: number) => unknown; cancel?: (handle: unknown) => void } = {},
): { stop(): void; done: Promise<OrderResponse | null> } {
  const interval = opts.intervalMs ?? 3000;
  const maxMs = opts.maxMs ?? 10 * 60_000;
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let stopped = false;
  let handle: unknown = null;
  let elapsed = 0;
  let finish!: (v: OrderResponse | null) => void;
  const done = new Promise<OrderResponse | null>((r) => (finish = r));
  let last: OrderResponse | null = null;
  const tick = async () => {
    if (stopped) return;
    const res = await read();
    if (stopped) return;
    if (res.ok) {
      last = res.data;
      onUpdate(res.data);
      if (isFinalStatus(res.data.order.status)) return end();
    } else if (res.error.kind === 'AUTH' || res.error.status === 404) {
      if (res.error.kind === 'AUTH') opts.onAuthError?.();
      return end();
    }
    elapsed += interval;
    if (elapsed >= maxMs) return end();
    handle = schedule(() => void tick(), interval);
  };
  const end = () => {
    stopped = true;
    if (handle !== null) cancel(handle);
    finish(last);
  };
  void tick();
  return { stop: end, done };
}
