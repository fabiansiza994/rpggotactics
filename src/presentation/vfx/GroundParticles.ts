import { Container, Graphics } from 'pixi.js';
import { GROUND_PARTICLE_LIMIT } from './groundFeel';

type Puff = {
  life: number;
  age: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  frost: boolean;
  debris: boolean;
};
/** One ground-layer draw call, fixed pool, no per-frame allocations or gameplay RNG. */
export class GroundParticles {
  private disposed = false;
  private readonly art = new Graphics();
  private readonly pool: Puff[] = Array.from({ length: GROUND_PARTICLE_LIMIT }, () => ({
    life: 0,
    age: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    size: 0,
    frost: false,
    debris: false,
  }));
  constructor(layer: Container) {
    this.art.eventMode = 'none';
    layer.addChild(this.art);
  }
  emit(
    x: number,
    y: number,
    dx: number,
    dy: number,
    count: number,
    heavy: boolean,
    frost = false,
    debris = false,
  ) {
    if (this.disposed) return;
    for (let i = 0; i < Math.ceil(count); i++) {
      const p = this.pool.find((p) => p.life === 0);
      if (!p) break;
      const side = i % 2 ? 1 : -1,
        phase = i * 2.39996;
      Object.assign(p, {
        life: debris ? 480 : 360,
        age: 0,
        x: x + side * 3,
        y: y + 1,
        vx: -dx * (heavy ? 15 : 9) + Math.cos(phase) * 9,
        vy: -dy * 5 - 5 - Math.sin(phase) * 4,
        size: (heavy ? 3 : 2) + (i % 3),
        frost,
        debris,
      });
    }
  }
  tick(ms: number, reduced: boolean) {
    if (this.disposed) return;
    this.art.clear();
    for (const p of this.pool) {
      if (!p.life) continue;
      p.age += ms;
      if (reduced || p.age >= p.life) {
        p.life = 0;
        continue;
      }
      const t = p.age / p.life,
        x = p.x + p.vx * t,
        y = p.y + p.vy * t + (p.debris ? 12 * t * t : 0);
      const color = p.frost ? 0xc0e7e7 : p.debris ? 0x9a8b70 : 0x9e927b;
      if (p.debris) this.art.rect(x, y, 2, 2).fill({ color, alpha: (1 - t) * 0.7 });
      else
        this.art
          .ellipse(x, y, p.size * (0.5 + t), p.size * (0.3 + t * 0.3))
          .fill({ color, alpha: (1 - t) * 0.26 });
    }
  }
  get activeCount() {
    return this.pool.filter((p) => p.life > 0).length;
  }
  clear() {
    if (this.disposed) return;
    for (const p of this.pool) p.life = 0;
    this.art.clear();
  }
  destroy() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.art.destroy();
  }
}
