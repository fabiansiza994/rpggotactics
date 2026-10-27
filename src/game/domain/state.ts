import type { EnemyIntent } from './ai/behavior';
import type { Board } from './board/board';
import type { CardInstance } from './cards/card';
import type { Collectible } from './entities/collectible';
import type { Obstacle } from './entities/obstacle';
import type { Glyph } from './entities/glyph';
import type { Trap } from './entities/trap';
import type { Faction, Unit } from './entities/unit';
import type { ObjectiveState } from './objectives/objective';
import type { WaveDef } from './scenario';

/**
 * - PLAYER: the player may issue MOVE_UNIT / PLAY_CARD / END_TURN.
 * - ENEMY:  transient; enemy actions resolve synchronously inside END_TURN.
 * - ENDED:  battle is over (see `outcome`).
 */
export type BattlePhase = 'PLAYER' | 'ENEMY' | 'ENDED';

export interface PlayerState {
  heroId: string;
  energy: number;
  maxEnergy: number;
  movePoints: number;
  maxMovePoints: number;
  drawPerTurn: number;
  /** Hard cap during the turn (see `HeroDef.maxHandSize`). */
  maxHandSize: number;
  /** Kept between turns (see `HeroDef.handSize`). Absent in older snapshots = `maxHandSize`. */
  handSize?: number;
  /** Index 0 is the top of the deck. */
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  /**
   * Única cards played this battle (every Ultra): out of play for good, never discarded, never
   * recycled into the deck and never searchable. Absent in older snapshots = none.
   */
  banished?: CardInstance[];
  /** Successful discard recycling count. First free, later arcane damage = count - 1. */
  deckRecycles: number;
  /**
   * Ritual altar (champions with `altarSlots` only): pieces sealed out of the hand, committed to
   * rituals. Private like the hand: PvP projections never send the rival's altar, only its size.
   */
  altar?: CardInstance[];
  /** Pieces sealed this turn (prices the next seal, `HeroDef.altarSealing`). Reset at turn start. */
  altarSeals?: number;
  /** Ritual ids resolved this battle, in order (`RitualDef.limitPerBattle`). */
  ritualsResolved?: string[];
}

export type OutcomeReason =
  'OBJECTIVES_COMPLETED' | 'HERO_DEFEATED' | 'PROTECTED_TARGET_DESTROYED' | 'ROUND_LIMIT_REACHED';

export interface BattleOutcome {
  result: 'WON' | 'LOST';
  reason: OutcomeReason;
}

/**
 * The single source of truth for a battle. Plain serialisable data: no class instances,
 * no functions, no references to renderer objects.
 */
export interface GameState {
  /** Private sorted candidate projection for own deck search; never authoritative draw order. */
  searchChoices?: CardInstance[];
  /** Authoritative static PvP map identifier; terrain itself is in board snapshots. */
  mapId?: string;
  /** Server-only duel turn context; omitted from wire projections. */
  duel?: import('../pvp/duel').DuelMeta;
  /** Counts for player-specific network views; draw order is deliberately absent. */
  pileCounts?: {
    deck: number;
    discard: number;
    opponentHand: number;
    opponentDeck: number;
    opponentDiscard: number;
    /** Pieces on the rival's altar (count only: identities stay hidden until activation). */
    opponentAltar?: number;
  };
  dominion?: import('../pvp/dominion').DominionState;
  scenarioId: string;
  round: number;
  phase: BattlePhase;
  activeFaction: Faction;
  board: Board;
  units: Unit[];
  obstacles: Obstacle[];
  /** Placed traps (Archer). Absent in older snapshots = none. Public in PvP like obstacles. */
  traps?: Trap[];
  /** Delayed areas (Runa de Ignición). Absent in older snapshots = none. Public in PvP like traps. */
  glyphs?: Glyph[];
  /** Interactive battlefield (Act III). Present only when the scenario declares a puzzle; never in PvP. */
  mechanisms?: import('./mechanisms/mechanism').MechanismBoard;
  /** Objective pickups declared by the scenario (collected ones stay, flagged). */
  collectibles: Collectible[];
  player: PlayerState;
  /** Current enemy intents, declared at the start of each player turn. */
  intents: EnemyIntent[];
  objectives: ObjectiveState[];
  pendingWaves: WaveDef[];
  outcome: BattleOutcome | null;
  stats: { enemiesDefeated: number; totalEnemies: number; cardsPlayed: number };
  rngState: number;
  /** Monotonic counter for generated ids (cards, obstacles). */
  nextId: number;
}
