/** Wall-clock presentation time. Hidden/menu-paused time never enters a visual replay. */
export class PresentationClock {
  private last: number | null = null;
  private suspended = true;
  constructor(private readonly discontinuityMs = 5000) {}
  setSuspended(value: boolean, now: number): void {
    if (this.suspended !== value || this.last === null) this.last = now;
    this.suspended = value;
  }
  advance(now: number): number {
    const previous = this.last;
    this.last = now;
    if (this.suspended || previous === null) return 0;
    const delta = Math.max(0, now - previous);
    // A process/system suspension is a discontinuity, not a very slow ordinary frame.
    // 100–1000ms slow frames must catch up, otherwise a 3s ritual becomes a 9s lock.
    return delta > this.discontinuityMs ? 0 : delta;
  }
}
