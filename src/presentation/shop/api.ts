import type { OfferView, PurchasePlan, CurrencyDef, StoreCategoryId } from '../../game/store/store';
import type { PromoResult } from '../../game/store/promo';
import type { CloudState } from '../cloud/api';
import { CLOUD_CONFIG } from '../cloud/config';
import { request } from '../cloud/http';
export interface Wallet {
  currencyId: string;
  name: string;
  balance: number;
}
/** Price/contents are the server's quote for this player (a partly-owned bundle is prorated). */
export type CatalogOffer = OfferView;
export interface Cosmetics {
  owned: { cosmeticId: string; kind: string; acquiredAt: number }[];
  /** slot → equipped cosmetic id (null = nothing equipped). */
  equipped: Record<string, string | null>;
}
export interface Catalog {
  serverTime: number;
  currencies: CurrencyDef[];
  categories: { id: StoreCategoryId; label: string }[];
  offers: CatalogOffer[];
  wallet: Wallet;
  cosmetics: Cosmetics;
}
export interface PurchaseResponse extends CloudState {
  wallet: Wallet;
  purchase: { purchaseId: string; offerId: string; price: number; granted: PurchasePlan };
  replayed: boolean;
}
/** One granted line, described by the server ("Invocar Dragón de Guerra x1", "300 Cristales Arcanos"). */
export interface PromoRewardLine {
  kind: 'CURRENCY' | 'CARD' | 'COSMETIC';
  id: string;
  label: string;
  amount: number;
}
/** Successful redemption: the fresh player state (collection), the wallet and what was granted. */
export interface PromoRedeemResponse extends CloudState {
  success: true;
  result: 'SUCCESS';
  code: string;
  reward: { items: PromoRewardLine[] };
  wallet: Wallet;
}
/** Failure details: `error.code` is one of PROMO_RESULTS (ALREADY_REDEEMED also carries `reward`). */
export type PromoFailure = Exclude<PromoResult, 'SUCCESS'>;
export const storeApi = {
  catalog: (token: string) =>
    request<Catalog>(CLOUD_CONFIG.apiUrl, '/api/tactics/store/catalog', {
      token,
      timeoutMs: CLOUD_CONFIG.timeoutMs,
    }),
  purchase: (token: string, offerId: string, idempotencyKey: string) =>
    request<PurchaseResponse>(CLOUD_CONFIG.apiUrl, '/api/tactics/store/purchase', {
      method: 'POST',
      token,
      body: { offerId, idempotencyKey },
      timeoutMs: CLOUD_CONFIG.timeoutMs,
    }),
  /** The client sends ONLY the code text; the reward is decided by the server. */
  redeemCode: (token: string, code: string) =>
    request<PromoRedeemResponse>(CLOUD_CONFIG.apiUrl, '/api/tactics/store/promo/redeem', {
      method: 'POST',
      token,
      body: { code },
      timeoutMs: CLOUD_CONFIG.timeoutMs,
    }),
  /** Ownership is checked by the server; the client only names an owned id (or null). */
  equip: (token: string, slot: string, cosmeticId: string | null) =>
    request<Cosmetics>(CLOUD_CONFIG.apiUrl, '/api/tactics/cosmetics/equip', {
      method: 'PUT',
      token,
      body: { slot, cosmeticId },
      timeoutMs: CLOUD_CONFIG.timeoutMs,
    }),
};
