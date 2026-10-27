import { RANKED_PREMIUM_CARDS, type RankedPremiumCardId } from '../data/ranked-premium-cards';
import type { CosmeticDef } from '../store/store';

/**
 * Ranked Premium Track cosmetics: ids + names + visual intent (art comes in Codex's pass). Leaf
 * module (no track imports) so rewardTrack.ts / rankedCosmetics.ts can merge it without cycles.
 * Never in the store registry (COSMETICS): only the pass grant (migration 0027) owns them.
 * Every cosmetic here is permanent and exclusive to the season's pass.
 */

export interface RankedPremiumTitle {
  id: string;
  name: string;
  nodeId: string;
  exclusive: true;
}

/** Shares the one equipped title slot with Mastery and the free track. */
export const RANKED_PREMIUM_TITLES: readonly RankedPremiumTitle[] = [
  { id: 'ranked.premium.preseason_0.pretender', name: 'Pretendiente Arcano', nodeId: 'DIAMOND_III', exclusive: true },
];

export interface RankedPremiumCosmetic extends CosmeticDef {
  /** Visual intent for Codex (qa/ranked-premium-track/CODEX_HANDOFF.md). */
  intent: string;
}

/** Frames + card back. Frames are equippable today; the card back is owned, its renderer is pending. */
export const RANKED_PREMIUM_COSMETICS: Readonly<Record<string, RankedPremiumCosmetic>> = {
  frame_premium_circle_bronze: {
    id: 'frame_premium_circle_bronze',
    kind: 'PROFILE_FRAME',
    name: 'Bronce del Círculo',
    description: 'Marco de bronce grabado con el Círculo Arcano.',
    intent: 'Bronce envejecido con runas del Círculo incrustadas; brillo cálido discreto.',
  },
  frame_premium_threshold_crown: {
    id: 'frame_premium_threshold_crown',
    kind: 'PROFILE_FRAME',
    name: 'Corona del Umbral',
    description: 'Una corona de luz arcana sobre el retrato.',
    intent: 'Corona de oro pálido con filo azul que flota sobre el retrato; pulso lento (respeta reduced-motion).',
  },
  cardback_premium_arcane_circle: {
    id: 'cardback_premium_arcane_circle',
    kind: 'CARD_BACK',
    name: 'Sello del Círculo Arcano',
    description: 'Reverso de carta con el sello del Círculo Arcano.',
    intent: 'Sello circular dorado sobre azul noche; legible a tamaño de mano (sin texto).',
  },
};

/** Showcase of a premium card: CARD_ART cosmetic, same gameplay (presentation only). */
export const showcaseCosmeticId = (cardId: string) => `showcase_${cardId}`;

/** The five Showcase variants the Diamante I choice can grant (exactly one per account and season). */
export const RANKED_PREMIUM_SHOWCASES: Readonly<Record<string, RankedPremiumCosmetic>> = Object.fromEntries(
  RANKED_PREMIUM_CARDS.map((card) => [
    showcaseCosmeticId(card.id),
    {
      id: showcaseCosmeticId(card.id),
      kind: 'CARD_ART' as const,
      name: `${card.name} · Showcase`,
      heroId: card.heroId,
      targetId: card.id,
      description: 'Acabado Showcase: mismo efecto, mismo coste, mismas estadísticas.',
      intent: 'Arte extendido + marco premium + foil sutil (premiumTreatment showcase). Nunca cambia el juego.',
    },
  ]),
);

export const RANKED_PREMIUM_SHOWCASE_CHOICES = RANKED_PREMIUM_CARDS.map((c) => c.id as RankedPremiumCardId);
