import type { Container } from 'pixi.js';

/** Offset-only camera parent: layout and hit testing continue to use the existing world. */
export class CameraController {
  private elapsed = 0;
  private amplitude = 0;
  constructor(private readonly root: Container) {}
  impulse(kind: 'LIGHT' | 'MEDIUM', reduced: boolean): void {
    if (reduced) return;
    this.elapsed = 0;
    this.amplitude = Math.max(this.amplitude, kind === 'LIGHT' ? 1.5 : 3);
  }
  tick(ms: number): void {
    if (!this.amplitude) return;
    this.elapsed += ms;
    const t = Math.min(1, this.elapsed / 140),
      amount = this.amplitude * (1 - t);
    if (t === 1) {
      this.clear();
      return;
    }
    this.root.position.set(Math.sin(t * 24) * amount, Math.cos(t * 19) * amount * 0.6);
  }
  clear(): void {
    this.root.position.set(0, 0);
    this.amplitude = 0;
    this.elapsed = 0;
  }
}
