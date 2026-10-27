import type { Container } from 'pixi.js';
import type { GameState } from '../../game';
import type { GridProjection } from '../pixi/GridProjection';
import type { FxGeometry } from './ElementEffects';
import { PaintedEffectPool } from './PaintedEffectPool';

type Kind = 'torch' | 'FIRE' | 'ICE';
type Patch = { key: string; kind: Kind; x: number; y: number; w: number; h: number; depth: number };
type Live = Patch & { born: number; ended?: number; painted: boolean };
export const environmentFade = (age: number, remaining?: number) =>
  Math.max(0, Math.min(1, age / 350, remaining === undefined ? 1 : remaining / 450));
/** Permanent ambience and authoritative terrain share the existing bounded atlas pool.
 * No commands, timers, RNG, filters or new ticker. Ground effects never capture input.
 */
export class EnvironmentEffects extends PaintedEffectPool {
  private clock = 0;
  private live = new Map<string, Live>();
  wake = 1;
  constructor(actors: Container, ground: Container, geometry: FxGeometry) {
    super(actors, ground, geometry, 'environment', 160);
  }
  get requested() {
    return true;
  }
  syncTorches(points: Array<{ x: number; y: number; scale: number; depth: number }>) {
    this.sync(
      'torch',
      points.map((p, i) => ({
        key: `torch:${i}`,
        kind: 'torch',
        x: p.x,
        y: p.y,
        w: 44 * p.scale,
        h: 52 * p.scale,
        depth: p.depth,
      })),
    );
  }
  syncTerrain(state: Readonly<GameState>, proj: GridProjection) {
    const patches: Patch[] = [];
    state.board.tiles.forEach((tile, i) => {
      if (tile.terrain !== 'FIRE' && tile.terrain !== 'ICE') return;
      const pos = { x: i % state.board.width, y: Math.floor(i / state.board.width) },
        p = proj.getTileCenter(pos),
        f = proj.footprint(pos);
      patches.push({
        key: `tile:${i}:${tile.terrain}`,
        kind: tile.terrain,
        x: p.x,
        y: p.y,
        w: f.w * 0.66,
        h: f.h * 0.66,
        depth: proj.depthAtPoint(p),
      });
    });
    this.sync('tile', patches);
  }
  private sync(prefix: string, patches: Patch[]) {
    const keys = new Set(patches.map((p) => p.key));
    for (const [key, p] of this.live)
      if (key.startsWith(prefix) && !keys.has(key) && p.ended === undefined) p.ended = this.clock;
    for (const patch of patches) {
      const old = this.live.get(patch.key);
      if (old) {
        Object.assign(old, patch);
        old.ended = undefined;
      } else this.live.set(patch.key, { ...patch, born: this.clock, painted: false });
    }
    this.beginBatch();
    void this.prepare();
  }
  private paint(p: Live) {
    const phase = (p.x * 0.013 + p.y * 0.007) % 6;
    const fade = () =>
      environmentFade(
        this.clock - p.born,
        p.ended === undefined ? undefined : 450 - (this.clock - p.ended),
      ) * (p.kind === 'torch' ? this.wake : 1);
    if (p.kind === 'ICE') {
      this.sprite(
        [4],
        p,
        p.w,
        Infinity,
        (_, s) => {
          s.texture = this.frames[4 + (Math.abs(Math.floor(phase)) % 4)]!;
          s.position.set(p.x, p.y);
          s.width = p.w * (0.8 + 0.2 * fade());
          s.height = p.h * (0.8 + 0.2 * fade());
          s.alpha = 0.55 * fade();
        },
        true,
        false,
        p.key,
      );
      this.sprite(
        [14],
        p,
        p.w * 0.5,
        Infinity,
        (_, s) => {
          s.position.set(p.x, p.y - p.h * 0.08);
          s.width = p.w * 0.52;
          s.height = p.h * 0.6;
          s.alpha =
            fade() * (this.reduced ? 0.25 : 0.27 + 0.06 * Math.sin(this.clock / 1200 + phase));
        },
        true,
        false,
        p.key,
      );
    } else {
      const torch = p.kind === 'torch';
      this.sprite(
        [12],
        p,
        p.w * 1.5,
        Infinity,
        (_, s) => {
          s.position.set(p.x, p.y + (torch ? (30 * p.w) / 44 : 0));
          s.width = p.w * (torch ? 2.8 : 1);
          s.height = torch ? p.w * 1.1 : p.h;
          s.alpha =
            fade() * (this.reduced ? 0.22 : 0.22 + 0.025 * Math.sin(this.clock / 670 + phase));
        },
        true,
        true,
        p.key,
      );
      const count = torch || this.mobile ? 1 : 2;
      for (let i = 0; i < count; i++)
        this.sprite(
          [0],
          p,
          p.w,
          Infinity,
          (_, s) => {
            const t = this.clock / 1000 + phase + i * 1.7;
            const idx = this.reduced ? 0 : Math.floor(t * 6) % 4;
            s.texture = this.frames[(idx + 4) % 4]!;
            s.anchor.set(0.5, 0.96);
            s.position.set(
              p.x + (i - (count - 1) / 2) * p.w * 0.22,
              p.y + (torch ? 0 : p.h * 0.12),
            );
            s.width = p.w * (torch ? 0.85 : 0.48);
            s.height =
              (torch ? p.h : p.w * 0.54) * (this.reduced ? 1 : 1 + 0.045 * Math.sin(t * 5.1));
            s.rotation = this.reduced ? 0 : Math.sin(t * 3.7) * 0.025;
            s.alpha = fade() * 0.88;
            s.zIndex = p.depth + 0.1;
          },
          false,
          false,
          p.key,
        );
      if (!this.mobile)
        this.sprite(
          [8],
          p,
          p.w,
          Infinity,
          (_, s) => {
            const t = (this.clock / 2400 + phase) % 1;
            s.texture = this.frames[8 + Math.floor(t * 4)]!;
            s.position.set(p.x + Math.sin(t * 5) * p.w * 0.08, p.y - p.w * (0.5 + t * 0.5));
            s.width = p.w * 0.65;
            s.height = p.w * 0.8;
            s.alpha = this.reduced ? 0 : fade() * 0.1 * Math.sin(t * Math.PI);
            s.zIndex = p.depth + 0.2;
          },
          false,
          false,
          p.key,
        );
    }
    this.sprite(
      [p.kind === 'ICE' ? 14 : 13],
      p,
      p.w * 0.38,
      Infinity,
      (_, s) => {
        const t = (((this.clock / 1900 + phase) % 1) + 1) % 1;
        s.position.set(p.x + Math.sin(t * 5 + phase) * p.w * 0.12, p.y - t * p.w * 0.55);
        s.width = p.w * 0.32;
        s.height = p.w * 0.42;
        s.alpha = this.reduced ? 0 : fade() * 0.3 * Math.sin(t * Math.PI);
        s.zIndex = p.depth + 0.3;
      },
      false,
      true,
      p.key,
    );
    p.painted = true;
  }
  override tick(ms: number) {
    this.clock += Math.max(0, ms);
    for (const [key, p] of this.live) {
      if (p.ended !== undefined && this.clock - p.ended >= 450) {
        this.clearGroup(key);
        this.live.delete(key);
      } else if (this.ready && !p.painted) this.paint(p);
    }
    super.tick(ms);
  }
  override clear() {
    super.clear();
    this.live.clear();
  }
}
