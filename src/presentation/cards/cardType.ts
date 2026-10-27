import type { CardDefinition } from '../../game';
import type { IconName } from '../assets/iconPaths';
export type CardVisualType = 'summon' | 'spell' | 'defense' | 'tactic' | 'ritual';
export const CARD_TYPE_VISUALS: Record<CardVisualType, { label: string; icon: IconName }> = {
  summon: { label: 'Invocación', icon: 'prey' },
  spell: { label: 'Efecto / hechizo', icon: 'arcane' },
  defense: { label: 'Defensa / protección', icon: 'shield' },
  tactic: { label: 'Movimiento / táctica', icon: 'move' },
  ritual: { label: 'Ritual / especial', icon: 'energy' },
};
/** UI metadata only. No rarity, ownership or champion-id rules participate. */
export function cardVisualType(card: CardDefinition): CardVisualType {
  if (card.presentation.cardType) return card.presentation.cardType;
  const effects = [...card.effects, ...(card.formEffects?.HUMAN ?? []), ...(card.formEffects?.BEAST ?? [])];
  if (card.ritualPiece || card.tags.includes('ritual') || effects.some(e => e.type === 'TRANSFORM')) return 'ritual';
  if (effects.some(e => e.type === 'SUMMON')) return 'summon';
  if (card.category === 'DEFENSE' || (!effects.some(e => e.type === 'DAMAGE') && effects.some(e => e.type === 'CREATE_OBSTACLE'))) return 'defense';
  if (card.category === 'MOVEMENT' || card.deckSearch || card.discardSearch) return 'tactic';
  if (!effects.some(e => e.type === 'DAMAGE') && effects.some(e => ['TELEPORT_CASTER', 'STEP_CASTER', 'SWAP_WITH_TARGET', 'GAIN_MOVE_POINTS', 'PUSH'].includes(e.type))) return 'tactic';
  if (!effects.some(e => e.type === 'DAMAGE') && effects.some(e => e.type === 'HEAL' || e.type === 'SHIELD' || e.type === 'CLEANSE')) return 'defense';
  return 'spell';
}

/** Header/art trim palette, independent from the five existing semantic type icons. */
export type CardTypePalette = 'summon' | 'attack' | 'effect' | 'defense' | 'movement' | 'utility' | 'neutral';
export function cardTypePalette(card: CardDefinition): CardTypePalette {
  const type = cardVisualType(card);
  if (type === 'ritual') return 'effect';
  if (type === 'summon') return 'summon';
  if (!card.heroId) return 'neutral';
  if (type === 'defense') return 'defense';
  if (type === 'tactic') return 'movement';
  if (card.category === 'ATTACK') return 'attack';
  if (card.category === 'UTILITY' || card.category === 'TERRAIN') return 'utility';
  return 'effect';
}
