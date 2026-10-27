import { hasGuaranteedFreeCatalogRoute } from '../data/free-catalog';
import { isExclusiveCard } from '../domain/cards/card';
import type { GameContent } from '../domain/content';
import { copyLimit, isCardForHero, rarityOf, type CardRarity, type DeckRules } from '../collection/deck-rules';

/**
 * Store economy model (Phase 4A, extended in 4C). Pure data + rules shared by the Worker
 * (authoritative) and the store UI (display only). Nothing here moves currency or grants items: the server
 * does that in one D1 transaction after running these same checks against ITS state.
 *
 * Competitive rule (no pay-to-win): every gameplay card an offer contains must be a card the
 * champion can also earn through normal play. Store cards go into the ONE existing collection
 * (copy caps included); there is no separate store inventory.
 */

// ── Currency ─────────────────────────────────────────────────────────────────────────────
export const PREMIUM_CURRENCY_ID = 'arcane_crystals';

export interface CurrencyDef {
  /** Stable id stored in every wallet/ledger/purchase row. Never rename. */
  id: string;
  /** Display name: may change freely (it is not persisted). */
  name: string;
  shortName: string;
  premium: boolean;
}

export const CURRENCIES: Readonly<Record<string, CurrencyDef>> = {
  [PREMIUM_CURRENCY_ID]: {
    id: PREMIUM_CURRENCY_ID,
    name: 'Cristales Arcanos',
    shortName: 'Cristales',
    premium: true,
  },
};

/**
 * Why a ledger row exists. Every balance change is one immutable row; refunds and corrections
 * are new compensating rows, never edits. Written today: QA_GRANT, STORE_PURCHASE and PROMO_GRANT
 * (gift/promo code redemptions); the other reasons are reserved.
 */
export const LEDGER_REASONS = [
  'QA_GRANT',
  'STORE_PURCHASE',
  'PURCHASE_CURRENCY',
  'REFUND',
  'ADMIN_ADJUSTMENT',
  'PROMO_GRANT',
  /** Cristales bought with real money (ePayco), reference 'EPAYCO:<orderId>'. Older sandbox credits used PURCHASE_CURRENCY. */
  'REAL_MONEY_PURCHASE',
  /** Reserved: a controlled debit after a real-money refund (never automatic, never below 0). */
  'REAL_MONEY_REVERSAL',
  /** The sender's debit for a store product bought as a gift (reference = gift id). */
  'STORE_GIFT_PURCHASE',
  'DAILY_FIRST_WIN',
  'CAMPAIGN_MILESTONE',
  'ACHIEVEMENT_REWARD',
  'SEASON_REWARD',
] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

/** Stores that may one day sell currency packages. Each has its own receipt format. */
export type PaymentProvider = 'WEB' | 'APPLE' | 'GOOGLE';
export const PAYMENT_PROVIDERS: readonly PaymentProvider[] = ['WEB', 'APPLE', 'GOOGLE'];

/**
 * Future real-money currency packages (product model only — NOT purchasable, no fiat prices, no
 * provider). A package is credited only by the server after a verified receipt/webhook, as a
 * PURCHASE_CURRENCY ledger row whose reference is the provider's transaction id (see
 * server/src/payments.ts). Fiat prices live in each provider's console, never here.
 */
export interface CurrencyPackage {
  /** Our stable product id; ledger/payment rows reference it forever. */
  internalSku: string;
  currencyId: string;
  /** Base amount credited… */
  currencyAmount: number;
  /** …plus this bonus (total credited = currencyAmount + bonusAmount). */
  bonusAmount: number;
  /**
   * The provider's product id for this package, once it exists in that provider's console.
   * null = not sold there (never a placeholder: an unknown product id is rejected).
   */
  platformSkus: Readonly<Record<PaymentProvider, string | null>>;
}

export const packageTotal = (p: CurrencyPackage): number => p.currencyAmount + p.bonusAmount;

// ── Catalog ──────────────────────────────────────────────────────────────────────────────
/**
 * Store sections, in display order (labels are display only). MAGE / SUMMONER / WARRIOR hold that
 * champion's offers; an offer may sit in several sections.
 */
