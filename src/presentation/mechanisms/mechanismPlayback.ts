import { create } from 'zustand';
import type { GameState } from '../../game';
/** Read-only display snapshot owned by the existing visual queue. Never dispatches commands. */
export const useMechanismPlayback = create<{ state: Readonly<GameState> | null }>(() => ({
  state: null,
}));
export function presentMechanisms(state: Readonly<GameState>) {
  useMechanismPlayback.setState({ state });
}
