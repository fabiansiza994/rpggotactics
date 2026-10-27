import { Container, Graphics } from 'pixi.js';
import type { CollectibleKind } from '../../game';
import { TILE } from './renderContract';

/** Readable at a glance and unlike units, hazards or props: a ground sigil + a floating item. */
const STYLE: Record<CollectibleKind, { glow: number; core: number; rim: number }> = {
  ORB: { glow: 0xb68cff, core: 0xe9dcff, rim: 0x7c4dff },
  PAGE: { glow: 0xf4d27a, core: 0xf6ead0, rim: 0xb48a3c },
  // World 2 forge core: placeholder colours until Codex's final pickup art.
  CORE: { glow: 0xff8a3d, core: 0xffd9a8, rim: 0xb8461c },
};

const HOVER = TILE * 0.36;
const COLLECT_MS = 520;

/**
 * Board pickup (orb / grimoire page). Sits on its tile's unit anchor, bobs gently, and on
 * collection rises and fades. Purely visual: the engine already marked it collected.
 */
export class CollectibleView {
  readonly root = new Container();
  private readonly sigil = new Graphics();
  private readonly item = new Container();
  private time = Math.random() * 1000;
  private collectT = -1;

  constructor(readonly kind: CollectibleKind) {
    const s = STYLE[kind];
    // Ground sigil: dashed ring + 4 ticks (distinct from AoE fills and faction rings).
    const rx = TILE * 0.3,
      ry = TILE * 0.12;
    this.sigil.ellipse(0, 0, rx, ry).fill({ color: s.glow, alpha: 0.16 });
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2,
        a1 = a0 + Math.PI / 12;
      this.sigil
        .moveTo(Math.cos(a0) * rx, Math.sin(a0) * ry)
        .lineTo(Math.cos(a1) * rx, Math.sin(a1) * ry)
        .stroke({ color: s.glow, width: 2, alpha: 0.75 });
    }
    const body = new Graphics();
    body.circle(0, 0, TILE * 0.2).fill({ color: s.glow, alpha: 0.18 });
    if (kind === 'ORB') {
      body.circle(0, 0, TILE * 0.13).fill({ color: s.rim });
      body.circle(0, 0, TILE * 0.13).stroke({ color: s.core, width: 2, alpha: 0.9 });
      body.circle(-TILE * 0.03, -TILE * 0.04, TILE * 0.07).fill({ color: s.core, alpha: 0.85 });
      body.circle(-TILE * 0.05, -TILE * 0.06, TILE * 0.025).fill({ color: 0xffffff });
    } else {
      const w = TILE * 0.2,
        h = TILE * 0.26;
      body.roundRect(-w / 2, -h / 2, w, h, 3).fill({ color: s.core }).stroke({ color: s.rim, width: 2 });
      for (let i = 0; i < 4; i++)
        body
          .moveTo(-w * 0.3, -h * 0.28 + i * h * 0.17)
          .lineTo(w * (i % 2 ? 0.15 : 0.3), -h * 0.28 + i * h * 0.17)
          .stroke({ color: s.rim, width: 1.5, alpha: 0.8 });
      body.circle(0, h * 0.32, TILE * 0.03).fill({ color: 0x9a5cff });
    }
    this.item.addChild(body);
    this.item.y = -HOVER;
    this.root.addChild(this.sigil, this.item);
    this.root.eventMode = 'none';
  }

  /** Start (or undo, on a restart) the pickup animation. */
  setCollected(collected: boolean): void {
    if (collected && this.collectT < 0) this.collectT = 0;
    if (!collected && this.collectT >= 0) {
      this.collectT = -1;
      this.root.alpha = 1;
      this.item.scale.set(1);
    }
  }

  tick(elapsed: number, reduced: boolean): void {
    this.time += elapsed;
    if (this.collectT >= 0) {
      this.collectT += elapsed;
      const t = Math.min(1, this.collectT / (reduced ? 1 : COLLECT_MS));
      this.item.y = -HOVER - t * TILE * 0.5;
      this.item.scale.set(1 + t * 0.4);
      this.root.alpha = 1 - t;
      return;
    }
    const bob = reduced ? 0 : Math.sin(this.time / 420) * TILE * 0.04;
    this.item.y = -HOVER + bob;
    this.item.rotation = this.kind === 'PAGE' && !reduced ? Math.sin(this.time / 700) * 0.12 : 0;
    this.sigil.alpha = reduced ? 0.9 : 0.75 + Math.sin(this.time / 300) * 0.2;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
