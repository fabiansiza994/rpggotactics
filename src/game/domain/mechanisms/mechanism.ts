import type { DamageType } from '../combat/damage-types';
import type { Pos } from '../core/position';
import type { EnemySpawnDef } from '../scenario';

/**
 * Interactive battlefield (Act III «El Templo del Umbral»). A scenario that declares `mechanisms`
 * gets a small, data-driven machine on its board:
 *
 *   TRIGGER (what happened to which sources) → CONDITION (optional all/any active) → ACTIONS → TARGETS
 *
 * No map-specific code: every puzzle is objects + rules in the encounter data. Scenarios without
 * `mechanisms` never create `GameState.mechanisms`, so every older state stays byte-identical.
 * PvE only: duels never carry mechanisms (pvp/duel.ts builds its own state).
 */
export type MechanismKind =
  /** Active while an accepted occupant stands on it (walk/push/teleport/summon END on the tile). */
  | 'PRESSURE_PLATE'
  /** Lever on a pedestal: the champion INTERACTs from an adjacent tile. */
  | 'SWITCH'
  /** CLOSED blocks movement (and sight, unless `blocksSight: false`); OPEN is floor. */
  | 'GATE'
  /** RAISED is a gap (blocks movement, never sight); LOWERED is floor. */
  | 'BRIDGE'
  /** Movable stone block: the champion pushes it 1 tile, cardinal, from an adjacent tile. */
  | 'STATUE'
  /** Pickup on a pedestal: the champion INTERACTs (RECOGER) from an adjacent tile. */
  | 'RELIC'
  /** Rune vent on walkable floor: while ENABLED, damages accepted units that end a move on it. */
  | 'TRAP'
  /**
   * Moving floor section (Act III phase 2). Provides floor on its footprint (over a chasm) and moves
   * between named `stops`, carrying every unit, statue and dropped relic standing on it.
   */
  | 'PLATFORM'
  /**
   * Transformable board section (Act III phase 3, «El Laberinto Vivo»). Not an object on a tile: a
   * set of cells that ROTATEs about a pivot in quarter turns, carrying its floor, walls, units and
   * mechanisms (see mechanism-transform.ts). Its state is its orientation.
   */
  | 'REGION';

/** Who presses a plate / springs a trap. HERO_ONLY = ['HERO']; "any unit" = ['ANY_UNIT']. */
export type OccupantClass = 'HERO' | 'SUMMON' | 'ENEMY' | 'ANY_UNIT' | 'MOVABLE_OBJECT';

/** Discrete state per kind (plates/statues have none: they are derived from positions). */
export type MechanismStateValue =
  | 'OFF'
  | 'ON'
  | 'CLOSED'
  | 'OPEN'
  | 'RAISED'
  | 'LOWERED'
  | 'IDLE'
  | 'COLLECTED'
  | 'ENABLED'
  | 'DISABLED'
  /** Carry relics (`carry`): IDLE = on its pedestal, then CARRIED / DROPPED / EXTRACTED. */
  | 'CARRIED'
  | 'DROPPED'
  | 'EXTRACTED'
  /** REGION: discrete orientation (clockwise quarter turns from the authored layout). */
  | 'ORIENTATION_0'
  | 'ORIENTATION_90'
  | 'ORIENTATION_180'
  | 'ORIENTATION_270';

/** REGION orientation in degrees, clockwise on screen. Gameplay only ever sees these four values. */
export type Orientation = 0 | 90 | 180 | 270;

/**
 * REGION geometry (`MechanismDef.region`). The cells must map onto themselves under every allowed
 * rotation (validated), so a turn is a permutation of the section: nothing leaves it or enters it.
 */
export interface RegionDef {
  cells: readonly Pos[];
  /** Grid-space point (tile corners are integers): the centre of a 7×7 section at x 3..9 is 6.5. */
  pivot: Pos;
  /** Default all four. Rotating to an orientation outside this list is refused (blocked). */
  allowedOrientations?: readonly Orientation[];
  /** Units on the section ride the turn (default true). */
  occupantsMoveWithRegion?: boolean;
  /** Statues, plates, switches, gates, traps, dropped relics… on the section ride it (default true). */
  mechanismsMoveWithRegion?: boolean;
  /** Floor terrain, walls/obstacles, card traps, glyphs and pickups ride it (default true). */
  staticObjectsMoveWithRegion?: boolean;
  /** true: the section refuses to turn while any unit stands on it (default false: they ride). */
  blockedByOccupancy?: boolean;
}

