import { it, expect } from "vitest";
import {
  atmosphereView,
  composeAtmosphere,
  MAX_ENVIRONMENT_OPACITY,
} from "../src/presentation/immersion/atmosphere";
import { DEFAULT_IMMERSION } from "../src/presentation/immersion/settings";
import {
  showcaseState,
  SHOWCASE_UNIT,
} from "../src/presentation/qa/locomotion/showcase";
import { projectEvent } from "../src/presentation/vfx/visualProjection";
const fixture = () => {
  const s = showcaseState("mage");
  const h = s.units.find((u) => u.id === SHOWCASE_UNIT)!;
  h.maxHp = 100;
  h.hp = 100;
  h.statuses = [];
  s.board.tiles[h.pos.y * s.board.width + h.pos.x] = {
    terrain: "NORMAL",
    baseTerrain: "NORMAL",
    terrainTurnsLeft: null,
  };
  return s;
};
it("rooted is an active champion status, never terrain/proximity", () => {
  const s = fixture(),
    h = s.units.find((u) => u.id === SHOWCASE_UNIT)!;
  expect(atmosphereView(s, h.id).rooted).toBe(false);
  h.statuses = [{ id: "ROOTED", turnsLeft: 2 }];
  expect(atmosphereView(s, h.id).rooted).toBe(true);
  h.statuses = [];
  expect(atmosphereView(s, h.id).rooted).toBe(false);
});
it("root removal commits through existing presentation projection", () => {
  const s = fixture(),
    h = s.units.find((u) => u.id === SHOWCASE_UNIT)!;
  h.statuses = [{ id: "ROOTED", turnsLeft: 2 }];
  const final = structuredClone(s);
  final.units.find((u) => u.id === h.id)!.statuses = [];
  const p = projectEvent(
    s,
    {
      type: "STATUS_REMOVED",
      unitId: h.id,
      status: "ROOTED",
      reason: "CLEANSED",
    },
    final,
  );
  expect(atmosphereView(p, h.id).rooted).toBe(false);
});
for (const [tile, label] of [
  ["ICE", "ice"],
  ["FIRE", "fire"],
] as const) {
  it(`entry and exit ${tile} follows the real tile`, () => {
    const s = fixture(),
      h = s.units.find((u) => u.id === SHOWCASE_UNIT)!;
    s.board.tiles[h.pos.y * s.board.width + h.pos.x]!.terrain = tile;
    expect(atmosphereView(s, h.id).terrain).toBe(label);
    h.pos = { x: h.pos.x + 1, y: h.pos.y };
    expect(atmosphereView(s, h.id).terrain).toBe("none");
  });
  it(`expiration/removal ${tile}`, () => {
    const s = fixture(),
      h = s.units.find((u) => u.id === SHOWCASE_UNIT)!;
    s.board.tiles[h.pos.y * s.board.width + h.pos.x]!.terrain = tile;
    const p = projectEvent(
      s,
      {
        type: "TERRAIN_REMOVED",
        pos: h.pos,
        terrain: tile,
        revertedTo: "NORMAL",
        reason: "EXPIRED",
      },
      s,
    );
    expect(atmosphereView(p, h.id).terrain).toBe("none");
  });
}
it("BURNING does not imply standing in fire", () => {
  const s = fixture(),
    h = s.units.find((u) => u.id === SHOWCASE_UNIT)!;
  h.statuses = [{ id: "BURNING", turnsLeft: 2 }];
  expect(atmosphereView(s, h.id).terrain).toBe("none");
});
it("enemy/rooted summon never owns the local screen", () => {
  const s = fixture(),
    h = s.units.find((u) => u.id === SHOWCASE_UNIT)!;
  s.units.push({
    ...structuredClone(h),
    id: "other",
    faction: "ENEMY",
    hp: 1,
    statuses: [{ id: "ROOTED", turnsLeft: 2 }],
  });
  expect(atmosphereView(s, h.id).rooted).toBe(false);
  expect(atmosphereView(s, h.id).hp).toBe(100);
});
it("critical + rooted + fire all survive within one opacity budget", () => {
  const s = fixture(),
    h = s.units.find((u) => u.id === SHOWCASE_UNIT)!;
  h.hp = 10;
  h.statuses = [{ id: "ROOTED", turnsLeft: 2 }];
  s.board.tiles[h.pos.y * s.board.width + h.pos.x]!.terrain = "FIRE";
  const c = composeAtmosphere(atmosphereView(s, h.id), DEFAULT_IMMERSION);
  expect(c.mood).toBe("extreme");
  expect(c.rootOpacity).toBeGreaterThan(0);
  expect(c.terrainOpacity).toBeGreaterThan(0);
  expect(
    1 - (1 - c.healthOpacity) * (1 - c.rootOpacity) * (1 - c.terrainOpacity),
  ).toBeLessThanOrEqual(MAX_ENVIRONMENT_OPACITY + 1e-9);
});
it("healing removes health warning but keeps active root/terrain", () => {
  const s = fixture(),
    h = s.units.find((u) => u.id === SHOWCASE_UNIT)!;
  h.hp = 100;
  h.statuses = [{ id: "ROOTED", turnsLeft: 2 }];
  const c = composeAtmosphere(atmosphereView(s, h.id), DEFAULT_IMMERSION);
  expect(c.healthOpacity).toBe(0);
  expect(c.rooted).toBe(true);
});
it("reconnection snapshots deterministically restore layers without replay", () => {
  const s = fixture(),
    h = s.units.find((u) => u.id === SHOWCASE_UNIT)!;
  h.hp = 1;
  h.statuses = [{ id: "ROOTED", turnsLeft: 2 }];
  expect(atmosphereView(structuredClone(s), h.id)).toEqual(
    atmosphereView(s, h.id),
  );
});
it("disabled, reduced intensity and death clean up the composition", () => {
  const s = fixture(),
    h = s.units.find((u) => u.id === SHOWCASE_UNIT)!;
  h.hp = 10;
  h.statuses = [{ id: "ROOTED", turnsLeft: 2 }];
  const v = atmosphereView(s, h.id),
    off = composeAtmosphere(v, { ...DEFAULT_IMMERSION, visuals: false });
  expect(off.healthOpacity + off.rootOpacity + off.terrainOpacity).toBe(0);
  expect(
    composeAtmosphere(v, { ...DEFAULT_IMMERSION, subtle: true }).healthOpacity,
  ).toBeLessThan(composeAtmosphere(v, DEFAULT_IMMERSION).healthOpacity);
  h.hp = 0;
  expect(atmosphereView(s, h.id).finished).toBe(true);
  expect(atmosphereView(s, "missing").finished).toBe(true);
});

it("PvP surrender/result clears presentation even without engine outcome", () => {
  const s = fixture(),
    h = s.units.find((u) => u.id === SHOWCASE_UNIT)!;
  h.hp = 4;
  h.statuses = [{ id: "ROOTED", turnsLeft: 2 }];
  s.board.tiles[h.pos.y * s.board.width + h.pos.x]!.terrain = "FIRE";
  expect(s.outcome).toBeFalsy();
  const c = composeAtmosphere(
    { ...atmosphereView(s, h.id), finished: true },
    DEFAULT_IMMERSION,
  );
  expect(c.healthOpacity + c.rootOpacity + c.terrainOpacity).toBe(0);
  expect(c.rooted).toBe(false);
  expect(c.terrain).toBe("none");
});
