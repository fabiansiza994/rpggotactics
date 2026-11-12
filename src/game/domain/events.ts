import type { EnemyIntent } from './ai/behavior';
import type { DamageType } from './combat/damage-types';
import type { Direction, Pos } from './core/position';
import type { CollectibleKind } from './entities/collectible';
import type { Faction, UnitKind } from './entities/unit';
import type { ObjectiveStatus } from './objectives/objective';
import type { BattleOutcome } from './state';
import type { StatusId } from './statuses/status';
import type { TerrainType } from './terrain/terrain';

/**
 * GAME EVENTS CONTRACT — the boundary between rules and presentation.
 *
 * Events describe WHAT happened, with enough data (ids, tiles, directions, amounts, element)
 * for the presentation to animate it. They never contain screen coordinates, colours or VFX
 * instructions. Events are emitted in causal order; by the time a batch is published the
 * GameState already reflects its end result.
 *
 * `sourceId` conventions: a unit id, `terrain:<TYPE>` or `status:<ID>`.
 */
export type GameEvent =
  | { type: 'GLYPH_ACTIVATED'; glyphId: string; kind: string; ownerId: string; origin: Pos; targets: {unitId:string;pos:Pos}[]; remaining: number }
  | { type: 'BACKSTAB'; unitId: string; sourceId: string; pos: Pos; bonus: 1 }
  | { type: 'FORM_CHANGED'; unitId: string; from: string | null; to: string | null }
  | {
      type: 'DOMINION_SCORED';
      round: number;
      points: [number, number];
      scores: [number, number];
      suddenDeath: boolean;
    }
  // ── Interactive battlefield (Act III) ──────────────────────────────
  /** A mechanism changed (switch, plate, gate, bridge, statue, relic, trap). `causeId` = triggering mechanism. */
  | {
      type: 'MECHANISM_CHANGED';
      cue: import('./mechanisms/mechanism').MechanismCue;
      mechanismId: string;
      kind: import('./mechanisms/mechanism').MechanismKind;
      state: import('./mechanisms/mechanism').MechanismStateValue;
      pos: Pos;
      from?: Pos;
      causeId?: string;
      /** The unit that caused it directly (interacting champion, unit springing a trap). */
      actorId?: string;
      /** PLATFORM_MOVED: units / statues / relics that travelled with the platform. SECTION_ROTATED: units, mechanisms and obstacles that rode the section. */
      carriedIds?: string[];
      /** SECTION_ROTATED (and _BLOCKED: the turn that was refused). Degrees clockwise; `turns` = signed quarter turns as animated (−1 = counter-clockwise). */
      rotation?: { from: import('./mechanisms/mechanism').Orientation; to: import('./mechanisms/mechanism').Orientation; turns: number; pivot: Pos; cells: Pos[] };
      /** SECTION_ROTATION_BLOCKED: why (Spanish, player-facing). */
      reason?: string;
    }
  /** Mechanical Guardian plating (FORTIFY / EXPOSE rules). `untilRound` = last exposed round. */
  | {
      type: 'GUARDIAN_STATE';
      cue: 'GUARDIAN_FORTIFIED' | 'GUARDIAN_EXPOSED' | 'GUARDIAN_REFORTIFIED';
      unitId: string;
      untilRound?: number;
      causeId?: string;
    }
  /** A STAGES objective moved on: `stage` stages done of `total`; `label` = the new current stage (null = all done). */
  | { type: 'OBJECTIVE_STAGE_CHANGED'; index: number; stage: number; total: number; label: string | null }
  // ── Battle / turn flow ─────────────────────────────────────────────
  | { type: 'BATTLE_STARTED'; scenarioId: string; seed: number }
  | { type: 'ROUND_STARTED'; round: number }
  | { type: 'TURN_STARTED'; faction: Faction; round: number }
  | { type: 'TURN_ENDED'; faction: Faction; round: number }
  | { type: 'BATTLE_WON'; outcome: BattleOutcome }
  | { type: 'BATTLE_LOST'; outcome: BattleOutcome }

  // ── Cards & resources ──────────────────────────────────────────────
  | { type: 'CARD_DRAWN'; cardUid: string; cardId: string }
  | {
      type: 'CARD_DISCARDED';
      cardUid: string;
      cardId: string;
      /** HAND_FULL: drawn over the turn cap. HAND_LIMIT: the end-of-turn discard (player's choice). */
      reason: 'PLAYED' | 'HAND_FULL' | 'HAND_LIMIT';
    }
  /** Último Bastión held: `prevented` HP of this hit was not lost (the unit stays at `hpAfter`). */
  | { type: 'DEATH_PREVENTED'; unitId: string; sourceId: string; prevented: number; hpAfter: number }
  /** Danza de las Formas paid out on a change of form (the shield follows as SHIELD_GAINED). */
  | { type: 'FORM_TRIGGER'; unitId: string; status: string; shield: number; movePoints: number; chargesLeft: number }
  /** Ranked Premium (Eclipse de Ceniza / Ascenso Primordial): the caster's next card of `scope` costs less. Public. */
  | { type: 'COST_DISCOUNT_GRANTED'; unitId: string; scope: 'SPELL' | 'TRANSFORM'; amount: number }
  /** That pending discount was spent on `cardId` (paid `paid` instead of its printed cost). Public. */
  | { type: 'COST_DISCOUNT_USED'; unitId: string; scope: 'SPELL' | 'TRANSFORM'; cardId: string; paid: number }
  /** Orden del Vinculador: the summon takes this round's activation now (its actions follow). */
  | { type: 'SUMMON_ORDERED'; unitId: string }
  /** A Única card (Ultra) resolved and left the battle for good. Public: the card was played face up. */
  | { type: 'CARD_BANISHED'; cardUid: string; cardId: string }
  | { type: 'DECK_RESHUFFLED'; cardCount: number }
  | { type: 'ARCANE_FATIGUE'; unitId: string; recycle: number; amount: number }
  | {
      type: 'CARD_PLAYED';
      cardUid: string;
      cardId: string;
      casterId: string;
      /** Tile the player selected (null for SELF cards). */
      target: Pos | null;
      /** Resolved anchor: end of a LINE, chosen tile, or caster tile. */
      impact: Pos;
      affectedTiles: Pos[];
      direction: Direction | null;
      /** The card spent Momentum and resolved its empowered effects. */
      empowered?: boolean;
    }
  | { type: 'CARD_RESOLVED'; cardUid: string; cardId: string }

  // ── Rituals ────────────────────────────────────────────────────────
  /**
   * A piece was sealed onto `casterId`'s altar. PvP projections strip `cardUid`/`cardId` for the
   * rival (only the altar size is public until activation).
   */
  | { type: 'RITUAL_PIECE_COMMITTED'; casterId: string; cardUid?: string; cardId?: string; altarSize: number; energyCost: number }
  /** A sealed piece was abandoned to the discard pile (same redaction as COMMITTED). */
  | { type: 'RITUAL_PIECE_RELEASED'; casterId: string; cardUid?: string; cardId?: string; altarSize: number }
  /** Activation: the pieces are revealed and consumed (discard). The result's events follow. */
  | {
      type: 'RITUAL_ACTIVATED';
      ritualId: string;
      tier: 'MINOR' | 'MAJOR' | 'LEGENDARY';
      casterId: string;
      pieces: { cardUid: string; cardId: string }[];
      target: Pos | null;
      impact: Pos;
      affectedTiles: Pos[];
    }
  | { type: 'RITUAL_RESOLVED'; ritualId: string; casterId: string }
  | { type: 'ENERGY_CHANGED'; from: number; to: number; max: number }
  | { type: 'MOVE_POINTS_CHANGED'; from: number; to: number; max: number }

  // ── Movement ───────────────────────────────────────────────────────
  | {
      type: 'UNIT_MOVED';
      unitId: string;
      from: Pos;
      to: Pos;
      /** Every tile stepped on, excluding `from`, ending with `to`. */
      path: Pos[];
      cost: number;
      mode: 'WALK' | 'CHARGE';
    }
  | { type: 'UNIT_TELEPORTED'; unitId: string; from: Pos; to: Pos; sourceId: string }
  | {
      type: 'UNIT_PUSHED';
      unitId: string;
      from: Pos;
      to: Pos;
      direction: Direction;
      sourceId: string;
      /** What stopped the push early, if anything. */
      collision: 'UNIT' | 'OBSTACLE' | 'EDGE' | 'BLOCKED_TERRAIN' | null;
    }
  | {
      type: 'PROJECTILE_LAUNCHED';
      sourceId: string;
      from: Pos;
      to: Pos;
      direction: Direction;
      /** Unit hit at `to`, if any. */
      hitUnitId: string | null;
    }

  // ── Health ─────────────────────────────────────────────────────────
  | {
      type: 'UNIT_DAMAGED';
      unitId: string;
      sourceId: string;
      damageType: DamageType;
      pos: Pos;
      /** Incoming damage before armor/shield. */
      rawAmount: number;
      armorMitigated: number;
      coverMitigated?: number;
      shieldAbsorbed: number;
      hpLost: number;
      hpAfter: number;
    }
  | { type: 'UNIT_HEALED'; unitId: string; sourceId: string; amount: number; hpAfter: number }
  /** A unit paid HP as a cost (Vínculo Prohibido). Not damage: no armor, shield or hit reactions. */
  | { type: 'HP_SACRIFICED'; unitId: string; cardId?: string; amount: number; hpAfter: number }
  /** `unitId`'s summon capacity changed for this battle (`from` → `to` points, `bonus` = battle total). Public. */
  | { type: 'SUMMON_CAPACITY_CHANGED'; unitId: string; cardId?: string; from: number; to: number; bonus: number }
  | { type: 'UNIT_DEFEATED'; unitId: string; faction: Faction; kind: UnitKind; pos: Pos }
  | {
      type: 'SUMMON_ATTACKED';
      unitId: string;
      targetId: string;
      from: Pos;
      to: Pos;
      ranged: boolean;
    }
  /** A summon used its signature area attack (Aliento Primordial). Damage follows as UNIT_DAMAGED. */
  | {
      type: 'SUMMON_BREATH';
      unitId: string;
      name: string;
      from: Pos;
      /** Direction of the cone (one of the four board directions). */
      direction: Pos;
      tiles: Pos[];
      targetIds: string[];
    }
  | { type: 'UNIT_SPAWNED'; unitId: string; faction: Faction; kind: UnitKind; pos: Pos }
  | { type: 'SHIELD_GAINED'; unitId: string; sourceId: string; amount: number; total: number }
  | { type: 'SHIELD_BROKEN'; unitId: string }
  /** Rompeguardia: shield removed before the hit (never HP). */
  | { type: 'SHIELD_SHATTERED'; unitId: string; sourceId: string; amount: number; total: number }
  | { type: 'SHIELD_EXPIRED'; unitId: string; amount: number }
  /** A champion resource changed (Warrior's Impulso). `reason` drives gain/spend feedback. */
  | {
      type: 'MOMENTUM_CHANGED';
      unitId: string;
      from: number;
      to: number;
      max: number;
      reason: 'ENGAGE' | 'HIT' | 'CARD' | 'SPENT';
    }
  /**
   * Archer Concentración changed. CARD = a card effect granted it (GAIN_FOCUS / DAMAGE.focusGain),
   * SPENT = a focus cost or a focus pierce consumed it. Never passive.
   */
  | { type: 'FOCUS_CHANGED'; unitId: string; from: number; to: number; max: number; reason: 'CARD' | 'SPENT' }
  /** A trap was placed (public). `trapId` is the instance id, `kind` the trap content key. */
  | { type: 'TRAP_PLACED'; trapId: string; kind: string; ownerId: string; pos: Pos; turnsLeft: number }
  /** A hostile unit entered a trap: it stops there, ROOTED follows as STATUS_APPLIED, damage as UNIT_DAMAGED. */
  | { type: 'TRAP_TRIGGERED'; trapId: string; kind: string; ownerId: string; unitId: string; pos: Pos; damage: number }
  | { type: 'TRAP_REMOVED'; trapId: string; kind: string; pos: Pos; reason: 'EXPIRED' | 'REPLACED' | 'NET_CLOSED' }
  /** A rebounding arrow jumped `from` → `unitId` (bounce 1 or 2); its damage follows as UNIT_DAMAGED. */
  | { type: 'ARROW_REBOUNDED'; casterId: string; fromPos: Pos; unitId: string; pos: Pos; bounce: number; element?: 'THUNDER' }
  /** Riposte fired: `unitId` answers `targetId`'s adjacent attack (the damage follows as UNIT_DAMAGED). */
  | { type: 'COUNTER_ATTACK'; unitId: string; targetId: string; amount: number }
  /** A finisher hit met its HP condition (`unitId` had ≤ `hpAtMost` HP): UNIT_DAMAGED of `amount` follows. */
  | { type: 'FINISHER_TRIGGERED'; unitId: string; casterId: string; hpAtMost: number; amount: number }

  // ── Statuses ───────────────────────────────────────────────────────
  | {
      type: 'STATUS_APPLIED';
      unitId: string;
      status: StatusId;
      turnsLeft: number;
      sourceId: string;
    }
  | {
      type: 'STATUS_REMOVED';
      unitId: string;
      status: StatusId;
      reason: 'EXPIRED' | 'CLEANSED' | 'CONSUMED';
    }

  // ── Terrain / obstacles ────────────────────────────────────────────
  | {
      type: 'TERRAIN_CREATED';
      pos: Pos;
      terrain: TerrainType;
      previous: TerrainType;
      turnsLeft: number | null;
      sourceId: string;
    }
  | {
      type: 'TERRAIN_REMOVED';
      pos: Pos;
      terrain: TerrainType;
      revertedTo: TerrainType;
      reason: 'EXPIRED' | 'CLEANSED';
    }
  | {
      type: 'OBSTACLE_CREATED';
      obstacleId: string;
      defId: string;
      pos: Pos;
      turnsLeft: number | null;
      sourceId: string;
    }
  | { type: 'OBSTACLE_REMOVED'; obstacleId: string; defId: string; pos: Pos; reason: 'EXPIRED' }

  // ── Enemies ────────────────────────────────────────────────────────
  | { type: 'ENEMY_INTENT_DECLARED'; intent: EnemyIntent }
  | { type: 'ENEMY_ACTION_STARTED'; enemyId: string; intent: EnemyIntent }
  | {
      type: 'ENEMY_ATTACKED';
      enemyId: string;
      intentKind: EnemyIntent['kind'];
      /** Tiles the attack hits (for impact VFX). */
      tiles: Pos[];
      targetUnitIds: string[];
      damageType: DamageType;
    }
  | { type: 'ENEMY_ACTION_ENDED'; enemyId: string }

  // ── Objectives ─────────────────────────────────────────────────────
  /** The hero walked/teleported/was pushed onto a pickup; emitted right after the move event. */
  | {
      type: 'COLLECTIBLE_COLLECTED';
      collectibleId: string;
      kind: CollectibleKind;
      pos: Pos;
      unitId: string;
    }
  | {
      type: 'OBJECTIVE_UPDATED';
      index: number;
      status: ObjectiveStatus;
      current: number;
      target: number;
    };

export type GameEventType = GameEvent['type'];

export type EventOfType<T extends GameEventType> = Extract<GameEvent, { type: T }>;
