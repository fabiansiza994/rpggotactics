/** Cosmetic vitals; targets only come from projected authoritative events. No timers. */
export class HealthBarAnimation {
  target = 1;
  front = 1;
  trail = 1;
  private start = 1;
  private trailStart = 1;
  private age = 0;
  private initialized = false;
  set(hp: number, max: number, animate: boolean): void {
    const value = Math.max(0, Math.min(1, hp / Math.max(1, max)));
    if (this.initialized && value === this.target) return;
    const previous = this.target;
    const healing = value > previous;
    this.target = value;
    if (!animate || !this.initialized) { this.initialized = true; this.snap(); return; }
    // Complete any pending earlier loss before presenting recovery, never animate a heal downward.
    this.start = healing ? Math.min(this.front, previous) : this.front;
    this.front = this.start;
    this.trailStart = healing ? value : Math.max(this.trail, this.front);
    this.trail = this.trailStart;
    this.age = 0;
  }
  snap(): void { this.front = this.trail = this.start = this.trailStart = this.target; this.age = 1000; }
  tick(ms: number, reduced: boolean): void {
    this.age += Math.max(0, ms);
    const t = Math.min(1, this.age / (reduced ? 60 : 180));
    this.front = this.start + (this.target - this.start) * (1 - (1 - t) ** 3);
    const lag = Math.min(1, Math.max(0, (this.age - (reduced ? 0 : 140)) / (reduced ? 100 : 420)));
    this.trail = this.trailStart + (this.target - this.trailStart) * lag;
    this.trail = Math.max(this.front, this.trail);
  }
}
