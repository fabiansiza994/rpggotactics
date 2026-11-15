import { describe, it, expect, vi, afterEach } from "vitest";
import {
  browserHapticPort,
  CombatHaptics,
  healthMood,
  healthSeverity,
  HAPTIC_PATTERNS,
  vibrationPattern,
  type HapticPort,
} from "../src/presentation/immersion/combatImmersion";
import {
  DEFAULT_IMMERSION,
  normalizeImmersion,
} from "../src/presentation/immersion/settings";
import type { GameState, EventOfType } from "../src/game";
import { readFileSync } from "node:fs";
const state = {
  units: [
    { id: "hero", faction: "PLAYER", maxHp: 20 },
    { id: "pet", faction: "PLAYER", maxHp: 6 },
    { id: "foe", faction: "ENEMY", maxHp: 20 },
  ],
} as unknown as GameState;
const damage = (id = "hero", hpLost = 2): EventOfType<"UNIT_DAMAGED"> => ({
  type: "UNIT_DAMAGED",
  unitId: id,
  sourceId: "foe",
  pos: { x: 1, y: 1 },
  damageType: "PHYSICAL",
  rawAmount: hpLost,
  armorMitigated: 0,
  shieldAbsorbed: 0,
  hpLost,
  hpAfter: 20 - hpLost,
});
function fixture() {
  vi.useFakeTimers();
  let active = true;
  const calls: (number | number[])[] = [];
  const settings = { ...DEFAULT_IMMERSION, vibration: true };
  const port: HapticPort = {
    allowed: () => active,
    reduced: () => false,
    now: () => Date.now(),
    vibrate: (p) => {
      calls.push(p);
      return true;
    },
  };
  const h = new CombatHaptics(port, () => settings);
  return {
    h,
    calls,
    settings,
    port,
    active: (v: boolean) => {
      active = v;
    },
    flush: () => vi.advanceTimersByTime(33),
  };
}
afterEach(() => vi.useRealTimers());
describe("champion health atmosphere", () => {
  for (const [hp, mood] of [
    [100, "normal"],
    [50, "alert"],
    [25, "critical"],
    [10, "extreme"],
    [1, "extreme"],
    [0, "normal"],
  ] as const)
    it(`HP ${hp}%`, () => expect(healthMood(hp, 100)).toBe(mood));
  it("heals continuously and tolerates invalid max HP", () => {
    expect(healthSeverity(10, 100)).toBeGreaterThan(healthSeverity(25, 100));
    expect(healthSeverity(51, 100)).toBe(0);
    expect(healthMood(1, 0)).toBe("normal");
    expect(healthMood(NaN, 100)).toBe("normal");
  });
});
describe("confirmed presentation haptics", () => {
  it("normal impact only when presented, never on snapshot/register", () => {
    const f = fixture(),
      e = damage();
    f.h.register([e]);
    f.flush();
    expect(f.calls).toEqual([]);
    f.h.present(e, state, "hero");
    f.flush();
    expect(f.calls).toEqual([[60]]);
  });
  it("strong impact threshold", () => {
    const f = fixture();
    f.h.present(damage("hero", 4), state, "hero");
    f.flush();
    expect(f.calls).toEqual([[120]]);
  });
  it("explicit backstab cue, not a guessed card name", () => {
    const f = fixture();
    f.h.present(
      {
        type: "BACKSTAB",
        unitId: "hero",
        sourceId: "foe",
        pos: { x: 1, y: 1 },
        bonus: 1,
      },
      state,
      "hero",
    );
    f.h.present(damage(), state, "hero");
    f.flush();
    expect(f.calls).toEqual([[80, 50, 150]]);
  });
  it("full block, no zero damage vibration without mitigation", () => {
    const f = fixture();
    f.h.present(
      { ...damage("hero", 0), rawAmount: 3, shieldAbsorbed: 3 },
      state,
      "hero",
    );
    f.flush();
    expect(f.calls).toEqual([[35]]);
  });
  it("zero damage without block is silent", () => {
    const f = fixture();
    f.h.present(damage("hero", 0), state, "hero");
    f.flush();
    expect(f.calls).toEqual([]);
  });
  it("opponent damage is silent", () => {
    const f = fixture();
    f.h.present(damage("foe", 8), state, "hero");
    f.flush();
    expect(f.calls).toEqual([]);
  });
  it("own summon damage vibrates but never determines champion health", () => {
    const f = fixture();
    f.h.present(damage("pet", 1), state, "hero");
    f.flush();
    expect(f.calls).toEqual([[60]]);
    expect(healthMood(20, 20)).toBe("normal");
  });
  for (const [id, kind] of [
    ["pet", "death"],
    ["hero", "defeat"],
  ] as const)
    it(`${kind} priority`, () => {
      const f = fixture();
      f.h.present(damage(), state, "hero");
      f.h.present(
        {
          type: "UNIT_DEFEATED",
          unitId: id,
          faction: "PLAYER",
          kind: id === "hero" ? "HERO" : "SUMMON",
          pos: { x: 1, y: 1 },
        },
        state,
        "hero",
      );
      f.flush();
      expect(f.calls).toEqual([[...HAPTIC_PATTERNS[kind]]]);
    });
  it("merges simultaneous hits into one strongest burst", () => {
    const f = fixture();
    for (let n = 1; n <= 8; n++) f.h.present(damage("hero", n), state, "hero");
    f.flush();
    expect(f.calls).toEqual([[120]]);
  });
  it("deduplicates event references", () => {
    const f = fixture(),
      e = damage();
    f.h.present(e, state, "hero");
    f.flush();
    vi.advanceTimersByTime(500);
    f.h.present(e, state, "hero");
    f.flush();
    expect(f.calls).toHaveLength(1);
  });
  it("does not stack normal hits inside cooldown", () => {
    const f = fixture();
    f.h.present(damage(), state, "hero");
    f.flush();
    f.h.present(damage(), state, "hero");
    f.flush();
    expect(f.calls).toHaveLength(1);
  });
  it("preferences off and unsupported browser are silent", () => {
    const f = fixture();
    f.settings.vibration = false;
    f.h.present(damage(), state, "hero");
    f.flush();
    f.settings.vibration = true;
    f.active(false);
    f.h.present(damage(), state, "hero");
    f.flush();
    expect(f.calls).toEqual([]);
  });
  it("visibility/focus loss suppresses registered old impacts", () => {
    const f = fixture(),
      e = damage();
    f.h.register([e]);
    f.active(false);
    f.h.cancel();
    f.active(true);
    f.h.present(e, state, "hero");
    f.flush();
    expect(f.calls).toEqual([]);
  });
  it("hidden batch remains silent after returning", () => {
    const f = fixture(),
      e = damage();
    f.active(false);
    f.h.register([e]);
    f.active(true);
    f.h.present(e, state, "hero");
    f.flush();
    expect(f.calls).toEqual([]);
  });
  it("destroy clears pending timers and is silent afterwards", () => {
    const f = fixture();
    f.h.present(damage(), state, "hero");
    f.h.destroy();
    f.flush();
    f.h.present(damage(), state, "hero");
    f.flush();
    expect(f.calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reduced motion uses a brief single pulse", () =>
    expect(vibrationPattern("defeat", { ...DEFAULT_IMMERSION }, true)).toEqual([
      35,
    ]));
  it("intensity scales duration only", () => {
    expect(
      vibrationPattern("normal", { ...DEFAULT_IMMERSION, intensity: "soft" }),
    ).toEqual([33]);
    expect(
      vibrationPattern("normal", { ...DEFAULT_IMMERSION, intensity: "strong" }),
    ).toEqual([75]);
  });
  it("defaults and malformed preferences are safe", () => {
    expect(normalizeImmersion(null)).toEqual(DEFAULT_IMMERSION);
    expect(
      normalizeImmersion({ vibration: "true", intensity: "turbo" }).vibration,
    ).toBe(false);
  });
  it("reconnect snapshots are already gated by fresh revision in PvP", () => {
    const s = readFileSync("src/presentation/pvp/PvpScreen.tsx", "utf8");
    expect(s).toContain("if (fresh && next.events.length)");
  });
});


describe('browser compatibility',()=>{it('missing vibration API fails quietly',()=>{vi.stubGlobal('navigator',{});expect(browserHapticPort().allowed()).toBe(false);vi.unstubAllGlobals();});});