export interface MechanismDef {
  id: string;
  kind: MechanismKind;
  pos: Pos;
  /** Initial state; defaults per kind (SWITCH OFF, GATE CLOSED, BRIDGE RAISED, TRAP ENABLED). */
  initial?: MechanismStateValue;
  /** PRESSURE_PLATE default ['HERO', 'SUMMON', 'MOVABLE_OBJECT']; TRAP default ['HERO', 'SUMMON', 'ENEMY']. */
  accepts?: readonly OccupantClass[];
  /** SWITCH: every INTERACT flips it (default). `false` = one-way: ON stays ON (no prompt after). */
  toggle?: boolean;
  /** SWITCH as a push BUTTON: INTERACT only fires its ON_INTERACT rules, its state never changes. */
  momentary?: boolean;
  /**
   * Starts frozen (as after a DISABLE): a dormant control of a CYCLE group (XXV: the Guardian's
   * levers B and C wait while lever A is the live one).
   */
  startsLocked?: boolean;
  /** QA reversible platform control: repeat only this same control after its first use. */
  repeatableControl?: boolean;
  /**
   * 'REPEATABLE_CONTROL' (geometry controls, XXVIII+): usable any number of times per turn and never
   * spends the turn's interaction — reconfiguring the board IS the puzzle. Fail closed: it only
   * applies while every rule of the board is pure geometry (see safeRepeatableControl).
   */
  interactionMode?: 'REPEATABLE_CONTROL';
  /** REGION: its cells, pivot and what rides it. `pos` is only a label anchor. */
  region?: RegionDef;
  /** GATE: a closed gate blocks line of sight unless false. STATUE: blocks sight only when true. */
  blocksSight?: boolean;
  /** STATUE softlock guard: the only tiles it may be pushed onto (absent = any legal tile). */
  allowedTiles?: readonly Pos[];
  /** TRAP damage on a unit that ends a move on it while ENABLED. */
  trap?: { damage: number; damageType: DamageType };
  /** INTERACT price for this object (default 0 energy; the per-turn interaction is spent anyway). */
  energyCost?: number;
  /** Prompt verb override (e.g. 'RESTABLECER' for a reset lever). */
  prompt?: InteractionVerb;
  /** Short Spanish name for logs/tooltips ("Palanca norte"). Optional. */
  label?: string;
  /** SWITCH: once ON it turns itself OFF at the end of its `holdRounds`-th round (timed window). */
  holdRounds?: number;
  /** PLATFORM: footprint offsets from `pos` (default a single tile). */
  shape?: readonly Pos[];
  /** PLATFORM: named anchor positions, in ADVANCE order. `pos` must equal the `initialStop` one. */
  stops?: Readonly<Record<string, Pos>>;
  initialStop?: string;
  /**
   * RELIC: the champion carries it (RECOGER → CARRIED, −1 movement while carried, SOLTAR → DROPPED)
   * and secures it standing on an `extraction` tile (ASEGURAR → EXTRACTED). Without `carry` a relic
   * is simply collected (XXIII).
   */
  carry?: { extraction: readonly Pos[] };
}

