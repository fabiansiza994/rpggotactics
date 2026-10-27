import type { BehaviorDef } from './ai/behavior';
import type { CardDefinition } from './cards/card';
import type { DamageType } from './combat/damage-types';
import type { RitualDef } from './rituals/ritual';
import type { ObstacleDef } from './entities/obstacle';
import type { StatusDef, StatusId } from './statuses/status';
import type { TerrainDef, TerrainType } from './terrain/terrain';

import type { TransformationDef } from './transformations/transformations';

export interface HeroDef {
  /** Allowed form ids. No forms available unless explicitly opted in by content. */
  transformationForms?: readonly string[];
  id: string;
  name: string;
  maxHp: number;
  maxEnergy: number;
  movePoints: number;
  startingHandSize: number;
  drawPerTurn: number;
  /**
   * Hard hand cap DURING a turn (draws beyond it go straight to the discard pile). With
   * `handSize`, the turn draw may take the hand one card over the kept size.
   */
  maxHandSize: number;
  /**
   * Cards kept between turns: END_TURN with more must discard down to it (the player's choice,
   * `END_TURN.discardUid`). Absent = `maxHandSize` (no end-of-turn discard). `maxHandSize` is
   * at most `handSize + 1`, so a turn never ends more than one card over.
   */
  handSize?: number;
  deck: { cardId: string; count: number }[];
  /**
   * Class cards owned from the start WITHOUT being in the starter deck (available in the Deck
   * Builder by default). Like starter copies they are a floor: every new profile, guest save and
   * account load owns at least these copies, so existing players get them without a migration and
   * the server validates decks with them through the same `ownedFor`.
   */
  /** Deterministic opening consistency, shared by setup and replay. No extra cards or RNG. */
  guaranteedTransformationOpening?: boolean;
  starterCollection?: { cardId: string; count: number }[];
  visualKey: string;
  summonCapacity?: number;
  /**
   * Momentum (Impulso) resource, Warrior only. Gained by engaging (walking or charging next to
   * an enemy, once per turn) and by taking hostile hits; cards with `empowered` spend it.
   */
  momentum?: { max: number };
  /**
   * Concentración (Archer only): starts at 0, capped at `max`, gained only by card effects
   * (GAIN_FOCUS, DAMAGE.focusGain) and spent by `focusCost` / LINE `focusPierce`. `optimalRange`
   * is the champion's Distancia Óptima (Manhattan, inclusive) read by the optimal-range conditions.
   */
  focus?: { max: number; optimalRange: { min: number; max: number } };
  /**
   * Ritual altar: how many ritual pieces this champion can keep sealed at once (Summoner only).
   * Absent = the champion cannot commit ritual pieces.
   */
  altarSlots?: number;
  /**
   * Sealing pace (champions with `altarSlots`): each turn the first `freePerTurn` seals cost 0
   * energy and every further seal costs `extraEnergy`. Absent = { freePerTurn: 1, extraEnergy: 1 }.
   */
  altarSealing?: { freePerTurn: number; extraEnergy: number };
}

/**
 * Encounter-design classification. Pure metadata: the AI acts through `behavior`, never
 * through the role. Used to author and describe compositions (and by the UI).
 * - FRONTLINER: advances and pressures space        - TANK: slow, armoured, blocks lanes
 * - RANGED: attacks from distance, forces movement   - DIVER: dashes along lanes to the hero
 * Support / controller roles are not listed: no enemy behaviour can heal, buff or displace yet.
 */
export type EnemyRole = 'FRONTLINER' | 'TANK' | 'RANGED' | 'DIVER';

/** NORMAL foot soldier, ELITE (real tactical twist), BOSS (encounter centrepiece). */
export type EnemyRank = 'NORMAL' | 'ELITE' | 'BOSS';