export type StoreCategoryId = 'FEATURED' | 'PREMIUM' | 'MAGE' | 'SUMMONER' | 'WARRIOR' | 'CARDS' | 'DEALS' | 'COSMETICS';

export const STORE_CATEGORIES: readonly { id: StoreCategoryId; label: string }[] = [
  { id: 'FEATURED', label: 'Destacado' },
  { id: 'PREMIUM', label: 'Premium · Showcase' },
  { id: 'MAGE', label: 'Mago' },
  { id: 'SUMMONER', label: 'Invocador' },
  { id: 'WARRIOR', label: 'Guerrero' },
  { id: 'CARDS', label: 'Cartas' },
  { id: 'DEALS', label: 'Ofertas' },
  { id: 'COSMETICS', label: 'Cosméticos' },
];

/** Champion sections only list that champion's offers. */
const CATEGORY_HERO: Partial<Record<StoreCategoryId, string>> = { MAGE: 'mage', SUMMONER: 'summoner', WARRIOR: 'warrior' };

/**
 * Presentation/merchandising type only. Every type is fulfilled by the same generic contents
 * path: a Summoner or Mage pack is a CHAMPION_PACK with `heroId`, not a new code path.
 */
export type StoreOfferType = 'CARD' | 'BUNDLE' | 'COSMETIC' | 'CHAMPION_PACK';

export type CosmeticKind =
  | 'SUMMON_SKIN'
  | 'CARD_BACK'
  | 'CARD_FRAME'
  | 'CARD_ART'
  | 'SPELL_VFX'
  | 'PROFILE_FRAME'
  /** Ranked Reward Track: crest beside the name (lobby, VS, profile). Earned only, never sold. */
  | 'RANKED_CREST'
  /** Ranked Reward Track: seal stamped on the result screen of a win. Earned only, never sold. */
  | 'VICTORY_BADGE';
/** Kinds that can ever have a store price (the Ranked kinds are earned only). */
export type SellableCosmeticKind = Exclude<CosmeticKind, 'RANKED_CREST' | 'VICTORY_BADGE'>;

/**
 * A cosmetic the game can actually show. Ownership is unique (no stacks). Only kinds with a
 * renderer go into the registry (src/game/data/store-catalog.ts), so the catalog can never sell
 * something invisible (validateCatalog rejects unknown cosmetic ids). Cosmetics never touch
 * gameplay state.
 */
export interface CosmeticDef {
  id: string;
  kind: CosmeticKind;
  name: string;
  description?: string;
  /** Champion it belongs to (omitted = account-wide). */
  heroId?: string;
  /** What it re-skins: a summon id, a card id, … (meaning depends on `kind`). */
  targetId?: string;
}

/**
 * Kinds a player can equip today (= kinds with a renderer). SUMMON_SKIN is modelled
 * (slot per summon, see `cosmeticSlot`) but stays unequippable until the battle renderer can
 * draw skins.
 */
export const EQUIPPABLE_KINDS: readonly CosmeticKind[] = ['PROFILE_FRAME', 'RANKED_CREST', 'VICTORY_BADGE', 'CARD_BACK', 'CARD_ART'];

/**
 * Equip slot of a cosmetic: one equipped item per slot. Ownership ≠ equipped: owning many
 * frames, one is shown. Summon skins get one slot per creature ("SUMMON_SKIN:fox").
 */
export function cosmeticSlot(def: CosmeticDef): string {
  return def.kind === 'SUMMON_SKIN' ? `SUMMON_SKIN:${def.targetId ?? ''}` : def.kind;
}

export type StoreContent =
  | { kind: 'CARD'; cardId: string; copies: number }
  | { kind: 'COSMETIC'; cosmeticId: string };

