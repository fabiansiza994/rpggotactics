import type { Graphics } from 'pixi.js';
import type { Pos } from '../../game';
import type { GridProjection } from './GridProjection';
import type { BoardViewModel } from './viewModel';

/**
 * Act III phase 2 — FUNCTIONAL PLACEHOLDERS only (Codex owns the final look, see
 * qa/act3-interactive/CODEX_HANDOFF.md). Without them a moving platform over the chasm would be
 * invisible floor. Draws, from the mechanism view only: platform floor + its other stops (rails),
 * relic extraction tiles, a carried relic on its carrier, and the Guardian's plating ring.
 */
const STONE = 0x8c7b5a;
const RUNE = 0x5fd6d0;
const GOLD = 0xf2c35b;
const STEEL = 0x9fb3c8;

const quad = (proj: GridProjection, tile: Pos, inset: number) => proj.getInsetPolygon(tile, inset).flatMap((p) => [p.x, p.y]);

function ring(g: Graphics, proj: GridProjection, tile: Pos, r: number): Graphics {
  const pts: number[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const p = proj.project(tile.x + 0.5 + Math.cos(a) * r, tile.y + 0.5 + Math.sin(a) * r);
    pts.push(p.x, p.y);
  }
  return g.poly(pts);
}

export function drawPhase2Overlay(g: Graphics, proj: GridProjection, vm: BoardViewModel): void {
  const view = vm.mechanisms;
  if (!view) return;
  for (const o of view.objects) {
    if (o.kind === 'PLATFORM') {
      // Rails: every stop it can reach, faintly; then the floor where it is now.
      for (const stop of o.stops ?? []) for (const t of stop.tiles) g.poly(quad(proj, t, 0.12)).stroke({ color: RUNE, alpha: 0.35, width: 1.2 });
      for (const t of o.tiles ?? []) {
        g.poly(quad(proj, t, 0.03)).fill({ color: STONE, alpha: 0.92 }).stroke({ color: o.visualState === 'active' ? GOLD : RUNE, alpha: 0.9, width: 2 });
        g.poly(quad(proj, t, 0.3)).stroke({ color: RUNE, alpha: 0.5, width: 1 });
      }
    }
    if (o.kind === 'RELIC' && o.state !== 'EXTRACTED') {
      for (const t of o.extraction ?? []) g.poly(quad(proj, t, 0.08)).fill({ color: GOLD, alpha: 0.08 }).stroke({ color: GOLD, alpha: 0.75, width: 1.6 });
      const carrier = o.carrier ? vm.state.units.find((u) => u.id === o.carrier) : undefined;
      if (carrier) ring(g, proj, carrier.pos, 0.18).fill({ color: GOLD, alpha: 0.85 }).stroke({ color: 0x5a3d10, width: 1.5 });
      else if (o.state === 'DROPPED') ring(g, proj, o.pos, 0.16).fill({ color: GOLD, alpha: 0.6 }).stroke({ color: GOLD, width: 2 });
    }
  }
  for (const guardian of view.guardians ?? []) {
    const unit = vm.state.units.find((u) => u.id === guardian.unitId);
    if (!unit) continue;
    const plated = guardian.state === 'FORTIFIED';
    ring(g, proj, unit.pos, 0.46).stroke({ color: plated ? STEEL : GOLD, alpha: plated ? 0.9 : 1, width: plated ? 4 : 2.5 });
  }
}
