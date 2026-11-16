/** QA ONLY. This module is an independent lab entry, never imported by src/. */
import {
  createProfile,
  STORE_CATALOG,
  validateCatalog,
  DEFAULT_CONTENT,
  COSMETICS,
  DECK_RULES,
  offerView,
  type PlayerProfile,
} from "../../src/game";
import { releasedContent } from "../../server/src/ritualRelease";
import {
  boosterOffers,
  expansionViews,
  rollBooster,
} from "../../server/src/boosters";
import type { Env } from "../../server/src/db";
import type { CatalogOffer } from "../../src/presentation/shop/api";
import type { PurchasePlan } from "../../src/game/store/store";
export const DEMO_KEY = "rpggo.market20.qa-demo.v1";
export const context = {
  content: releasedContent(DEFAULT_CONTENT, {
    FREE_CATALOG_ENABLED: "1",
    SHAPESHIFTER_ENABLED: "1",
    WARRIOR_ENABLED: "1",
    ARCHER_ENABLED: "1",
    SUMMONER_RITUALS_ENABLED: "1",
    PRIMORDIAL_DRAGON_ENABLED: "1",
    ARSENAL_CARDS_ENABLED: "1",
    TACTICAL_CARDS_ENABLED: "1",
    STORE_SHOWCASE_ENABLED: "1",
  } as Env),
  cosmetics: COSMETICS,
  rules: DECK_RULES,
};
const owned = { copies: () => 0, hasCosmetic: () => false, purchases: () => 0 };
export const packs = boosterOffers(context);
export const expansions = expansionViews(context, packs);
export const offers = packs.map((o) => ({
  ...offerView(o, owned, context, Date.now()),
  ...(o.booster?.freeGrant ? { freeRemaining: o.purchaseLimit } : {}),
})) as CatalogOffer[];
export interface DemoState {
  balance: number;
  profile: PlayerProfile;
  purchases: {
    id: number;
    offerId: string;
    opening: NonNullable<PurchasePlan["opening"]>;
    openings?: NonNullable<PurchasePlan["openings"]>;
  }[];
}
export function freshDemo(): DemoState {
  const profile = createProfile(context.content);
  for (const h of Object.values(profile.heroes)) h.collection = {};
  profile.shared = { collection: {}, acquisitions: 0 };
  for (const id of expansions[0]!.cardIds.slice(0, 6)) {
    const card = context.content.cards[id]!;
    profile.heroes[card.heroId!]!.collection[id] = { copies: 1, acquired: 0 };
  }
  return { balance: 2000, profile, purchases: [] };
}
export function simulatePurchase(
  state: DemoState,
  offerId: string,
  below?: (n: number) => number,
): DemoState {
  const offer = packs.find((o) => o.id === offerId);
  if (
    !offer ||
    state.balance < offer.price ||
    (offer.booster?.freeGrant &&
      state.purchases.filter((p) => p.offerId === offerId).length >=
        (offer.purchaseLimit ?? 0))
  )
    throw Error("Saldo de demostración insuficiente. Reinicia el laboratorio.");
  const result = rollBooster(
    offer,
    {
      ...owned,
      copies: (heroId, cardId) =>
        (context.content.cards[cardId]?.heroId
          ? state.profile.heroes[heroId]?.collection[cardId]?.copies
          : state.profile.shared?.collection[cardId]?.copies) ?? 0,
    },
    context,
    Date.now(),
    below,
  );
  const next = structuredClone(state);
  for (const card of (result.openings ?? [result.opening!]).flatMap(
    (o) => o.cards,
  )) {
    const c = context.content.cards[card.cardId]!;
    const h = next.profile.heroes[c.heroId!]!;
    const old = h.collection[c.id];
    h.collection[c.id] = {
      copies: (old?.copies ?? 0) + 1,
      acquired: ++h.acquisitions,
    };
  }
  next.balance -= offer.price;
  next.purchases.push({
    id: next.purchases.length + 1,
    offerId,
    opening: result.opening!,
    openings: result.openings,
  });
  return next;
}

/** Real eligible products, display-only in the disconnected lab. */
export const demoShowcase = STORE_CATALOG.filter(
  (o) =>
    (o.type === "CARD" || o.type === "COSMETIC") &&
    validateCatalog([o], context).length === 0,
).map((o) => offerView(o, owned, context, Date.now())) as CatalogOffer[];
