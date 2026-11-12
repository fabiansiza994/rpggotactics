import type { Pos } from '../core/position';

/**
 * A placed trap (Archer: Trampa de Zarzas). Plain data in `GameState.traps`. Triggers on the first
 * unit hostile to its owner that enters the tile; never blocks movement or line of sight.
 */
export interface Trap {
  id: string;
  /** Content key of the trap kind (presentation reads it; rules only use the numbers below). */
  trapId: string;
  ownerId: string;
  pos: Pos;
  damage: number;
  damageType?: import('../combat/damage-types').DamageType;
  rootOnTrigger?: boolean;
  /** Board rounds left while untriggered (ticks with temporary terrain). */
  turnsLeft: number;
  /** Red del Cazador: traps placed by one cast share it; the first one sprung removes the rest. */
  netId?: string;
  /** Concentración for the owner when the net catches its Presa. */
  preyFocus?: number;
}
