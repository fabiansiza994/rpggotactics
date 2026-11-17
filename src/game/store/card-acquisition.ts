import { cardSource, WORLDS, WORLD_CAMPAIGNS } from "../data/worlds";
import type { GameContent } from "../domain/content";
import { FREE_CATALOG } from "../data/free-catalog";
import {
  commercialExpansion,
  boosterCardEligible,
} from "./commercial-acquisition";
export interface CardAcquisitionView {
  cardId: string;
  expansionId: string | null;
  expansionName: string | null;
  inBooster: boolean;
  future: boolean;
  sources: string[];
  notice: string;
}
export function describeCardAcquisition(
  cardId: string,
  content: GameContent,
  pool?: ReadonlySet<string>,
): CardAcquisitionView | null {
  const card = content.cards[cardId];
  if (!card) return null;
  const e = commercialExpansion(cardId),
    a = card.acquisition,
    sources: string[] = [];
  if (
    Object.values(content.heroes).some(
      (h) =>
        h.deck.some((x) => x.cardId === cardId) ||
        (h.starterCollection ?? []).some((x) => x.cardId === cardId),
    )
  )
    sources.push("Copia inicial incluida");
  for (const entry of Object.values(FREE_CATALOG)
    .flat()
    .filter((x) => x.cardId === cardId && x.unlock.type !== "STARTER")) {
    const u = entry.unlock;
    sources.push(
      u.type === "MASTERY_LEVEL"
        ? `Recompensa de Maestría ${u.level}`
        : u.type === "WORLD_COMPLETED"
          ? `Recompensa por completar ${WORLDS.find((w) => w.id === u.worldId)?.name ?? u.worldId}`
          : u.type === "ENCOUNTER_CLEAR"
            ? `Recompensa de progreso en ${WORLD_CAMPAIGNS[u.campaignId]?.name ?? u.campaignId}`
            : "Recompensa de progreso",
    );
  }
  if (a?.source === "WORLD_COMPLETION")
    sources.push(
      `Recompensa especial por completar ${cardSource(card)?.worldName ?? a.worldId}`,
    );
  if (a?.source === "ENCOUNTER_REWARD")
    sources.push(
      `Recompensa de campaña · ${cardSource(card)?.worldName ?? a.worldId}`,
    );
  if (a?.source === "RANKED_TRACK") sources.push("Acceso anticipado · Ranked");
  if (a?.source === "RANKED_PREMIUM")
    sources.push("Acceso anticipado · Pase Premium Ranked");
  const inBooster = pool
    ? pool.has(cardId)
    : boosterCardEligible(card, content);
  const temporary =
    a?.source === "RANKED_TRACK" || a?.source === "RANKED_PREMIUM";
  return {
    cardId,
    expansionId: e?.id ?? null,
    expansionName: e?.name ?? null,
    inBooster,
    future: e?.status !== "AVAILABLE",
    sources,
    notice: inBooster
      ? sources.length
        ? "Más copias disponibles en:"
        : "Disponible en:"
      : temporary
        ? "Actualmente no aparece en sobres."
        : card.rarity === "ULTRA"
          ? "Recompensa especial · 0 % en sobres."
          : e?.status !== "AVAILABLE"
            ? "Expansión próximamente."
            : "Actualmente no aparece en sobres.",
  };
}
