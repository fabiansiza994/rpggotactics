/**
 * Real-money Cristales Arcanos (ePayco, COP). The package catalog is DATA in D1
 * (tactics_crystal_packages, migration 0018): prices, activation and order change there, never in
 * payment logic or the frontend. The client names a package id and nothing else.
 */

export interface CrystalPackage {
  id: string;
  displayName: string;
  baseCrystals: number;
  bonusCrystals: number;
  /** Credited amount = base + bonus. */
  crystals: number;
  /** Whole Colombian pesos (gross: what the player pays). */
  priceCOP: number;
  active: boolean;
  sortOrder: number;
}

export const PACKAGE_ID = /^crystals_[0-9a-z]{1,31}$/;

export const REAL_MONEY_ORDER_STATUSES = ['CREATED', 'PENDING', 'PAID', 'FULFILLED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'DISPUTED'] as const;
export type RealMoneyOrderStatus = (typeof REAL_MONEY_ORDER_STATUSES)[number];

/** Statuses after which the client stops polling. */
export const FINAL_ORDER_STATUSES: readonly RealMoneyOrderStatus[] = ['FULFILLED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'DISPUTED'];

/** What the player is told (result page / history). Derived from OUR order only, never from URL params. */
export type PurchaseResult = 'VERIFYING' | 'APPROVED' | 'PENDING' | 'REJECTED' | 'FAILED' | 'REVIEW';

/** `providerState` = the order's last ePayco state ("2 Rechazada"): 2 → REJECTED, other failures → FAILED. */
export function purchaseResult(status: RealMoneyOrderStatus | null, providerState?: string | null): PurchaseResult {
  switch (status) {
    case null:
    case 'CREATED':
      return 'VERIFYING';
    case 'PENDING':
    case 'PAID':
      return 'PENDING';
    case 'FULFILLED':
      return 'APPROVED';
    case 'FAILED':
      return (providerState ?? '').trim().startsWith('2') ? 'REJECTED' : 'FAILED';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'FAILED';
    case 'REFUNDED':
    case 'DISPUTED':
      return 'REVIEW';
  }
}

/** Short reference safe to show and to quote to support (part of OUR order id, no provider data). */
export const orderReference = (orderId: string): string => orderId.replace(/^rmo_/, '').replace(/-/g, '').slice(0, 10).toUpperCase();

/**
 * What an ePayco transaction state means for an order (docs.epayco.com "URL de confirmación",
 * x_cod_transaction_state): 1 Aceptada, 2 Rechazada, 3 Pendiente, 4 Fallida, 6 Reversada,
 * 7 Retenida, 8 Iniciada, 9 Caducada, 10 Abandonada, 11 Cancelada. Only 1 may deliver crystals.
 */
export type EpaycoOutcome = 'APPROVED' | 'PENDING' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'REVERSED' | 'UNKNOWN';

const STATE_CODE: Record<string, EpaycoOutcome> = {
  '1': 'APPROVED',
  '2': 'FAILED',
  '3': 'PENDING',
  '4': 'FAILED',
  '6': 'REVERSED',
  '7': 'PENDING',
  '8': 'PENDING',
  '9': 'EXPIRED',
  '10': 'CANCELLED',
  '11': 'CANCELLED',
};
const RESPONSE_TEXT: Record<string, EpaycoOutcome> = {
  ACEPTADA: 'APPROVED',
  RECHAZADA: 'FAILED',
  PENDIENTE: 'PENDING',
  FALLIDA: 'FAILED',
};

/** Numeric state code first; the x_response text only when no code was sent. */
export function epaycoOutcome(stateCode: string | null | undefined, responseText?: string | null): EpaycoOutcome {
  const code = (stateCode ?? '').trim();
  if (code) return STATE_CODE[code] ?? 'UNKNOWN';
  return RESPONSE_TEXT[(responseText ?? '').trim().toUpperCase()] ?? 'UNKNOWN';
}

/** Whole pesos from an ePayco amount string ("12345", "12345.00", "12345.0"); null otherwise. */
export function parseCopAmount(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, cents = ''] = value.trim().split('.');
  if (cents && Number(cents) !== 0) return null;
  return Number(whole);
}

export const formatCop = (amount: number): string => `$${amount.toLocaleString('es-CO')} COP`;
