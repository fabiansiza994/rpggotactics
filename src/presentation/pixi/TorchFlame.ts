import { Container, Graphics } from 'pixi.js';
export function flamePose(ms: number, phase: number, reduced: boolean) {
  if (reduced) return { x: 0, y: 1, glow: 0.72 };
  const t = ms / 1000 + phase;
  return {
    x: Math.sin(t * 7.1) * 1.2 + Math.sin(t * 11.3) * 0.45,
    y: 1 + Math.sin(t * 8.7) * 0.09 + Math.sin(t * 13.1) * 0.04,
    glow: 0.72 + Math.sin(t * 6.3) * 0.1 + Math.sin(t * 9.7) * 0.06,
  };
}
/** Three illustrated flame tongues and a bounded glow; no filters, textures or particle emitter. */
export class TorchFlame extends Container {
  private clock = 0;
  private glow = new Graphics();
  private tongues: Graphics[] = [];
  constructor(private phase: number) {
    super({ eventMode: 'none' });
    for (let i = 4; i > 0; i--)
      this.glow.circle(0, -12, i * 8).fill({ color: 0xffa046, alpha: 0.025 });
    this.addChild(this.glow);
    for (const [color, width, height] of [
      [0xf17524, 9, 29],
      [0xffba4e, 6, 23],
      [0xffedb0, 3, 15],
    ]) {
      const g = new Graphics()
        .moveTo(-width!, 0)
        .bezierCurveTo(-width! * 1.4, -height! * 0.4, width! * 0.6, -height! * 0.55, 0, -height!)
        .bezierCurveTo(width! * 1.5, -height! * 0.45, width!, 0, -width!, 0)
        .fill({ color: color! });
      this.addChild(g);
      this.tongues.push(g);
    }
  }
  tick(ms: number, reduced: boolean) {
    this.clock += ms;
    this.tongues.forEach((g, i) => {
      const p = flamePose(this.clock, this.phase + i * 0.7, reduced);
      g.x = p.x;
      g.scale.y = p.y;
    });
    this.glow.alpha = flamePose(this.clock, this.phase, reduced).glow;
  }
}
