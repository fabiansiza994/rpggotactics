import {primaryMarketExpansionId} from '../../src/game/store/market-primary';
import {
  MARKET_EXPANSIONS,
  freePackAllowance,
  type MarketExpansionView,
} from "../../src/game/store/market-expansions";
import { rarityOf } from "../../src/game/collection/deck-rules";
import {
  BOOSTER_RARITIES,
  type BoosterPolicy,
} from "../../src/game/store/boosters";
import {
  planPurchase,
  validateCatalog,
  type StoreContext,
  type StoreOffer,
  type StoreOwnership,
  type PurchasePlan,
} from "../../src/game/store/store";

/** Empty buckets disable the pack. Never silently renormalize advertised odds. */
export function validBooster(offer: StoreOffer, ctx: StoreContext): boolean {
  const p = offer.booster;
  if (
    !p ||
    p.size !== 4 ||
    p.duplicates !== true ||
    !p.revision ||
    ![1, 5, 10].includes(p.packs ?? 1) ||
    (p.freeGrant === true &&
      (p.packs !== 1 ||
        offer.price !== 0 ||
        !Number.isSafeInteger(p.freeLimit) ||
        !(p.freeLimit! > 0) ||
        offer.purchaseLimit !== p.freeLimit)) ||
    offer.contents.length > 40 ||
    offer.giftable ||
    offer.ritualPreview
  )
    return false;
  if (
    BOOSTER_RARITIES.some(
      (r) => !Number.isSafeInteger(p.weights[r]) || p.weights[r] < 0,
    ) ||
    BOOSTER_RARITIES.reduce((n, r) => n + p.weights[r], 0) !== 100 ||
    p.weights.ULTRA !== 0
  )
    return false;
  if (
    offer.contents.some(
      (c) =>
        c.kind !== "CARD" ||
        c.copies !== 1 ||
        !ctx.content.cards[c.cardId] ||
        p.weights[rarityOf(ctx.content.cards[c.cardId]!)] === 0 ||
        ctx.content.cards[c.cardId]!.tags.some((t) =>
          ["qa", "experimental", "prototype"].includes(t.toLowerCase()),
        ),
    ) ||
    validateCatalog([offer], ctx).length
  )
    return false;
  if (
    p.poolType === "GENERAL" &&
    offer.contents.some(
      (c) =>
        c.kind === "CARD" &&
        validateCatalog(
          [
            {
              ...offer,
              price: Math.max(1, offer.price),
              booster: undefined,
              heroId:
                ctx.content.cards[c.cardId]!.heroId ??
                ctx.content.defaultHeroId ??
                Object.keys(ctx.content.heroes)[0]!,
              contents: [c],
            },
          ],
          ctx,
        ).length,
    )
  )
    return false;
  return BOOSTER_RARITIES.every(
    (r) =>
      p.weights[r] === 0 ||
      offer.contents.some(
        (c) =>
          c.kind === "CARD" && rarityOf(ctx.content.cards[c.cardId]!) === r,
      ),
  );
}
/** Reuses catalog validation: released, saleable, real cards for the named champion only. */
export function boosterOffers(
  ctx: StoreContext,
  policy?: BoosterPolicy,
  price?: number,
  expansions = MARKET_EXPANSIONS,
): StoreOffer[] {
  return expansions
    .filter((e) => e.status === "AVAILABLE" && e.pack)
    .flatMap((expansion) => {
      const general = expansion.poolType === "GENERAL";
      const heroes = general
        ? [undefined]
        : Object.values(ctx.content.heroes).filter(
            (h) => !expansion.championId || h.id === expansion.championId,
          );
      return heroes.flatMap((hero) =>
        [
          ...(freePackAllowance(expansion) > 0 ? [0] : []),
          1,
          5,
          10,
        ].flatMap((amount) => {
          const chosenPolicy = policy ?? expansion.pack!.policy;
          const base: StoreOffer = {
            id: `booster_${expansion.id}_${general ? (amount === 0 ? "free" : "x" + amount) : hero!.id + (amount === 1 ? "" : "_x" + amount)}`,
            type: "BUNDLE",
            heroId: hero?.id,
            title: expansion.name,
            description:
              "Sobres individuales de cuatro cartas. Sin rareza garantizada; duplicados acumulables.",
            price: amount === 0 ? 0 : (price ?? expansion.pack!.price) * amount,
            currencyId: "arcane_crystals",
            categories: ["CARDS"],
            tags: ["booster", expansion.id],
            startAt: null,
            endAt: null,
            purchaseLimit: amount === 0 ? freePackAllowance(expansion) : null,
            sortOrder: amount,
            giftable: false,
            contents: [],
            booster: {
              ...chosenPolicy,
              revision: chosenPolicy.revision,
              expansionId: expansion.id,
              poolType: general
                ? "GENERAL"
                : (expansion.poolType ?? "CHAMPION"),
              packs: (amount === 0 ? 1 : amount) as 1 | 5 | 10,
              ...(amount === 0
                ? { freeGrant: true, freeLimit: freePackAllowance(expansion) }
                : {}),
            },
          };
          const cards = Object.values(ctx.content.cards).filter(
            (card) =>
              primaryMarketExpansionId(card.id) === expansion.id && expansion.cardIds.includes(card.id) &&
              (general || !card.heroId || card.heroId === hero?.id) &&
              !card.tags.some((t) =>
                ["qa", "experimental", "prototype"].includes(t.toLowerCase()),
              ) &&
              chosenPolicy.weights[rarityOf(card)] > 0 &&
              validateCatalog(
                [
                  {
                    ...base,
                    price: Math.max(1, base.price),
                    heroId:
                      card.heroId ??
                      ctx.content.defaultHeroId ??
                      Object.keys(ctx.content.heroes)[0]!,
                    booster: undefined,
                    contents: [{ kind: "CARD", cardId: card.id, copies: 1 }],
                  },
                ],
                ctx,
              ).length === 0,
          );
          const offer = {
            ...base,
            contents: cards.map((card) => ({
              kind: "CARD" as const,
              cardId: card.id,
              copies: 1,
            })),
          };
          return validBooster(offer, ctx) ? [offer] : [];
        }),
      );
    });
}