export interface StoreOffer {
  /** Stable id; purchases reference it forever. */
  id: string;
  type: StoreOfferType;
  title: string;
  description: string;
  price: number;
  currencyId: string;
  /** Champion whose collection receives the cards. Required when the offer has cards. */
  heroId?: string;
  contents: readonly StoreContent[];
  categories: readonly StoreCategoryId[];
  tags: readonly string[];
  /** Server timestamps (ms). null = open-ended. Rotation = offers with windows. */
  startAt: number | null;
  endAt: number | null;
  /** Times one account may buy it (null = only ownership/copy caps limit it). */
  purchaseLimit: number | null;
  /** Lower first inside a section. */
  sortOrder: number;
  /**
   * May be bought for a friend (src/game/store/gifts.ts). Opt-in: an offer without the flag can
   * only be bought for oneself.
   */
  giftable?: boolean;
  /** Most gifts of this offer one recipient may hold (pending + claimed). Omitted = no extra limit. */
  giftLimitPerRecipient?: number;
  /**
   * Merchandising only: the card the store shows as the offer's hero shot («Carta destacada»).
   * Must be one of its CARD contents. Omitted = the highest-rarity card (presentation picks it).
   */
  featuredCardId?: string;
  /**
   * Merchandising only: the ritual this offer leads to (`GameContent.rituals` id). The store shows
   * the ritual's creature as the aspirational hero shot («Recompensa del ritual»); the offer still
   * sells only its listed cards, never the creature. The offer must contain one copy of every
   * piece of that ritual, for the offer's champion (validateCatalog BAD_RITUAL_PREVIEW).
   */
  ritualPreview?: string;
}

export interface StoreContext {
  content: GameContent;
  rules: DeckRules;
  cosmetics: Readonly<Record<string, CosmeticDef>>;
  currencies?: Readonly<Record<string, CurrencyDef>>;
}

// ── Pricing ──────────────────────────────────────────────────────────────────────────────
/**
 * Transparent MVP price ladder (Cristales Arcanos):
 *   single card (100–250) < cosmetic (300–400) < small bundle (≈85% of its cards) < major bundle.
 * A bundle must cost less than its parts bought one by one, and more than its priciest part.
 */
export const PRICE_LADDER = {
  // Catalog cards may also be sold if their guaranteed free route exists; no new offers implied.
  card: { COMMON: 100, UNCOMMON: 150, RARE: 250, LEGENDARY: 400, ULTRA: 600 } satisfies Record<CardRarity, number>,
  cosmetic: { CARD_BACK: 300, CARD_FRAME: 300, PROFILE_FRAME: 300, CARD_ART: 350, SUMMON_SKIN: 400, SPELL_VFX: 400 } satisfies Record<
    SellableCosmeticKind,
    number
  >,
  bundleRate: 0.85,
};

/** Price of a content line bought on its own, from the ladder. */
export function contentValue(c: StoreContent, ctx: StoreContext): number {
  if (c.kind === 'CARD') {
    const card = ctx.content.cards[c.cardId];
    return card ? PRICE_LADDER.card[rarityOf(card)] * c.copies : 0;
  }
  const cosmetic = ctx.cosmetics[c.cosmeticId];
  return cosmetic && cosmetic.kind in PRICE_LADDER.cosmetic ? PRICE_LADDER.cosmetic[cosmetic.kind as SellableCosmeticKind] : 0;
}

// ── Validation (catalog authoring) ───────────────────────────────────────────────────────
export type CatalogIssue =
  | { code: 'DUPLICATE_OFFER'; offerId: string }
  | { code: 'BAD_PRICE'; offerId: string }
  | { code: 'UNKNOWN_CURRENCY'; offerId: string }
  | { code: 'EMPTY_OFFER'; offerId: string }
  | { code: 'BAD_WINDOW'; offerId: string }
  | { code: 'BAD_LIMIT'; offerId: string }
  | { code: 'UNKNOWN_CHAMPION'; offerId: string }
  | { code: 'UNKNOWN_CARD'; offerId: string; cardId: string }
  | { code: 'WRONG_HERO'; offerId: string; cardId: string }
  | { code: 'OVER_COPY_LIMIT'; offerId: string; cardId: string }
  /** The card has an exclusive source (world reward…) and cannot be sold. */
  | { code: 'EXCLUSIVE_CARD'; offerId: string; cardId: string }
  | { code: 'UNKNOWN_COSMETIC'; offerId: string; cosmeticId: string }
  | { code: 'DUPLICATE_CONTENT'; offerId: string }
  /** The card ships in a set not released yet (`GameContent.releasedExpansions`): never sold early. */
  | { code: 'UNRELEASED_CARD'; offerId: string; cardId: string }
  | { code: 'BAD_FEATURED_CARD'; offerId: string; cardId: string }
  | { code: 'BAD_RITUAL_PREVIEW'; offerId: string; ritualId: string }
  | { code: 'BAD_CATEGORY'; offerId: string; category: string };

