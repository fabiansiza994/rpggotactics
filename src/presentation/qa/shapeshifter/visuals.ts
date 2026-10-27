import type { CSSProperties } from 'react';
import type { GameContent, GameEvent, GameState, Unit } from '../../../game';
import { DURATION } from '../../motion/tokens';

export type FormPose = 'idle' | 'attack' | 'hurt' | 'death';
export interface FormVisual {
  id: string;
  label: string;
  accent: string;
  secondary: string;
  idleMotion: 'mantle' | 'heavy' | 'axe';
  reveal: 'ancestral' | 'earth' | 'iron';
  scale: number;
  icon: string;
  poses: Record<FormPose, string>;
  locomotion: { atlas: string; walkFrames: number; runFrames: number };
}
const root = '/art/qa-shapeshifter/';
const form = (
  id: string,
  label: string,
  accent: string,
  secondary: string,
  idleMotion: FormVisual['idleMotion'],
  reveal: FormVisual['reveal'],
  scale: number,
  runFrames = 3,
): FormVisual => ({
  id,
  label,
  accent,
  secondary,
  idleMotion,
  reveal,
  scale,
  icon: `${root}${id}-icon.webp`,
  locomotion: { atlas: `${root}${id}-locomotion.webp`, walkFrames: 3, runFrames },
  poses: {
    idle: `${root}${id}-idle.webp`,
    attack: `${root}${id}-attack.webp`,
    hurt: `${root}${id}-hurt.webp`,
    death: `${root}${id}-death.webp`,
  },
});
/** The only form-specific presentation registry. More forms need assets + one registration. */
export const QA_FORM_VISUALS: Readonly<Record<string, FormVisual>> = {
  humanoid: form('humanoid', 'Humanoide', '#80d9c5', '#c6a46c', 'mantle', 'ancestral', 1),
  bear: form('bear', 'Oso', '#a8d7a1', '#aa743a', 'heavy', 'earth', 1.12),
  minotaur: form('minotaur', 'Minotauro', '#70d5d0', '#df994d', 'axe', 'iron', 1.08, 2),
};
export const QA_TRANSFORM_ART: Readonly<Record<string, { art: string; visualId: string }>> = {
  qa_bear_form: { art: root + 'bear-card.webp', visualId: 'bear' },
  qa_minotaur_form: { art: root + 'minotaur-card.webp', visualId: 'minotaur' },
};
export const QA_CHAMPION_PORTRAIT = root + 'portrait.webp';
export const FORM_REVEAL_MS = DURATION.cinematic;
export const formVisual = (
  formId?: string | null,
  registry: Readonly<Record<string, FormVisual>> = QA_FORM_VISUALS,
): FormVisual => registry[formId ?? 'humanoid'] ?? registry.humanoid!;
export const formStyle = (v: FormVisual): CSSProperties =>
  ({
    '--form-accent': v.accent,
    '--form-secondary': v.secondary,
    '--form-scale': v.scale,
    '--form-reveal-ms': `${FORM_REVEAL_MS}ms`,
  }) as CSSProperties;
export interface VisualCue {
  motion: 'attack' | 'hurt' | 'death' | 'transform';
  previousForm?: string | null;
}
export interface VisualBatch {
  serial: number;
  cues: Record<string, VisualCue>;
  ghosts: Unit[];
}
export const EMPTY_VISUAL_BATCH: VisualBatch = { serial: 0, cues: {}, ghosts: [] };
/** Presentation reads accepted events only; this function never mutates authoritative state. */
export function eventVisuals(
  before: Readonly<GameState>,
  after: Readonly<GameState>,
  events: readonly GameEvent[],
  content: GameContent,
  serial: number,
): VisualBatch {
  const cues: Record<string, VisualCue> = {},
    ghosts: Unit[] = [];
  for (const event of events) {
    if (event.type === 'FORM_CHANGED')
      cues[event.unitId] = { motion: 'transform', previousForm: event.from };
    if (
      event.type === 'CARD_PLAYED' &&
      content.cards[event.cardId]?.effects.some((e) => e.type === 'DAMAGE')
    )
      cues[event.casterId] = { motion: 'attack' };
    if (event.type === 'UNIT_DAMAGED') cues[event.unitId] = { motion: 'hurt' };
    if (event.type === 'UNIT_DEFEATED') {
      cues[event.unitId] = { motion: 'death' };
      const unit = before.units.find((u) => u.id === event.unitId);
      if (unit && !after.units.some((u) => u.id === unit.id)) ghosts.push({ ...unit, hp: 0 });
    }
  }
  return { serial, cues, ghosts };
}
/** Sprites face right natively; mirror toward the nearest enemy without touching logical facing. */
export function facingFor(unit: Unit, units: readonly Unit[]): 1 | -1 {
  let nearest: Unit | undefined,
    distance = Infinity;
  for (const candidate of units) {
    if (candidate.faction === unit.faction || candidate.hp <= 0) continue;
    const d = Math.abs(candidate.pos.x - unit.pos.x) + Math.abs(candidate.pos.y - unit.pos.y);
    if (d < distance || (d === distance && candidate.id < (nearest?.id ?? '~'))) {
      nearest = candidate;
      distance = d;
    }
  }
  return nearest && nearest.pos.x < unit.pos.x ? -1 : 1;
}
