import {
  CURRENCY_PACKAGES,
  PAYMENT_PROVIDERS,
  packageTotal,
  type CurrencyPackage,
  type PaymentProvider,
} from '../../src/game';

/**
 * Real-money boundary — Phase 4C: MODEL ONLY. Nothing here is wired to a route, no provider SDK
 * is installed and no secret exists. It fixes the one canonical flow every provider must use:
 *
 *   provider receipt / webhook ──► PaymentReceiptVerifier.verify (server-side, provider API +
 *   signature) ──► decideCredit (known SKU, PURCHASED, right environment) ──► one D1 batch:
 *   payment record + PURCHASE_CURRENCY ledger row (reference = paymentReference) ──► wallet
 *   (ledger trigger).
 *
 * A client "success" callback never credits anything: it may only ask the server to look up a
 * receipt. Dedupe is the ledger's UNIQUE (user, currency, reason, reference_id) plus the payment
 * record's UNIQUE (provider, provider_transaction_id). See qa/store-phase4c/PAYMENTS.md.
 */

/** What a provider-specific verifier returns after checking the receipt WITH the provider. */
export interface VerifiedReceipt {
  provider: PaymentProvider;
  /** Provider transaction id (Stripe Checkout Session/PaymentIntent, Apple transactionId, Google orderId). */
  transactionId: string;
  /** Provider product id (matched against CurrencyPackage.platformSkus). */
  productId: string;
  status: 'PURCHASED' | 'PENDING' | 'REFUNDED' | 'REVOKED';
  environment: 'SANDBOX' | 'PRODUCTION';
  /** Our account reference the purchase was started for (never trusted from the client alone). */
  accountRef: string;
  purchasedAt: number;
}

export type ReceiptRejection = { rejected: 'BAD_SIGNATURE' | 'MALFORMED' | 'PROVIDER_ERROR' | 'NOT_FOUND' };

/**
 * One implementation per provider (WEB e.g. Stripe webhooks, APPLE App Store Server API,
 * GOOGLE Play Developer API), added in a later phase together with its secrets.
 */
export interface PaymentReceiptVerifier {
  readonly provider: PaymentProvider;
  verify(payload: unknown): Promise<VerifiedReceipt | ReceiptRejection>;
}

const TRANSACTION_ID = /^[A-Za-z0-9._:-]{6,128}$/;

/**
 * Ledger reference of a currency purchase. Namespaced by provider, so two providers can never
 * collide on one id, and stable, so a replayed webhook maps to the SAME ledger row.
 */
export const paymentReference = (provider: PaymentProvider, transactionId: string): string => `${provider}:${transactionId}`;

/** The package a provider product id sells, or null (unknown / not listed on that provider). */
export function packageForProduct(
  provider: PaymentProvider,
  productId: string,
  packages: readonly CurrencyPackage[] = CURRENCY_PACKAGES,
): CurrencyPackage | null {
  if (!productId) return null;
  return packages.find((p) => p.platformSkus[provider] === productId) ?? null;
}

export const packageBySku = (internalSku: string, packages: readonly CurrencyPackage[] = CURRENCY_PACKAGES): CurrencyPackage | null =>
  packages.find((p) => p.internalSku === internalSku) ?? null;

export type CreditDecision =
  | { ok: true; credit: { internalSku: string; currencyId: string; amount: number; referenceId: string } }
  | { ok: false; code: 'UNKNOWN_PROVIDER' | 'BAD_TRANSACTION_ID' | 'UNKNOWN_PRODUCT' | 'NOT_PURCHASED' | 'WRONG_ENVIRONMENT' };

/**
 * Whether a VERIFIED receipt may credit currency, and how much. Pure: the caller still writes
 * the ledger row, whose unique reference makes a second credit for the same transaction fail.
 */
export function decideCredit(
  receipt: VerifiedReceipt,
  expectedEnvironment: VerifiedReceipt['environment'],
  packages: readonly CurrencyPackage[] = CURRENCY_PACKAGES,
): CreditDecision {
  if (!PAYMENT_PROVIDERS.includes(receipt.provider)) return { ok: false, code: 'UNKNOWN_PROVIDER' };
  if (!TRANSACTION_ID.test(receipt.transactionId)) return { ok: false, code: 'BAD_TRANSACTION_ID' };
  if (receipt.environment !== expectedEnvironment) return { ok: false, code: 'WRONG_ENVIRONMENT' };
  if (receipt.status !== 'PURCHASED') return { ok: false, code: 'NOT_PURCHASED' };
  const pkg = packageForProduct(receipt.provider, receipt.productId, packages);
  if (!pkg) return { ok: false, code: 'UNKNOWN_PRODUCT' };
  return {
    ok: true,
    credit: {
      internalSku: pkg.internalSku,
      currencyId: pkg.currencyId,
      amount: packageTotal(pkg),
      referenceId: paymentReference(receipt.provider, receipt.transactionId),
    },
  };
}
