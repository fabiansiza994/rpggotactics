import type { Pos } from './core/position';
import type { CollectibleSpawnDef } from './entities/collectible';
import type { TargetPreference } from './entities/unit';
import type { ObjectiveDef } from './objectives/objective';
import type { TerrainType } from './terrain/terrain';

export interface EnemySpawnDef {
  id: string;
  enemyId: string;
  pos: Pos;
  targetPreference?: TargetPreference;
}

export interface WaveDef {
  /** Spawns at the start of this round, before intents are declared. */
  round: number;
  enemies: EnemySpawnDef[];
}

/**
 * Encounter declaration: board + player + enemies + terrain + objective, all as data.
 *
 * `layout` is one string per row, one char per tile. The legend maps chars to terrain and/or
 * obstacles. Units are placed explicitly by coordinates.
 */
export interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  layout: string[];
  legend: Record<string, { terrain?: TerrainType; obstacleId?: string }>;
  hero: { heroId: string; pos: Pos };
  structures: { id: string; structureId: string; pos: Pos }[];
  enemies: EnemySpawnDef[];
  waves: WaveDef[];
  /** Objective pickups (COLLECT_OBJECTS). Optional: most scenarios have none. */
  collectibles?: CollectibleSpawnDef[];
  objectives: ObjectiveDef[];
  /** Interactive battlefield (Act III): objects + trigger rules. Absent = static board. */
  mechanisms?: import('./mechanisms/mechanism').MechanismBoardDef;
  defaultSeed: number;
}
