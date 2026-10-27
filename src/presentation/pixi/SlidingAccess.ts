import { Container, Graphics, type Texture } from 'pixi.js';
import type { Pos } from '../../game';
import type { GridProjection } from './GridProjection';
export const ACCESS_SLIDE_MS = 900;
export function accessSlide(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}
/** Material-rendered stone, not an upright illustration distorted into another perspective. */
export class SlidingAccess {
  readonly block = new Graphics();
  readonly supports = new Graphics();
  constructor(
    private back: Container,
    private front: Container,
  ) {
    back.addChild(this.block);
    front.addChild(this.supports);
  }
  draw(pos: Pos, progress: number, p: GridProjection, material?: Texture) {
    this.block.clear();
    this.supports.clear();
    const color = 0x65716f,
      height = p.footprint(pos).w * 0.92;
    const cube = (g: Graphics, cx: number, cy: number, depth: number, width: number, h: number) => {
      const base = [
        [cx - depth / 2, cy - width / 2],
        [cx + depth / 2, cy - width / 2],
        [cx + depth / 2, cy + width / 2],
        [cx - depth / 2, cy + width / 2],
      ].map(([x, y]) => p.project(x!, y!));
      const top = base.map((v) => ({ x: v.x, y: v.y - h }));
      const poly = (points: { x: number; y: number }[], tone: number) => {
        const path = points.flatMap((v) => [v.x, v.y]);
        g.poly(path)
          .fill(material ? { texture: material, color: tone } : { color: tone })
          .stroke({ color: 0x202b2c, width: 1.5 });
      };
      poly([base[1]!, base[2]!, top[2]!, top[1]!], color);
      poly([base[2]!, base[3]!, top[3]!, top[2]!], 0x3c4949);
      poly(top, 0x9b9d88);
      const a = top[1]!,
        b = top[2]!;
      g.moveTo(a.x, a.y + 8)
        .lineTo(b.x, b.y + 8)
        .stroke({ color: 0xb8a578, width: 2, alpha: 0.8 });
    };
    const along = pos.y + 0.5 - accessSlide(progress) * 1.18;
    cube(this.block, pos.x + 0.5, along, 0.24, 0.92, height);
    for (const y of [pos.y - 0.12, pos.y + 1.12])
      cube(this.supports, pos.x + 0.5, y, 0.34, 0.18, height * 1.14);
    const anchor = p.project(pos.x + 0.5, along);
    this.back.zIndex = p.depthAtPoint(anchor) - 0.5;
    this.front.zIndex = p.depthAtPoint(p.getUnitAnchor(pos)) + 0.5;
    if (progress > 0.98) {
      const a = p.project(pos.x + 0.1, pos.y + 0.5),
        b = p.project(pos.x + 0.9, pos.y + 0.5);
      this.supports
        .moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ color: 0xd4b872, width: 2, alpha: 0.65 });
    }
  }
}
