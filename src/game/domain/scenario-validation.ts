import { boardSizeErrors, type BoardSize } from './board/board-size';
import type { GameContent } from './content';
import { DIRECTIONS, manhattan, posKey, step, type Pos } from './core/position';
import type { ScenarioDef } from './scenario';
import { platformRides, platformTiles, regionOrbits, validateMechanisms } from './mechanisms/mechanism-validation';

/** Initial enemies must start at least this far (Manhattan) from the hero: no free first hit. */
export const MIN_SPAWN_SEPARATION = 3;

/** Board size as declared by the layout (rows = strings, columns = chars per string). */
export function scenarioBoardSize(scenario: ScenarioDef): BoardSize {
  return { rows: scenario.layout.length, columns: scenario.layout[0]?.length ?? 0 };
}

/**
 * Static checks for an encounter declaration. Returns human-readable errors (empty = valid).
 *
 * - layout: rectangular, within BOARD_LIMITS, every char in the legend, known obstacle ids
 * - spawns (hero, structures, enemies, waves): in bounds, on walkable terrain, not on a static
 *   obstacle; initial units never overlap; ids are unique; known definitions
 * - collectibles: unique ids, in bounds, walkable, not under an initial unit or another pickup
 * - objectives reference existing units / in-bounds tiles; COLLECT_OBJECTS has enough pickups
 * - every objective tile (pickups, REACH_TILE exits) is reachable on foot from the hero spawn
 *   through the static layout (units ignored: they move), so no objective is impossible
 *
 * `authoring: true` adds design rules for shipped encounters (rules tests build deliberately
 * cramped boards, so battle creation only enforces the hard rules above):
 * - teams: no initial enemy within MIN_SPAWN_SEPARATION of the hero
 * - reinforcements arrive from round 2 on
 *
 * Wave spawns may overlap units at spawn time (the rules relocate them), so only their tile
 * itself is checked.
 */
