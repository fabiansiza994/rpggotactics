export type CharacterMotion =
  | 'arrival'
  | 'idle'
  | 'walk'
  | 'run'
  | 'walk_heavy'
  | 'cast'
  | 'attack'
  | 'hit'
  | 'death'
  | 'bash'
  | 'charge'
  | 'charge_stop'
  | 'guard'
  | 'ability'
  | 'block';
export type Facing = 'LEFT' | 'RIGHT';

export interface AnimationFrames {
  readonly count: number;
  readonly loop: boolean;
  readonly frameMs: number;
  readonly terminal?: boolean;
  readonly loopStart?: number;
  readonly animatedIdle?: boolean;
  readonly queueAfterHit?: boolean;
  readonly contactFrame?: number;
}

const PRIORITY: Record<CharacterMotion, number> = {
  idle: 0,
  guard: 0,
  block: 3,
  bash: 2,
  charge: 1,
  charge_stop: 2,
  ability: 2,
  arrival: 2,
  walk: 1,
  run: 1,
  walk_heavy: 1,
  cast: 2,
  attack: 2,
  hit: 3,
  death: 4,
};

/** Presentation-only animation state: stable, prioritized, and independent of game state. */
export class CharacterAnimator {
  private motion: CharacterMotion = 'idle';
  private restMotion: 'idle' | 'guard' = 'idle';
  private pending: { motion: CharacterMotion; cueMs: number } | null = null;
  private frame = 0;
  private elapsed = 0;
  private holdMs = 0;
  private sequence: number[] = [];
  private durations: number[] = [];
  private facing: Facing = 'RIGHT';
  private readonly available: Partial<Record<CharacterMotion, AnimationFrames>>;

  constructor(
    config: Partial<Record<CharacterMotion, AnimationFrames>>,
    private readonly onFrame: (motion: CharacterMotion, frame: number) => void,
    private readonly onFacing: (facing: Facing) => void,
  ) {
    this.available = config;
    this.sequence = Array.from({ length: config.idle?.count ?? 1 }, (_, i) => i);
    this.durations = this.sequence.map(() => config.idle?.frameMs ?? 150);
    this.onFrame('idle', 0);
  }

  /** Presentation-only clip switch when an executed path enters another authored view. */
  configureGait(motion: 'walk' | 'run', config: AnimationFrames): void {
    const previous = this.available[motion];
    this.available[motion] = config;
    if (
      this.motion !== motion ||
      (previous?.count === config.count && previous.frameMs === config.frameMs)
    )
      return;
    this.frame = 0;
    this.elapsed = 0;
    this.sequence = Array.from({ length: config.count }, (_, i) => i);
    this.durations = this.sequence.map(() => config.frameMs);
    this.onFrame(motion, 0);
  }

  get state(): CharacterMotion {
    return this.motion;
  }
  get frameIndex(): number {
    return this.frame;
  }
  get direction(): Facing {
    return this.facing;
  }
  get dead(): boolean {
    return this.motion === 'death';
  }

  face(direction: Facing): void {
    if (this.facing === direction) return;
    this.facing = direction;
    this.onFacing(direction);
  }

  faceHorizontal(delta: number): void {
    if (delta < 0) this.face('LEFT');
    else if (delta > 0) this.face('RIGHT');
  }

  setRestMotion(motion: 'idle' | 'guard'): void {
    this.restMotion = this.available[motion] ? motion : 'idle';
    if (this.motion === 'idle' || this.motion === 'guard') this.play(this.restMotion);
  }

