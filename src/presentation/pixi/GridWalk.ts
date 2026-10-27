import { locomotionRoute } from './locomotion';
import type { Pos } from '../../game';
import type { CharacterMotion } from './CharacterAnimator.ts';

interface WalkView {
  root: { position: { x: number; y: number; set(x: number, y: number): void } };
  faceHorizontal(delta: number): void;
  faceMovement?(from: Pos, to: Pos, attack?: boolean): void;
  playAnimation(motion: CharacterMotion): boolean;
}
interface Segment {
  from: Pos;
  to: Pos;
  motion?: 'walk' | 'run' | 'idle';
}
interface Playback {
  view: WalkView;
  segments: Segment[];
  elapsed: number;
  reduced: boolean;
  enter: boolean;
  leave: boolean;
}

/** Cubic Hermite progress with matching straight-cell tangents. Corners retain
 * zero speed so the sprite never cuts a logical route or snaps its facing at speed.
 * Each cell still takes exactly 300 ms (100 ms reduced); no game timestamps change. */
export function walkProgress(t: number, enter: boolean, leave: boolean): number {
  const v = Math.max(0, Math.min(1, t));
  return (-2 * v + 3) * v * v
    + (enter ? v * (v - 1) * (v - 1) : 0)
    + (leave ? v * v * (v - 1) : 0);
}

function straightJoin(a: Segment | undefined, b: Segment | undefined): boolean {
  if (!a || !b || a.to.x !== b.from.x || a.to.y !== b.from.y) return false;
  const ax = a.to.x - a.from.x, ay = a.to.y - a.from.y;
  const bx = b.to.x - b.from.x, by = b.to.y - b.from.y;
  // Equal grid steps preserve projected velocity even on an isometric board.
  return ax === bx && ay === by && (ax !== 0 || ay !== 0);
}

/** Route-faithful presentation playback for ordinary UNIT_MOVED paths. */
export class GridWalk {
  private readonly playing = new Map<string, Playback>();
  constructor(
    private readonly center: (pos: Pos) => { x: number; y: number },
    private readonly onComplete: (id: string, view: WalkView) => void = () => {},
    private readonly qaLocomotion = false,
  ) {}

  has(id: string): boolean {
    return this.playing.has(id);
  }

  enqueue(
    id: string,
    view: WalkView,
    move: { from: Pos; to: Pos; path: readonly Pos[] },
    reduced: boolean,
  ): void {
    const route = locomotionRoute(move);
    const cells = [move.from, ...move.path];
    if (cells.length === 1 || cells.at(-1)!.x !== move.to.x || cells.at(-1)!.y !== move.to.y)
      cells.push(move.to);
    const motion = reduced ? 'idle' as const : route.mode;
    const segments: Segment[] = this.qaLocomotion ? route.segments.map(s=>({...s,motion})) : cells.slice(1).map((to, i) => ({ from: cells[i]!, to }));
    if (!segments.length) return;
    const active = this.playing.get(id);
    if (active) {
      active.segments.push(...segments);
      // A late packet must not change an in-flight curve (which would jump the
      // sprite backwards). Coalesce only before the current cell has advanced.
      if (active.elapsed === 0) active.leave = straightJoin(active.segments[0], active.segments[1]);
      return;
    }
    view.root.position.set(this.center(move.from).x, this.center(move.from).y);
    if (view.faceMovement) view.faceMovement(segments[0]!.from, segments[0]!.to);
    else view.faceHorizontal(segments[0]!.to.x - segments[0]!.from.x);
    view.playAnimation(this.qaLocomotion ? motion : 'walk');
    this.playing.set(id, { view, segments, elapsed: 0, reduced, enter: false, leave: straightJoin(segments[0], segments[1]) });
  }

  tick(deltaMs: number): void {
    for (const [id, state] of this.playing) {
      state.elapsed += Math.max(0, deltaMs);
      const duration = state.reduced ? 100 : 300;
      while (state.segments.length && state.elapsed >= duration) {
        const segment = state.segments.shift()!;
        state.enter = state.leave && straightJoin(segment, state.segments[0]);
        state.leave = straightJoin(state.segments[0], state.segments[1]);
        const end = this.center(segment.to);
        state.view.root.position.set(end.x, end.y);
        state.elapsed -= duration;
        if (state.segments.length) {
          const next = state.segments[0]!;
          if (state.view.faceMovement) state.view.faceMovement(next.from, next.to);
          else state.view.faceHorizontal(next.to.x - next.from.x);
          if (this.qaLocomotion) state.view.playAnimation(next.motion ?? 'walk');
        }
      }
      const segment = state.segments[0];
      if (!segment) {
        this.playing.delete(id);
        state.view.playAnimation('idle');
        this.onComplete(id, state.view);
        continue;
      }
      const from = this.center(segment.from),
        to = this.center(segment.to),
        t = Math.min(1, state.elapsed / duration),
        eased = walkProgress(
          t,
          state.enter,
          state.leave,
        );
      state.view.root.position.set(
        from.x + (to.x - from.x) * eased,
        from.y + (to.y - from.y) * eased,
      );
    }
  }

  cancel(id: string): void {
    const state = this.playing.get(id);
    if (!state) return;
    this.playing.delete(id);
    state.view.playAnimation('idle');
  }

  clear(): void {
    for (const id of this.playing.keys()) this.cancel(id);
  }
}
