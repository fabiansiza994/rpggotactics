/** Not an identity check. Draft version is usable only while the provider is sandbox-only. */
export const PURCHASE_CONSENT_VERSION = 'purchase-18plus-draft-2026-10-16';
export const AGE_DECLARATION = 'Declaro que tengo 18 años o más y que estoy autorizado para realizar esta compra.';
export interface PurchaseConsent {
  adult: true;
  termsAccepted: true;
  version: typeof PURCHASE_CONSENT_VERSION;
  operationId: string;
}
export function validPurchaseConsent(value: unknown): value is PurchaseConsent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return v.adult === true && v.termsAccepted === true && v.version === PURCHASE_CONSENT_VERSION && typeof v.operationId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v.operationId);
}
