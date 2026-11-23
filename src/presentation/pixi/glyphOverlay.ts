import {activeBloodTrails} from '../../game/domain/combat/blood-trail';
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
  for (const mark of activeBloodTrails(vm.state)) {
    const c = proj.getTileCenter(mark.pos);
    g.ellipse(c.x-3,c.y+2,5,2.5).fill({color:0x7b1124,alpha:0.72});
    g.circle(c.x+5,c.y-2,1.7).fill({color:0xb5273b,alpha:0.8});
  }
  for (const glyph of vm.state.glyphs ?? []) {
    if(glyph.winterHeart){const h=glyph.winterHeart,at=vm.state.units.find(u=>u.id===h.targetId)?.pos??h.lastKnown,c=proj.getTileCenter(at);g.ellipse(c.x,c.y,18,8).stroke({color:0x96e6ff,width:2,alpha:.8});continue;}
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
