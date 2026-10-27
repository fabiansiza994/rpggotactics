import type { Pos } from '../core/position';

export interface ObstacleDef {
  id: string;
  name: string;
  blocksMovement: boolean;
  /** Data-driven LoS: not every obstacle blocks line attacks. */
  blocksLineOfSight: boolean;
  visualKey: string;
}

export interface Obstacle {
  id: string;
  defId: string;
  pos: Pos;
  /** Rounds left for temporary obstacles (Ice Wall). `null` = permanent. */
  turnsLeft: number | null;
}
