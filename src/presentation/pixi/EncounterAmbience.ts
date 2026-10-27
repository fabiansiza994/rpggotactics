import type { EnvironmentEffects } from '../vfx/EnvironmentEffects';
import { Container, Graphics } from 'pixi.js';
import type { GridProjection } from './GridProjection';
import { encounterIdentity } from '../assets/visualIdentity.ts';
import { easing } from '../motion/tokens.ts';

/** Torch catching: a fast swell past full brightness, a few flickers, then steady. */
function ignite(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return easing.outCubic(p) + Math.sin(p * Math.PI) * 0.22 + Math.sin(p * 31) * 0.07 * (1 - p);
}

/** 24 deterministic motes and static edge light pools, driven by the scene's shared clock. */
export class EncounterAmbience {
  constructor(private readonly environment?: EnvironmentEffects) {}
  readonly art = new Graphics();
  readonly lighting = new Container({ eventMode: 'none' });
  readonly foreground = new Container({ eventMode: 'none' });
  private pools: Graphics[] = [];
  private fog: Graphics[] = [];
  private sparks: { art: Graphics; x: number; y: number; phase: number }[] = [];
  private clock = 0;
  private width = 672;
  private height = 480;
  private left = 0;
  private scenario = 'first_blood';
  /** Battle-intro awakening, 0 → 1 per layer: lights, then fog, then motes. */
  private wake = { lights: 1, fog: 1, motes: 1 };
  setWake(lights: number, fog: number, motes: number): void {
    this.wake = { lights: ignite(lights), fog: easing.outCubic(fog), motes: easing.outCubic(motes) };
  }
  /** `left` is the board's left edge in world space (the projected board is centred on x = 0). */
  configure(scenario: string, width: number, height: number, left = 0, proj?: GridProjection) {
    this.scenario = scenario;
    this.width = width;
    this.height = height;
    this.left = left;
    if (!proj) return;
    for (const layer of [this.lighting, this.foreground])
      for (const child of layer.removeChildren()) child.destroy();
    this.pools = [];
    this.fog = [];
    this.sparks = [];
    const theme = encounterIdentity(scenario);
    const cold = new Graphics();
    for (let i = 6; i > 0; i--)
      cold.ellipse(0, height * 0.44, width * (0.18 + i * 0.045), height * (0.08 + i * 0.024))
        .fill({ color: 0x7fb6c9, alpha: 0.007 });
    this.lighting.addChild(cold);
    // Same anchors as arenaArt's corner braziers. Sanctuary crystals remain unchanged.
    const torches = theme.theme === 'fracture' || theme.theme === 'sanctuary' ? [] :
      [[-0.15,-0.15],[proj.cols+0.15,-0.15],[-0.15,proj.rows+0.15],[proj.cols+0.15,proj.rows+0.15]].map(([u,v])=>{
        const p=proj.project(u!,v!),scale=proj.scaleAtY(p.y);
        return {x:p.x,y:p.y-38*scale,scale,depth:proj.depthAtPoint(p)+1};
      });
    this.environment?.syncTorches(torches);
    for (let i = 0; i < 3; i++) {
      const fog = new Graphics();
      for (let band = 5; band > 0; band--)
        fog.ellipse(0, height + 94 + i * 26, width * (0.31 + band * 0.025), 13 + band * 4)
          .fill({ color: 0x7195aa, alpha: 0.009 });
      this.foreground.addChild(fog);
      this.fog.push(fog);
    }
  }
  tick(ms: number, reduced: boolean, compact = false) {
    this.clock += ms;
    const { lights, fog: fogWake, motes } = this.wake;
    if (this.environment) this.environment.wake = Math.min(1,lights);
    for (const [i, pool] of this.pools.entries()) {
      const t = this.clock / 1000;
      pool.alpha =
        lights * (reduced ? 0.85 : 0.86 + Math.sin(t * 1.31 + i * 2.4) * 0.07 + Math.sin(t * 0.73 + i) * 0.04);
    }
    for (const [i, fog] of this.fog.entries()) {
      // Fog drifts in from the side while it thickens, then keeps its slow idle sway.
      fog.x = (reduced ? 0 : Math.sin(this.clock / 23000 + i * 1.8) * 16) - (1 - fogWake) * (36 + i * 14);
      fog.alpha = fogWake * (reduced ? 0.7 : 0.75 + Math.sin(this.clock / 17000 + i) * 0.1);
    }
    for (const spark of this.sparks) {
      const progress = (this.clock / 8200 + spark.phase) % 1;
      spark.art.visible = !reduced && progress < 0.42 && lights > 0.6;
      spark.art.position.set(spark.x + Math.sin(progress * 9 + spark.phase) * 5, spark.y - progress * 68);
      spark.art.alpha = Math.max(0, Math.sin(progress / 0.42 * Math.PI)) * 0.55 * Math.min(1, lights);
    }
    const g = this.art,
      theme = encounterIdentity(this.scenario);
    g.clear();
    for (const x of [this.left - 22, this.left + this.width + 22])
      for (const y of [this.height * 0.22, this.height * 0.8]) {
        for (let j = 3; j > 0; j--)
          g.ellipse(x, y, 12 + j * 13, 25 + j * 16).fill({ color: theme.light, alpha: 0.012 * lights });
      }
    for (let i = 0; i < (compact ? 8 : 24); i++) {
      const phase = ((i * 131) % 997) / 997;
      const progress = reduced
        ? phase
        : (phase + this.clock * (theme.ambient === 'embers' ? 0.000055 : 0.000025)) % 1;
      const x = this.left + (i % 2 ? this.width + 20 + (i % 3) * 8 : -20 - (i % 3) * 8);
      const y = this.height * (1 - progress);
      const sway = reduced ? 0 : Math.sin(progress * 6 + i) * 5;
      g.circle(x + sway, y, i % 5 === 0 ? 1.5 : 0.8).fill({
        color: theme.light,
        alpha: Math.sin(progress * Math.PI) * (reduced ? 0.12 : 0.35) * motes,
      });
    }
  }
  destroy() {
    this.art.destroy({ context: true });
    this.lighting.destroy({ children: true });
    this.foreground.destroy({ children: true });
  }
}
