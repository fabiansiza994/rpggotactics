import type { GameState } from '../state';
/** Old persisted PvP games keep legacy rules; PvE and new games use the current content. */
export const beastsEnabled = (state: GameState): boolean => !state.duel || state.duel.beastsRelease === true;
