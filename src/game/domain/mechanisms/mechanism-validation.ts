import type { GameContent } from '../content';
import { addPos, posKey, samePos, type Pos } from '../core/position';
import type { ScenarioDef } from '../scenario';
import type { MechanismActionType, MechanismKind } from './mechanism';
import { orientationOf, regionClosedUnder, rotateCell } from './mechanism-transform';

/** Which kinds each action can target (anything else is an authoring error, not a silent no-op). */
const ACTION_TARGETS: Partial<Record<MechanismActionType, readonly MechanismKind[]>> = {
  OPEN: ['GATE', 'BRIDGE', 'SWITCH'],
  CLOSE: ['GATE', 'BRIDGE', 'SWITCH'],
  LOWER: ['BRIDGE', 'GATE'],
  RAISE: ['BRIDGE', 'GATE'],
  TOGGLE: ['GATE', 'BRIDGE', 'SWITCH', 'TRAP'],
  ENABLE: ['TRAP', 'SWITCH', 'PRESSURE_PLATE'],
  DISABLE: ['TRAP', 'SWITCH', 'PRESSURE_PLATE'],
  MOVE: ['STATUE', 'PLATFORM', 'REGION'],
  ADVANCE: ['PLATFORM', 'REGION'],
  ROTATE: ['REGION'],
  RESET: ['STATUE', 'GATE', 'BRIDGE', 'SWITCH', 'TRAP', 'PRESSURE_PLATE', 'PLATFORM', 'REGION'],
  DAMAGE: ['PRESSURE_PLATE', 'TRAP', 'GATE', 'BRIDGE'],
  CYCLE: ['SWITCH'],
};

/** Footprint of a platform at a stop. */
const platformAt = (shape: readonly Pos[] | undefined, anchor: Pos): Pos[] => (shape ?? [{ x: 0, y: 0 }]).map((d) => addPos(anchor, d));

/**
 * Tiles platforms make walkable: `initial` = where they start (units may spawn there), `all` = every
 * stop (static reachability: an exit across a chasm is reachable by platform).
 */
export function platformTiles(scenario: ScenarioDef, which: 'initial' | 'all'): Pos[] {
  return (scenario.mechanisms?.objects ?? [])
    .filter((o) => o.kind === 'PLATFORM')
    .flatMap((o) => (which === 'initial' ? [o.pos] : Object.values(o.stops ?? {})).flatMap((a) => platformAt(o.shape, a)));
}

/** Tile key of any platform stop → every tile of that platform's stops (a ride connects them). */
export function platformRides(scenario: ScenarioDef): Map<string, Pos[]> {
  const out = new Map<string, Pos[]>();
  for (const o of scenario.mechanisms?.objects ?? []) {
    if (o.kind !== 'PLATFORM') continue;
    const tiles = Object.values(o.stops ?? {}).flatMap((a) => platformAt(o.shape, a));
    for (const t of tiles) out.set(posKey(t), [...(out.get(posKey(t)) ?? []), ...tiles]);
  }
  return out;
}

/**
 * Rotating sections for the static reachability flood: each section cell → its orbit under the
 * allowed turns (where riding the section can carry you). A cell is listed only when some cell of
 * its orbit is floor in the layout (a turn can put floor there). Over-approximates on purpose: the
 * exact puzzle is checked per encounter by its tests.
 */
export function regionOrbits(scenario: ScenarioDef, isFloor: (p: Pos) => boolean): Map<string, Pos[]> {
  const out = new Map<string, Pos[]>();
  for (const o of scenario.mechanisms?.objects ?? []) {
    const r = o.kind === 'REGION' ? o.region : undefined;
    if (!r) continue;
    const turns = (r.allowedOrientations ?? [0, 90, 180, 270]).map((a) => a / 90);
    for (const c of r.cells) {
      const orbit = turns.map((t) => rotateCell(c, r.pivot, t));
      if (orbit.some(isFloor)) out.set(posKey(c), orbit);
    }
  }
  return out;
}

/** Kinds that occupy their tile (no unit may start there). */
const SOLID_AT_START: readonly MechanismKind[] = ['STATUE', 'SWITCH', 'RELIC'];

/**
 * Static checks for `ScenarioDef.mechanisms` (called from validateScenario). Same spirit as the
 * spawn checks: in bounds, walkable floor, no overlaps, every rule reference resolves, every
 * action fits its target kind, and statues start inside their own `allowedTiles`.
 */
