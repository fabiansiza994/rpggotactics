import { isExclusiveCard } from '../domain/cards/card';
import type { GameContent } from '../domain/content';
import { copyLimit, type DeckRules } from '../collection/deck-rules';
import { CURRENCIES, PREMIUM_CURRENCY_ID, type CardGrant, type CosmeticDef, type CosmeticGrant, type StoreOwnership } from './store';

/**
 * Gift / promo codes. Pure rules shared by the Worker (authoritative: it reads the code and its
 * reward from D1 and grants it in one transaction) and the store UI (labels only). The client
 * only ever sends the code text; what a code gives, and whether it can be redeemed, is decided
 * here against the SERVER's state.
 */

// ── Code text ────────────────────────────────────────────────────────────────────────────
/** Longest raw input accepted before normalising (anything longer is rejected unread). */
export const PROMO_INPUT_MAX = 48;
const NORMALIZED = /^[A-Z0-9]{4,32}$/;
const RAW = /^[A-Za-z0-9 _-]+$/;

/**
 * Canonical form: trimmed, upper-case, without spaces, hyphens or underscores, so
 * " war-dragon " and "WAR_DRAGON" are the same code as "WARDRAGON". null = malformed (other
 * characters, too short/long): the server answers INVALID_CODE without querying.
 */
export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > PROMO_INPUT_MAX) return null;
  const trimmed = raw.trim();
  if (!RAW.test(trimmed)) return null;
  const code = trimmed.replace(/[\s_-]+/g, '').toUpperCase();
  return NORMALIZED.test(code) ? code : null;
}

// ── Rewards ──────────────────────────────────────────────────────────────────────────────
/** One thing a code grants. Deterministic only: no random rewards. */
export type PromoRewardItem =
  | { type: 'ARCANE_CRYSTALS'; amount: number }
  | { type: 'CARD'; cardId: string; copies: number }
  | { type: 'COSMETIC'; cosmeticId: string };

/** A code's reward: one item, or several granted together (all or nothing). */
export type PromoReward = PromoRewardItem | { type: 'MULTI'; items: PromoRewardItem[] };

/** Upper bounds that keep a typo in a seed from becoming a giant grant. */
const MAX_CRYSTALS = 10_000;
const MAX_ITEMS = 8;

export interface PromoContext {
  content: GameContent;
  rules: DeckRules;
  cosmetics: Readonly<Record<string, CosmeticDef>>;
  /** Champion release gate of the caller (QA-only champions). Omitted = every champion. */
  heroAllowed?(heroId: string): boolean;
}

/** Every outcome the redeem endpoint can answer with (the client maps these to messages). */
export const PROMO_RESULTS = [
  'SUCCESS',
  'INVALID_CODE',
  'ALREADY_REDEEMED',
  'EXPIRED',
  'NOT_STARTED',
  'INACTIVE',
  'GLOBAL_LIMIT_REACHED',
  'CARD_AT_CAP',
  'ALREADY_OWNED',
  'REWARD_UNAVAILABLE',
  'RATE_LIMITED',
] as const;
export type PromoResult = (typeof PROMO_RESULTS)[number];

/** Player-facing text per result (Spanish UI). */
export const PROMO_RESULT_LABEL: Record<PromoResult, string> = {
  SUCCESS: 'Código canjeado.',
  INVALID_CODE: 'Ese código no existe.',
  ALREADY_REDEEMED: 'Ya canjeaste este código con esta cuenta.',
  EXPIRED: 'Este código ha caducado.',
  NOT_STARTED: 'Este código todavía no está disponible.',
  INACTIVE: 'Este código no está disponible.',
  GLOBAL_LIMIT_REACHED: 'Este código se ha agotado.',
  CARD_AT_CAP: 'Ya tienes el máximo de copias de esa carta; el código no se ha consumido.',
  ALREADY_OWNED: 'Ya tienes esa recompensa; el código no se ha consumido.',
  REWARD_UNAVAILABLE: 'La recompensa de este código no está disponible ahora.',
  RATE_LIMITED: 'Demasiados intentos. Espera un minuto y vuelve a probar.',
};

const isInt = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

/**
 * Parses a stored reward (D1 JSON) into a typed reward, or null if its SHAPE is wrong. Unknown
 * fields are dropped, so nothing unvalidated ever reaches a grant. Content checks (does the card
 * exist, is it released…) are `checkPromoReward`'s job.
 */
export function parsePromoReward(raw: unknown): PromoReward | null {
  const item = (v: unknown): PromoRewardItem | null => {
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (o.type === 'ARCANE_CRYSTALS') return isInt(o.amount, 1, MAX_CRYSTALS) ? { type: o.type, amount: o.amount } : null;
    if (o.type === 'CARD')
      return typeof o.cardId === 'string' && isInt(o.copies, 1, 3) ? { type: o.type, cardId: o.cardId, copies: o.copies } : null;
    if (o.type === 'COSMETIC') return typeof o.cosmeticId === 'string' ? { type: o.type, cosmeticId: o.cosmeticId } : null;
    return null;
  };
  if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'MULTI') {
    const list = (raw as { items?: unknown }).items;
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_ITEMS) return null;
    const items = list.map(item);
    if (items.some((i) => i === null)) return null;
    const keys = items.map((i) => (i!.type === 'CARD' ? `card:${i!.cardId}` : i!.type === 'COSMETIC' ? `cos:${i!.cosmeticId}` : 'crystals'));
    if (new Set(keys).size !== keys.length) return null; // one line per thing: no hidden stacking
    return { type: 'MULTI', items: items as PromoRewardItem[] };
  }
  return item(raw);
}

