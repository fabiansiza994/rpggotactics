import { rarityOf, type CardRarity } from '../collection/deck-rules';
import type { GameContent } from '../domain/content';
import { isOfferActive, planPurchase, type PurchasePlan, type StoreContext, type StoreOffer, type StoreOwnership } from './store';

/**
 * Store gifting: buy a store offer for a friend. Pure rules shared by the Worker (authoritative:
 * it resolves the recipient, the offer and both players' state from D1, charges the sender and
 * creates a PENDING gift in one transaction) and the store UI (labels only).
 *
 * A gift reuses the purchase planner against the RECIPIENT's ownership, with one difference: it
 * is never prorated. Everything the offer contains must fit the recipient (copy caps, unique
 * cosmetics, purchase limit) or the gift is refused before any charge — no partial gifts, no
 * silent repricing, no conversion to crystals.
 */

export const GIFT_LIMITS = {
  /** Optional note from the sender, plain text, one line. */
  messageMaxChars: 120,
  /** Gifts one account may send per rolling 24 h. */
  perSenderDay: 20,
  /** Unclaimed gifts one sender may have waiting for the same friend. */
  pendingPerPair: 5,
} as const;

/** Every outcome of the gift endpoints that is not a plain success. */
export const GIFT_RESULTS = [
  'PRODUCT_NOT_FOUND',
  'NOT_GIFTABLE',
  'PRODUCT_INACTIVE',
  'RECIPIENT_NOT_FOUND',
  'CANNOT_GIFT_SELF',
  'USER_BLOCKED',
  'NOT_FRIENDS',
  'RECIPIENT_CANNOT_RECEIVE',
  'RECIPIENT_CARD_AT_CAP',
  'RECIPIENT_ALREADY_OWNS',
  'RECIPIENT_LIMIT_REACHED',
  'GIFT_LIMIT_REACHED',
  'INSUFFICIENT_FUNDS',
  'IDEMPOTENCY_KEY_REUSED',
  'GIFT_NOT_FOUND',
  'GIFT_BLOCKED',
  'GIFT_UNAVAILABLE',
  'GIFT_CONFLICT',
  'RATE_LIMITED',
] as const;
export type GiftResult = (typeof GIFT_RESULTS)[number];

/** Player-facing text per result (Spanish UI). Never reveals who blocked whom. */
export const GIFT_RESULT_LABEL: Record<GiftResult, string> = {
  PRODUCT_NOT_FOUND: 'Ese producto no existe.',
  NOT_GIFTABLE: 'Este producto no se puede regalar.',
  PRODUCT_INACTIVE: 'Este producto ya no está disponible.',
  RECIPIENT_NOT_FOUND: 'No encontramos a ese jugador.',
  CANNOT_GIFT_SELF: 'No puedes regalarte un producto a ti mismo.',
  USER_BLOCKED: 'No puedes enviar regalos a este jugador.',
  NOT_FRIENDS: 'Solo puedes enviar regalos a tus amigos.',
  RECIPIENT_CANNOT_RECEIVE: 'Este jugador todavía no puede recibir este producto.',
  RECIPIENT_CARD_AT_CAP: 'Tu amigo ya tiene el máximo de copias de esta carta.',
  RECIPIENT_ALREADY_OWNS: 'Tu amigo ya tiene este producto.',
  RECIPIENT_LIMIT_REACHED: 'Tu amigo ya tiene este pack.',
  GIFT_LIMIT_REACHED: 'Has alcanzado el límite de regalos por ahora.',
  INSUFFICIENT_FUNDS: 'Saldo insuficiente.',
  IDEMPOTENCY_KEY_REUSED: 'Esa clave ya se usó para otro regalo.',
  GIFT_NOT_FOUND: 'Ese regalo no existe.',
  GIFT_BLOCKED: 'Ahora mismo no puedes recibir este regalo: ya tienes ese contenido. El regalo sigue guardado.',
  GIFT_UNAVAILABLE: 'Este regalo ya no está disponible.',
  GIFT_CONFLICT: 'No se completó; inténtalo de nuevo.',
  RATE_LIMITED: 'Demasiadas acciones seguidas. Espera un momento.',
};

export type GiftStatus = 'PENDING' | 'CLAIMED' | 'CANCELLED' | 'EXPIRED' | 'REVOKED';