export type MechanismTriggerType =
  /** A source plate went from not pressed → pressed. */
  | 'ON_OCCUPIED'
  /** A source plate went from pressed → not pressed. */
  | 'ON_VACATED'
  /** The champion interacted with a source (switch flipped, relic picked up, statue pushed). */
  | 'ON_INTERACT'
  /** A unit/statue ended a move on a source tile (fires per arrival, even if already pressed). */
  | 'ON_ENTER_TILE'
  /** A unit/statue left a source tile. */
  | 'ON_EXIT_TILE'
  /** Start of every round (after waves spawn, before the player turn starts). */
  | 'ON_ROUND_START'
  /** End of every round (after the enemy turn, before the round counter advances). */
  | 'ON_ROUND_END'
  /** Rising edge: every source is active (and was not, the previous check). */
  | 'ON_ALL_ACTIVE'
  /** Rising edge: at least one source is active (none was, the previous check). */
  | 'ON_ANY_ACTIVE'
  /**
   * The sources were INTERACTed in exactly this order. A wrong source restarts the sequence (it
   * counts as step one if it is the first source). Progress is per rule.
   */
  | 'ON_SEQUENCE'
  /**
   * A FORTIFY/EXPOSE unit's exposure window just closed (its plating is back), at the end of the
   * round, before ON_ROUND_END rules. `unitIds` filters which unit (absent = any).
   */
  | 'ON_EXPOSE_END';

export type MechanismActionType =
  | 'OPEN'
  | 'CLOSE'
  | 'TOGGLE'
  | 'LOWER'
  | 'RAISE'
  | 'ENABLE'
  | 'DISABLE'
  /**
   * STATUE → `to` (validated like a push destination; deferred while the tile is taken). PLATFORM →
   * `stop`. REGION → `orientation`.
   */
  | 'MOVE'
  /** REGION: `turns` clockwise quarter turns (−1 = counter-clockwise, 2 = half turn). */
  | 'ROTATE'
  /** PLATFORM: to the next stop in `stops` order (cycles). REGION: next allowed orientation clockwise. */
  | 'ADVANCE'
  /** Units `unitIds`: armour plating on (FORTIFIED status). */
  | 'FORTIFY'
  /** Units `unitIds`: plating off for `rounds` rounds (this one included), then FORTIFY again. */
  | 'EXPOSE'
  /** Targets back to their initial state/position (gates/bridges respect occupancy). */
  | 'RESET'
  | 'SPAWN'
  /** Damage every unit standing on the targets' tiles. */
  | 'DAMAGE'
  /** Raise a named flag read by MECHANISM objectives with goal FLAG. */
  | 'COMPLETE_OBJECTIVE'
  /**
   * Relocating control (XXV): `targets` is an ordered ring of switches of which exactly one is live
   * (unlocked). CYCLE locks the live one and unlocks the next in ring order (A → B → C → A),
   * skipping a candidate the champion could not stand next to right now (every orthogonal
   * neighbour blocked); if all others are blocked the live one simply re-arms. The ring position is
   * `MechanismBoard.cycles` (deterministic, serialized with the state).
   */
  | 'CYCLE';

export interface MechanismAction {
  type: MechanismActionType;
  /** Mechanism ids (OPEN/CLOSE/…/RESET/MOVE/DAMAGE). */
  targets?: readonly string[];
  /** MOVE destination (statue). */
  to?: Pos;
  /** MOVE destination (platform stop name). */
  stop?: string;
  /** MOVE destination (region orientation). */
  orientation?: Orientation;
  /** ROTATE: clockwise quarter turns (default 1; −1 = counter-clockwise). */
  turns?: number;
  /** FORTIFY / EXPOSE: unit ids (the guardian). */
  unitIds?: readonly string[];
  /** EXPOSE window in rounds (default 2). */
  rounds?: number;
  /** SPAWN: enemies placed like waves (occupied tile → nearest free tile). */
  enemies?: readonly EnemySpawnDef[];
  /** DAMAGE amount and type. */
  damage?: number;
  damageType?: DamageType;
  /** COMPLETE_OBJECTIVE flag name. */
  flag?: string;
}

export interface MechanismRuleDef {
  id: string;
  trigger: {
    type: MechanismTriggerType;
    sources?: readonly string[];
    /** ON_EXPOSE_END: only these units' windows. */
    unitIds?: readonly string[];
    /**
     * ON_ROUND_START / ON_ROUND_END schedule: fires on rounds `offset`, `offset + every`, … (offset
     * defaults to `every`). Absent = every round. The view lists upcoming firings (telegraph).
     */
    every?: number;
    offset?: number;
  };
  /** Fires only while every one of these units is on the board (a boss's board control dies with it). */
  whileAlive?: readonly string[];
  /** Short Spanish telegraph line for scheduled board changes ("El Arquitecto gira el santuario"). */
  label?: string;
  /** Extra check when the trigger fires: these ids must all / any be active right now. */
  condition?: { all?: readonly string[]; any?: readonly string[] };
  actions: readonly MechanismAction[];
  /** Fires at most once per battle (default: repeatable). */
  once?: boolean;
}