/**
 * Authoring checks. An offer with any issue is never served or sold. Cards must belong to the
 * offer's champion. Scripted catalog cards require a guaranteed free route and a released set;
 * other exclusive sources stay protected (no store-exclusive catalog power).
 */
export function validateCatalog(offers: readonly StoreOffer[], ctx: StoreContext): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const currencies = ctx.currencies ?? CURRENCIES;
  const seen = new Set<string>();
  for (const o of offers) {
    const offerId = o.id;
    if (seen.has(offerId)) issues.push({ code: 'DUPLICATE_OFFER', offerId });
    seen.add(offerId);
    if (!Number.isInteger(o.price) || o.price <= 0) issues.push({ code: 'BAD_PRICE', offerId });
    if (!currencies[o.currencyId]) issues.push({ code: 'UNKNOWN_CURRENCY', offerId });
    if (!o.contents.length) issues.push({ code: 'EMPTY_OFFER', offerId });
    if (o.startAt !== null && o.endAt !== null && o.endAt <= o.startAt) issues.push({ code: 'BAD_WINDOW', offerId });
    if (o.purchaseLimit !== null && (!Number.isInteger(o.purchaseLimit) || o.purchaseLimit < 1))
      issues.push({ code: 'BAD_LIMIT', offerId });
    if (o.heroId !== undefined && !ctx.content.heroes[o.heroId]) issues.push({ code: 'UNKNOWN_CHAMPION', offerId });
    for (const category of o.categories) {
      const hero = CATEGORY_HERO[category];
      if (!STORE_CATEGORIES.some((c) => c.id === category) || (hero !== undefined && o.heroId !== hero))
        issues.push({ code: 'BAD_CATEGORY', offerId, category });
    }
    const keys = o.contents.map((c) => (c.kind === 'CARD' ? `card:${c.cardId}` : `cosmetic:${c.cosmeticId}`));
    if (new Set(keys).size !== keys.length) issues.push({ code: 'DUPLICATE_CONTENT', offerId });
    if (o.featuredCardId !== undefined && !o.contents.some((c) => c.kind === 'CARD' && c.cardId === o.featuredCardId))
      issues.push({ code: 'BAD_FEATURED_CARD', offerId, cardId: o.featuredCardId });
    if (o.ritualPreview !== undefined) {
      const ritual = Object.hasOwn(ctx.content.rituals ?? {}, o.ritualPreview) ? ctx.content.rituals![o.ritualPreview] : undefined;
      if (!ritual || ritual.heroId !== o.heroId || !ritual.pieces.every((id) => o.contents.some((c) => c.kind === 'CARD' && c.cardId === id)))
        issues.push({ code: 'BAD_RITUAL_PREVIEW', offerId, ritualId: o.ritualPreview });
    }
    for (const c of o.contents) {
      if (c.kind === 'CARD') {
        const card = ctx.content.cards[c.cardId];
        if (!card) issues.push({ code: 'UNKNOWN_CARD', offerId, cardId: c.cardId });
        else if (o.heroId === undefined || !isCardForHero(card, o.heroId))
          issues.push({ code: 'WRONG_HERO', offerId, cardId: c.cardId });
        else if (!Number.isInteger(c.copies) || c.copies < 1 || c.copies > copyLimit(card, ctx.rules))
          issues.push({ code: 'OVER_COPY_LIMIT', offerId, cardId: c.cardId });
        else if (isExclusiveCard(card) && !hasGuaranteedFreeCatalogRoute(card)) issues.push({ code: 'EXCLUSIVE_CARD', offerId, cardId: c.cardId });
        else if (card.expansion && !(ctx.content.releasedExpansions ?? []).includes(card.expansion))
          issues.push({ code: 'UNRELEASED_CARD', offerId, cardId: c.cardId });
      } else {
        const cosmetic = ctx.cosmetics[c.cosmeticId];
        if (!cosmetic || (cosmetic.heroId !== undefined && cosmetic.heroId !== o.heroId))
          issues.push({ code: 'UNKNOWN_COSMETIC', offerId, cosmeticId: c.cosmeticId });
      }
    }
  }
  return issues;
}

