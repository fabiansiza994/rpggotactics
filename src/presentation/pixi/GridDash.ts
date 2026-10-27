import { Container } from 'pixi.js';
import type { Pos } from '../../game';
import type { CharacterMotion } from './CharacterAnimator';
import type { UnitView } from './UnitView';

type Move = { from: Pos; to: Pos };
type DashView = Pick<UnitView, 'root' | 'body'> & {
  scaler?: Container;
  playAnimation?(motion: CharacterMotion): boolean;
  hasChargeAnimation?: boolean;
};
type Snapshot = {
  sx: number;
  sy: number;
  alpha: number;
  rotation: number;
  tint: Container['tint'];
  filters: Container['filters'];
};
type Playback = {
  view: DashView;
  queue: Move[];
  elapsed: number;
  original: Snapshot;
  ghost: Afterimage | null;
  ghostCreated: boolean;
};

/** One short-lived deep copy of the existing procedural frame; no textures or filters allocated. */
class Afterimage {
  readonly root = new Container();
  private readonly art: Container;
  constructor(view: DashView, layer: Container, x: number, y: number, original: Snapshot) {
    this.art = view.body.clone(true);
    this.root.addChild(this.art);
    this.root.position.set(x, y);
    // Same ground anchor and depth scale as the figure it was copied from; Y-sorted with actors.
    const depth = view.scaler?.scale.x ?? 1;
    this.root.scale.set(original.sx * depth, original.sy * depth);
    this.root.zIndex = y;
    this.root.rotation = original.rotation;
    this.root.tint = original.tint;
    if (original.filters?.length) this.root.filters = [...original.filters];
    this.root.alpha = original.alpha * 0.42;
    layer.addChild(this.root);
  }
  fade(progress: number, alpha: number): void {
    this.root.alpha = alpha * 0.42 * Math.max(0, 1 - progress);
  }
  destroy(): void {
    this.art.destroy({ children: true });
    this.root.destroy();
  }
}

/**
 * Visual-only 160 ms playback of UNIT_MOVED endpoints. No engine or pathfinding access.
 * `center` is GridProjection.getUnitAnchor: from/to are projected ground anchors.
 */
export class GridDash {
  private readonly playing = new Map<string, Playback>();
  constructor(
    private readonly layer: Container,
    private readonly center: (pos: Pos) => { x: number; y: number },
    private readonly onLand: (id:string,to:Pos) => void = () => {},
  ) {}

  has(id: string): boolean {
    return this.playing.has(id);
  }

  enqueue(id: string, view: DashView, move: Move, reducedEffects: boolean): void {
    if (reducedEffects) {
      this.cancel(id);
      const to = this.center(move.to);
      view.root.position.set(to.x, to.y);
      view.playAnimation?.('charge_stop');
      return;
    }
    const active = this.playing.get(id);
    if (active) {
      active.queue.push(move);
      return;
    }
    const root = view.root;
    this.playing.set(id, {
      view,
      queue: [move],
      elapsed: 0,
      ghost: null,
      ghostCreated: false,
      original: {
        sx: root.scale.x,
        sy: root.scale.y,
        alpha: root.alpha,
        rotation: root.rotation,
        tint: root.tint,
        filters: root.filters,
      },
    });
    const from = this.center(move.from);
    root.position.set(from.x, from.y);
  }

  tick(deltaMs: number): void {
    for (const [id, p] of this.playing) {
      p.elapsed += deltaMs;
      // Catch up after an inactive tab without replaying a stale backlog.
      while (p.elapsed >= (p.view.hasChargeAnimation ? 320 : 160) && p.queue.length) {
        const move = p.queue.shift()!;
        this.restore(p);
        const to = this.center(move.to);
        p.view.root.position.set(to.x, to.y);
        this.onLand(id,move.to);
        p.ghost?.destroy();
        p.ghost = null;
        p.ghostCreated = false;
        p.elapsed -= p.view.hasChargeAnimation ? 320 : 160;
      }
      const move = p.queue[0];
      if (!move) {
        this.playing.delete(id);
        p.view.playAnimation?.('charge_stop');
        continue;
      }
      const t = p.elapsed,
        root = p.view.root,
        o = p.original;
      const from = this.center(move.from),
        to = this.center(move.to);
      if (p.view.hasChargeAnimation) {
        const progress = Math.min(1, t / 320),
          eased = progress * progress * (3 - 2 * progress);
        root.position.set(from.x + (to.x - from.x) * eased, from.y + (to.y - from.y) * eased);
      } else root.position.set(t < 80 ? from.x : to.x, t < 80 ? from.y : to.y);
      if (t >= 40 && !p.ghostCreated) {
        p.ghost = new Afterimage(p.view, this.layer, from.x, from.y, o);
        p.ghostCreated = true;
      }
      p.ghost?.fade((t - 40) / 110, o.alpha);
      root.alpha = p.view.hasChargeAnimation ? o.alpha : t >= 60 && t < 80 ? 0 : o.alpha;
      let sx = 1,
        sy = 1;
      if (t < 30) {
        sx = 1 + (t / 30) * 0.06;
        sy = 1 - (t / 30) * 0.06;
      } else if (t < 60) {
        sx = 1.06 + ((t - 30) / 30) * 0.18;
        sy = 0.94 - ((t - 30) / 30) * 0.22;
      } else if (t >= 80) {
        const settle = Math.min(1, (t - 80) / 80);
        sx = 0.78 + settle * 0.22;
        sy = 1.23 - settle * 0.23;
      }
      root.scale.set(
        o.sx * (p.view.hasChargeAnimation ? 1 : sx),
        o.sy * (p.view.hasChargeAnimation ? 1 : sy),
      );
    }
  }

  private restore(p: Playback): void {
    const root = p.view.root,
      o = p.original;
    root.scale.set(o.sx, o.sy);
    root.alpha = o.alpha;
    root.rotation = o.rotation;
    root.tint = o.tint;
    if (root.filters !== o.filters) root.filters = o.filters ? [...o.filters] : undefined;
  }

  cancel(id: string): void {
    const p = this.playing.get(id);
    if (!p) return;
    this.restore(p);
    if (p.view.hasChargeAnimation) p.view.playAnimation?.('idle');
    p.ghost?.destroy();
    this.playing.delete(id);
  }

  clear(): void {
    for (const id of this.playing.keys()) this.cancel(id);
  }
}
