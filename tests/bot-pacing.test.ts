import { describe, it, expect } from "vitest";
import {
  botPause,
  botActionTiming,
  pacingCredit,
  BOT_PACING_CREDIT_MS,
} from "../server/src/botPacing";
import { DEFAULT_CONTENT, type GameEvent } from "../src/game";
import { compileTimeline } from "../src/presentation/vfx/spellTimeline";
describe("Persistent bot pacing, separate from combat randomness", () => {
  it("bounds reproducible first, normal and final pauses with varied values", () => {
    for (const [kind, min, max] of [
      ["first", 1500, 2500],
      ["normal", 800, 1500],
      ["end", 800, 1200],
    ] as const) {
      const values = new Set<number>();
      for (let seed = 0; seed < 300; seed++) {
        const value = botPause(kind, seed, 4, 3);
        expect(value).toBeGreaterThanOrEqual(min);
        expect(value).toBeLessThanOrEqual(max);
        expect(botPause(kind, seed, 4, 3)).toBe(value);
        values.add(value);
      }
      expect(values.size).toBeGreaterThan(100);
    }
  });
  it("uses the exact existing client timeline rather than an unrelated timeout", () => {
    const events: GameEvent[] = [];
    const before = JSON.stringify(events);
    const a = botActionTiming(
      { type: "END_TURN" },
      events,
      DEFAULT_CONTENT,
      1,
      1,
      1,
    );
    expect(a.visualMs).toBe(
      compileTimeline(events, (id) => id, false, true).duration,
    );
    expect(a.delayMs).toBe(0);
    expect(JSON.stringify(events)).toBe(before);
  });
  it("never credits unbounded wall time or grants additional CPU/action budget", () => {
    let used = 0;
    for (let i = 0; i < 100; i++) used += pacingCredit(2500, used);
    expect(used).toBe(BOT_PACING_CREDIT_MS);
    expect(pacingCredit(1000, used)).toBe(0);
    expect(pacingCredit(-1, 0)).toBe(0);
  });
});

// Exercise the production engine's public events, including HP contact and summon presentation.
import { GameEngine } from "../src/game";
import { encounterCheckpoint } from "../src/presentation/qa/act3/integrationFixtures";
it.each(["fireball", "summon_pact_golem", "nurture"])(
  "waits through actual %s events without mutating HP or commands",
  (card) => {
    const hero = card === "fireball" ? "mage" : "summoner";
    const { state, scenario } = encounterCheckpoint("duel", hero)!;
    state.player.energy = 20;
    state.player.hand = [{ uid: "pace", cardId: card }];
    const champion = state.units.find((u) => u.id === state.player.heroId)!;
    if (card === "nurture") champion.hp -= 6;
    const engine = GameEngine.fromSnapshot(state, DEFAULT_CONTENT, scenario);
    const target =
      card === "nurture"
        ? champion.pos
        : card === "fireball"
          ? state.units.find((u) => u.faction === "ENEMY")!.pos
          : engine.getValidTargets("pace")[0]!;
    const command = { type: "PLAY_CARD" as const, cardUid: "pace", target };
    const result = engine.dispatch(command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snapshot = JSON.stringify(engine.state),
      events = JSON.stringify(result.events);
    const timing = botActionTiming(
      command,
      result.events,
      DEFAULT_CONTENT,
      42,
      4,
      2,
    );
    expect(timing.delayMs).toBeGreaterThanOrEqual(timing.visualMs + 140);
    if (card === "summon_pact_golem")
      expect(timing.delayMs).toBeGreaterThanOrEqual(1500);
    expect(JSON.stringify(engine.state)).toBe(snapshot);
    expect(JSON.stringify(result.events)).toBe(events);
  },
);
it("allows a movement cue to finish before the next command", () => {
  const events: GameEvent[] = [
    {
      type: "UNIT_MOVED",
      unitId: "bot",
      from: { x: 1, y: 1 },
      to: { x: 1, y: 4 },
      path: [
        { x: 1, y: 2 },
        { x: 1, y: 3 },
        { x: 1, y: 4 },
      ],
      cost: 3,
      mode: "WALK",
    },
  ];
  const timing = botActionTiming(
    { type: "MOVE_UNIT", unitId: "bot", to: { x: 1, y: 4 } },
    events,
    DEFAULT_CONTENT,
    6,
    3,
    1,
  );
  expect(timing.visualMs).toBeGreaterThan(0);
  expect(timing.delayMs).toBeGreaterThanOrEqual(timing.visualMs + 140);
});
it("presents consecutive legal summons as separate batches with unique units", () => {
  const { state, scenario } = encounterCheckpoint("duel", "summoner")!;
  state.player.energy = 20;
  state.player.hand = [
    { uid: "one", cardId: "summon_chicken" },
    { uid: "two", cardId: "summon_turtle" },
  ];
  const engine = GameEngine.fromSnapshot(state, DEFAULT_CONTENT, scenario);
  let elapsed = botPause("first", 42, 3, 0);
  const commits: number[] = [];
  for (const uid of ["one", "two"]) {
    const target = engine.getValidTargets(uid)[0]!;
    expect(target).toBeTruthy();
    const command = { type: "PLAY_CARD" as const, cardUid: uid, target };
    const r = engine.dispatch(command);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.filter((e) => e.type === "UNIT_SPAWNED")).toHaveLength(1);
    commits.push(elapsed);
    const t = botActionTiming(
      command,
      r.events,
      DEFAULT_CONTENT,
      42,
      3,
      commits.length,
    );
    expect(t.delayMs).toBeGreaterThanOrEqual(1500);
    elapsed += t.delayMs;
  }
  expect(commits[1]! - commits[0]!).toBeGreaterThanOrEqual(1500);
  expect(new Set(engine.state.units.map((u) => u.id)).size).toBe(
    engine.state.units.length,
  );
});
