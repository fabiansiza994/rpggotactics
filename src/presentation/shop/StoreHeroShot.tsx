import type { ReactNode } from 'react';
import { DEFAULT_CONTENT, rarityOf, type StoreOffer } from '../../game';
import '../../styles/shop-hero.css';

const RARITY_RANK = { COMMON: 0, UNCOMMON: 1, RARE: 2, LEGENDARY: 3, ULTRA: 4 } as const;
const RARITY_BADGE = { COMMON: 'Común', UNCOMMON: 'Infrecuente', RARE: 'Rara', LEGENDARY: 'Legendaria', ULTRA: 'Ultra' } as const;

/** The offer's star card: its `featuredCardId`, else its highest-rarity card (first on ties). */
export function featuredCardOf(offer: Pick<StoreOffer, 'contents' | 'featuredCardId'>): string | null {
  if (offer.featuredCardId) return offer.featuredCardId;
  let best: string | null = null;
  for (const c of offer.contents) {
    if (c.kind !== 'CARD' || !DEFAULT_CONTENT.cards[c.cardId]) continue;
    if (!best || RARITY_RANK[rarityOf(DEFAULT_CONTENT.cards[c.cardId]!)] > RARITY_RANK[rarityOf(DEFAULT_CONTENT.cards[best]!)]) best = c.cardId;
  }
  return best;
}

/** True when the offer holds a Showcase Rare (premium visual treatment). */
export const isPremiumOffer = (offer: Pick<StoreOffer, 'contents'>): boolean =>
  offer.contents.some((c) => c.kind === 'CARD' && DEFAULT_CONTENT.cards[c.cardId]?.presentation.premiumTreatment === 'showcase');

/**
 * Store modal hero shot: the card stands at a 3/4 angle with depth (perspective, floor shadow),
 * keeps the existing premium pointer tilt on top of that base angle, and eases in when the shown
 * card changes. Pure presentation (CSS in shop-hero.css).
 */
export function StoreHeroShot({ cardId, star, children }: { cardId: string; star: boolean; children: ReactNode }) {
  const card = DEFAULT_CONTENT.cards[cardId];
  const showcase = card?.presentation.premiumTreatment === 'showcase';
  return (
    <div className="shop-hero-shot" key={cardId} data-showcase={showcase || undefined}>
      <div className="shop-hero-badges">
        {star && <span className="shop-hero-badge is-star">Carta destacada</span>}
        {showcase && <span className="shop-hero-badge is-premium">✦ Premium incluida</span>}
        {card && <span className={`shop-hero-badge rarity-${rarityOf(card).toLowerCase()}`}>{RARITY_BADGE[rarityOf(card)]}</span>}
      </div>
      <div className="shop-hero-stage">{children}</div>
      <span className="shop-hero-floor" aria-hidden="true" />
    </div>
  );
}