export interface EnemyDef {
  id: string;
  name: string;
  role: EnemyRole;
  rank: EnemyRank;
  maxHp: number;
  armor: number;
  moveRange: number;
  behavior: BehaviorDef;
  visualKey: string;
  /**
   * Creatures of fire (imps, magma beast, Forge King) take no end-of-turn TERRAIN damage (lava,
   * fire). Statuses and attacks still hurt them. Absent = terrain hurts it like anyone else.
   */
  hazardImmune?: boolean;
  /**
   * Simple boss phases: at or below `belowHpPct`% of its max HP the enemy uses `behavior` instead
   * (the lowest threshold reached wins). Read when intents are declared, so the telegraph always
   * shows the phase that will act. No timers, scripts or extra state.
   */
  phases?: readonly EnemyPhaseDef[];
}

export interface EnemyPhaseDef {
  belowHpPct: number;
  behavior: BehaviorDef;
  /** Short label for the presentation ("Frenesí"). */
  name: string;
}

export interface StructureDef {
  id: string;
  name: string;
  maxHp: number;
  armor: number;
  visualKey: string;
}

/**
 * Everything the rules need to interpret a battle. Injected into the engine so tests can use
 * custom content and the domain never imports concrete data files.
 */
export interface SummonDef {
  /** Roles are deterministic behaviors, independent of presentation. */
  behavior?: 'SCOUT' | 'SKIRMISHER' | 'GUARD' | 'RANGED' | 'PRESSURE';
  attackRange?: number;
  /** Damage type of its attack (default PHYSICAL in melee, ARCANE at range). */
  damageType?: DamageType;
  retreatSteps?: number;
  id: string;
  name: string;
  maxHp: number;
  armor: number;
  moveRange: number;
  damage: number;
  capacityCost: number;
  visualKey: string;
  /** Status its attack applies to the unit hit (Sabueso de Ceniza: BURNING). Never on structures. */
  onHitStatus?: { status: StatusId; duration: number };
  /**
   * Signature area attack that replaces the basic attack on an activation when it is ready
   * (Dragón Primordial: Aliento Primordial). A short cone in one of the four directions: the
   * tiles 1..`range` straight ahead plus the two tiles beside the first one, each needing line of
   * sight. Hits hostile units only. After use it is ready again `cooldownRounds` rounds later.
   * The summon breathes when it would hit 2+ hostiles, or 1 when its basic attack has no target.
   */
  breath?: { name: string; range: number; damage: number; damageType: DamageType; cooldownRounds: number };
  /**
   * Passive aura (Gólem del Pacto), live from the board every time it is read: once the summon is
   * ready, attacks from hostile units against an ally orthogonally next to it (its owner, other
   * summons; never itself or structures) deal this much less. Several auras or a Cobertura status
   * never add up: the biggest reduction applies. See combat/attack-modifiers.ts.
   */
  aura?: { incomingDamageReduction: number };
}

export interface GameContent {
  /** Experimental rules, never registered by public content. Version pinned in QA replays. */
  qaCombatDepth?: { version: 1; backstab: boolean; formCounter: 'perHit' | 'oncePerRound' };
  transformations?: Readonly<Record<string, TransformationDef>>;
  /** Champion selected for a brand-new profile (selectable modes). Default: the first hero. */
  defaultHeroId?: string;
  summons?: Readonly<Record<string, SummonDef>>;
  /** Generic ritual definitions (pieces → explicit activation → result). */
  rituals?: Readonly<Record<string, RitualDef>>;
  /**
   * Card sets released to players (`CardDefinition.expansion`). Only affects reward offers:
   * battles, replays and deck rules never depend on it.
   */
  releasedExpansions?: readonly string[];
  cards: Readonly<Record<string, CardDefinition>>;
  heroes: Readonly<Record<string, HeroDef>>;
  enemies: Readonly<Record<string, EnemyDef>>;
  structures: Readonly<Record<string, StructureDef>>;
  obstacles: Readonly<Record<string, ObstacleDef>>;
  statuses: Readonly<Record<StatusId, StatusDef>>;
  terrain: Readonly<Record<TerrainType, TerrainDef>>;
}

export function requireDef<T>(table: Readonly<Record<string, T>>, id: string, kind: string): T {
  const def = table[id];
  if (!def) throw new Error(`Unknown ${kind} definition: "${id}"`);
  return def;
}
