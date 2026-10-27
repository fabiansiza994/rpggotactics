import type { GameEvent, GameState } from '../../game';
import { applyTransform, regionPlan } from '../../game/domain/mechanisms/mechanism-transform';

/** Assign event-reported display data to an isolated snapshot. This never resolves a command. */
export function projectEvent(
  state: Readonly<GameState>,
  event: GameEvent,
  final: Readonly<GameState>,
): GameState {
  const next: GameState = structuredClone(state);
  const unit = 'unitId' in event ? next.units.find((u) => u.id === event.unitId) : undefined;
  switch (event.type) {
    case 'MECHANISM_CHANGED': {
      const object = next.mechanisms?.objects.find(o => o.def.id === event.mechanismId);
      if (object) {
        // Geometry and all riders commit together at the rotation cue, not at batch end.
        if (event.cue === 'SECTION_ROTATED' && event.rotation && object.def.region)
          applyTransform(next, regionPlan(next, object, event.rotation.turns));
        object.state = event.state; object.pos = { ...event.pos };
        if (event.cue === 'PLATE_PRESSED') object.active = true;
        else if (event.cue === 'PLATE_RELEASED') object.active = false;
        else if (object.def.kind !== 'PRESSURE_PLATE') object.active = object.def.kind === 'REGION' ? event.state !== (object.def.initial ?? 'ORIENTATION_0') : ['ON','OPEN','LOWERED','COLLECTED','CARRIED','EXTRACTED','ENABLED'].includes(event.state);
        if (event.cue === 'MECHANISM_LOCKED') object.locked = true;
        if (event.cue === 'MECHANISM_UNLOCKED') object.locked = false;
      }
      break;
    }
    case 'GUARDIAN_STATE':
      if (next.mechanisms) {
        next.mechanisms.exposed ??= {};
        if (event.untilRound !== undefined) next.mechanisms.exposed[event.unitId] = event.untilRound;
        else delete next.mechanisms.exposed[event.unitId];
      }
      break;
    case 'UNIT_MOVED':
    case 'UNIT_TELEPORTED':
    case 'UNIT_PUSHED':
      if (unit) unit.pos = { ...event.to };
      break;
    case 'FORM_CHANGED':
      if(unit){if(event.to===null)delete unit.activeForm;else unit.activeForm=event.to;}
      break;
    case 'SHIELD_SHATTERED':
      if(unit)unit.shield=event.total;
      break;
    case 'UNIT_DAMAGED':
      if (unit) {
        unit.hp = event.hpAfter;
        unit.shield = Math.max(0, unit.shield - event.shieldAbsorbed);
      }
      break;
    case 'UNIT_HEALED':
    case 'HP_SACRIFICED':
      if (unit) unit.hp = event.hpAfter;
      break;
    case 'SUMMON_CAPACITY_CHANGED':
      if (unit) unit.summonCapacityBonus = event.bonus;
      break;
    case 'UNIT_DEFEATED':
      next.units = next.units.filter((u) => u.id !== event.unitId);
      break;
    case 'UNIT_SPAWNED': {
      const spawned = final.units.find((u) => u.id === event.unitId);
      if (spawned && !unit) next.units.push({ ...structuredClone(spawned), pos: { ...event.pos } });
      break;
    }
    case 'SHIELD_GAINED':
      if (unit) unit.shield = event.total;
      break;
    case 'SHIELD_BROKEN':
    case 'SHIELD_EXPIRED':
      if (unit) unit.shield = 0;
      break;
    case 'STATUS_APPLIED': {
      // Sourced statuses (Presa) keep their owner so markers know whose mark it is mid-playback.
      const sourced = final.units.find((u) => u.id === event.unitId)?.statuses.some((s) => s.id === event.status && s.sourceId);
      if (unit)
        unit.statuses = [
          ...unit.statuses.filter((s) => s.id !== event.status),
          { id: event.status, turnsLeft: event.turnsLeft, ...(sourced ? { sourceId: event.sourceId } : {}) },
        ];
      break;
    }
    case 'FOCUS_CHANGED':
      if (unit?.focus) unit.focus = { ...unit.focus, value: event.to };
      break;
    case 'TRAP_PLACED':
      next.traps = [...(next.traps ?? []).filter((t) => t.id !== event.trapId),
        { id: event.trapId, trapId: event.kind, ownerId: event.ownerId, pos: { ...event.pos }, damage: 0, turnsLeft: event.turnsLeft }];
      break;
    case 'TRAP_TRIGGERED':
    case 'TRAP_REMOVED':
      next.traps = (next.traps ?? []).filter((t) => t.id !== event.trapId);
      break;
    case 'STATUS_REMOVED':
      if (unit) unit.statuses = unit.statuses.filter((s) => s.id !== event.status);
      break;
    case 'TERRAIN_CREATED':
    case 'TERRAIN_REMOVED': {
      const tile = next.board.tiles[event.pos.y * next.board.width + event.pos.x];
      if (tile) {
        tile.terrain = event.type === 'TERRAIN_CREATED' ? event.terrain : event.revertedTo;
        tile.terrainTurnsLeft = event.type === 'TERRAIN_CREATED' ? event.turnsLeft : null;
      }
      break;
    }
    case 'OBSTACLE_CREATED':
      next.obstacles.push({
        id: event.obstacleId,
        defId: event.defId,
        pos: { ...event.pos },
        turnsLeft: event.turnsLeft,
      });
      break;
    case 'OBSTACLE_REMOVED':
      next.obstacles = next.obstacles.filter((o) => o.id !== event.obstacleId);
      break;
    case 'COLLECTIBLE_COLLECTED': {
      const item = next.collectibles.find((c) => c.id === event.collectibleId);
      if (item) item.collected = true;
      break;
    }
  }
  return next;
}
