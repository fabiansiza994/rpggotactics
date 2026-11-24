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
    const tone = glyph.glyphId.startsWith('thunder_') ? 0x85dfff : FIRE;
    for (const tile of glyph.tiles) {
      const quad = proj.getInsetPolygon(tile, 0.1).flatMap((p) => [p.x, p.y]);
      g.poly(quad).fill({ color: tone, alpha: 0.14 }).stroke({ color: tone, alpha: 0.85, width: 2 });
      const inner = proj.getInsetPolygon(tile, 0.32).flatMap((p) => [p.x, p.y]);
      g.poly(inner).stroke({ color: tone, alpha: 0.6, width: 1.2 });
    }
  }
}

/** Bounded, deterministic presentation sampling; no timer or gameplay RNG. */
export function stormOrbArcs(timeMs: number, reduced = false) {
  const t = reduced ? 0 : timeMs / 1000;
  return Array.from({length: reduced ? 4 : 7}, (_, i) => {
    const angle = i * Math.PI * 2 / (reduced ? 4 : 7) + .18 * Math.sin(t * 1.7 + i);
    const length = 15 + 8 * (.5 + .5 * Math.sin(t * 3.1 + i * 2.7));
    return {angle,length,bend:Math.sin(t * 4.2+i*1.8)*4};
  });
}
export function drawStormOrbs(g: Graphics, proj: GridProjection, vm: BoardViewModel, timeMs: number, reduced: boolean): void {
  for (const glyph of vm.state.glyphs ?? []) {
    if (glyph.glyphId !== 'thunder_orb' || !glyph.tiles.length) continue;
    const mean = glyph.tiles.reduce((a,p)=>({x:a.x+p.x,y:a.y+p.y}),{x:0,y:0});
    const c=proj.getTileCenter(glyph.origin ?? {x:Math.round(mean.x/glyph.tiles.length),y:Math.round(mean.y/glyph.tiles.length)});
    const y=c.y-38, pulse=reduced?0:Math.sin(timeMs/330)*.7;
    g.circle(c.x,y,18+pulse).fill({color:0x398ae8,alpha:.18});
    g.circle(c.x,y,12+pulse).fill({color:0x3279ba,alpha:.86}).stroke({color:0xbcefff,width:1.6});
    g.circle(c.x-2,y-2,4).fill({color:0xf0ffff,alpha:.95});
    for (const arc of stormOrbArcs(timeMs,reduced)) {
      const dx=Math.cos(arc.angle)*1.7,dy=Math.sin(arc.angle)*1.3;
      const points=[{x:c.x+dx*6,y:y+dy*6},{x:c.x+dx*arc.length*.55-dy*arc.bend,y:y+dy*arc.length*.55+dx*arc.bend},{x:c.x+dx*arc.length,y:y+dy*arc.length}];
      for (const [width,alpha] of [[4,.15],[1.4,.9]]) {
        g.moveTo(points[0]!.x,points[0]!.y);for(const p of points.slice(1))g.lineTo(p.x,p.y);
        g.stroke({color:0xa9eaff,width,alpha});
      }
      g.circle(points[2]!.x,points[2]!.y,1.2).fill({color:0xe6ffff,alpha:.85});
    }
  }
}
