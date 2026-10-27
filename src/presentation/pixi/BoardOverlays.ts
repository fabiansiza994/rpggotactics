import { targetingColors } from '../vfx/ElementalTargetingPreview';
import type { Graphics } from 'pixi.js';
import type { Pos } from '../../game';
import type { GridProjection, Point } from './GridProjection';
import { PALETTE } from './palette.ts';
import type { BoardViewModel } from './viewModel';
import { drawArcherOverlay } from '../qa/archer/archerBoard';
import { drawMechanisms } from './MechanismLayer';
import { drawGlyphOverlay } from './glyphOverlay';

/**
 * Tactical overlays drawn on the projected tile surface. Every shape is built from cell-space
 * (u, v) points mapped through GridProjection, so nothing is an axis-aligned rectangle laid over a
 * projected tile. Data comes only from the view model (Core queries / intent previews).
 */
const pts = (points: readonly Point[]) => points.flatMap((p) => [p.x, p.y]);

/** Polyline in cell space → projected polyline. */
function path(g: Graphics, proj: GridProjection, cells: readonly [number, number][]): Graphics {
  const [first, ...rest] = cells.map(([u, v]) => proj.project(u, v));
  g.moveTo(first!.x, first!.y);
  for (const p of rest) g.lineTo(p.x, p.y);
  return g;
}

/** Corner brackets hugging the projected tile edges. */
export function corners(
  g: Graphics,
  proj: GridProjection,
  cell: Pos,
  color: number,
  alpha = 1,
): void {
  const i = 0.075,
    l = 0.13;
  for (const [cu, cv, du, dv] of [
    [i, i, 1, 1],
    [1 - i, i, -1, 1],
    [i, 1 - i, 1, -1],
    [1 - i, 1 - i, -1, -1],
  ] as const) {
    const u = cell.x + cu,
      v = cell.y + cv;
    path(g, proj, [
      [u + du * l, v],
      [u, v],
      [u, v + dv * l],
    ]);
  }
  g.stroke({ color, alpha, width: 2 });
}

/** Small ground diamond at a cell-space point. */
function diamond(g: Graphics, proj: GridProjection, u: number, v: number, r: number): Graphics {
  return g.poly(
    pts([
      proj.project(u, v - r),
      proj.project(u + r, v),
      proj.project(u, v + r),
      proj.project(u - r, v),
    ]),
  );
}

/** Circle lying on the ground plane (projected), centred on a cell-space point. */
function groundCircle(
  g: Graphics,
  proj: GridProjection,
  u: number,
  v: number,
  r: number,
): Graphics {
  const ring: Point[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    ring.push(proj.project(u + Math.cos(a) * r, v + Math.sin(a) * r));
  }
  return g.poly(pts(ring));
}

export function drawRanges(g: Graphics, proj: GridProjection, vm: BoardViewModel): void {
  for (const n of vm.moveTiles) {
    g.poly(pts(proj.getInsetPolygon(n.pos, 0.045)))
      .fill({ color: PALETTE.moveRange, alpha: vm.mechanisms && !vm.hoverTile ? 0.025 : 0.09 })
      .stroke({ color: PALETTE.moveRange, alpha: vm.mechanisms && !vm.hoverTile ? 0.22 : 0.52, width: 1.35 });
  }
  for (const p of vm.targetTiles) {
    const enemy = vm.state.units.some(
      (u) => u.faction === 'ENEMY' && u.pos.x === p.x && u.pos.y === p.y,
    );
    const tone = enemy ? PALETTE.intentThreat : PALETTE.targetRange;
    g.poly(pts(proj.getInsetPolygon(p, 0.04)))
      .fill({ color: tone, alpha: 0.055 })
      .stroke({ color: tone, alpha: 0.72, width: 1.6 });
    diamond(g, proj, p.x + 0.5, p.y + 0.84, 0.045).stroke({
      color: tone,
      width: 1.5,
    });
  }
}

