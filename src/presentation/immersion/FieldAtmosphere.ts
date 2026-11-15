import { ColorMatrixFilter, Container } from "pixi.js";
/** One existing Pixi matrix shader, restricted to scenery below all tactical layers. */
export class FieldAtmosphere {
  private filter = new ColorMatrixFilter();
  private readonly filters = [this.filter];
  private attached = false;
  private target = 0;
  private current = 0;
  private warmth = 0;
  private targetWarmth = 0;
  private initialized = false;
  constructor(private scenery: Container) {}
  set(
    hp: number,
    max: number,
    enabled: boolean,
    subtle: boolean,
    finished: boolean,
    terrain: "none" | "ice" | "fire" = "none",
  ) {
    this.targetWarmth =
      enabled && !finished
        ? (terrain === "fire" ? 1 : terrain === "ice" ? -1 : 0) *
          (subtle ? 0.45 : 1)
        : 0;
    const ratio = max > 0 ? hp / max : 1;
    this.target =
      enabled && !finished && hp > 0
        ? Math.max(0, Math.min(0.48, (0.25 - ratio) * 2)) * (subtle ? 0.45 : 1)
        : 0;
    if (!this.initialized) {
      this.initialized = true;
      this.current = this.target;
      this.warmth = this.targetWarmth;
      this.apply();
    }
    if (finished) {
      this.current = 0;
      this.warmth = 0;
      this.apply();
    }
  }
  tick(ms: number) {
    if (
      Math.abs(this.current - this.target) < 0.001 &&
      Math.abs(this.warmth - this.targetWarmth) < 0.001
    )
      return;
    this.warmth +=
      (this.targetWarmth - this.warmth) *
      (1 - Math.exp(-Math.min(ms, 100) / 180));
    if (Math.abs(this.warmth - this.targetWarmth) < 0.001)
      this.warmth = this.targetWarmth;
    this.current +=
      (this.target - this.current) * (1 - Math.exp(-Math.min(ms, 100) / 180));
    if (Math.abs(this.current - this.target) < 0.001)
      this.current = this.target;
    this.apply();
  }
  private apply() {
    if (this.current <= 0.001 && Math.abs(this.warmth) < 0.001) {
      if (this.attached) {
        this.scenery.filters = null;
        this.attached = false;
      }
      return;
    }
    this.filter.saturate(-this.current, false);
    const m = this.filter.matrix;
    const rgb =
      this.warmth >= 0
        ? [
            1 + this.warmth * 0.04,
            1 + this.warmth * 0.01,
            1 - this.warmth * 0.05,
          ]
        : [
            1 + this.warmth * 0.06,
            1 + this.warmth * 0.02,
            1 - this.warmth * 0.035,
          ];
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 5; col++) m[row * 5 + col]! *= rgb[row]!;
    this.filter.matrix = m;
    if (!this.attached) {
      this.scenery.filters = this.filters;
      this.attached = true;
    }
  }
  destroy() {
    this.scenery.filters = null;
    this.filter.destroy();
  }
}
