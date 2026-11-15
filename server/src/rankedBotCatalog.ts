import { releasedContent } from "./ritualRelease";
import { championAllowed } from "./warriorRelease";
import type { GameContent } from "../../src/game";
import type { Env } from "./db";
/** Flags are PUBLIC flags only: never honor an account-specific QA entitlement for a bot. */
export function rankedBotCatalog(content: GameContent, env: Env): GameContent {
  const released = releasedContent(content, {
    ...env,
    ARCHER_QA: "0",
    SHAPESHIFTER_QA: "0",
  });
  const cards = Object.fromEntries(
    Object.entries(released.cards).filter(
      ([, c]) =>
        (!c.heroId ||
          ["mage", "summoner", "shapeshifter"].includes(c.heroId)) &&
        (!c.expansion ||
          released.releasedExpansions?.includes(c.expansion) ||
          (c.heroId === "shapeshifter" &&
            env.SHAPESHIFTER_ENABLED === "1" &&
            released.heroes.shapeshifter?.starterCollection?.some(
              (e) => e.cardId === c.id,
            ))) &&
        !c.tags.some((t) =>
          ["nature", "qa", "experimental", "prototype"].includes(
            t.toLowerCase(),
          ),
        ) &&
        (c.acquisition?.source !== "RANKED_PREMIUM" ||
          env.RANKED_PREMIUM_ENABLED === "1") &&
        (c.acquisition?.source !== "RANKED_TRACK" ||
          env.RANKED_PRESEASON_ENABLED === "1"),
    ),
  );
  const heroes = Object.fromEntries(
    Object.entries(released.heroes).filter(
      ([id]) =>
        ["mage", "summoner", "shapeshifter"].includes(id) &&
        championAllowed(id, env, ""),
    ),
  );
  return { ...released, cards, heroes };
}
