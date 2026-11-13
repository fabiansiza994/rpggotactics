import { COSMETICS, DEFAULT_CONTENT, copyLimit, DECK_RULES, isNeutral, ownedFor, sharedPool, type PlayerProfile } from '../../game';

function neutralOrFor(profile: PlayerProfile, heroId: string | undefined, cardId: string): number {
  const card = DEFAULT_CONTENT.cards[cardId];
  if (card && isNeutral(card)) return sharedPool(profile, DEFAULT_CONTENT).collection[cardId]?.copies ?? 0;
  return heroId ? ownedFor(profile, heroId, DEFAULT_CONTENT)(cardId) : 0;
}
import type { CloudError } from '../cloud/http';
import type { CatalogOffer } from './api';
export function availabilityText(offer: CatalogOffer): string | null {
  if (offer.availability.purchasable) return null;
  const r = offer.availability.reason;
  if (r?.code === 'CARD_AT_CAP')
    return `Ya tienes ${r.owned}/${r.cap} copias de ${DEFAULT_CONTENT.cards[r.cardId]?.name ?? 'una carta del pack'}. Has alcanzado el máximo de copias.`;
  if (r?.code === 'PURCHASE_LIMIT')
    return offer.type === 'COSMETIC'
      ? 'Ya es tuyo. Puedes equiparlo desde aquí.'
      : 'Ya adquiriste esta oferta. Se alcanzó su límite de compra.';
  if (r?.code === 'COSMETIC_OWNED') return 'Ya es tuyo. Puedes equiparlo desde aquí.';
  if (r?.code === 'ALL_OWNED')
    return 'Ya tienes todo el contenido de este pack al máximo de copias. No queda nada por entregar.';
  return 'Esta oferta no está disponible en la rotación actual.';
}
export function ownership(offer: CatalogOffer, cardId: string, profile: PlayerProfile) {
  const reason = offer.availability.reason;
  if (reason?.code === 'CARD_AT_CAP' && reason.cardId === cardId)
    return { owned: reason.owned, cap: reason.cap };
  return {
    // A neutral card is owned by the account whichever champion the offer shows.
    owned: neutralOrFor(profile, offer.heroId, cardId),
    cap: copyLimit(DEFAULT_CONTENT.cards[cardId]!, DECK_RULES),
  };
}
export function purchaseError(error: CloudError): string {
  if (error.code === 'STORE_QUOTE_UNAVAILABLE') return 'La tienda está en actualización. Conservamos tu operación pendiente; puedes recuperar su recibo más tarde.';
  if (error.kind === 'AUTH')
    return 'Tu sesión venció. Vuelve al menú e inicia sesión para continuar.';
  if (error.kind === 'NETWORK' || error.kind === 'TIMEOUT' || error.kind === 'SERVER')
    return 'No pudimos confirmar el resultado. Reintenta esta misma compra; no se cobrará dos veces.';
  switch (error.code) {
    case 'QUOTE_REQUIRED':
    case 'QUOTE_UPDATE_REQUIRED':
      return 'Recarga la página: esta compra necesita una cotización actualizada. Conservamos el identificador para recuperar cualquier recibo anterior.';
    case 'QUOTE_EXPIRED':
    case 'QUOTE_CHANGED':
    case 'QUOTE_INVALID':
      return 'La cotización venció, cambió o no es válida. Revisa las condiciones actuales y vuelve a confirmar; este intento no se ha cobrado.';
    case 'PURCHASE_NOT_FOUND':
      return 'Todavía no hay un recibo confirmado. Puedes recuperarlo de nuevo o revisar las condiciones para confirmar esta misma compra.';
    case 'INSUFFICIENT_FUNDS':
      return 'Saldo insuficiente. Actualiza la tienda para consultar tu saldo.';
    case 'OFFER_EXPIRED':
    case 'OFFER_UNAVAILABLE':
    case 'UNKNOWN_OFFER':
      return 'La oferta ya no está disponible. Actualiza la tienda.';
    case 'OWNERSHIP_LIMIT':
    case 'ALREADY_OWNED':
      return 'Ya tienes el máximo de copias o alcanzaste el límite de esta oferta.';
    case 'PURCHASE_CONFLICT':
      return 'La compra no se completó. Actualiza la tienda antes de intentarlo de nuevo.';
    default:
      return 'No se pudo completar la compra. Actualiza la tienda e inténtalo de nuevo.';
  }
}
/** A rejection must not discard an identifier whose first request may still be in flight. */
export const needsQuoteReview = (code:string) => ['QUOTE_REQUIRED','QUOTE_UPDATE_REQUIRED','QUOTE_EXPIRED','QUOTE_CHANGED','QUOTE_INVALID','PURCHASE_NOT_FOUND'].includes(code);
export interface PurchaseIntent {
  username: string;
  offerId: string;
  key: string;
  /** The exact signed quote confirmed by the user; never refreshed automatically on retry. */
  quote?: CatalogOffer['purchaseQuote'];
}
const KEY = 'rpg-go-tactics:store-pending';
export function readIntent(username: string): PurchaseIntent | null {
  try {
    const x = JSON.parse(localStorage.getItem(`${KEY}:${username}`) ?? 'null');
    if (x?.username !== username || typeof x.offerId !== 'string' || typeof x.key !== 'string') return null;
    const quote = typeof x.quote?.token === 'string' && Number.isSafeInteger(x.quote?.expiresAt)
      ? {token:x.quote.token,expiresAt:x.quote.expiresAt} : undefined;
    return {username:x.username,offerId:x.offerId,key:x.key,...(quote ? {quote} : {})};
  } catch {
    return null;
  }
}
export function saveIntent(intent: PurchaseIntent | null, username?: string) {
  if (intent) localStorage.setItem(`${KEY}:${intent.username}`, JSON.stringify(intent));
  else if (username) localStorage.removeItem(`${KEY}:${username}`);
}
export function remainingTime(endAt: number | null, serverNow: number): string | null {
  if (endAt === null) return null;
  const ms = endAt - serverNow;
  if (ms <= 0) return 'Rotación terminada · Actualiza la tienda';
  const hours = Math.ceil(ms / 3600000);
  return `Disponible por ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** What the store calls an offer (merchandising type). */
export function offerKind(offer: CatalogOffer, detail = false): string {
  if (offer.ritualPreview) return detail ? 'Pack ritual · Invocación ritual' : 'Pack ritual';
  if (offer.type === 'CARD') return detail ? 'Carta de colección' : 'Carta';
  if (offer.type === 'COSMETIC') return detail ? 'Cosmético de perfil' : 'Cosmético';
  return detail ? 'Pack de campeón' : 'Pack de cartas';
}

/** Owned items left out of a bundle, in player words (the server already reduced the price). */
export function excludedText(offer: CatalogOffer): string[] {
  return offer.excluded.map((e) =>
    e.kind === 'CARD'
      ? `${DEFAULT_CONTENT.cards[e.cardId]?.name ?? e.cardId} (tienes ${e.owned}/${e.cap})`
      : (COSMETICS[e.cosmeticId]?.name ?? e.cosmeticId),
  );
}

export const isReduced = (offer: CatalogOffer): boolean => offer.price < offer.basePrice;
