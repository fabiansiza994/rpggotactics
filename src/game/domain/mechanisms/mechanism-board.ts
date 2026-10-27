import { addPos, samePos, type Pos } from '../core/position';
import type { Unit } from '../entities/unit';
import type { GameState } from '../state';
import {
  DEFAULT_ACCEPTS,
  defaultMechanismState,
  type MechanismBoard,
  type MechanismBoardDef,
  type MechanismObject,
  type MechanismStateValue,
  type OccupantClass,
} from './mechanism';

/**
 * Pure board queries over `GameState.mechanisms`. Kept free of rule imports so occupancy.ts (and
 * through it pathfinding, AI, pushes, LoS, previews) can ask "does a mechanism block this tile?"
 * without an import cycle. No mechanisms → every query answers as if the feature did not exist.
 */

const ACTIVE_STATES: ReadonlySet<MechanismStateValue> = new Set(['ON', 'OPEN', 'LOWERED', 'COLLECTED', 'ENABLED']);

/** Active for anything except plates (whose activity comes from occupancy, see the sync). */
export const stateIsActive = (state: MechanismStateValue): boolean => ACTIVE_STATES.has(state);

export function createMechanismBoard(def: MechanismBoardDef): MechanismBoard {
  const objects: MechanismObject[] = def.objects.map((d) => {
    const state = d.initial ?? defaultMechanismState(d.kind);
    return {
      def: structuredClone(d),
      state,
      pos: { ...d.pos },
      active: d.kind === 'PRESSURE_PLATE' || d.kind === 'STATUE' || d.kind === 'PLATFORM' || d.kind === 'REGION' ? false : stateIsActive(state),
      occupants: [],
      ...(d.kind === 'PLATFORM' && d.initialStop ? { stop: d.initialStop } : {}),
      ...(d.startsLocked ? { locked: true } : {}),
    };
  });
  return { objects, rules: structuredClone([...def.rules]), fired: [], edges: {}, flags: [], held: {}, interactedRound: 0 };
}

export const mechanismById = (state: Readonly<GameState>, id: string): MechanismObject | undefined =>
  state.mechanisms?.objects.find((o) => o.def.id === id);

/** Tiles an object occupies now: a platform's footprint, nothing for a carried/extracted relic. */
export function footprint(o: MechanismObject): Pos[] {
  if (o.def.kind === 'RELIC' && (o.state === 'CARRIED' || o.state === 'EXTRACTED')) return [];
  // A region is a transform of the board, not an object standing on it.
  if (o.def.kind === 'REGION') return [];
  if (o.def.kind === 'PLATFORM') return (o.def.shape ?? [{ x: 0, y: 0 }]).map((d) => addPos(o.pos, d));
  return [o.pos];
}

export const covers = (o: MechanismObject, p: Pos): boolean => footprint(o).some((t) => samePos(t, p));

/** Every mechanism on `p` (a statue may stand on a plate or a platform). */
export const mechanismsAt = (state: Readonly<GameState>, p: Pos): MechanismObject[] =>
  state.mechanisms?.objects.filter((o) => covers(o, p)) ?? [];

/** A platform is under `p`: walkable floor even over a chasm (occupancy.isStandable). */
export const mechanismFloorAt = (state: Readonly<GameState>, p: Pos): boolean =>
  !!state.mechanisms && mechanismsAt(state, p).some((o) => o.def.kind === 'PLATFORM');

/** Solid right now: closed gate, raised bridge, statue, switch/relic pedestal (relic until taken). */
export function mechanismIsSolid(o: MechanismObject): boolean {
  switch (o.def.kind) {
    case 'GATE':
      return o.state === 'CLOSED';
    case 'BRIDGE':
      return o.state === 'RAISED';
    case 'STATUE':
    case 'SWITCH':
      return true;
    case 'RELIC':
      // On its pedestal it is solid; a dropped relic lies on the floor (units may stand on it).
      return o.state === 'IDLE';
    case 'PRESSURE_PLATE':
    case 'TRAP':
    case 'PLATFORM':
    case 'REGION':
      return false;
  }
}

export function mechanismBlocksMovementAt(state: Readonly<GameState>, p: Pos): boolean {
  return !!state.mechanisms && mechanismsAt(state, p).some(mechanismIsSolid);
}

/** Closed gates (unless `blocksSight: false`) and statues with `blocksSight: true`. Gaps never do. */
export function mechanismBlocksSightAt(state: Readonly<GameState>, p: Pos): boolean {
  if (!state.mechanisms) return false;
  return mechanismsAt(state, p).some((o) =>
    o.def.kind === 'GATE' ? o.state === 'CLOSED' && o.def.blocksSight !== false : o.def.kind === 'STATUE' && o.def.blocksSight === true,
  );
}

/** Occupant class of a unit (structures never press or spring anything). */
export function occupantClassOf(unit: Unit): OccupantClass | null {
  return unit.kind === 'HERO' ? 'HERO' : unit.kind === 'SUMMON' ? 'SUMMON' : unit.kind === 'ENEMY' ? 'ENEMY' : null;
}

export function acceptsOccupant(o: MechanismObject, cls: OccupantClass | null): boolean {
  if (!cls) return false;
  const accepts = o.def.accepts ?? DEFAULT_ACCEPTS[o.def.kind] ?? [];
  return accepts.includes(cls) || (cls !== 'MOVABLE_OBJECT' && accepts.includes('ANY_UNIT'));
}

/**
 * A summon standing on a plate that accepts summons "holds" it: it stays put (still attacks what
 * it reaches) instead of walking off — the Summoner's plate advantage. Plates that refuse summons
 * (HERO_ONLY) never hold one.
 */
export function holdsPlate(state: Readonly<GameState>, unit: Unit): boolean {
  return mechanismsAt(state, unit.pos).some((o) => o.def.kind === 'PRESSURE_PLATE' && !o.locked && acceptsOccupant(o, occupantClassOf(unit)));
}
