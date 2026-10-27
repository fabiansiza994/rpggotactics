import type { Graphics } from 'pixi.js';
import type { GridProjection } from './GridProjection';
import type { BoardViewModel } from './viewModel';

/**
 * Runa de Ignición (Ranked): public delayed area. Both seats see the marked tiles until the owner's
 * next turn start resolves them (rules: domain/combat/glyphs.ts). Functional marker only; Codex
 * owns the final rune look (qa/ranked-reward-track/CODEX_HANDOFF.md).
 */
const FIRE = 0xff8a3d;

export function drawGlyphOverlay(g: Graphics, proj: GridProjection, vm: BoardViewModel): void {
  for (const glyph of vm.state.glyphs ?? []) {
    for (const tile of glyph.tiles) {
      const quad = proj.getInsetPolygon(tile, 0.1).flatMap((p) => [p.x, p.y]);
      g.poly(quad).fill({ color: FIRE, alpha: 0.14 }).stroke({ color: FIRE, alpha: 0.85, width: 2 });
      const inner = proj.getInsetPolygon(tile, 0.32).flatMap((p) => [p.x, p.y]);
      g.poly(inner).stroke({ color: FIRE, alpha: 0.6, width: 1.2 });
    }
  }
}