/** The puzzle a scenario declares (`ScenarioDef.mechanisms`). */
export interface MechanismBoardDef {
  objects: readonly MechanismDef[];
  rules: readonly MechanismRuleDef[];
}

/** Runtime object: its def plus the little dynamic state the rules need. */
export interface MechanismObject {
  def: MechanismDef;
  state: MechanismStateValue;
  /** Current tile (only a STATUE ever moves). */
  pos: Pos;
  /** Derived each sync: plate pressed / switch ON / gate OPEN / bridge LOWERED / relic COLLECTED / trap ENABLED. */
  active: boolean;
  /** Ids (units and statues) on this tile at the last sync, sorted (ENTER/EXIT edges). */
  occupants: string[];
  /** A CLOSE / RAISE / RESET / MOVE that waits for the tile to be free (never shut on someone). */
  pending?: { action: 'CLOSE' | 'RAISE' | 'RESET' | 'MOVE'; to?: Pos };
  /** Was ever active (ACTIVATE_N objectives count it). */
  everActive?: boolean;
  /** DISABLE on a switch/plate: frozen in its current state (switch refuses INTERACT). */
  locked?: boolean;
  /** PLATFORM: current stop name. */
  stop?: string;
  /** RELIC (carry): the champion carrying it. */
  carrier?: string;
}

/**
 * Presentation cue of a MECHANISM_CHANGED event (the gameplay already happened). `causeId` on
 * the event names the mechanism whose trigger caused it, so the UI can run energy source → target.
 */
export type MechanismCue =
  | 'SWITCH_ACTIVATED'
  | 'SWITCH_DEACTIVATED'
  | 'PLATE_PRESSED'
  | 'PLATE_RELEASED'
  | 'GATE_OPENED'
  | 'GATE_CLOSED'
  | 'GATE_CLOSE_DEFERRED'
  | 'BRIDGE_LOWERED'
  | 'BRIDGE_RAISED'
  | 'BRIDGE_RAISE_DEFERRED'
  | 'STATUE_PUSHED'
  | 'STATUE_MOVED'
  | 'RELIC_COLLECTED'
  | 'TRAP_ENABLED'
  | 'TRAP_DISABLED'
  | 'TRAP_FIRED'
  | 'MECHANISM_LOCKED'
  | 'MECHANISM_UNLOCKED'
  | 'MECHANISM_RESET'
  | 'OBJECTIVE_FLAG'
  | 'PLATFORM_MOVED'
  | 'PLATFORM_BLOCKED'
  | 'RELIC_PICKED_UP'
  | 'RELIC_DROPPED'
  | 'RELIC_EXTRACTED'
  | 'SEQUENCE_PROGRESS'
  | 'SEQUENCE_RESET'
  /** REGION turned: `rotation` on the event says from → to, and `carriedIds` what rode it. */
  | 'SECTION_ROTATED'
  /** REGION could not turn (`reason`): nothing changed. */
  | 'SECTION_ROTATION_BLOCKED'
  /**
   * CYCLE moved the live control: the event's mechanism is the NEW live control, `from` the old
   * one's tile and `causeId` the old one's id ("NUEVO CONTROL ACTIVADO").
   */
  | 'CONTROL_RELOCATED';

