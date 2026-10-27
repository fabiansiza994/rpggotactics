import type { CardDefinition } from '../../../game';

/** Symbolic footprint, not a valid-target query. Orientation is representative for directional cards. */
export function cardPattern(target: CardDefinition['targeting']) {
  const cells: { x: number; y: number }[] = [];
  const area = 'area' in target ? target.area : undefined;
  const shape = target.type === 'LINE' ? 'LINE' : target.type === 'CROSS' ? 'CROSS'
    : target.type === 'AREA' ? 'SQUARE' : area?.shape ?? 'SINGLE';
  const radius = 'radius' in target ? target.radius : area && 'radius' in area ? area.radius : 0;
  const includeCenter = 'includeCenter' in target ? target.includeCenter !== false
    : area && 'includeCenter' in area ? area.includeCenter !== false : true;
  const origin = shape === 'LINE' ? { x: 0, y: 2 } : { x: 2, y: 2 };
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    const dx = Math.abs(x - 2), dy = Math.abs(y - 2);
    const filled = shape === 'LINE' ? y === 2 && x > 0 && x <= (target.type === 'LINE' ? target.range : 0)
      : shape === 'CROSS' ? dx + dy <= radius && (dx === 0 || dy === 0)
        : shape === 'SQUARE' ? Math.max(dx, dy) <= radius
          : shape === 'WALL' ? x === 2 && dy <= radius : dx === 0 && dy === 0;
    if (filled && (includeCenter || dx + dy > 0)) cells.push({ x, y });
  }
  return { cells, origin, shape };
}
