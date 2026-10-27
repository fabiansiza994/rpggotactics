/** Shared release adapter. Availability is enforced separately; no experimental combat-depth rules. */
import type { GameContent } from '../domain/content';
import { shapeshifterCatalog } from './shapeshifter-catalog';
import { RANKED_SHAPESHIFTER_CARDS } from './ranked-cards';
import { RANKED_PREMIUM_SHAPESHIFTER_CARDS } from './ranked-premium-cards';
import { TEMPLE_SHAPESHIFTER_CARDS } from './temple-rewards';
import { FREE_CATALOG_SHAPESHIFTER_CARDS } from './free-catalog';
export function withShapeshifterRelease(base: GameContent): GameContent {
  if (base.heroes.shapeshifter?.guaranteedTransformationOpening) return base;
  const c = shapeshifterCatalog(base);
  // Ranked Reward Track card: added AFTER the catalog so it never joins the starter collection.
  const cards = { ...c.cards, ...Object.fromEntries([...RANKED_SHAPESHIFTER_CARDS, ...RANKED_PREMIUM_SHAPESHIFTER_CARDS, ...TEMPLE_SHAPESHIFTER_CARDS, ...FREE_CATALOG_SHAPESHIFTER_CARDS].map((card) => [card.id, card])) };
  return { ...c, cards, defaultHeroId: base.defaultHeroId, heroes: { ...c.heroes,
    shapeshifter: { ...c.heroes.shapeshifter!, name: 'Cambiaformas', visualKey: 'shapeshifter',
      guaranteedTransformationOpening: true } } };
}