/** Why the recipient cannot get (or claim) an offer right now. */
export type GiftBlock = Extract<
  GiftResult,
  'NOT_GIFTABLE' | 'PRODUCT_INACTIVE' | 'RECIPIENT_CANNOT_RECEIVE' | 'RECIPIENT_CARD_AT_CAP' | 'RECIPIENT_ALREADY_OWNS' | 'RECIPIENT_LIMIT_REACHED'
>;

export interface GiftContext extends StoreContext {
  /** Champion release gate of the RECIPIENT (QA-only champions). Omitted = every champion. */
  heroAllowed?(heroId: string): boolean;
}

/**
 * The offer delivered whole to this recipient, at its catalog price, or why not. `owned` must be
 * the recipient's ownership INCLUDING gifts already waiting for them (they will land too).
 */
export function planGift(
  offer: StoreOffer,
  owned: StoreOwnership,
  ctx: GiftContext,
  now: number,
): { ok: true; plan: PurchasePlan; price: number } | { ok: false; reason: GiftBlock } {
  if (offer.giftable !== true) return { ok: false, reason: 'NOT_GIFTABLE' };
  if (!isOfferActive(offer, now)) return { ok: false, reason: 'PRODUCT_INACTIVE' };
  if (offer.heroId !== undefined && !(ctx.heroAllowed?.(offer.heroId) ?? true)) return { ok: false, reason: 'RECIPIENT_CANNOT_RECEIVE' };
  for (const c of offer.contents) {
    // A gift never skips a release gate: unreleased sets / champions stay unreachable.
    if (c.kind !== 'CARD') continue;
    const card = ctx.content.cards[c.cardId];
    if (!card || (card.expansion && !(ctx.content.releasedExpansions ?? []).includes(card.expansion))) return { ok: false, reason: 'RECIPIENT_CANNOT_RECEIVE' };
  }
  if (offer.giftLimitPerRecipient !== undefined && owned.purchases(offer.id) >= offer.giftLimitPerRecipient)
    return { ok: false, reason: 'RECIPIENT_LIMIT_REACHED' };
  const planned = planPurchase(offer, owned, ctx, now);
  if (!planned.ok) {
    const r = planned.reason;
    if (r.code === 'OFFER_INACTIVE') return { ok: false, reason: 'PRODUCT_INACTIVE' };
    if (r.code === 'PURCHASE_LIMIT') return { ok: false, reason: 'RECIPIENT_LIMIT_REACHED' };
    if (r.code === 'CARD_AT_CAP') return { ok: false, reason: 'RECIPIENT_CARD_AT_CAP' };
    if (r.code === 'COSMETIC_OWNED') return { ok: false, reason: 'RECIPIENT_ALREADY_OWNS' };
    return { ok: false, reason: offer.contents[0]?.kind === 'CARD' ? 'RECIPIENT_CARD_AT_CAP' : 'RECIPIENT_ALREADY_OWNS' };
  }
  // A partly-owned bundle would be prorated for a purchase; a gift is all or nothing.
  const first = planned.quote.excluded[0];
  if (first) return { ok: false, reason: first.kind === 'CARD' ? 'RECIPIENT_CARD_AT_CAP' : 'RECIPIENT_ALREADY_OWNS' };
  return { ok: true, plan: planned.plan, price: offer.price };
}

/**
 * Optional sender note: plain text on one line (control, zero-width and bidi characters are
 * removed by the caller's sanitiser first), at most 120 characters. '' → null (no note);
 * undefined = invalid.
 */
export function giftMessage(cleaned: string | null): string | null | undefined {
  if (cleaned === null) return null;
  const line = cleaned.replace(/\s+/g, ' ').trim();
  if (!line) return null;
  return [...line].length <= GIFT_LIMITS.messageMaxChars ? line : undefined;
}

/** Highest card rarity in a gift (cosmetic-only gifts have none). For the gift modal's styling. */
export function giftRarity(offer: Pick<StoreOffer, 'contents'>, content: GameContent): CardRarity | null {
  const order: CardRarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY', 'ULTRA'];
  let best: CardRarity | null = null;
  for (const c of offer.contents) {
    const card = c.kind === 'CARD' ? content.cards[c.cardId] : undefined;
    if (card && (best === null || order.indexOf(rarityOf(card)) > order.indexOf(best))) best = rarityOf(card);
  }
  return best;
}
