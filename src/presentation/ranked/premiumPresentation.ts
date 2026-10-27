import { RANKED_PREMIUM_CARDS } from '../../game/data/ranked-premium-cards';
import {
  premiumItemName,
  type PremiumItemView,
  type PremiumNodeView,
} from '../../game/ranked/premiumTrack';
import { FINAL_CARD_ART } from '../assets/paintedAssets';

export const PREMIUM_CARDS = Object.fromEntries(
  RANKED_PREMIUM_CARDS.map((card) => [card.id, card]),
);
export const premiumName = (item: PremiumItemView) => premiumItemName(item, PREMIUM_CARDS);
export const premiumStatus = (status: PremiumItemView['status'], purchased: boolean) =>
  ({
    LOCKED: 'Hito bloqueado',
    UNLOCKED: 'Requiere Premium',
    CLAIMABLE: purchased ? 'Pendiente de entrega' : 'Requiere Premium',
    CLAIMED: 'Concedido',
  })[status];
export const nextPremiumNode = (nodes: readonly PremiumNodeView[]) =>
  nodes.find((n) => n.items.some((i) => i.status !== 'CLAIMED'));
/** Explicit allowlist: only verified, shipped art belongs here. Missing reward art never makes a request. */
export const PREMIUM_REWARD_ART: Readonly<Record<string, string>> = Object.fromEntries([
  'premium_arcane_emblem', 'premium_celestial_fox', 'premium_golden_circle_sorcerer',
  'frame_premium_circle_bronze', 'frame_premium_threshold_crown', 'cardback_premium_arcane_circle',
].map(id => [id, `/art/${id.startsWith('premium_') ? 'profile-avatars' : 'ranked-premium'}/${id}.webp`]));
export function premiumArt(item: PremiumItemView): string | undefined {
  return item.cardId
    ? FINAL_CARD_ART[item.cardId]
    : item.type === 'SHOWCASE_CHOICE'
      ? FINAL_CARD_ART[item.chosenCardId ?? 'double_moon_pact']
      : PREMIUM_REWARD_ART[item.avatarId ?? item.cosmeticId ?? ''];
}

/** Small rail nodes use controlled crops; large details retain the complete composition. */
export function premiumThumbnail(item: PremiumItemView): string | undefined {
  const art = premiumArt(item);
  return art?.endsWith('.webp')
    ? art.replace('.webp', '-thumb.webp') : art;
}