/** Offers that pass validation (the only ones the server serves or sells). */
export function validOffers(offers: readonly StoreOffer[], ctx: StoreContext): StoreOffer[] {
  const bad = new Set(validateCatalog(offers, ctx).map((i) => i.offerId));
  return offers.filter((o) => !bad.has(o.id));
}

export const isOfferActive = (o: StoreOffer, now: number): boolean =>
  (o.startAt === null || now >= o.startAt) && (o.endAt === null || now < o.endAt);

// ── Purchase planning (ownership) ────────────────────────────────────────────────────────
/** What the buyer already has, as the SERVER stored it. */
export interface StoreOwnership {
  copies(heroId: string, cardId: string): number;
  hasCosmetic(cosmeticId: string): boolean;
  /** Completed purchases of this offer by this account. */
  purchases(offerId: string): number;
}

export interface CardGrant {
  heroId: string;
  cardId: string;
  copies: number;
  /** Owned copies after the grant (never above `cap`). */
  total: number;
  cap: number;
}
export interface CosmeticGrant {
  cosmeticId: string;
  kind: CosmeticKind;
}
export interface PurchasePlan {
  cards: CardGrant[];
  cosmetics: CosmeticGrant[];
}

/** A content line (or part of one) left out because the buyer already has it. */
export type ExcludedContent =
  | { kind: 'CARD'; cardId: string; copies: number; owned: number; cap: number }
  | { kind: 'COSMETIC'; cosmeticId: string };

/** What this buyer pays and receives right now. Always computed by the server. */
export interface PurchaseQuote {
  /** The catalog price for the whole offer. */
  basePrice: number;
  /** basePrice, or less when part of a bundle is already owned (`excluded`). */
  price: number;
  /** The lines actually granted (copies may be fewer than authored). */
  contents: StoreContent[];
  excluded: ExcludedContent[];
}

export type Unavailable =
  | { code: 'OFFER_INACTIVE' }
  | { code: 'PURCHASE_LIMIT'; limit: number }
  | { code: 'CARD_AT_CAP'; cardId: string; owned: number; cap: number }
  | { code: 'COSMETIC_OWNED'; cosmeticId: string }
  /** A multi-item offer whose every item is already owned/at cap: nothing left to sell. */
  | { code: 'ALL_OWNED' };

/** Nearest 10, never 0, never above the base price. */
const PRICE_STEP = 10;

/**
 * Proportional price for the part of an offer still grantable: base × remaining value / full
 * value (values from PRICE_LADDER), rounded to 10. The offer's own discount is preserved, so a
 * reduced bundle still costs less than its remaining items bought one by one.
 */
export function proratedPrice(basePrice: number, fullValue: number, remainingValue: number): number {
  if (fullValue <= 0 || remainingValue >= fullValue) return basePrice;
  const raw = (basePrice * Math.max(0, remainingValue)) / fullValue;
  return Math.min(basePrice, Math.max(PRICE_STEP, Math.round(raw / PRICE_STEP) * PRICE_STEP));
}

