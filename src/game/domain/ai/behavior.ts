import type { AreaDef } from '../cards/card';
import type { DamageType } from '../combat/damage-types';
import type { Direction, Pos } from '../core/position';
import type { StatusId } from '../statuses/status';
import type { TerrainType } from '../terrain/terrain';

/**
 * Reusable enemy behaviours. Enemies are data (EnemyDef) that pick one of these primitives;
 * there is no per-enemy code.
 *
 * - MELEE:        walk toward the target and hit it when adjacent.
 * - CHARGE:       when aligned with the target, dash in a straight line and slam the first unit
 *                 hit; otherwise reposition to get aligned.
 * - AREA_CASTER:  lock an area on the target's tile at declaration time; it detonates on the
 *                 enemy phase (the player can step out of it).
 */
export type BehaviorDef = (
  | { type: 'MELEE'; damage: number; damageType: DamageType }
  | { type: 'CHARGE'; damage: number; damageType: DamageType; range: number }
  | {
      type: 'AREA_CASTER';
      damage: number;
      damageType: DamageType;
      castRange: number;
      area: AreaDef;
    }
) & { onHit?: HitRider };

/**
 * Optional consequences of a behaviour's attack, applied after its damage (composition of
 * existing rules, no per-enemy code). Resolved in this order for each unit hit that survives:
 * push, then status; `scorch` paints terrain once per attack (even if nobody was hit).
 *
 * - push:   knock the unit `distance` tiles away from the attacker (from the area's centre for
 *           AREA attacks), with the push rules of cards (`pushUnit`: collisions hurt both).
 * - status: apply a status (BURNING for infernal enemies).
 * Structures (objective crystals) only take the damage: they are never pushed nor given statuses.
 * - scorch: temporary terrain on the attack's centre tile (AREA) or the hit unit's tile
 *           ('CENTER'), or on every tile of the area ('AREA'). Map terrain that cannot be
 *           overwritten (LAVA, abyss, exits) is left untouched.
 */
export interface HitRider {
  push?: { distance: number; collisionDamage: number };
  status?: { status: StatusId; duration: number };
  scorch?: { terrain: TerrainType; turns: number; tiles: 'CENTER' | 'AREA' };
}

/**
 * Declared at the start of the player's turn and visible to the player. Unit-targeted intents
 * follow their target; tile-targeted intents (AREA_SPELL, CHARGE direction) are locked.
 */
export type EnemyIntent =
  | { kind: 'MELEE_ATTACK'; enemyId: string; targetUnitId: string; damage: number }
  | { kind: 'CHARGE'; enemyId: string; direction: Direction; range: number; damage: number }
  | { kind: 'APPROACH'; enemyId: string; targetUnitId: string }
  | { kind: 'AREA_SPELL'; enemyId: string; center: Pos; tiles: Pos[]; damage: number }
  | { kind: 'IDLE'; enemyId: string; reason: 'STUNNED' | 'NO_TARGET' };

export type IntentKind = EnemyIntent['kind'];
