import { hasGuaranteedFreeCatalogRoute } from "../data/free-catalog";
import type { CardDefinition } from "../domain/cards/card";
import type { GameContent } from "../domain/content";
import { MARKET_EXPANSIONS } from "./market-expansions";
import { primaryMarketExpansionId } from "./market-primary";
/** Commercial release only: campaign/drop/import gates and historical acquisition stay unchanged. */
const COMMERCIAL_TECHNICAL_SETS = new Set([
  "archer_core",
  "archer_hunt",
  "forbidden_bond",
]);
export const commercialExpansion = (cardId: string) =>
  MARKET_EXPANSIONS.find((e) => e.id === primaryMarketExpansionId(cardId));
export const commercialOverlap = (card: CardDefinition) => {
  const e = commercialExpansion(card.id);
  return (
    !!e?.pack &&
    e.status === "AVAILABLE" &&
    e.cardIds.includes(card.id) &&
    (hasGuaranteedFreeCatalogRoute(card) ||
      ["WORLD_COMPLETION", "ENCOUNTER_REWARD"].includes(
        card.acquisition?.source ?? "",
      ))
  );
};
export const commercialSetReleased = (
  card: CardDefinition,
  content: GameContent,
) =>
  !card.expansion ||
  (content.releasedExpansions ?? []).includes(card.expansion) ||
  (!!commercialExpansion(card.id)?.pack &&
    COMMERCIAL_TECHNICAL_SETS.has(card.expansion));
export function boosterCardEligible(
  card: CardDefinition,
  content: GameContent,
): boolean {
  const e = commercialExpansion(card.id);
  return (
    !!e?.pack &&
    e.status === "AVAILABLE" &&
    e.cardIds.includes(card.id) &&
    (e.pack.policy.inventory === "FINITE" || (e.pack.policy.weights[card.rarity ?? "COMMON"] ?? 0) > 0) &&
    commercialSetReleased(card, content) &&
    !card.tags.some((t) =>
      ["qa", "experimental", "prototype"].includes(t.toLowerCase()),
    ) &&
    (!card.acquisition || commercialOverlap(card))
  );
}
