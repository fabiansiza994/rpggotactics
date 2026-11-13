import {
  readDrawMode,
  writeDrawMode,
  DRAW_MODE_KEY,
} from "../src/presentation/cards/drawRitualSettings";
import { expect, it, vi } from "vitest";
import {
  DEFAULT_CONTENT,
  GameEngine,
  SCENARIOS_BY_ID,
  type GameState,
  type GameEvent,
} from "../src/game";
import {
  classifyDraws,
  DrawRitualMachine,
  drawGesture,
  drawPointerCommits,
  type DrawTicket,
} from "../src/presentation/cards/drawRitual";
const ticket = (i: number): DrawTicket => ({
  key: String(i),
  uid: "uid" + i,
  cardId: "fireball",
  interactive: true,
});
function observation(online = false) {
  const e = new GameEngine(SCENARIOS_BY_ID.first_blood!, DEFAULT_CONTENT, 42);
  const previous = structuredClone(e.state) as GameState;
  previous.player.hand = [];
  const state = structuredClone(previous);
  state.round = 2;
  state.player.hand = [{ uid: "new", cardId: "fireball" }];
  return {
    content: DEFAULT_CONTENT,
    previous,
    state,
    online,
    live: true,
    revision: "battle:2",
    events: [
      { type: "TURN_STARTED", faction: "PLAYER", round: 2 },
      { type: "CARD_DRAWN", cardUid: "new", cardId: "fireball" },
    ] as GameEvent[],
  };
}
it("main turn draw is a reference to exactly one existing own card", () => {
  const o = observation(),
    before = JSON.stringify(o);
  expect(classifyDraws(o)).toEqual([
    { key: "battle:2:new", uid: "new", cardId: "fireball", interactive: true },
  ]);
  expect(JSON.stringify(o)).toBe(before);
});
it.each([
  "opening",
  "restoration",
  "unavailable",
  "enemy",
  "discarded",
  "unknown",
] as const)("skips %s without inventing a card", (kind) => {
  const o = observation();
  if (kind === "opening")
    o.events.unshift({ type: "BATTLE_STARTED", scenarioId: "x", seed: 1 });
  if (kind === "restoration") o.live = false;
  if (kind === "unavailable")
    o.state.player.hand[0]!.unavailableThisTurn = true;
  if (kind === "enemy") o.state.phase = "ENEMY";
  if (kind === "discarded") o.state.player.hand = [];
  if (kind === "unknown") o.state.player.hand[0]!.cardId = "missing";
  expect(classifyDraws(o)).toEqual([]);
});
it("PvP uses only own hand delta and new own turn, not filtered private events", () => {
  const o = observation(true);
  o.previous.phase = "ENEMY";
  o.events = [{ type: "TURN_STARTED", faction: "ENEMY", round: 2 }];
  expect(classifyDraws(o)).toHaveLength(1);
  o.previous.phase = "PLAYER";
  o.previous.round = 2;
  expect(classifyDraws(o)).toEqual([]);
  o.previous.phase = "ENEMY";
  o.live = false;
  expect(classifyDraws(o)).toEqual([]);
});
it("duplicates, same snapshot and rival private cards cannot create more tickets", () => {
  const o = observation(true);
  o.previous.phase = "ENEMY";
  const m = new DrawRitualMachine();
  m.enqueue(classifyDraws(o));
  m.enqueue(classifyDraws(o));
  expect(m.getSnapshot().queue).toHaveLength(1);
  o.previous.player.hand = structuredClone(o.state.player.hand);
  expect(classifyDraws(o)).toEqual([]);
  expect(m.getSnapshot().queue[0]!.uid).toBe("new");
});
it("multiple own cards use short automatic FIFO, full hand has no overlay", () => {
  const o = observation();
  o.state.player.hand.push({ uid: "new2", cardId: "magic_missile" });
  o.events.push({
    type: "CARD_DRAWN",
    cardUid: "new2",
    cardId: "magic_missile",
  });
  expect(classifyDraws(o).every((t) => !t.interactive)).toBe(true);
  o.state.player.hand = [];
  expect(classifyDraws(o)).toEqual([]);
});
it("draw spells are automatic; retrieval/search is excluded", () => {
  const o = observation();
  o.events = [
    {
      type: "CARD_PLAYED",
      cardUid: "played",
      cardId: "arcane_surge",
      casterId: o.state.player.heroId,
      target: null,
      impact: { x: 1, y: 1 },
      affectedTiles: [],
      direction: null,
    },
    { type: "CARD_DRAWN", cardUid: "new", cardId: "fireball" },
  ];
  expect(classifyDraws(o)[0]?.interactive).toBe(false);
  o.events = o.events.filter((e) => e.type !== "CARD_PLAYED");
  expect(classifyDraws(o)).toEqual([]);
});
it("legal phases, incomplete drag, FIFO settlement and duplicate settlement are bounded", () => {
  const m = new DrawRitualMachine();
  m.enqueue([ticket(1), ticket(2)]);
  m.phase("flight");
  expect(m.getSnapshot().phase).toBe("waiting");
  for (const p of [
    "presenting",
    "ready",
    "dragging",
    "springBack",
    "ready",
    "committing",
    "reveal",
    "flight",
    "settled",
  ] as const)
    m.phase(p);
  m.settle("1");
  m.settle("1");
  expect(m.getSnapshot().current?.key).toBe("2");
  m.complete();
  expect(m.getSnapshot().queue).toHaveLength(0);
});
it("scene cleanup, subscriptions and queue cap do not retain cards", () => {
  const m = new DrawRitualMachine();
  let notifications = 0;
  const off = m.subscribe(() => notifications++);
  m.enqueue(Array.from({ length: 100 }, (_, i) => ticket(i)));
  expect(m.getSnapshot().queue).toHaveLength(8);
  m.reset();
  expect(m.getSnapshot().current).toBeNull();
  off();
  const n = notifications;
  m.enqueue([ticket(1)]);
  expect(notifications).toBe(n);
});
it("gesture requires downward threshold or valid fast swipe; tap is separate", () => {
  expect(drawGesture(59, 500, 200)).toBe(false);
  expect(drawGesture(70, 500, 200)).toBe(true);
  expect(drawGesture(-100, 50, 200)).toBe(false);
  expect(drawGesture(40, 40, 250)).toBe(true);
  expect(drawGesture(20, 10, 200)).toBe(false);
});
it("ritual enabled and disabled yield identical engine state, history and RNG", () => {
  const a = new GameEngine(SCENARIOS_BY_ID.first_blood!, DEFAULT_CONTENT, 42),
    b = new GameEngine(SCENARIOS_BY_ID.first_blood!, DEFAULT_CONTENT, 42),
    m = new DrawRitualMachine();
  for (let i = 0; i < 3 && !a.state.outcome; i++) {
    const before = structuredClone(a.state),
      r = a.dispatch({
        type: "END_TURN",
        discardUid: a.state.player.hand[0]?.uid,
      });
    b.dispatch({ type: "END_TURN", discardUid: b.state.player.hand[0]?.uid });
    m.enqueue(
      classifyDraws({
        events: r.events,
        state: a.state,
        previous: before,
        content: DEFAULT_CONTENT,
        revision: String(i),
      }),
    );
    m.complete();
    expect(a.state).toEqual(b.state);
    expect(a.history).toEqual(b.history);
  }
});

it("PvE engine may mutate the same snapshot reference before notifying listeners", () => {
  const o = observation();
  o.previous = o.state;
  expect(classifyDraws(o)).toHaveLength(1);
});

it.each([
  [0, 0, 0, true],
  [0, -100, 100, false],
  [120, 15, 121, false],
  [0, 140, 140, true],
] as const)(
  "pointer delta %s/%s has safe tap/swipe result",
  (dx, dy, moved, result) => {
    expect(drawPointerCommits(dx, dy, moved, 500, 258)).toBe(result);
  },
);
it("interactive preference defaults safely and persists automatic without touching cards", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  });
  expect(readDrawMode()).toBe("interactive");
  writeDrawMode("automatic");
  expect(values.get(DRAW_MODE_KEY)).toBe("automatic");
  expect(readDrawMode()).toBe("automatic");
  vi.unstubAllGlobals();
});
it("blocked local storage never prevents combat or default interaction", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  });
  expect(readDrawMode()).toBe("interactive");
  expect(() => writeDrawMode("automatic")).not.toThrow();
  vi.unstubAllGlobals();
});
