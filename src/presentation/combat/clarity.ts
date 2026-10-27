import type { GameState } from '../../game';
export type CombatPhase = 'ENEMY_TURN' | 'RESOLVING' | 'PLAYER_TURN' | 'FINISHED';
/** Display/control contract only; never advances the engine. */
export function combatPhase(state: Readonly<GameState>, locked: boolean): CombatPhase {
  if (locked) return 'RESOLVING';
  if (state.outcome) return 'FINISHED';
  return state.phase === 'PLAYER' ? 'PLAYER_TURN' : 'ENEMY_TURN';
}