export function validateMechanisms(scenario: ScenarioDef, content: GameContent, err: (msg: string) => void): void {
  const def = scenario.mechanisms;
  if (!def) return;
  const rows = scenario.layout.length;
  const cols = scenario.layout[0]?.length ?? 0;
  const inBounds = (p: Pos) => p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows;
  const floor = (p: Pos) => {
    const legend = scenario.legend[scenario.layout[p.y]?.[p.x] ?? ''];
    if (!legend) return false;
    if (legend.obstacleId) return false;
    return legend.terrain ? content.terrain[legend.terrain]?.walkable !== false : true;
  };

  const unitIds = new Set([scenario.hero.heroId, ...scenario.structures.map((s) => s.id), ...scenario.enemies.map((e) => e.id), ...scenario.waves.flatMap((w) => w.enemies.map((e) => e.id))]);
  const unitTiles = new Map<string, string>();
  for (const u of [{ id: scenario.hero.heroId, pos: scenario.hero.pos }, ...scenario.structures, ...scenario.enemies]) unitTiles.set(posKey(u.pos), u.id);

  const kinds = new Map<string, MechanismKind>();
  const statics = new Map<string, string>();
  const platformLanes = new Map<string, string>();
  for (const o of def.objects.filter((x) => x.kind === 'PLATFORM')) {
    const what = `platform "${o.id}"`;
    const stops = o.stops ?? {};
    if (Object.keys(stops).length < 2) err(`${what} needs at least two stops`);
    if (!o.initialStop || !stops[o.initialStop]) err(`${what} has no valid initialStop`);
    else if (!samePos(stops[o.initialStop]!, o.pos)) err(`${what} pos must equal its initialStop`);
    for (const [name, anchor] of Object.entries(stops))
      for (const t of platformAt(o.shape, anchor)) {
        if (!inBounds(t)) err(`${what} stop ${name} leaves the board at (${t.x},${t.y})`);
        else if (scenario.legend[scenario.layout[t.y]![t.x]!]?.obstacleId) err(`${what} stop ${name} overlaps a wall at (${t.x},${t.y})`);
        platformLanes.set(posKey(t), o.id);
      }
  }
  for (const o of def.objects) {
    const what = `mechanism "${o.id}"`;
    if (kinds.has(o.id) || unitIds.has(o.id)) err(`duplicate mechanism id "${o.id}"`);
    kinds.set(o.id, o.kind);
    if (!inBounds(o.pos)) {
      err(`${what} at (${o.pos.x},${o.pos.y}) is outside the board`);
      continue;
    }
    if (o.kind === 'PLATFORM' || o.kind === 'REGION') continue;
    if (o.interactionMode && (o.kind !== 'SWITCH' || !o.momentary)) err(`${what}: interactionMode needs a momentary SWITCH`);
    if (!floor(o.pos)) err(`${what} at (${o.pos.x},${o.pos.y}) is not on walkable floor`);
    if (platformLanes.has(posKey(o.pos))) err(`${what} sits in the lane of platform "${platformLanes.get(posKey(o.pos))}"`);
    if (o.holdRounds !== undefined && (o.kind !== 'SWITCH' || o.holdRounds < 1)) err(`${what}: holdRounds needs a SWITCH and ≥ 1`);
    if (o.startsLocked && o.kind !== 'SWITCH') err(`${what}: only a SWITCH can start locked`);
    if (o.carry && o.kind !== 'RELIC') err(`${what}: only relics can be carried`);
    for (const t of o.carry?.extraction ?? []) if (!inBounds(t) || !floor(t)) err(`${what}: extraction (${t.x},${t.y}) is not walkable floor`);
    // One fixed object per tile; a statue may start on a plate.
    const key = posKey(o.pos);
    const other = statics.get(key);
    const otherKind = other ? kinds.get(other) : undefined;
    const stacking = other && ((o.kind === 'STATUE' && otherKind === 'PRESSURE_PLATE') || (o.kind === 'PRESSURE_PLATE' && otherKind === 'STATUE'));
    if (other && !stacking) err(`${what} overlaps "${other}" at (${o.pos.x},${o.pos.y})`);
    statics.set(key, o.id);
    const unit = unitTiles.get(key);
    const closed = (o.kind === 'GATE' && (o.initial ?? 'CLOSED') === 'CLOSED') || (o.kind === 'BRIDGE' && (o.initial ?? 'RAISED') === 'RAISED');
    if (unit && (SOLID_AT_START.includes(o.kind) || closed)) err(`${what} starts under unit "${unit}"`);
    if (o.kind === 'STATUE' && o.allowedTiles && !o.allowedTiles.some((t) => samePos(t, o.pos)))
      err(`${what} starts outside its allowedTiles`);
    if (o.kind === 'TRAP' && !o.trap) err(`${what} has no trap damage`);
  }

  // Rotating sections: a turn must permute the section onto itself and never carry an exit, a platform
  // lane or a statue rail (those are authored in absolute coordinates).
  const regionCells = new Map<string, string>();
  for (const o of def.objects.filter((x) => x.kind === 'REGION')) {
    const what = `region "${o.id}"`;
    const r = o.region;
    if (!r || !r.cells.length) {
      err(`${what} needs region.cells`);
      continue;
    }
    if (o.initial && !o.initial.startsWith('ORIENTATION_')) err(`${what}: initial must be an ORIENTATION_* state`);
    const allowed = r.allowedOrientations ?? [0, 90, 180, 270];
    if (!allowed.includes(orientationOf(o.initial ?? 'ORIENTATION_0'))) err(`${what}: initial orientation is not allowed`);
    if (allowed.length < 2) err(`${what} needs at least two allowed orientations`);
    for (const a of allowed) if (!regionClosedUnder(r, a / 90)) err(`${what} does not map onto itself at ${a}°`);
    if (r.occupantsMoveWithRegion === false && !r.blockedByOccupancy) err(`${what}: occupants that do not ride must block the turn (blockedByOccupancy)`);
    for (const c of r.cells) {
      if (!inBounds(c)) err(`${what} cell (${c.x},${c.y}) is outside the board`);
      const key = posKey(c);
      if (regionCells.has(key)) err(`${what} overlaps region "${regionCells.get(key)}" at (${c.x},${c.y})`);
      regionCells.set(key, o.id);
      if (platformLanes.has(key)) err(`${what} contains the lane of platform "${platformLanes.get(key)}"`);
      if (scenario.legend[scenario.layout[c.y]?.[c.x] ?? '']?.terrain === 'OBJECTIVE') err(`${what} contains an exit tile (${c.x},${c.y})`);
    }
  }
  if (regionCells.size) {
    const inside = (p: Pos) => regionCells.has(posKey(p));
    for (const o of def.objects) {
      if (o.kind === 'STATUE' && o.allowedTiles && inside(o.pos)) err(`statue "${o.id}" has allowedTiles inside a rotating region`);
      for (const t of o.carry?.extraction ?? []) if (inside(t)) err(`relic "${o.id}": extraction tile (${t.x},${t.y}) inside a rotating region`);
    }
    for (const obj of scenario.objectives)
      if (obj.type === 'REACH_TILE' && obj.tiles.some(inside)) err('REACH_TILE objective tile inside a rotating region');
  }

  const ruleIds = new Set<string>();
  for (const rule of def.rules) {
    if (ruleIds.has(rule.id)) err(`duplicate mechanism rule "${rule.id}"`);
    ruleIds.add(rule.id);
    const t = rule.trigger.type;
    const sources = rule.trigger.sources ?? [];
    if (t !== 'ON_ROUND_START' && t !== 'ON_ROUND_END' && t !== 'ON_EXPOSE_END' && sources.length === 0) err(`rule "${rule.id}": ${t} needs sources`);
    if (t === 'ON_EXPOSE_END' && rule.trigger.unitIds?.some((id) => !unitIds.has(id))) err(`rule "${rule.id}": ON_EXPOSE_END on an unknown unit`);
    const { every, offset } = rule.trigger;
    if (every !== undefined || offset !== undefined) {
      if (t !== 'ON_ROUND_START' && t !== 'ON_ROUND_END') err(`rule "${rule.id}": every/offset need a round trigger`);
      if (!Number.isInteger(every) || every! < 1 || (offset !== undefined && (!Number.isInteger(offset) || offset < 1))) err(`rule "${rule.id}": every/offset must be whole rounds ≥ 1`);
    }
    for (const id of rule.whileAlive ?? []) if (!unitIds.has(id)) err(`rule "${rule.id}": whileAlive names unknown unit "${id}"`);
    for (const id of [...sources, ...(rule.condition?.all ?? []), ...(rule.condition?.any ?? [])])
      if (!kinds.has(id)) err(`rule "${rule.id}": unknown mechanism "${id}"`);
    if (t === 'ON_SEQUENCE' && (sources.length < 2 || sources.some((id) => kinds.get(id) !== 'SWITCH')))
      err(`rule "${rule.id}": ON_SEQUENCE needs two or more switches`);
    if (t === 'ON_INTERACT')
      for (const id of sources)
        if (kinds.has(id) && !['SWITCH', 'STATUE', 'RELIC'].includes(kinds.get(id)!)) err(`rule "${rule.id}": "${id}" cannot be interacted with`);
    if ((t === 'ON_OCCUPIED' || t === 'ON_VACATED') && sources.some((id) => kinds.get(id) !== 'PRESSURE_PLATE'))
      err(`rule "${rule.id}": ${t} sources must be pressure plates`);
    if (rule.actions.length === 0) err(`rule "${rule.id}": no actions`);
    for (const action of rule.actions) {
      const allowed = ACTION_TARGETS[action.type];
      for (const id of action.targets ?? []) {
        const kind = kinds.get(id);
        if (!kind) err(`rule "${rule.id}": unknown target "${id}"`);
        else if (allowed && !allowed.includes(kind)) err(`rule "${rule.id}": ${action.type} cannot target ${kind} "${id}"`);
      }
      if (allowed && !(action.targets ?? []).length) err(`rule "${rule.id}": ${action.type} needs targets`);
      const regionMove = action.type === 'MOVE' && action.targets?.some((id) => kinds.get(id) === 'REGION');
      if (regionMove && (action.orientation === undefined || ![0, 90, 180, 270].includes(action.orientation))) err(`rule "${rule.id}": MOVE on a region needs an orientation`);
      if (action.type === 'MOVE' && !regionMove && !action.stop && (!action.to || !inBounds(action.to))) err(`rule "${rule.id}": MOVE needs an in-bounds "to"`);
      if (action.type === 'ROTATE' && action.turns !== undefined && (!Number.isInteger(action.turns) || action.turns % 4 === 0)) err(`rule "${rule.id}": ROTATE turns must be a non-zero quarter-turn count`);
      if (action.type === 'SPAWN')
        for (const e of action.enemies ?? []) {
          if (!content.enemies[e.enemyId]) err(`rule "${rule.id}": unknown enemy "${e.enemyId}"`);
          if (unitIds.has(e.id)) err(`rule "${rule.id}": spawn id "${e.id}" already used`);
        }
      if (action.type === 'COMPLETE_OBJECTIVE' && !action.flag) err(`rule "${rule.id}": COMPLETE_OBJECTIVE needs a flag`);
      if (action.type === 'CYCLE') {
        // Exactly one live control: the first of the ring; every other one starts locked.
        const ring = (action.targets ?? []).map((id) => def.objects.find((o) => o.id === id));
        if (ring.length < 2) err(`rule "${rule.id}": CYCLE needs two or more switches`);
        if (ring[0]?.startsLocked || ring.slice(1).some((o) => o && !o.startsLocked)) err(`rule "${rule.id}": CYCLE ring must start with only its first control unlocked`);
      }
      if (action.type === 'MOVE' && action.targets?.some((id) => kinds.get(id) === 'PLATFORM')) {
        const platform = def.objects.find((o) => action.targets!.includes(o.id) && o.kind === 'PLATFORM');
        if (!action.stop || !platform?.stops?.[action.stop]) err(`rule "${rule.id}": MOVE needs a known platform stop`);
      }
      if ((action.type === 'FORTIFY' || action.type === 'EXPOSE') && (!action.unitIds?.length || action.unitIds.some((id) => !unitIds.has(id))))
        err(`rule "${rule.id}": ${action.type} needs existing unitIds`);
    }
  }

  for (const o of scenario.objectives) {
    if (o.type !== 'MECHANISM' || o.goal === 'FLAG') continue;
    if (o.goal === 'STAGES') {
      if (!o.stages?.length) err('MECHANISM STAGES objective needs stages');
      continue;
    }
    for (const id of o.ids) if (!kinds.has(id)) err(`MECHANISM objective references unknown "${id}"`);
    if (o.goal === 'MOVE_OBJECT' && !(o.tiles ?? []).length) err('MECHANISM MOVE_OBJECT objective needs tiles');
  }
}