export function drawOverlay(g: Graphics, proj: GridProjection, vm: BoardViewModel): void {
  const center = (p: Pos) => proj.getTileCenter(p);
  // Archer: traps, Presa reticle and Distancia Óptima hints sit under every other overlay.
  drawArcherOverlay(g, proj, vm);
  // Ranked: Runa de Ignición tiles (public, resolve at the owner's next turn start).
  drawGlyphOverlay(g, proj, vm);
  // Final mechanism art and signposting replace the functional Phase 2 placeholders.
  drawMechanisms(g, proj, vm);

  // Server-projected arcane nodes: ownership also changes rune geometry, never picking.
  for (const node of vm.state.dominion?.nodes ?? []) {
    const ownSeat = vm.state.player.heroId === 'champion-a' ? 0 : 1;
    const own = node.control === ownSeat,
      rival = typeof node.control === 'number' && !own;
    const tone = own
      ? 0x67d8ff
      : rival
        ? 0xff897b
        : node.control === 'CONTESTED'
          ? 0xffd678
          : 0xc1acd9;
    const u = node.pos.x + 0.5,
      v = node.pos.y + 0.5;
    groundCircle(g, proj, u, v, 0.36)
      .fill({ color: tone, alpha: 0.12 })
      .stroke({ color: tone, width: 2.5, alpha: 0.9 });
    groundCircle(g, proj, u, v, 0.27).stroke({ color: tone, width: 1, alpha: 0.7 });
    diamond(g, proj, u, v, 0.16)
      .fill({ color: tone, alpha: 0.4 })
      .stroke({ color: tone, width: 2 });
    if (own) corners(g, proj, node.pos, tone, 0.9);
    if (rival || node.control === 'CONTESTED') {
      path(g, proj, [
        [u - 0.18, v - 0.18],
        [u + 0.18, v + 0.18],
      ]);
      path(g, proj, [
        [u - 0.18, v + 0.18],
        [u + 0.18, v - 0.18],
      ]);
      g.stroke({ color: tone, width: 2 });
    }
    if (node.control === 'NEUTRAL')
      diamond(g, proj, u, v, 0.06).stroke({ color: tone, width: 1.5 });
  }

  // Enemy intents (telegraphs): projected path centre → centre, outlined + hatched threat.
  for (const plan of vm.intents) {
    const focused = vm.focusedEnemyId === null || vm.focusedEnemyId === plan.enemyId;
    const alpha = focused ? 1 : 0.35;
    const enemy = vm.state.units.find((u) => u.id === plan.enemyId);
    const threatTone = enemy?.defId.startsWith('veil_') ? 0xb7a0d2 : PALETTE.intentThreat;
    const forge = enemy?.defId === 'forge_king' || enemy?.defId === 'magma_beast';
    if (enemy && plan.path.length > 0) {
      const start = center(enemy.pos);
      for (const p of plan.path)
        g.poly(pts(proj.getInsetPolygon(p, 0.12))).fill({
          color: PALETTE.intentPath,
          alpha: 0.035 * alpha,
        });
      // Show the connecting route only when the player inspects this enemy.
      if (vm.focusedEnemyId === plan.enemyId) {
        g.moveTo(start.x, start.y);
        for (const p of plan.path) {
          const c = center(p);
          g.lineTo(c.x, c.y);
        }
        g.stroke({ width: 1.3, color: PALETTE.intentPath, alpha: 0.55 });
      }
      const end = center(plan.end);
      const before = plan.path.length > 1 ? center(plan.path[plan.path.length - 2]!) : start;
      const angle = Math.atan2(end.y - before.y, end.x - before.x);
      for (const offset of [-0.55, 0.55]) {
        g.moveTo(end.x - Math.cos(angle + offset) * 8, end.y - Math.sin(angle + offset) * 8).lineTo(
          end.x,
          end.y,
        );
      }
      g.stroke({ color: PALETTE.intentPath, width: 1.4, alpha: alpha * 0.65 });
      diamond(g, proj, plan.end.x + 0.5, plan.end.y + 0.5, 0.07).stroke({
        color: PALETTE.intentPath,
        width: 2,
        alpha,
      });
    }
    for (const t of plan.threatTiles) {
      g.poly(pts(proj.getInsetPolygon(t, 0.06))).stroke({
        width: 2,
        color: threatTone,
        alpha: 0.6 * alpha,
      });
    }
    for (const t of plan.attackTiles) {
      const quad = pts(proj.getInsetPolygon(t, 0.06));
      g.poly(quad).fill({ color: threatTone, alpha: 0.1 * alpha });
      if (forge) {
        const c = center(t);
        g.circle(c.x,c.y,9).stroke({color:0xffcf86,width:2,alpha});
        g.moveTo(c.x-5,c.y).lineTo(c.x+5,c.y).moveTo(c.x,c.y-5).lineTo(c.x,c.y+5).stroke({color:0xffcf86,width:2,alpha});
        corners(g,proj,t,0xffc078,alpha);
      }
      // Guaranteed hit: diagonal hatching that stays on the projected surface.
      for (let k = 0; k < 4; k++) {
        const u0 = t.x + 0.16 + k * 0.18;
        path(g, proj, [
          [u0, t.y + 0.9],
          [u0 + 0.13, t.y + 0.68],
        ]);
      }
      g.stroke({ width: 2, color: threatTone, alpha: 0.5 * alpha });
      g.poly(quad).stroke({ width: 3, color: threatTone, alpha });
    }
  }

  // Movement reads through lit stepping stones; a thin track stays secondary.
  if (vm.hoverPath.length > 0) {
    const hero = vm.state.units.find((u) => u.id === vm.heroId);
    if (hero) {
      const start = center(hero.pos);
      g.moveTo(start.x, start.y);
      for (const cell of vm.hoverPath) {
        const c = center(cell);
        g.lineTo(c.x, c.y);
      }
      g.stroke({ width: 1.3, color: PALETTE.moveRange, alpha: 0.35 });
    }
    for (const [i, cell] of vm.hoverPath.entries()) {
      const destination = i === vm.hoverPath.length - 1;
      g.poly(pts(proj.getInsetPolygon(cell, 0.09)))
        .fill({ color: PALETTE.moveRange, alpha: destination ? 0.19 : 0.1 })
        .stroke({
          color: PALETTE.moveRange,
          alpha: destination ? 0.9 : 0.45,
          width: destination ? 1.8 : 1,
        });
      if (destination) corners(g, proj, cell, PALETTE.moveRange, 0.95);
      else
        diamond(g, proj, cell.x + 0.5, cell.y + 0.5, 0.035).fill({
          color: PALETTE.moveRange,
          alpha: 0.65,
        });
    }
  }

  // Card preview: the exact Core footprint, following each tile's surface.
  if (vm.preview) {
    const color = vm.preview.valid ? (vm.preview.element ? targetingColors[vm.preview.element] : PALETTE.preview) : PALETTE.invalid;
    for (const t of vm.preview.tiles)
      g.poly(pts(proj.getInsetPolygon(t, 0.02)))
        .fill({ color, alpha: vm.preview.element && vm.preview.valid ? 0 : 0.12 })
        .stroke({ width: 2, color });
    if (vm.preview.impact)
      groundCircle(g, proj, vm.preview.impact.x + 0.5, vm.preview.impact.y + 0.5, 0.15).stroke({
        width: 3,
        color: 0xffffff,
      });
  }

  // Hover.
  if (vm.hoverTile && vm.interactive) {
    const p = vm.hoverTile;
    const hero = vm.state.units.find((u) => u.id === vm.heroId);
    const isHero = hero?.pos.x === p.x && hero.pos.y === p.y;
    const valid = vm.preview
      ? vm.preview.valid
      : vm.moveTiles.some((n) => n.pos.x === p.x && n.pos.y === p.y);
    const color = valid || isHero ? PALETTE.hover : PALETTE.invalid;
    // A touch-armed preview waits for confirmation: lift it above a passing mouse hover.
    if (vm.aimArmed && valid) {
      g.poly(pts(proj.getInsetPolygon(p, 0.02)))
        .fill({ color, alpha: 0.16 })
        .stroke({ color, width: 3 });
    }
    corners(g, proj, p, color);
    if (!valid && !isHero) {
      path(g, proj, [
        [p.x + 0.45, p.y + 0.78],
        [p.x + 0.55, p.y + 0.92],
      ]);
      path(g, proj, [
        [p.x + 0.55, p.y + 0.78],
        [p.x + 0.45, p.y + 0.92],
      ]);
      g.stroke({ color, width: 2 });
    }
  }
}