  play(motion: CharacterMotion, cueMs = 90): boolean {
    const returningRest = motion === 'idle';
    if (returningRest && PRIORITY[this.motion] > PRIORITY.walk) return false;
    if (returningRest) motion = this.restMotion;
    if (!this.available[motion] || this.dead) return false;
    if (motion === 'idle' && PRIORITY[this.motion] > PRIORITY.walk) return false;
    if (!returningRest && motion !== 'idle' && PRIORITY[motion] < PRIORITY[this.motion]) {
      if (
        this.available[motion]?.queueAfterHit &&
        (this.motion === 'hit' || this.motion === 'block')
      ) {
        this.pending = { motion, cueMs };
        return true;
      }
      return false;
    }
    if (motion === 'death') this.pending = null;
    if (
      motion === this.motion &&
      (motion === 'idle' ||
        motion === 'walk' ||
        motion === 'run' ||
        motion === 'guard' ||
        motion === 'charge')
    )
      return true;
    this.motion = motion;
    this.frame = 0;
    this.elapsed = 0;
    const config = this.available[motion]!;
    this.sequence = Array.from({ length: config.count }, (_, i) => i);
    this.durations = this.sequence.map(() => config.frameMs);
    if (motion === 'cast' || motion === 'attack' || motion === 'bash' || motion === 'ability') {
      // Use the authored release/contact pose (frame 3 in the six-pose pilot, otherwise last pose).
      const releaseFrame = Math.min(config.contactFrame ?? 3, Math.max(0, config.count - 1));
      const preCue = Math.max(12, cueMs) / Math.max(1, releaseFrame);
      this.durations =
        config.count === 1
          ? [config.frameMs]
          : this.durations.map((_, i) => (i < releaseFrame ? preCue : 65));
    } else if (motion === 'hit') {
      this.durations = config.count === 1 ? [config.frameMs] : this.durations.map(() => 40);
    }
    this.onFrame(this.motion, this.sequence[0] ?? 0);
    return true;
  }

  /** A one/two-frame visual impact hold; commands, movement and the battle clock are untouched. */
  hold(ms: number): void {
    this.holdMs = Math.max(this.holdMs, Math.min(32, Math.max(0, ms)));
  }
  contactPose(): void {
    if (this.motion !== 'attack' && this.motion !== 'bash') return;
    const contact = Math.min(this.available[this.motion]?.contactFrame ?? 3, this.sequence.length - 1);
    if (this.frame >= contact) return;
    this.frame = contact;
    this.elapsed = 0;
    this.onFrame(this.motion, this.sequence[contact] ?? 0);
  }

  tick(deltaMs: number, reduced: boolean): void {
    if (reduced) this.holdMs = 0;
    const held = Math.min(this.holdMs, Math.max(0, deltaMs));
    this.holdMs -= held;
    const advance = Math.max(0, deltaMs) - held;
    if (held && advance === 0) return;
    if (this.motion === 'idle' && !this.available.idle?.animatedIdle) return;
    const config = this.available[this.motion];
    if (!config) return;
    if (reduced && ['idle', 'guard', 'walk', 'charge'].includes(this.motion)) {
      const rest = this.motion === 'guard' ? (config.loopStart ?? 0) : 0;
      if (this.frame !== rest) {
        this.frame = rest;
        this.onFrame(this.motion, rest);
      }
      return;
    }
    this.elapsed += advance;
    let guard = 0;
    while (
      guard++ < this.sequence.length + 1 &&
      this.elapsed >= (this.durations[this.frame] ?? 0)
    ) {
      this.elapsed -= this.durations[this.frame] ?? 0;
      if (this.frame + 1 < this.sequence.length) {
        this.frame++;
        this.onFrame(this.motion, this.sequence[this.frame]!);
      } else if (config.loop) {
        this.frame = config.loopStart ?? 0;
        this.onFrame(this.motion, this.sequence[this.frame] ?? 0);
      } else if (config.terminal) {
        this.elapsed = 0;
        break;
      } else {
        this.setIdle();
        break;
      }
    }
  }

  reset(): void {
    this.holdMs = 0;
    this.pending = null;
    this.motion = 'idle';
    this.frame = 0;
    this.elapsed = 0;
    this.sequence = Array.from({ length: this.available.idle?.count ?? 1 }, (_, i) => i);
    this.durations = this.sequence.map(() => this.available.idle?.frameMs ?? 150);
    this.onFrame('idle', 0);
  }

  private setIdle(): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      this.motion = 'idle';
      this.play(pending.motion, pending.cueMs);
      return;
    }
    this.motion = this.restMotion;
    this.frame = 0;
    this.elapsed = 0;
    const idle = this.available[this.restMotion];
    this.sequence = Array.from({ length: idle?.count ?? 1 }, (_, i) => i);
    this.durations = this.sequence.map(() => idle?.frameMs ?? 150);
    this.onFrame(this.restMotion, 0);
  }
}

export function facingForHorizontalDelta(delta: number): Facing | null {
  return delta < 0 ? 'LEFT' : delta > 0 ? 'RIGHT' : null;
}
