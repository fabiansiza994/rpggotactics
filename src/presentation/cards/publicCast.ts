import { create } from 'zustand';
import type { EventOfType } from '../../game';
export type PublicCast = Pick<EventOfType<'CARD_PLAYED'>, 'cardId' | 'cardUid' | 'casterId'>;
/** Only a publicly resolved CARD_PLAYED fact, never an opponent hand or altar contents. */
export const usePublicCast = create<{ cast: PublicCast | null; action: PublicEnemyAction | null; ritual: PublicRitual | null }>(
  () => ({ cast: null, action: null, ritual: null }),
);
export function presentPublicCast(cast: PublicCast | null) {
  usePublicCast.setState({ cast });
}

export type PublicEnemyAction = Pick<EventOfType<'ENEMY_ACTION_STARTED'>, 'enemyId' | 'intent'>;
export const ENEMY_ACTION_LABELS = {
  MELEE_ATTACK: 'Ataque cuerpo a cuerpo',
  CHARGE: 'Embestida',
  APPROACH: 'Avance',
  AREA_SPELL: 'Conjuro de área',
  IDLE: 'Espera',
} as const;
export function presentPublicAction(action: PublicEnemyAction | null) {
  usePublicCast.setState({ action });
}

export type PublicRitual = Pick<EventOfType<"RITUAL_ACTIVATED">, "casterId" | "ritualId" | "pieces">;
export function presentPublicRitual(ritual: PublicRitual | null) { usePublicCast.setState({ritual}); }
