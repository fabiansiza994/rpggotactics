import { DECK_RULES } from "../data/rules";
import type { DeckEntry, DeckRules } from "./deck-rules";
import { deckSize } from "./deck-rules";
/** Separate policy: never overwrite the Story/campaign rules or a saved 30-card list. */
export type DeckFormat = "STORY" | "COMPETITIVE";
export const COMPETITIVE_DECK_RULES: DeckRules = {
  ...DECK_RULES,
  requiredSize: 40,
  legacySize: undefined,
};
export const deckRulesFor = (format: DeckFormat) =>
  format === "COMPETITIVE" ? COMPETITIVE_DECK_RULES : DECK_RULES;
export const savedDeckFormat = (cards: readonly DeckEntry[]): DeckFormat =>
  deckSize(cards) === 40 ? "COMPETITIVE" : "STORY";
export const storedDeckRules = (
  cards: readonly DeckEntry[],
  format?: DeckFormat,
) => deckRulesFor(format ?? savedDeckFormat(cards));
