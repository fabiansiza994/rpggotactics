import type { GameContent, GameEvent, GameState } from "../../game";
export type DrawPhase =
  | "idle"
  | "waiting"
  | "presenting"
  | "ready"
  | "dragging"
  | "springBack"
  | "committing"
  | "reveal"
  | "flight"
  | "settled";
export type DrawMode = "interactive" | "automatic";
export interface DrawTicket {
  key: string;
  uid: string;
  cardId: string;
  interactive: boolean;
}
export interface DrawObservation {
  events: readonly GameEvent[];
  state: Readonly<GameState>;
  previous?: Readonly<GameState> | null;
  content: GameContent;
  online?: boolean;
  live?: boolean;
  revision: string;
}
/** Only already-owned, authoritative hand cards can become visual tickets. */
export function classifyDraws(o: DrawObservation): DrawTicket[] {
  const { events, state, previous } = o;
  if (
    !previous ||
    o.live === false ||
    state.outcome ||
    events.some((e) => e.type === "BATTLE_STARTED")
  )
    return [];
  const ownTurn =
    state.phase === "PLAYER" &&
    events.some(
      (e) =>
        e.type === "TURN_STARTED" &&
        (o.online
          ? previous.phase !== "PLAYER" || state.round !== previous.round
          : e.faction === "PLAYER"),
    );
  const drawSpell = events.some(
    (e) =>
      e.type === "CARD_PLAYED" &&
      o.content.cards[e.cardId]?.effects.some(
        (effect) => effect.type === "DRAW",
      ),
  );
  if (!ownTurn && !drawSpell) return [];
  const old = new Set(previous.player.hand.map((c) => c.uid));
  const drawn = new Set(
    events.filter((e) => e.type === "CARD_DRAWN").map((e) => e.cardUid),
  );
  const candidates = state.player.hand.filter(
    (c) =>
      (!o.online || !old.has(c.uid)) &&
      !c.unavailableThisTurn &&
      o.content.cards[c.cardId] &&
      (o.online || drawn.has(c.uid)),
  );
  return candidates.map((c, i) => ({
    key: `${o.revision}:${c.uid}`,
    uid: c.uid,
    cardId: c.cardId,
    interactive: ownTurn && i === 0 && candidates.length === 1,
  }));
}
export interface DrawVisual {
  phase: DrawPhase;
  queue: readonly DrawTicket[];
  current: DrawTicket | null;
}
const empty: DrawVisual = { phase: "idle", queue: [], current: null };
/** Bounded presentation FIFO; no timers, DOM, cards, RNG, commands or authoritative writes. */
export class DrawRitualMachine {
  private value: DrawVisual = empty;
  private seen = new Set<string>();
  private listeners = new Set<() => void>();
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: DrawVisual) {
    this.value = next;
    for (const l of this.listeners) l();
  }
  enqueue(tickets: readonly DrawTicket[]) {
    const added = tickets.filter((t) => {
      if (this.seen.has(t.key)) return false;
      this.seen.add(t.key);
      return true;
    });
    while (this.seen.size > 512)
      this.seen.delete(this.seen.values().next().value!);
    if (!added.length) return;
    const queue = [...this.value.queue, ...added].slice(0, 8);
    this.update({
      phase: this.value.current ? this.value.phase : "waiting",
      queue,
      current: this.value.current ?? queue[0] ?? null,
    });
  }
  phase(phase: DrawPhase) {
    const allowed: Partial<Record<DrawPhase, DrawPhase[]>> = {
      waiting: ["presenting"],
      presenting: ["ready", "committing"],
      ready: ["dragging", "committing"],
      dragging: ["springBack", "committing"],
      springBack: ["ready"],
      committing: ["reveal"],
      reveal: ["flight"],
      flight: ["settled"],
    };
    if (this.value.current && allowed[this.value.phase]?.includes(phase))
      this.update({ ...this.value, phase });
  }
  settle(key: string) {
    if (this.value.current?.key !== key || this.value.phase !== "settled")
      return;
    const queue = this.value.queue.slice(1);
    this.update(
      queue.length ? { phase: "waiting", queue, current: queue[0]! } : empty,
    );
  }
  complete() {
    if (this.value.current || this.value.queue.length) this.update(empty);
  }
  reset() {
    this.seen.clear();
    this.complete();
  }
}
export const drawRitual = new DrawRitualMachine();
export function drawGesture(
  dy: number,
  elapsed: number,
  distance: number,
): boolean {
  return (
    dy >= Math.max(60, distance * 0.35) ||
    (dy >= 35 && dy / Math.max(1, elapsed) > 0.65)
  );
}
/** Tap or predominantly downward gesture, never an upward/sideways drag mistaken for a tap. */
export function drawPointerCommits(
  dx: number,
  dy: number,
  moved: number,
  elapsed: number,
  distance: number,
): boolean {
  return (
    moved < 8 ||
    (Math.abs(dx) <= Math.max(0, dy) && drawGesture(dy, elapsed, distance))
  );
}
