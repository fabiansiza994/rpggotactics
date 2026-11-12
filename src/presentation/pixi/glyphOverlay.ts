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
    if (glyph.glyphId === 'thunder_orb' && glyph.tiles.length) {
      const mean = glyph.tiles.reduce((a,p)=>({x:a.x+p.x,y:a.y+p.y}),{x:0,y:0});
      const c=proj.getTileCenter(glyph.origin ?? {x:Math.round(mean.x/glyph.tiles.length),y:Math.round(mean.y/glyph.tiles.length)});
      g.circle(c.x,c.y-23,8).fill({color:0x174978,alpha:0.8}).stroke({color:0xc6efff,width:1.8});
      g.circle(c.x-2,c.y-26,2).fill({color:0xf0ffff,alpha:0.95});
    }
    const tone = glyph.glyphId.startsWith('thunder_') ? 0x85dfff : FIRE;
    for (const tile of glyph.tiles) {
      const quad = proj.getInsetPolygon(tile, 0.1).flatMap((p) => [p.x, p.y]);
      g.poly(quad).fill({ color: tone, alpha: 0.14 }).stroke({ color: tone, alpha: 0.85, width: 2 });
      const inner = proj.getInsetPolygon(tile, 0.32).flatMap((p) => [p.x, p.y]);
      g.poly(inner).stroke({ color: tone, alpha: 0.6, width: 1.2 });
    }
  }
}
