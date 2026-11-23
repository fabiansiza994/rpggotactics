import { MARKET_EXPANSIONS } from '../store/market-expansions';
import type { GameContent, HeroDef } from '../domain/content';
import { copyLimit, validateDeck, type DeckEntry, type DeckRules } from './deck-rules';

/** New accounts only. Does not mutate hero definitions, saved decks or existing collections. */
export function freshStarterDeck(hero: HeroDef, content: GameContent, rules: DeckRules): DeckEntry[] {
  const cards = hero.deck.map(entry => ({ ...entry }));
  let count = cards.reduce((total, entry) => total + entry.count, 0);
  const commercial = new Set(MARKET_EXPANSIONS.filter(set => set.status === 'AVAILABLE' && set.pack).flatMap(set => [...set.cardIds]));
  const starterSets = new Set(hero.deck.map(entry => content.cards[entry.cardId]?.expansion).filter(Boolean));
  const starterIds = new Set((hero.starterCollection ?? []).map(entry => entry.cardId));
  const candidates = Object.values(content.cards).filter(card => card.heroId === hero.id
    && (!card.acquisition || (hero.id === 'archer' && commercial.has(card.id) && card.acquisition.source === 'ENCOUNTER_REWARD')) && !card.unique && card.rarity !== 'ULTRA'
    && (!card.expansion || content.releasedExpansions?.includes(card.expansion) || starterSets.has(card.expansion) || starterIds.has(card.id) || commercial.has(card.id))
    )
    .sort((a, b) => (a.rarity === 'COMMON' ? 0 : 1) - (b.rarity === 'COMMON' ? 0 : 1)
      || a.cost - b.cost || a.id.localeCompare(b.id));
  for (const card of candidates) {
    const existing = cards.find(entry => entry.cardId === card.id);
    const extra = Math.min(rules.requiredSize - count, Math.max(0, copyLimit(card, rules) - (existing?.count ?? 0)));
    if (extra > 0) {
      if (existing) existing.count += extra;
      else cards.push({ cardId: card.id, count: extra });
      count += extra;
    }
    if (count === rules.requiredSize) break;
  }
  const owned = (id: string) => cards.find(entry => entry.cardId === id)?.count ?? 0;
  const issues = validateDeck(cards, hero.id, owned, content, rules);
  if (issues.length) throw new Error(`No legal fresh starter for ${hero.id}: ${issues.map(issue => issue.code).join(', ')}`);
  // Neutral additions are deliberately forbidden; the historical shared starter pool is unchanged.
  if (cards.filter(entry => content.cards[entry.cardId]?.heroId === undefined).some(entry => !hero.deck.some(old => old.cardId === entry.cardId && old.count === entry.count)))
    throw new Error('Fresh starter must preserve the shared neutral pool.');
  return cards;
}
