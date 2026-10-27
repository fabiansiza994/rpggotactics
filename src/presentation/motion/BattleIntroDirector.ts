import type { IntroBeat, IntroStep } from './introTimeline';
import { motionCues } from './motionCues';

/**
 * Plays the battle intro on the scene's shared clock (the Pixi ticker: pauses with the tab and
 * follows the QA time scale). Pixi layers read `progress(beat)` every frame; the DOM reacts to
 * the beats it is told about. Purely presentational: it never touches game state.
 */
export class BattleIntroDirector {
  private steps: readonly IntroStep[] = [];
  private next = 0;
  private elapsed = 0;

  constructor(private readonly onBeat: (step: IntroStep) => void) {}

  /** True from start() until every beat (including `unlock`) has fired. */
  get active(): boolean {
    return this.next < this.steps.length;
  }

  start(steps: readonly IntroStep[]): void {
    this.steps = [...steps].sort((a, b) => a.at - b.at);
    this.next = 0;
    this.elapsed = 0;
    this.fireDue();
  }

  tick(ms: number): void {
    if (!this.active) return;
    this.elapsed += Math.max(0, ms);
    this.fireDue();
  }

  /** Fire every remaining beat now (teardown, or a new battle replacing this one). */
  finish(): void {
    this.elapsed = Number.POSITIVE_INFINITY;
    this.fireDue();
  }

  /**
   * 0 → 1 linear progress of a beat's own motion. A beat absent from the current timeline
   * (e.g. the battlefield on a QUICK restart) is considered already complete.
   */
  progress(beat: IntroBeat): number {
    const step = this.steps.find((s) => s.beat === beat);
    if (!step) return 1;
    if (this.elapsed < step.at) return 0;
    if (step.duration <= 0) return 1;
    return Math.min(1, (this.elapsed - step.at) / step.duration);
  }

  private fireDue(): void {
    while (this.next < this.steps.length && this.steps[this.next]!.at <= this.elapsed) {
      const step = this.steps[this.next++]!;
      if (step.cue) motionCues.emit(step.cue);
      this.onBeat(step);
    }
  }
}
