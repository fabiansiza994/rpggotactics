import { Container, Sprite, type Texture } from 'pixi.js';

/** State-driven root chrome. No RNG, combat writes, filters or additional ticker. */
export class RootSnareView extends Container {
  private active = false;
  private progress = 0;
  readonly artwork: Sprite;
  constructor(texture: Texture) {
    super();
    this.label = 'root-snare';
    this.eventMode = 'none';
    this.artwork = new Sprite(texture);
    this.artwork.anchor.set(.5, .72);
    this.artwork.width = 86;
    this.artwork.height = 40;
    this.addChild(this.artwork);
    this.visible = false;
  }
  setActive(active: boolean): void { this.active = active; }
  advance(ms: number, reduced: boolean): void {
    const target = this.active ? 1 : 0;
    this.progress = reduced ? target : Math.max(0, Math.min(1,
      this.progress + (this.active ? 1 : -1) * ms / (this.active ? 200 : 140)));
    this.visible = this.progress > 0;
    this.alpha = this.progress;
    this.scale.set(reduced ? 1 : .75 + .25 * this.progress,
      reduced ? 1 : .35 + .65 * this.progress);
  }
}
