import type { CardRarity, GiftBlock, GiftResult, GiftStatus, StoreContent, StoreOfferType } from '../../game';
import { GIFT_RESULT_LABEL, GIFT_RESULTS } from '../../game';
import type { CloudState } from '../cloud/api';
import { CLOUD_CONFIG } from '../cloud/config';
import type { CloudError } from '../cloud/http';
import { request } from '../cloud/http';
import type { PromoRewardLine, Wallet } from '../shop/api';

/**
 * Store gifting client (server/src/gifts.ts). The client names a product, a friend's username and
 * an idempotency key; price, contents and eligibility are the server's.
 */

/** Shared by both perspectives: what the gift is and its state (the gift modal's data contract). */
interface GiftBase {
  giftId: string;
  status: GiftStatus;
  productId: string;
  productName: string;
  productType: StoreOfferType;
  heroId: string | null;
  /** Art key: the store offer id (render with StoreArt via `product`). */
  artId: string;
  product: { id: string; type: StoreOfferType; heroId?: string; contents: StoreContent[] };
  rarity: CardRarity | null;
  rewardSummary: PromoRewardLine[];
  message: string | null;
  createdAt: number;
  claimedAt: number | null;
}
export interface ReceivedGift extends GiftBase {
  senderUsername: string;
  /** PENDING only: false = the recipient cannot take it right now (it stays saved). */
  claimable?: boolean;
  blockedReason?: GiftBlock | null;
}
export interface SentGift extends GiftBase {
  recipientUsername: string;
  price: number;
  currencyId: string;
}
export interface GiftQuote {
  productId: string;
  productName: string;
  recipientUsername: string;
  price: number;
  currencyId: string;
  balance: number;
  rewardSummary: PromoRewardLine[];
}

const base = '/api/tactics/store/gifts';
const opts = (token: string, method = 'GET', body?: unknown) => ({ method, token, body, timeoutMs: CLOUD_CONFIG.timeoutMs });

export const giftApi = {
  quote: (token: string, productId: string, recipientUsername: string) =>
    request<GiftQuote>(CLOUD_CONFIG.apiUrl, `${base}/quote`, opts(token, 'POST', { productId, recipientUsername })),
  send: (token: string, body: { productId: string; recipientUsername: string; idempotencyKey: string; message?: string }) =>
    request<{ gift: SentGift; replayed: boolean; wallet: Wallet }>(CLOUD_CONFIG.apiUrl, base, opts(token, 'POST', body)),
  received: (token: string) => request<{ gifts: ReceivedGift[]; pending: number }>(CLOUD_CONFIG.apiUrl, `${base}/received`, opts(token)),
  sent: (token: string) => request<{ gifts: SentGift[] }>(CLOUD_CONFIG.apiUrl, `${base}/sent`, opts(token)),
  claim: (token: string, giftId: string) =>
    request<CloudState & { gift: ReceivedGift; replayed: boolean }>(CLOUD_CONFIG.apiUrl, `${base}/${encodeURIComponent(giftId)}/claim`, opts(token, 'POST', {})),
};

const isResult = (code: string): code is GiftResult => (GIFT_RESULTS as readonly string[]).includes(code);

/** Player-facing text for a failed gift call. */
export function giftError(error: CloudError): string {
  if (error.kind === 'NETWORK' || error.kind === 'TIMEOUT' || error.kind === 'SERVER')
    return 'No pudimos confirmar el resultado. Reintenta: no se cobrará dos veces.';
  if (error.kind === 'AUTH') return 'Tu sesión venció. Inicia sesión de nuevo.';
  if (error.code === 'GIFT_BLOCKED' && typeof error.details?.reason === 'string' && isResult(error.details.reason))
    return `${GIFT_RESULT_LABEL.GIFT_BLOCKED} (${blockedText(error.details.reason as GiftBlock)})`;
  return isResult(error.code) ? GIFT_RESULT_LABEL[error.code] : error.message;
}

/** Why a received gift cannot be claimed yet (recipient's point of view). */
export function blockedText(reason: GiftBlock): string {
  if (reason === 'RECIPIENT_CARD_AT_CAP') return 'ya tienes el máximo de copias';
  if (reason === 'RECIPIENT_ALREADY_OWNS') return 'ya tienes este objeto';
  return 'este contenido aún no está disponible para ti';
}

export const GUEST_GIFT_TEXT = 'Inicia sesión para enviar y recibir regalos.';
