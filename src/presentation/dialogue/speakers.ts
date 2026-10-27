import type { DialoguePortraitVariant } from '../../game/dialogue/dialogue';
import { portraitVariantFor } from './portraitVariants';
import type { GameContent } from '../../game';
import { championPortrait } from '../assets/champions';
import { CHARACTER_PAINTINGS } from '../assets/paintedAssets';
import { unitVisualId } from '../assets/visualIdentity';

/** Display name and the existing painting for a dialogue speaker (placeholders until Codex). */
export interface SpeakerView {
  id: string;
  name: string;
  /** Existing painting URL, or undefined → monogram placeholder. */
  portrait?: string;
  isHero: boolean;
  basePortrait?: string;
  portraitVariant?: DialoguePortraitVariant;
}

export const NARRATOR = 'narrator';

export function speakerView(content: GameContent, id: string, portraitOverride?: string, variant: DialoguePortraitVariant = 'neutral'): SpeakerView {
  const hero = content.heroes[id];
  const enemy = content.enemies[id];
  const art = portraitOverride ?? id;
  const portrait = content.heroes[art] ? championPortrait(art) : CHARACTER_PAINTINGS[art] ?? CHARACTER_PAINTINGS[unitVisualId(art)];
  const chosen = portraitVariantFor(art, variant);
  return {
    id,
    name: hero?.name ?? enemy?.name ?? (id === NARRATOR ? '' : id.replace(/_/g, ' ')),
    portrait: id === NARRATOR && !portraitOverride ? undefined : chosen?.src ?? portrait,
    basePortrait: portrait,
    portraitVariant: chosen?.variant,
    isHero: !!hero,
  };
}
