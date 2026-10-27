/**
 * Motion tokens: the single source of every duration, easing and stagger in the presentation.
 *
 * Hierarchy (project rule):
 *  TIER 1 micro      hover, press, pip, tile           80–180 ms
 *  TIER 2 gameplay   card select, move, damage, draw  180–400 ms
 *  TIER 3 emphasis   spawn, heavy attack, banners     300–700 ms
 *  TIER 4 cinematic  battle entrance, victory, boss   600–1200 ms
 *
 * Repeated gameplay actions stay in tiers 1–2. Only one-off moments may use tier 4.
 * CSS reads the same values through custom properties installed by `applyMotionTokens`.
 */
export const DURATION = {
  instant: 100,
  fast: 160,
  normal: 240,
  emphasis: 380,
  cinematic: 600,
} as const;

export const STAGGER = {
  /** Tile ripple. */
  tile: 15,
  /** HUD panels, objectives. */
  hud: 60,
  /** Cards dealt into the hand. */
  card: 55,
  /** No staggered group may add more than this, however many members it has. */
  cap: 300,
} as const;

/** CSS easings. */
export const EASE = {
  /** UI entering: decelerates into place. */
  enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** UI leaving: accelerates away. */
  exit: 'cubic-bezier(0.55, 0, 1, 0.45)',
  /** Physical displacement. */
  move: 'cubic-bezier(0.65, 0, 0.35, 1)',
  /** Heavy masses (the battlefield): long, soft settle, no overshoot. */
  heavy: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** Impacts: fast out, settle. */
  impact: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
} as const;

/** The same curves for Pixi / JS-driven motion. */
export const easing = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  outQuart: (t: number) => 1 - (1 - t) ** 4,
  inCubic: (t: number) => t ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
} as const;

/** Battle intro choreography (tier 4, plays once per encounter). Offsets in ms. */
export const INTRO = {
  /** Menu: chosen mode confirms, the rest recedes, screen darkens. */
  commit: 220,
  /** Dark veil lifting off the new scene. */
  veil: 320,
  /** Scene backdrop fade + 1.03 → 1 scale. */
  scene: 560,
  /** Battlefield rising from below. */
  battlefield: 580,
  battlefieldRise: 140,
  battlefieldScale: 0.97,
} as const;

/** Turn hand-over (tier 3): "Tu turno" / "Turno del enemigo". */
export const TURN = {
  /** Banner in, hold, out. */
  banner: 800,
  /** Playback waits this long after a turn starts so the banner reads before anything acts. */
  hold: 450,
  holdReduced: 200,
} as const;

/** Index → delay for a staggered group, never exceeding the global cap. */
export function staggerDelay(index: number, count: number, step: number, cap: number = STAGGER.cap): number {
  if (count <= 1) return 0;
  return index * Math.min(step, cap / (count - 1));
}

const ms = (value: number) => `${value}ms`;

/** Install the tokens as CSS custom properties (once, at boot). */
export function applyMotionTokens(root: HTMLElement): void {
  const vars: Record<string, string> = {
    '--motion-instant': ms(DURATION.instant),
    '--motion-fast': ms(DURATION.fast),
    '--motion-normal': ms(DURATION.normal),
    '--motion-emphasis': ms(DURATION.emphasis),
    '--motion-cinematic': ms(DURATION.cinematic),
    '--stagger-hud': ms(STAGGER.hud),
    '--stagger-card': ms(STAGGER.card),
    '--stagger-cap': ms(STAGGER.cap),
    '--ease-enter': EASE.enter,
    '--ease-exit': EASE.exit,
    '--ease-move': EASE.move,
    '--ease-heavy': EASE.heavy,
    '--ease-impact': EASE.impact,
    '--intro-commit': ms(INTRO.commit),
    '--intro-veil': ms(INTRO.veil),
    '--intro-scene': ms(INTRO.scene),
    '--turn-banner': ms(TURN.banner),
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}