/** `GameState.mechanisms`: present only when the scenario declares a puzzle. */
export interface MechanismBoard {
  objects: MechanismObject[];
  rules: MechanismRuleDef[];
  /** `once` rules that already fired. */
  fired: string[];
  /** Last value of each ON_ALL_ACTIVE / ON_ANY_ACTIVE rule (edge detection). */
  edges: Record<string, boolean>;
  /** Raised COMPLETE_OBJECTIVE flags. */
  flags: string[];
  /** Round-end count of rounds each KEEP_ACTIVE objective held (by objective index). */
  held: Record<string, number>;
  /** Round of the champion's last INTERACT (one interaction per turn). 0 = none yet. */
  interactedRound: number;
  lastInteractionId?: string;
  /** Timed switches (`holdRounds`): id → last round they stay ON. Created on first use. */
  timers?: Record<string, number>;
  /** ON_SEQUENCE rules: rule id → steps done. Created on first use. */
  sequences?: Record<string, number>;
  /** EXPOSE windows: unit id → last exposed round. Created on first use. */
  exposed?: Record<string, number>;
  /** STAGES objectives: objective key → stages completed (latched). Created on first use. */
  stages?: Record<string, number>;
  /** Units under FORTIFY rules (the guardian): plated unless inside an EXPOSE window (see EXPOSE). */
  armored?: string[];
  /** CYCLE rings: ring key (target ids joined by '+') → index of the live control. Created on first use. */
  cycles?: Record<string, number>;
  /** Exposure windows that have closed, per unit (the Guardian's exposure cycle). Created on first use. */
  exposureCycles?: Record<string, number>;
}

/** What an INTERACT does with this object, as the button verb. */
export type InteractionVerb =
  | 'INTERACTUAR'
  | 'ACTIVAR'
  | 'DESACTIVAR'
  | 'EMPUJAR'
  | 'RECOGER'
  | 'GIRAR'
  | 'ABRIR'
  | 'RESTABLECER'
  | 'SOLTAR'
  | 'ASEGURAR';

/** MECHANISM objective goals (one objective type, so presentation switches stay small). */
export type MechanismGoal =
  /** `required` of `ids` were activated at least once (ACTIVATE_N_SWITCHES). */
  | 'ACTIVATE_N'
  /** All `ids` active at `required` round ends, cumulative (KEEP_PLATES_ACTIVE). */
  | 'KEEP_ACTIVE'
  /** All `ids` (gates) are OPEN (OPEN_GATE). */
  | 'OPEN'
  /** `required` of `ids` (relics) collected (COLLECT_RELIC). */
  | 'COLLECT_RELIC'
  /** Every `ids` statue rests on one of `tiles` (MOVE_OBJECT_TO_TARGET). */
  | 'MOVE_OBJECT'
  /** Every `ids` flag raised by COMPLETE_OBJECTIVE. */
  | 'FLAG'
  /** `required` of `ids` (carry relics) EXTRACTED (EXTRACT_RELIC). */
  | 'EXTRACT_RELIC'
  /** Ordered sub-objectives (`stages`); each latches when done (multi-stage missions). */
  | 'STAGES';

/** Default initial state per kind. */
export function defaultMechanismState(kind: MechanismKind): MechanismStateValue {
  switch (kind) {
    case 'SWITCH':
      return 'OFF';
    case 'GATE':
      return 'CLOSED';
    case 'BRIDGE':
      return 'RAISED';
    case 'TRAP':
      return 'ENABLED';
    case 'PRESSURE_PLATE':
    case 'STATUE':
    case 'RELIC':
    case 'PLATFORM':
      return 'IDLE';
    case 'REGION':
      return 'ORIENTATION_0';
  }
}

export const DEFAULT_ACCEPTS: Readonly<Partial<Record<MechanismKind, readonly OccupantClass[]>>> = {
  PRESSURE_PLATE: ['HERO', 'SUMMON', 'MOVABLE_OBJECT'],
  TRAP: ['HERO', 'SUMMON', 'ENEMY'],
};

/** Kinds the champion INTERACTs with from an adjacent tile. */
export const INTERACTABLE_KINDS: readonly MechanismKind[] = ['SWITCH', 'STATUE', 'RELIC'];

/** Guardian plating (FORTIFY / EXPOSE actions). */
export const FORTIFIED_STATUS = 'FORTIFIED';
/** Movement −1 (minimum 1) while carrying a relic. */
export const RELIC_BURDEN_STATUS = 'RELIC_BURDEN';