/**
 * Ownership rule (Phase 4C, replaces 4A's all-or-nothing): what the buyer already has is left
 * out and the price drops in proportion.
 * - A card line grants only the copies that fit under the copy cap; a cosmetic already owned
 *   is skipped. Nothing is ever granted above a cap, and nothing unusable is charged for.
 * - Nothing left → unavailable: single-item offers keep their specific reason
 *   (CARD_AT_CAP / COSMETIC_OWNED), bundles report ALL_OWNED.
 * - Ownership only grows, so between showing a quote and buying, the price can only stay or
 *   drop; the server recomputes it at purchase time anyway and charges ITS number.
 */
export function planPurchase(
  offer: StoreOffer,
  owned: StoreOwnership,
  ctx: StoreContext,
  now: number,
): { ok: true; plan: PurchasePlan; quote: PurchaseQuote } | { ok: false; reason: Unavailable } {
  if (!isOfferActive(offer, now)) return { ok: false, reason: { code: 'OFFER_INACTIVE' } };
  if (offer.purchaseLimit !== null && owned.purchases(offer.id) >= offer.purchaseLimit)
    return { ok: false, reason: { code: 'PURCHASE_LIMIT', limit: offer.purchaseLimit } };
  const plan: PurchasePlan = { cards: [], cosmetics: [] };
  const contents: StoreContent[] = [];
  const excluded: ExcludedContent[] = [];
  let firstBlock: Unavailable | null = null;
  let fullValue = 0;
  let remainingValue = 0;
  for (const c of offer.contents) {
    const value = contentValue(c, ctx);
    fullValue += value;
    if (c.kind === 'CARD') {
      const heroId = offer.heroId!; // validated: card offers always name their champion
      const cap = copyLimit(ctx.content.cards[c.cardId]!, ctx.rules);
      const have = owned.copies(heroId, c.cardId);
      const grant = Math.max(0, Math.min(c.copies, cap - have));
      if (grant < c.copies) {
        excluded.push({ kind: 'CARD', cardId: c.cardId, copies: c.copies - grant, owned: have, cap });
        firstBlock ??= { code: 'CARD_AT_CAP', cardId: c.cardId, owned: have, cap };
      }
      if (grant === 0) continue;
      plan.cards.push({ heroId, cardId: c.cardId, copies: grant, total: have + grant, cap });
      contents.push({ kind: 'CARD', cardId: c.cardId, copies: grant });
      remainingValue += (value / c.copies) * grant;
    } else {
      if (owned.hasCosmetic(c.cosmeticId)) {
        excluded.push({ kind: 'COSMETIC', cosmeticId: c.cosmeticId });
        firstBlock ??= { code: 'COSMETIC_OWNED', cosmeticId: c.cosmeticId };
        continue;
      }
      plan.cosmetics.push({ cosmeticId: c.cosmeticId, kind: ctx.cosmetics[c.cosmeticId]!.kind });
      contents.push(c);
      remainingValue += value;
    }
  }
  if (!contents.length) return { ok: false, reason: offer.contents.length === 1 && firstBlock ? firstBlock : { code: 'ALL_OWNED' } };
  const price = excluded.length ? proratedPrice(offer.price, fullValue, remainingValue) : offer.price;
  return { ok: true, plan, quote: { basePrice: offer.price, price, contents, excluded } };
}

/**
 * The offer as THIS buyer sees it (catalog response and purchase snapshot): price and contents
 * are the server's quote; `basePrice`/`excluded` explain a reduced bundle. An unavailable offer
 * keeps its authored price/contents plus the reason.
 */
export type OfferView = StoreOffer & {
  basePrice: number;
  excluded: ExcludedContent[];
  availability: { purchasable: boolean; reason?: Unavailable };
};

export function offerView(offer: StoreOffer, owned: StoreOwnership, ctx: StoreContext, now: number): OfferView {
  const planned = planPurchase(offer, owned, ctx, now);
  if (!planned.ok)
    return { ...offer, basePrice: offer.price, excluded: [], availability: { purchasable: false, reason: planned.reason } };
  const { quote } = planned;
  return { ...offer, price: quote.price, contents: quote.contents, basePrice: quote.basePrice, excluded: quote.excluded, availability: { purchasable: true } };
}
