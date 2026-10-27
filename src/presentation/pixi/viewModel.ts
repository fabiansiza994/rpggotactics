import type { GameContent, GameState, IntentPlan, PathNode, Pos } from '../../game';
import type { ArcherBoardHints } from '../qa/archer/archerBoard';

/**
 * Everything the board renderer needs for one frame. Built by React from engine queries;
 * the renderer never calls the engine itself.
 */
export interface BoardViewModel {
  mechanisms?: import('../../game/domain/mechanisms/mechanism-view').MechanismView | null;
  selectedMechanismId?: string | null;
  mechanismPushTo?: Pos;
  state: Readonly<GameState>;
  content: GameContent;
  heroId: string;
  interactive: boolean;
  /** Aimed tile: under the mouse, or the last touch tap. Feeds `preview` / `hoverPath`. */
  hoverTile: Pos | null;
  /** The aim came from a tap and waits for a second tap / Confirm (drawn stronger). */
  aimArmed: boolean;
  /** Legal walking destinations (only when no card is selected). */
  moveTiles: PathNode[];
  /** Path to the hovered legal destination. */
  hoverPath: Pos[];
  /** Selectable tiles for the selected card. */
  targetTiles: Pos[];
  unitTargeting?: boolean;
  /** Resolved area for the hovered target (null if nothing hovered / no card). */
  preview: {
    element?: import('../../game/domain/cards/card').VisualElement;
    tiles: Pos[];
    valid: boolean;
    impact: Pos | null;
    predicted: { unitId: string; label: string }[];
  } | null;
  intents: IntentPlan[];
  focusedEnemyId: string | null;
  /** Archer champion only: Distancia Óptima / Concentración tiles for the selected card. */
  archer?: ArcherBoardHints;
}
