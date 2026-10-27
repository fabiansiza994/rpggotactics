import type { StatusId } from '../statuses/status';
import type { DamageType } from '../combat/damage-types';

export type TerrainType =
  'NORMAL' | 'FIRE' | 'ICE' | 'BLOCKED' | 'OBJECTIVE' | 'COVER' | 'HAZARD' | 'ARCANE' | 'VOID' | 'LAVA' | 'SMOKE';

/**
 * Data-driven terrain behaviour. The domain only reads these numbers; how a tile *looks* is
 * decided by the presentation layer from `TerrainType`.
 */
export interface TerrainDef {
  type: TerrainType;
  name: string;
  walkable: boolean;
  rangedReduction?: number;
  startEnergyBonus?: number;
  /** Extra movement cost paid when a unit LEAVES this tile (ICE rule for v0.1). */
  exitCostBonus: number;
  /**
   * The exit cost is paid only when stepping onto a tile of ANOTHER terrain type (leaving the
   * zone), not between two tiles of this one: crossing a whole cloud costs it once (SMOKE).
   */
  exitCostOnlyLeavingZone?: boolean;
  /** Intermediate tiles with this terrain block line of sight, like a pillar (SMOKE). Walkable. */
  blocksLineOfSight?: boolean;
  /** Damage dealt to a unit that ENDS its side's turn on this tile (FIRE rule). */
  endTurnDamage: number;
  damageType: DamageType;
  /** Status applied to a unit that ends its turn here (optional). */
  endTurnStatus?: { status: StatusId; duration: number };
  /** Hazards can be removed by cleansing effects (Dispel) and are avoided by summon pathing. */
  isHazard: boolean;
  /** A hazard that is part of the map (LAVA): cleansing effects cannot remove it. */
  indestructible?: boolean;
  /** Temporary terrain may be painted over this type. */
  canBeOverwritten: boolean;
}
