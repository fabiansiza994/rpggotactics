import { Rectangle, Sprite, Texture, type Container } from 'pixi.js';
import type { Pos } from '../../game';
import { loadSharedTexture } from '../pixi/paintedTextures';
import type { FxGeometry } from './ElementEffects';
import { fireballFrame } from './fireballRecipe';

type Point = { x: number; y: number };
type Clip = {
  sprite: Sprite;
  group?: string;
  age: number;
  duration: number;
  update(t: number, sprite: Sprite): void;
};

/** Shared bounded illustrated-atlas pool; one existing presentation clock, never a renderer/ticker. */
export abstract class PaintedEffectPool {
  protected frames: Texture[] = [];
  private job: Promise<void> | null = null;
  private readonly free: Sprite[] = [];
  private readonly clips: Clip[] = [];
  private created = 0;
  private disposed = false;
  protected mobile = false;
  private usePremium = false;
  private peak = 0;
  private loadMs: number | null = null;
  reduced = false;
  constructor(
    private readonly actors: Container,
    private readonly ground: Container,
    protected readonly geometry: FxGeometry,
    private readonly assetId: string,
    private readonly limit = 32,
  ) {}
  abstract get requested(): boolean;
  get ready() {
    return this.usePremium && this.frames.length === 16;
  }
  get snapshot() {
    return {
      active: this.clips.length,
      allocated: this.created,
      peak: this.peak,
      ready: this.ready, loadMs: this.loadMs,
    };
  }
  beginBatch(): void {
    this.usePremium = this.requested;
    this.mobile =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(max-height: 500px), (pointer: coarse)').matches;
  }
  async prepare(): Promise<void> {
    if (!this.requested || this.frames.length || this.disposed) return;
    if (this.job) return this.job;
    this.mobile =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(max-height: 500px), (pointer: coarse)').matches;
    const size = this.mobile ? 512 : 1024;
    const started = performance.now();
    this.job = (async () => {
      try {
        const atlas = await loadSharedTexture(
          `/art/vfx/${this.assetId}/${this.assetId}-v1-${size}.webp`,
        );
        if (this.disposed) return;
        const cell = size / 4;
        this.frames = Array.from(
          { length: 16 },
          (_, i) =>
            new Texture({
              source: atlas.source,
              frame: new Rectangle((i % 4) * cell, Math.floor(i / 4) * cell, cell, cell),
            }),
        );
        this.loadMs = Math.max(0, performance.now() - started);
      } catch {
        console.warn(`${this.assetId} illustrated atlas unavailable; retaining original effect.`);
      } finally {
        this.job = null;
      }
    })();
    return this.job;
  }
  protected sprite(
    frames: readonly number[],
    at: Point,
    width: number,
    duration: number,
    update: Clip['update'],
    ground = false,
    additive = true,
    group?: string,
  ): void {
    if (this.disposed || !this.ready) return;
    const s =
      this.free.pop() ?? (this.created < this.limit ? (this.created++, new Sprite()) : null);
    if (!s) return;
    s.texture = this.frames[frames[0]!]!;
    s.anchor.set(0.5);
    s.position.set(at.x, at.y);
    s.rotation = 0;
    s.alpha = 1;
    s.tint = 0xffffff;
    s.blendMode = additive ? 'add' : 'normal';
    s.eventMode = 'none';
    s.width = width;
    s.height = width;
    s.zIndex = this.geometry.depth(at) + 2;
    (ground ? this.ground : this.actors).addChild(s);
    const clip: Clip = {
      sprite: s,
      group,
      age: 0,
      duration,
      update: (t, sprite) => {
        sprite.texture = this.frames[fireballFrame(frames, t)]!;
        update(t, sprite);
      },
    };
    this.clips.push(clip);
    this.peak = Math.max(this.peak, this.clips.length);
    clip.update(0, s);
  }
  protected lifted(p: Pos, fraction: number): Point {
    const c = this.geometry.center(p),
      scale = this.geometry.footprint(p).w / 96;
    return { x: c.x, y: c.y - 96 * 1.22 * fraction * scale };
  }
  tick(ms: number): void {
    for (let i = this.clips.length - 1; i >= 0; i--) {
      const c = this.clips[i]!;
      c.age += Math.max(0, ms);
      if (c.age >= c.duration) {
        c.sprite.removeFromParent();
        this.free.push(c.sprite);
        this.clips.splice(i, 1);
      } else c.update(c.age / c.duration, c.sprite);
    }
  }
  protected clearGroup(group: string): void {
    for (let i = this.clips.length - 1; i >= 0; i--) {
      const c = this.clips[i]!;
      if (c.group !== group) continue;
      c.sprite.removeFromParent(); this.free.push(c.sprite); this.clips.splice(i, 1);
    }
  }
  clear(): void {
    for (const c of this.clips) {
      c.sprite.removeFromParent();
      this.free.push(c.sprite);
    }
    this.clips.length = 0;
  }
  destroy(): void {
    this.clear();
    this.disposed = true;
    for (const s of this.free) s.destroy();
    this.free.length = 0;
    for (const t of this.frames) t.destroy(false);
    this.frames.length = 0;
  }
}
