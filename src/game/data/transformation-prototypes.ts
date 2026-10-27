import type { TransformationDef } from '../domain/transformations/transformations';

/** Phase 1 ONLY. Not merged into DEFAULT_CONTENT, roster, cards, rewards or server release. */
export const PROTOTYPE_TRANSFORMATIONS: Readonly<Record<string, TransformationDef>> = {
  bear: { id: 'bear', name: 'Oso', nature: 'BEAST', armorBonus: 2, provisional: true },
  minotaur: { id: 'minotaur', name: 'Minotauro', nature: 'BEAST', armorBonus: 1, provisional: true },
};
