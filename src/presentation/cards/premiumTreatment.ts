import type { CardDefinition } from '../../game';
import { worldRewardIdentity } from './worldRewardPresentation';

export type PremiumTreatment = 'none' | 'subtle' | 'showcase' | 'holographic' | 'legendary';
export type PremiumLayer = { src: string; depth: 'background' | 'subject' | 'foreground' };
export interface PremiumIdentity {
  treatment: PremiumTreatment;
  family: string;
  motif: 'arcane' | 'spectral' | 'metal' | 'forge' | 'dragon';
  layers?: readonly PremiumLayer[];
}
/** Presentation registry: optional art layers and future promo/store treatments live here.
 * Rules, rarity, costs, acquisitions and drop tables never import this module. */
export const PREMIUM_VISUAL_OVERRIDES: Readonly<Record<string, Partial<PremiumIdentity>>> = {
  // Motifs only: the holographic (super) finish belongs to LEGENDARY cards, never to a Rare.
  siege_leap: { motif: 'metal' },
  tracking_arrow: { motif: 'spectral' },
  rebound_arrow: { motif: 'metal' },
  summon_war_drake: { motif: 'dragon' },
  // Dragón Primordial seals: showcase foil with the dragon motif (store ritual pack).
  seal_claw: { motif: 'dragon' },
  seal_fang: { motif: 'dragon' },
  seal_wing: { motif: 'dragon' },
  seal_heart: { motif: 'dragon' },
};
export function premiumIdentity(card: CardDefinition): PremiumIdentity {
  const origin = worldRewardIdentity(card);
  const family = card.heroId ?? 'neutral';
  // Finish follows the rarity ladder: ULTRA → ultra, LEGENDARY → super (holographic). A Rare from
  // a world, the campaign or Ranked keeps the Rare finish; its origin is a separate seal
  // (CardOriginBadge). Showcase stays a cosmetic variant of the card.
  const treatment: PremiumTreatment =
    card.presentation.premiumTreatment === 'showcase'
      ? 'showcase'
      : card.rarity === 'ULTRA'
        ? 'legendary'
        : card.rarity === 'LEGENDARY'
          ? 'holographic'
          : origin || card.tags.includes('ancestral') || card.ritualPiece || card.rarity === 'RARE'
            ? 'subtle'
            : 'none';
  return {
    treatment,
    family,
    motif: origin
      ? origin.worldId === 'world_2' ? 'forge' : 'arcane'
      : family === 'warrior'
        ? 'metal'
        : family === 'summoner'
          ? 'spectral'
          : 'arcane',
    ...PREMIUM_VISUAL_OVERRIDES[card.id],
  };
}
export function premiumPointer(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
  max = 6,
) {
  const nx = Math.max(-1, Math.min(1, ((x - rect.left) / Math.max(1, rect.width)) * 2 - 1));
  const ny = Math.max(-1, Math.min(1, ((y - rect.top) / Math.max(1, rect.height)) * 2 - 1));
  return {
    x: nx,
    y: ny,
    angleX: -ny * max,
    angleY: nx * max,
    lightX: (nx + 1) * 50,
    lightY: (ny + 1) * 50,
  };
}

/** Finish labels are visual tiers, never additional gameplay rarities. */
export type CardRarityFinish = 'common' | 'rare' | 'super' | 'ultra' | 'secret' | 'arcana-secret';
/** Cosmetic metadata on presentation copies only; never persisted into engine content. */
export type FinishedCard = CardDefinition & { cosmeticFinish?: 'arcana-secret' };
export function withArcanaSecret(card: CardDefinition): FinishedCard {
  return { ...card, cosmeticFinish: 'arcana-secret' };
}
export function cardRarityFinish(card: CardDefinition): CardRarityFinish {
  if ((card as FinishedCard).cosmeticFinish === 'arcana-secret') return 'arcana-secret';
  const { treatment } = premiumIdentity(card);
  if (treatment === 'showcase') return 'secret';
  if (treatment === 'legendary') return 'ultra';
  if (treatment === 'holographic') return 'super';
  if (card.rarity === 'RARE') return 'rare';
  return 'common';
}
