/** QA-only sampler. A new busy interval must not inherit the previous cast's timestamps. */
export class FrameCadence {
  private start: number | null = null;
  private last: number | null = null;
  private intervals: number[] = [];
  begin(now: number): void {
    this.start = now;
    this.last = null;
    this.intervals = [];
  }
  frame(now: number): void {
    if (this.start === null) return;
    if (this.last !== null && now > this.last) this.intervals.push(now - this.last);
    this.last = now;
  }
  reset(): void {
    this.start = this.last = null;
    this.intervals = [];
  }
  finish(now: number) {
    if (this.start === null) return null;
    const sorted = [...this.intervals].sort((a, b) => a - b),
      frames = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0),
      mean = frames ? sum / frames : 0;
    const result = {
      wallMs: Math.max(0, now - this.start),
      frames,
      mean,
      p50: sorted[Math.floor(frames * 0.5)] ?? 0,
      p95: sorted[Math.floor(frames * 0.95)] ?? 0,
      fps: sum ? (frames * 1000) / sum : 0,
    };
    this.reset();
    return result;
  }
}
