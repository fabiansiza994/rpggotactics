import { rarityOf, DEFAULT_CONTENT } from "../../game";
import type { CatalogOffer } from "./api";
export const MARKET_SECTIONS = [
  { id: "featured", label: "Destacados" },
  { id: "packs", label: "Expansiones" },
  { id: "cards", label: "Cartas individuales" },
  { id: "cosmetics", label: "Cosméticos" },
  { id: "crystals", label: "Cristales Arcanos" },
] as const;
export type MarketSection = (typeof MARKET_SECTIONS)[number]["id"];
export function marketOffers(
  offers: readonly CatalogOffer[],
  section: MarketSection,
  hero = "",
  rarity = "",
  availableOnly = false,
): CatalogOffer[] {
  const seen = new Set<string>();
  return offers.filter((o) => {
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    if (section === "featured" && o.booster) {
      const free = offers.find(
        (f) =>
          f.booster?.freeGrant &&
          f.booster.expansionId === o.booster!.expansionId,
      );
      const available = (free?.freeRemaining ?? 0) > 0;
      if (
        available
          ? !o.booster.freeGrant
          : !!o.booster.freeGrant || (o.booster.packs ?? 1) > 1
      )
        return false;
    }
    const category =
      section === "featured"
        ? o.categories.includes("FEATURED") ||
          (o.type !== "CARD" && o.type !== "COSMETIC")
        : section === "packs"
          ? !!o.booster
          : section === "cards"
            ? o.type === "CARD"
            : section === "cosmetics"
              ? o.contents.some((c) => c.kind === "COSMETIC")
              : false;
    return (
      category &&
      (!hero || o.heroId === hero || !o.heroId) &&
      (!availableOnly || o.availability.purchasable) &&
      (!rarity ||
        o.contents.some(
          (c) =>
            c.kind === "CARD" &&
            DEFAULT_CONTENT.cards[c.cardId] &&
            rarityOf(DEFAULT_CONTENT.cards[c.cardId]!) === rarity,
        ))
    );
  });
}
export const RARITY_LABELS = {
  COMMON: "Común",
  UNCOMMON: "Infrecuente",
  RARE: "Rara",
  LEGENDARY: "Legendaria",
  ULTRA: "Ultra",
} as const;
