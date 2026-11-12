import type { DamageType } from '../combat/damage-types';
import type { Pos } from '../core/position';

/**
 * A delayed, public area (Mage: Runa de Ignición). Plain data in `GameState.glyphs`. Resolves once
 * at the start of its owner's next turn against the hostile units still inside, then disappears.
 * Never blocks movement or line of sight.
 */
export interface Glyph {
  id: string;
  /** Content key of the glyph kind (presentation reads it; rules only use the numbers below). */
  glyphId: string;
  ownerId: string;
  tiles: Pos[];
  damage: number;
  damageType: DamageType;
  /** Limited recurring glyph; absent means the original one-shot rune. */
  activationsLeft?: number;
  maxTargets?: number;
  origin?: Pos;
}
