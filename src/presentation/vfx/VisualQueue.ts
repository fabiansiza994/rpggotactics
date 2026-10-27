export interface VisualClip {
  duration: number;
  begin(): void;
  update(elapsed: number): void;
  finish(): void;
  cancel(): void;
}

/** A clock for presentation only. No timers, promises, engine calls or mutable domain references. */
export class VisualQueue {
  private pending: VisualClip[] = [];
  private active: VisualClip | null = null;
  private elapsed = 0;
  get busy(): boolean {
    return this.active !== null || this.pending.length > 0;
  }
  enqueue(clip: VisualClip): void {
    this.pending.push(clip);
    this.startNext();
  }
  private startNext(): void {
    if (this.active || !this.pending.length) return;
    this.active = this.pending.shift()!;
    this.elapsed = 0;
    this.active.begin();
    this.active.update(0);
  }
  tick(delta: number): void {
    let remaining = Math.max(0, delta);
    while (this.active) {
      const clip = this.active;
      const step = Math.min(remaining, clip.duration - this.elapsed);
      this.elapsed += step;
      remaining -= step;
      clip.update(this.elapsed);
      if (this.elapsed < clip.duration) break;
      this.active = null;
      clip.finish();
      this.startNext();
      if (remaining <= 0) break;
    }
  }
  clear(): void {
    this.active?.cancel();
    for (const clip of this.pending) clip.cancel();
    this.active = null;
    this.pending = [];
    this.elapsed = 0;
  }
}
