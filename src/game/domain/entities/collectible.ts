import type { Pos } from '../core/position';

/**
 * Gameplay pickups placed on the board by the encounter (not decoration). Only kinds with a
 * finished visual are listed; adding one is a data + art change, never a rule change. CORE (World
 * 2 forge cores) uses a placeholder style until its final art exists.
 */
export type CollectibleKind = 'ORB' | 'PAGE' | 'CORE';

export interface CollectibleSpawnDef {
  id: string;
  kind: CollectibleKind;
  pos: Pos;
}

/** Collectibles never block movement or line of sight; the hero picks them up by walking in. */
export interface Collectible extends CollectibleSpawnDef {
  collected: boolean;
}