/** Rejection sampling avoids modulo bias. No waits or expensive statistical work. */
export function secureBelow(bound: number): number {
  if (!Number.isSafeInteger(bound) || bound < 1 || bound > 0x100000000)
    throw Error("Invalid random bound");
  const max = 0x100000000 - (0x100000000 % bound),
    buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0]! >= max);
  return buf[0]! % bound;
}
export function rollBooster(
  offer: StoreOffer,
  owned: StoreOwnership,
  ctx: StoreContext,
  now: number,
  below: (n: number) => number = secureBelow,
): PurchasePlan {
  if (!validBooster(offer, ctx)) throw Error("Invalid pack policy or pool");
  const slots: string[] = [];
  for (let i = 0; i < offer.booster!.size * (offer.booster!.packs ?? 1); i++) {
    let roll = below(100);
    if (!Number.isInteger(roll) || roll < 0 || roll >= 100)
      throw Error("Invalid random result");
    const rarity = BOOSTER_RARITIES.find((r) => {
      roll -= offer.booster!.weights[r];
      return roll < 0;
    })!;
    const pool = offer.contents.filter(
      (c) =>
        c.kind === "CARD" && rarityOf(ctx.content.cards[c.cardId]!) === rarity,
    );
    const index = below(pool.length);
    if (!Number.isInteger(index) || index < 0 || index >= pool.length)
      throw Error("Invalid random result");
    const card = pool[index]!;
    if (card.kind !== "CARD") throw Error("Invalid pool");
    slots.push(card.cardId);
  }
  const counts = new Map<string, number>();
  slots.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  const result = planPurchase(
    {
      ...offer,
      contents: [...counts].map(([cardId, copies]) => ({
        kind: "CARD",
        cardId,
        copies,
      })),
    },
    owned,
    ctx,
    now,
  );
  if (!result.ok) throw Error("Pack unavailable");
  const seen = new Map<string, number>();
  const allSlots = {
    packId: offer.id,
    revision: offer.booster!.revision,
    cards: slots.map((cardId) => {
      seen.set(cardId, (seen.get(cardId) ?? 0) + 1);
      const grant = result.plan.cards.find((c) => c.cardId === cardId)!;
      return {
        ...grant,
        copies: 1,
        total: owned.copies(grant.heroId, cardId) + seen.get(cardId)!,
      };
    }),
  };
  result.plan.openings = Array.from(
    { length: offer.booster!.packs ?? 1 },
    (_, i) => ({ ...allSlots, cards: allSlots.cards.slice(i * 4, i * 4 + 4) }),
  );
  result.plan.opening = result.plan.openings[0];
  return result.plan;
}

/** No empty, disabled or future collection is sold; views never imply finite box stock. */
export function expansionViews(
  ctx: StoreContext,
  packs: readonly StoreOffer[],
): MarketExpansionView[] {
  return MARKET_EXPANSIONS.filter(e=>e.public!==false).map((e) => {
    const available = packs.filter((p) => p.booster?.expansionId === e.id);
    const ids = new Set(
      available.flatMap((p) =>
        p.contents.flatMap((c) => (c.kind === "CARD" ? [c.cardId] : [])),
      ),
    );
    const display = {
      id: e.id,
      name: e.name,
      description: e.description,
      art: e.art,
      status: e.status,
      poolType: e.poolType,
      championId: e.championId,
      freePacksPerPlayer: available.length ? freePackAllowance(e) : 0,
      cardIds: e.cardIds,
      highlights: e.highlights,
      synergies: e.synergies,
    };
    return {
      ...display,
      status:e.status,
      cardIds: e.cardIds.filter((id) => !!ctx.content.cards[id] && primaryMarketExpansionId(id)===e.id),
      highlights: e.highlights?.filter((h) => ids.has(h.cardId)),
      synergies: e.synergies?.filter((s) =>
        s.cardIds.every((id) => ids.has(id)),
      ),
      packs: available.map((p) => ({
        offerId: p.id,
        heroId: p.heroId!,
        price: p.price,
        policy: p.booster!,
      })),
    };
  });
}
