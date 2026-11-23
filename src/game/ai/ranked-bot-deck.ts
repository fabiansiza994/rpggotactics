import type { GameContent } from "../domain/content";
import type { CardDefinition } from "../domain/cards/card";
import { starterDeck } from "../collection/profile";
import {
  addCard,
  removeCard,
  validateDeck,
  copyLimit,
  addCardIssue,
  deckSize,
  type DeckEntry,
} from "../collection/deck-rules";
import {DECK_RULES as STORY_RULES} from "../data/rules";
import {COMPETITIVE_DECK_RULES as DECK_RULES} from "../collection/deck-formats";
import type { BotIdentity } from "./ranked-bot-policy";
const noise = (seed: number, id: string) => {
  let n = seed >>> 0;
  for (const c of id) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0;
  return n / 4294967296;
};
function families(card: CardDefinition) {
  return new Set([
    card.category,
    ...card.tags,
    ...card.effects.map((e) => e.type),
  ]);
}
/** The same legal 40-card foundation is used for availability and actual bot construction. */
export function botStarterDeck(content: GameContent, heroId: BotIdentity["heroId"], seed = 0): DeckEntry[] {
  const hero = content.heroes[heroId];
  if (!hero) throw Error("BOT_CHAMPION_DISABLED");
  const pool = Object.values(content.cards).filter(c => !c.heroId || c.heroId === heroId);
  const owned = (id: string) => content.cards[id] ? copyLimit(content.cards[id]!, DECK_RULES) : 0;
  let deck = starterDeck(hero);
  if (validateDeck(deck, heroId, owned, content, STORY_RULES).filter(issue => issue.code !== "DECK_INCOMPLETE").length)
    throw Error("BOT_STARTER_ILLEGAL");
  const fillers=[...pool].sort((a,b)=>noise(seed,a.id)-noise(seed,b.id)||a.id.localeCompare(b.id));
  while(deckSize(deck)<DECK_RULES.requiredSize){
    const next=fillers.find(c=>!addCardIssue(deck,c.id,heroId,owned,content,DECK_RULES));
    if(!next)throw Error('BOT_COLLECTION_TOO_SMALL');
    deck=addCard(deck,next.id);
  }
  if (validateDeck(deck, heroId, owned, content, DECK_RULES).length) throw Error("BOT_STARTER_ILLEGAL");
  return deck;
}
/** Account-independent: content.cards must already be filtered to the PUBLIC release by the server. */
export function botDeck(content: GameContent, bot: BotIdentity): DeckEntry[] {
  const hero = content.heroes[bot.heroId];
  if (!hero) throw Error("BOT_CHAMPION_DISABLED");
  const pool = Object.values(content.cards).filter(
    (c) => !c.heroId || c.heroId === bot.heroId,
  );
  const owned = (id: string) =>
    content.cards[id] ? copyLimit(content.cards[id]!, DECK_RULES) : 0;
  let deck = botStarterDeck(content, bot.heroId, bot.seed);
  // Advanced ritual templates are coherent packages, not isolated high-rarity cards.
  const requiredPieces = new Set<string>();
  if (
    bot.heroId === "summoner" &&
    bot.level >= 3 &&
    ["SUMMONS", "COMBOS"].includes(bot.personality)
  ) {
    const rituals = Object.values(content.rituals ?? {})
      .filter(
        (r) =>
          r.heroId === bot.heroId &&
          r.pieces.length <= bot.level - 1 &&
          r.pieces.every((id) => content.cards[id]),
      )
      .sort(
        (a, b) => b.pieces.length - a.pieces.length || a.id.localeCompare(b.id),
      );
    const ritual = rituals[0];
    if (ritual)
      for (const id of ritual.pieces) {
        requiredPieces.add(id);
        for (
          let i = 0;
          i < Math.min(2, copyLimit(content.cards[id]!, DECK_RULES));
          i++
        ) {
          const from = [...deck]
            .filter((e) => !requiredPieces.has(e.cardId) && e.count > 1)
            .sort(
              (a, b) => b.count - a.count || a.cardId.localeCompare(b.cardId),
            )[0];
          if (!from) break;
          const trial = addCard(removeCard(deck, from.cardId), id);
          if (
            !validateDeck(trial, bot.heroId, owned, content, DECK_RULES).length
          )
            deck = trial;
        }
      }
  }
  const weights: Record<string, number> = {
    ATTACK: 1,
    DEFENSE: 1,
    MOVEMENT: 1,
    CONTROL: 1,
    TERRAIN: 1,
    UTILITY: 1,
  };
  if (bot.personality === "AGGRESSIVE") weights.ATTACK = 1.5;
  if (bot.personality === "DEFENSIVE") weights.DEFENSE = 1.5;
  if (bot.personality === "CONTROL") {
    weights.CONTROL = 1.5;
    weights.TERRAIN = 1.3;
  }
  function quality(entries: DeckEntry[]) {
    const cards = entries.flatMap((e) =>
      Array.from({ length: e.count }, () => content.cards[e.cardId]!),
    );
    let score = 0;
    const avg = cards.reduce((n, c) => n + c.cost, 0) / cards.length;
    score -= Math.abs(avg - 2.1) * 12;
    const cheap = cards.filter((c) => c.cost <= 2).length;
    score -= Math.max(0, 18 - cheap) * 4;
    for (const category of Object.keys(weights)) {
      const n = cards.filter((c) => c.category === category).length;
      const target =
        category === "ATTACK"
          ? 10
          : category === "MOVEMENT"
            ? 5
            : category === "DEFENSE"
              ? 5
              : 4;
      score += Math.min(n, target) * weights[category]!;
      score -= Math.max(0, n - target - 3) * 2;
    }
    const sets = cards.map(families);
    const sum = sets.filter((s) => s.has("SUMMON")).length;
    if (bot.heroId === "summoner") {
      score += Math.min(sum, 8) * 2;
      score -= Math.max(0, 5 - sum) * 3;
    }
    if (bot.heroId === "shapeshifter") {
      const forms = cards.filter((c) =>
        c.effects.some((e) => e.type === "TRANSFORM"),
      );
      score += Math.min(forms.length, 5) * 2;
      const enabled = new Set(
        cards.flatMap((c) =>
          c.effects.flatMap((e) =>
            e.type === "TRANSFORM" && e.formId ? [e.formId] : [],
          ),
        ),
      );
      for (const card of cards)
        if (
          card.requiredForms &&
          !card.requiredForms.some((f) => f === null || enabled.has(f))
        )
          score -= 12;
    }
    if (bot.personality === "SUMMONS") score += Math.min(sum, 10) * 1.1;
    if (bot.personality === "COMBOS") {
      for (const tag of ["thunder", "summon-synergy", "form", "fire", "arcane"])
        score += Math.min(6, sets.filter((s) => s.has(tag)).length) * 0.4;
    }
    // Reliability and reproducible variation; rarity is deliberately absent from quality.
    for (const c of cards) {
      score += Math.min(3, c.effects.length) * 0.12;
      score += noise(bot.seed, c.id) * 0.7;
    }
    for (const id of requiredPieces)
      if (!entries.some((e) => e.cardId === id)) score -= 30;
    return score;
  }
  const swaps = [1, 3, 5, 7, 9, 11, 13][bot.level] ?? 1;
  for (let step = 0; step < swaps; step++) {
    let best = quality(deck),
      next: DeckEntry[] | undefined;
    for (const from of deck) {
      for (const card of pool) {
        if (card.id === from.cardId) continue;
        const trial = addCard(removeCard(deck, from.cardId), card.id);
        if (validateDeck(trial, bot.heroId, owned, content, DECK_RULES).length)
          continue;
        const q = quality(trial);
        if (q > best + 0.001) {
          best = q;
          next = trial;
        }
      }
    }
    if (!next) break;
    deck = next;
  }
  if (validateDeck(deck, bot.heroId, owned, content, DECK_RULES).length)
    throw Error("BOT_DECK_INVALID");
  return deck;
}