export const promoItems = (reward: PromoReward): PromoRewardItem[] => (reward.type === 'MULTI' ? reward.items : [reward]);

/** Champion whose collection receives a card (neutral cards go to the shared pool server-side). */
function cardHero(content: GameContent, cardId: string): string | null {
  const card = content.cards[cardId];
  if (!card) return null;
  return card.heroId ?? Object.keys(content.heroes)[0] ?? null;
}

/**
 * Can this content grant the reward at all (independent of the player)? A card must exist, belong
 * to a released champion and a released content set, and fit its copy cap; a cosmetic must be in
 * the registry (no ownership of something the game cannot show).
 */
export function checkPromoReward(reward: PromoReward, ctx: PromoContext): boolean {
  return promoItems(reward).every((i) => {
    if (i.type === 'ARCANE_CRYSTALS') return Boolean(CURRENCIES[PREMIUM_CURRENCY_ID]);
    if (i.type === 'COSMETIC') {
      const def = ctx.cosmetics[i.cosmeticId];
      return Boolean(def) && (def!.heroId === undefined || (ctx.heroAllowed?.(def!.heroId) ?? true));
    }
    const card = ctx.content.cards[i.cardId];
    if (!card || isExclusiveCard(card)) return false;
    if (card.expansion && !(ctx.content.releasedExpansions ?? []).includes(card.expansion)) return false;
    if (card.heroId !== undefined && (!ctx.content.heroes[card.heroId] || !(ctx.heroAllowed?.(card.heroId) ?? true))) return false;
    return i.copies <= copyLimit(card, ctx.rules);
  });
}

/** Exactly what a redemption grants (stored as the redemption's reward snapshot). */
export interface PromoGrant {
  crystals: number;
  cards: CardGrant[];
  cosmetics: CosmeticGrant[];
}

export type PromoPlan =
  | { ok: true; grant: PromoGrant }
  | { ok: false; reason: 'REWARD_UNAVAILABLE' }
  | { ok: false; reason: 'CARD_AT_CAP'; cardId: string; owned: number; cap: number }
  | { ok: false; reason: 'ALREADY_OWNED'; cosmeticId: string };

/**
 * All or nothing: if any item cannot be granted in full (a card would pass its copy cap, a
 * cosmetic is already owned), nothing is granted and the code is NOT consumed. There is no
 * automatic compensation; a code that wants one must say so in its reward.
 */
export function planPromoReward(reward: PromoReward, owned: StoreOwnership, ctx: PromoContext): PromoPlan {
  if (!checkPromoReward(reward, ctx)) return { ok: false, reason: 'REWARD_UNAVAILABLE' };
  const grant: PromoGrant = { crystals: 0, cards: [], cosmetics: [] };
  for (const i of promoItems(reward)) {
    if (i.type === 'ARCANE_CRYSTALS') grant.crystals += i.amount;
    else if (i.type === 'COSMETIC') {
      if (owned.hasCosmetic(i.cosmeticId)) return { ok: false, reason: 'ALREADY_OWNED', cosmeticId: i.cosmeticId };
      grant.cosmetics.push({ cosmeticId: i.cosmeticId, kind: ctx.cosmetics[i.cosmeticId]!.kind });
    } else {
      const heroId = cardHero(ctx.content, i.cardId)!;
      const cap = copyLimit(ctx.content.cards[i.cardId]!, ctx.rules);
      const have = owned.copies(heroId, i.cardId);
      if (have + i.copies > cap) return { ok: false, reason: 'CARD_AT_CAP', cardId: i.cardId, owned: have, cap };
      grant.cards.push({ heroId, cardId: i.cardId, copies: i.copies, total: have + i.copies, cap });
    }
  }
  return { ok: true, grant };
}

/** Spanish thousands separator ("1.500"). Explicit: Intl es-ES does not group 4-digit numbers. */
const groupThousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Safe, player-facing description of a grant ("Invocar Dragón de Guerra x1", "1.500 Cristales Arcanos"). */
export function describePromoGrant(
  grant: PromoGrant,
  content: GameContent,
  cosmetics: Readonly<Record<string, CosmeticDef>>,
): { kind: 'CURRENCY' | 'CARD' | 'COSMETIC'; id: string; label: string; amount: number }[] {
  const out: { kind: 'CURRENCY' | 'CARD' | 'COSMETIC'; id: string; label: string; amount: number }[] = [];
  if (grant.crystals > 0)
    out.push({ kind: 'CURRENCY', id: PREMIUM_CURRENCY_ID, label: `${groupThousands(grant.crystals)} ${CURRENCIES[PREMIUM_CURRENCY_ID]!.name}`, amount: grant.crystals });
  for (const c of grant.cards)
    out.push({ kind: 'CARD', id: c.cardId, label: `${content.cards[c.cardId]?.name ?? c.cardId} x${c.copies}`, amount: c.copies });
  for (const c of grant.cosmetics) out.push({ kind: 'COSMETIC', id: c.cosmeticId, label: cosmetics[c.cosmeticId]?.name ?? c.cosmeticId, amount: 1 });
  return out;
}