export function validateScenario(
  scenario: ScenarioDef,
  content: GameContent,
  options: { authoring?: boolean } = {},
): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(`Scenario ${scenario.id}: ${msg}`);

  const size = scenarioBoardSize(scenario);
  if (size.rows === 0 || size.columns === 0) {
    err('empty layout');
    return errors;
  }
  for (const row of scenario.layout)
    if (row.length !== size.columns) err(`ragged layout row "${row}"`);
  for (const e of boardSizeErrors(size)) err(e);
  if (errors.length) return errors;

  const blocked = new Set<string>();
  scenario.layout.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const legend = scenario.legend[ch];
      if (!legend) return err(`no legend entry for "${ch}"`);
      if (legend.obstacleId && !content.obstacles[legend.obstacleId])
        err(`unknown obstacle "${legend.obstacleId}"`);
      const walkable = legend.terrain ? content.terrain[legend.terrain]?.walkable !== false : true;
      if (!walkable || legend.obstacleId) blocked.add(posKey({ x, y }));
    }),
  );

  // Act III platforms are floor where they start; their other stops are reachable by riding them.
  for (const p of platformTiles(scenario, 'initial')) blocked.delete(posKey(p));
  const riding = new Set(platformTiles(scenario, 'all').map(posKey));
  const rides = platformRides(scenario);
  // Rotating sections: a cell some turn makes floor can be entered, and riding it reaches its orbit.
  const orbits = regionOrbits(scenario, (p) => !blocked.has(posKey(p)));
  for (const [key, orbit] of orbits) {
    riding.add(key);
    rides.set(key, [...(rides.get(key) ?? []), ...orbit]);
  }
  const inBounds = (p: Pos) => p.x >= 0 && p.y >= 0 && p.x < size.columns && p.y < size.rows;
  const checkTile = (what: string, p: Pos): boolean => {
    if (!inBounds(p)) return err(`${what} at (${p.x},${p.y}) is outside the ${size.rows}x${size.columns} board`), false;
    if (blocked.has(posKey(p))) return err(`${what} at (${p.x},${p.y}) is on a blocked tile`), false;
    return true;
  };

  const ids = new Set<string>();
  const occupied = new Map<string, string>();
  const place = (id: string, what: string, p: Pos, initial: boolean) => {
    if (ids.has(id)) err(`duplicate unit id "${id}"`);
    ids.add(id);
    if (!checkTile(what, p) || !initial) return;
    const other = occupied.get(posKey(p));
    if (other) err(`${what} overlaps "${other}" at (${p.x},${p.y})`);
    occupied.set(posKey(p), id);
  };

  if (!content.heroes[scenario.hero.heroId]) err(`unknown hero "${scenario.hero.heroId}"`);
  place(scenario.hero.heroId, 'hero spawn', scenario.hero.pos, true);
  for (const s of scenario.structures) {
    if (!content.structures[s.structureId]) err(`unknown structure "${s.structureId}"`);
    place(s.id, `structure "${s.id}"`, s.pos, true);
  }
  for (const e of scenario.enemies) {
    if (!content.enemies[e.enemyId]) err(`unknown enemy "${e.enemyId}"`);
    place(e.id, `enemy "${e.id}"`, e.pos, true);
    const gap = manhattan(e.pos, scenario.hero.pos);
    if (options.authoring && gap < MIN_SPAWN_SEPARATION) err(`enemy "${e.id}" spawns ${gap} tiles from the hero`);
  }
  for (const wave of scenario.waves) {
    if (options.authoring && wave.round < 2) err(`wave at round ${wave.round}: reinforcements start at round 2`);
    for (const e of wave.enemies) {
      if (!content.enemies[e.enemyId]) err(`unknown enemy "${e.enemyId}"`);
      place(e.id, `wave enemy "${e.id}"`, e.pos, false);
    }
  }

  // Static walkability flood from the hero spawn (obstacles/blocked terrain only).
  const reachable = new Set<string>();
  const frontier: Pos[] = inBounds(scenario.hero.pos) ? [scenario.hero.pos] : [];
  for (const p of frontier) reachable.add(posKey(p));
  while (frontier.length) {
    const from = frontier.shift()!;
    for (const n of DIRECTIONS.map((d) => step(from, d))) {
      if (!inBounds(n) || (blocked.has(posKey(n)) && !riding.has(posKey(n))) || reachable.has(posKey(n))) continue;
      reachable.add(posKey(n));
      frontier.push(n);
      // Stepping onto a platform stop reaches its other stops (the platform carries you there).
      for (const t of rides.get(posKey(n)) ?? [])
        if (!reachable.has(posKey(t))) {
          reachable.add(posKey(t));
          frontier.push(t);
        }
    }
  }
  const checkReachable = (what: string, p: Pos) => {
    if (checkTile(what, p) && !reachable.has(posKey(p))) err(`${what} at (${p.x},${p.y}) is unreachable from the hero spawn`);
  };

  const pickups = new Set<string>();
  for (const c of scenario.collectibles ?? []) {
    if (pickups.has(c.id)) err(`duplicate collectible id "${c.id}"`);
    pickups.add(c.id);
    checkReachable(`collectible "${c.id}"`, c.pos);
    const other = occupied.get(posKey(c.pos));
    if (other) err(`collectible "${c.id}" overlaps "${other}" at (${c.pos.x},${c.pos.y})`);
    occupied.set(posKey(c.pos), c.id);
  }

  if (scenario.objectives.length === 0) err('no objectives');
  for (const o of scenario.objectives) {
    if (o.type === 'PROTECT_TARGET' && !scenario.structures.some((s) => s.id === o.targetUnitId))
      err(`PROTECT_TARGET references missing structure "${o.targetUnitId}"`);
    if (o.type === 'DEFEAT_TARGET') {
      const all = [...scenario.enemies, ...scenario.waves.flatMap((w) => w.enemies)];
      if (!all.some((e) => e.id === o.targetUnitId))
        err(`DEFEAT_TARGET references missing enemy "${o.targetUnitId}"`);
    }
    if (o.type === 'REACH_TILE') for (const t of o.tiles) checkReachable('REACH_TILE target', t);
    if (o.type === 'COLLECT_OBJECTS') {
      const available = (scenario.collectibles ?? []).filter((c) => c.kind === o.kind).length;
      if (o.required < 1) err(`COLLECT_OBJECTS requires ${o.required} ${o.kind}`);
      if (available < o.required) err(`COLLECT_OBJECTS needs ${o.required} ${o.kind} but only ${available} are placed`);
    }
    if (o.type === 'SURVIVE_ROUNDS' && o.rounds < 1) err(`SURVIVE_ROUNDS needs at least 1 round`);
  }
  validateMechanisms(scenario, content, err);
  return errors;
}
