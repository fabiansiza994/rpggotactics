import { DECK_RULES } from "../data/rules";
import type { DeckEntry, DeckRules } from "./deck-rules";
/** Compatibility labels only: every standard mode uses the same 40-card policy. */
export type DeckFormat = "STORY" | "COMPETITIVE";
export const COMPETITIVE_DECK_RULES: DeckRules = {
  ...DECK_RULES,
  requiredSize: 40,
  legacySize: undefined,
};
export const deckRulesFor = (format: DeckFormat) => { void format; return DECK_RULES; };
export const savedDeckFormat = (cards: readonly DeckEntry[]): DeckFormat => { void cards; return "STORY"; };
export const storedDeckRules = (cards: readonly DeckEntry[], format?: DeckFormat) => { void cards; void format; return DECK_RULES; };
