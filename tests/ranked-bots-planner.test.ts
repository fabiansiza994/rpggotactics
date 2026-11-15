import { it, expect, describe } from "vitest";
import { DEFAULT_CONTENT } from "../src/game/data";
import { withShapeshifterRelease } from "../src/game/data/shapeshifter-release";
import { starterDeck } from "../src/game/collection/profile";
import { createDuel, applyDuel } from "../src/game/pvp/duel";
import { botObservation, planBot } from "../src/game/ai/ranked-bot";
import { botIdentity } from "../src/game/ai/ranked-bot-policy";
const content = withShapeshifterRelease(DEFAULT_CONTENT);
const load = (heroId: string) => ({
  heroId,
  cards: starterDeck(content.heroes[heroId]!),
});
describe("bounded observable bot planner", () => {
  it.each(["mage", "summoner", "shapeshifter"])(
    "issues legal commands for %s without changing canonical state",
    (hero) => {
      const state = createDuel(
          [load(hero), load("mage")],
          7,
          "DUEL",
          "classic",
          content,
          true,
        ),
        seat = state.duel!.active;
      const before = JSON.stringify(state);
      const observation = botObservation(state, seat, content);
      const identity = {
        ...botIdentity("test", 600, 55),
        heroId: hero as "mage",
        level: 2,
      };
      const p = planBot(observation, content, identity, { clock: () => 0 });
      expect(p.nodes).toBeLessThanOrEqual(180);
      expect(() => applyDuel(state, p.command, content)).not.toThrow();
      expect(JSON.stringify(state)).toBe(before);
    },
  );
  it("cannot infer opponent cards, deck or RNG and is deterministic from observation", () => {
    const a = createDuel(
        [load("summoner"), load("shapeshifter")],
        13,
        "DUEL",
        "classic",
        content,
        true,
      ),
      seat = a.duel!.active,
      b = structuredClone(a);
    b.duel!.other.hand = [];
    b.duel!.other.deck.reverse();
    b.duel!.other.altar = [];
    b.rngState = 998877;
    b.nextId = 99999;
    const oa = botObservation(a, seat, content),
      ob = botObservation(b, seat, content);
    // Public counts are legitimately observable; equalize them to compare same information set.
    ob.pileCounts = oa.pileCounts;
    expect(ob).toEqual(oa);
    const bot = botIdentity("x", 900, 29);
    expect(planBot(oa, content, bot, { clock: () => 0 })).toEqual(
      planBot(ob, content, bot, { clock: () => 0 }),
    );
  });
  it("honors exact node cap and wall-clock fuse", () => {
    const s = createDuel(
        [load("mage"), load("summoner")],
        7,
        "DUEL",
        "classic",
        content,
        true,
      ),
      o = botObservation(s, s.duel!.active, content),
      b = botIdentity("x", 1500, 1);
    let tick = 0;
    expect(
      planBot(o, content, b, { clock: () => tick++, maxCpuMs: 1 }).cutoff,
    ).toBe(true);
    expect(planBot(o, content, b, { clock: () => 0, maxNodes: 3 }).nodes).toBe(
      3,
    );
  });
  it("advanced mage recognizes a legal lethal with a powerful published card", () => {
    const s = createDuel(
        [load("mage"), load("mage")],
        9,
        "DUEL",
        "classic",
        content,
        true,
      ),
      seat = s.duel!.active;
    const own = s.units.find((u) => u.id === s.player.heroId)!,
      rival = s.units.find((u) => u.kind === "HERO" && u.id !== own.id)!;
    rival.pos = {
      x: own.pos.x > 4 ? own.pos.x - 2 : own.pos.x + 2,
      y: own.pos.y,
    };
    rival.hp = 2;
    rival.shield = 0;
    s.player.hand = [{ uid: "lethal", cardId: "tempest_judgment" }];
    s.player.energy = 5;
    const bot = { ...botIdentity("strong", 1500, 42), heroId: "mage" as const };
    const plan = planBot(botObservation(s, seat, content), content, bot, {
      clock: () => 0,
      maxNodes: 100,
    });
    expect(plan.command.type).toBe("PLAY_CARD");
    const after = applyDuel(s, plan.command, content).state;
    expect(after.units.some((u) => u.id === rival.id)).toBe(false);
    expect(after.player.energy).toBe(1);
  });
  it("uses existing pathfinding to take a detour instead of idling behind a wall", () => {
    const s = createDuel(
        [load("shapeshifter"), load("shapeshifter")],
        19,
        "DUEL",
        "classic",
        content,
        true,
      ),
      seat = s.duel!.active;
    const own = s.units.find((u) => u.id === s.player.heroId)!,
      rival = s.units.find((u) => u.kind === "HERO" && u.id !== own.id)!;
    own.pos = { x: 2, y: 3 };
    rival.pos = { x: 5, y: 3 };
    s.player.hand = [];
    s.player.energy = 0;
    for (let y = 1; y < s.board.height; y++) {
      const tile = s.board.tiles[y * s.board.width + 3]!;
      tile.terrain = "BLOCKED";
      tile.baseTerrain = "BLOCKED";
    }
    const bot = {
      ...botIdentity("detour", 900, 714),
      heroId: "shapeshifter" as const,
    };
    const plan = planBot(botObservation(s, seat, content), content, bot, {
      clock: () => 0,
      maxNodes: 100,
    });
    expect(plan.command.type).toBe("MOVE_UNIT");
    if (plan.command.type === "MOVE_UNIT")
      expect(plan.command.to.y).toBeLessThan(3);
    expect(() => applyDuel(s, plan.command, content)).not.toThrow();
  });
  it("recognizes public burning terrain as a survival threat without changing damage rules", () => {
    const s = createDuel(
        [load("mage"), load("mage")],
        11,
        "DUEL",
        "classic",
        content,
        true,
      ),
      seat = s.duel!.active;
    const own = s.units.find((u) => u.id === s.player.heroId)!;
    s.player.hand = [];
    s.player.energy = 0;
    const tile = s.board.tiles[own.pos.y * s.board.width + own.pos.x]!;
    tile.terrain = "FIRE";
    tile.baseTerrain = "NORMAL";
    tile.terrainTurnsLeft = 2;
    const plan = planBot(
      botObservation(s, seat, content),
      content,
      botIdentity("hazard", 900, 819),
      { clock: () => 0, maxNodes: 100 },
    );
    expect(plan.command.type).toBe("MOVE_UNIT");
    if (plan.command.type === "MOVE_UNIT")
      expect(
        s.board.tiles[plan.command.to.y * s.board.width + plan.command.to.x]!
          .terrain,
      ).not.toBe("FIRE");
  });
  it("values a real draw without seeing or fabricating future cards", () => {
    const s = createDuel(
      [load("mage"), load("mage")],
      17,
      "DUEL",
      "classic",
      content,
      true,
    );
    s.player.hand = [{ uid: "draw", cardId: "arcane_surge" }];
    s.player.energy = 1;
    s.player.movePoints = 0;
    const o = botObservation(s, s.duel!.active, content),
      before = structuredClone(o);
    const b = {
      ...botIdentity("draw-test", 1500, 37, 0),
      heroId: "mage" as const,
    };
    const p = planBot(o, content, b, { clock: () => 0 });
    expect(p.command).toEqual({
      type: "PLAY_CARD",
      cardUid: "draw",
      target: null,
    });
    expect(o).toEqual(before);
    expect(o.player.deck).toEqual([]);
    const applied = applyDuel(s, p.command, content);
    expect(applied.state.player.hand.length).toBe(2);
  });
  it("protects a low-HP champion from a visible ranged summon instead of taking a nonlethal shot", () => {
    const s = createDuel(
      [load("mage"), load("mage")],
      17,
      "DUEL",
      "classic",
      content,
      true,
    );
    const own = s.units.find((u) => u.id === s.player.heroId)!,
      rival = s.units.find((u) => u.kind === "HERO" && u.id !== own.id)!;
    own.pos = { x: 2, y: 2 };
    own.hp = 1;
    own.armor = 0;
    own.shield = 0;
    rival.pos = { x: 6, y: 2 };
    rival.hp = 20;
    const def = Object.values(content.summons!).find(
      (d) => (d.attackRange ?? 1) > 1,
    )!;
    expect(def).toBeTruthy();
    s.units.push({
      ...structuredClone(rival),
      id: "visible-archer",
      defId: def.id,
      kind: "SUMMON",
      hp: def.maxHp,
      maxHp: def.maxHp,
      armor: def.armor,
      pos: { x: 4, y: 2 },
      summon: {
        ownerId: rival.id,
        capacityCost: 1,
        lastActedRound: 0,
        readyRound: 0,
      },
    });
    s.player.movePoints = 0;
    s.player.energy = 2;
    s.player.hand = [
      { uid: "protect", cardId: "barrier" },
      { uid: "damage", cardId: "magic_missile" },
    ];
    const b = {
      ...botIdentity("defense", 1500, 41, 0),
      heroId: "mage" as const,
    };
    const p = planBot(botObservation(s, s.duel!.active, content), content, b, {
      clock: () => 0,
    });
    expect(p.command).toMatchObject({
      type: "PLAY_CARD",
      cardUid: "protect",
      target: own.pos,
    });
  });
  it("never treats unordered search candidates as a known future draw or fabricated lethal", () => {
    const s = createDuel(
      [load("mage"), load("mage")],
      17,
      "DUEL",
      "classic",
      content,
      true,
    );
    const own = s.units.find((u) => u.id === s.player.heroId)!,
      rival = s.units.find((u) => u.kind === "HERO" && u.id !== own.id)!;
    own.pos = { x: 2, y: 2 };
    rival.pos = { x: 4, y: 2 };
    rival.hp = 1;
    s.player.hand = [{ uid: "draw", cardId: "arcane_surge" }];
    s.player.energy = 2;
    s.player.movePoints = 0;
    const o = botObservation(s, s.duel!.active, content);
    o.searchChoices = [{ uid: "unordered", cardId: "magic_missile" }];
    const p = planBot(
      o,
      content,
      { ...botIdentity("unknown", 1500, 37, 0), heroId: "mage" as const },
      { clock: () => 0 },
    );
    expect(p.score).toBeLessThan(100000);
    expect(o.player.hand).toEqual([{ uid: "draw", cardId: "arcane_surge" }]);
  });
  it("advanced search finds a legal movement setup then lethal while the one-layer profile cannot see the combo", () => {
    let s = createDuel(
      [load("mage"), load("mage")],
      17,
      "DUEL",
      "classic",
      content,
      true,
    );
    const own = s.units.find((u) => u.id === s.player.heroId)!,
      rival = s.units.find((u) => u.kind === "HERO" && u.id !== own.id)!;
    own.pos = { x: 1, y: 2 };
    rival.pos = { x: 6, y: 2 };
    rival.hp = 3;
    rival.shield = 0;
    rival.armor = 0;
    s.player.movePoints = 0;
    s.player.energy = 2;
    s.player.hand = [
      { uid: "setup", cardId: "phase_step" },
      { uid: "lethal", cardId: "fireball" },
    ];
    const base = {
        ...botIdentity("combo", 0, 19, 0),
        heroId: "mage" as const,
        level: 0,
      },
      advanced = { ...base, level: 6 };
    const first = planBot(
      botObservation(s, s.duel!.active, content),
      content,
      advanced,
      { clock: () => 0 },
    );
    expect(first.command).toMatchObject({
      type: "PLAY_CARD",
      cardUid: "setup",
    });
    expect(
      planBot(botObservation(s, s.duel!.active, content), content, base, {
        clock: () => 0,
      }).command.type,
    ).toBe("END_TURN");
    for (let i = 0; i < 4 && !s.outcome; i++) {
      const plan = planBot(
        botObservation(s, s.duel!.active, content),
        content,
        advanced,
        { clock: () => 0 },
      );
      s = applyDuel(s, plan.command, content).state;
    }
    expect(s.units.some((u) => u.id === rival.id)).toBe(false);
  });
});
