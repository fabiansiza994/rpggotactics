/** Encounter-local onboarding; never persisted in gameplay or replay. */
export class TemporaryHint {
  private remaining = 6500;
  get visible() {
    return this.remaining > 0;
  }
  get opacity() {
    return Math.min(1, this.remaining / 700);
  }
  tick(ms: number) {
    this.remaining = Math.max(0, this.remaining - ms);
  }
  dismiss() {
    this.remaining = 0;
  }
}
