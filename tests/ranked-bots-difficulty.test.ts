import { describe, it, expect } from "vitest";
import {
  botDifficulty,
  botIdentity,
  botReward,
  BOT_LEVELS,
  botTurnBudget,
} from "../src/game/ai/ranked-bot-policy";
import { rankFor } from "../src/game/ranked/ranked";
import { makeBot } from "../server/src/rankedBots";
import type { Env } from "../server/src/db";

describe("variable 2+1 difficulty", () => {
  it.each([0, 1, 2, 3, 4, 5])(
    "mixes about 2/3 base and 1/3 higher at tier %i without a three-match cycle",
    (tier) => {
      const choices = Array.from({ length: 30000 }, (_, seed) =>
        botDifficulty(tier * 300, seed),
      );
      const higher = choices.filter((d) => d.promoted).length / choices.length;
      expect(higher).toBeGreaterThan(0.32);
      expect(higher).toBeLessThan(0.35);
      expect(
        choices.every((d) => d.level === tier || d.level === tier + 1),
      ).toBe(true);
      expect(
        choices.some(
          (d, i) =>
            i > 2 &&
            d.promoted &&
            choices[i - 1]!.promoted &&
            choices[i - 2]!.promoted,
        ),
      ).toBe(true);
      expect(
        choices.some(
          (d, i) =>
            i > 2 &&
            !d.promoted &&
            !choices[i - 1]!.promoted &&
            !choices[i - 2]!.promoted,
        ),
      ).toBe(true);
    },
  );
  it("reproduces selection, stores its configuration and keeps champion/name independent of the mix", () => {
    for (let seed = 0; seed < 1000; seed++) {
      const a = botIdentity("same", 650, seed, 0);
      const b = botIdentity("same", 650, seed, 10000);
      expect(botIdentity("same", 650, seed, 0)).toEqual(a);
      expect(botIdentity("same", 650, a.seed, 0)).toEqual(a);
      expect([a.heroId, a.name, a.personality, a.seed]).toEqual([
        b.heroId,
        b.name,
        b.personality,
        b.seed,
      ]);
      expect(a.level).toBe(2);
      expect(b.level).toBe(3);
      expect(JSON.parse(JSON.stringify(b))).toEqual(b);
    }
  });
  it("honors server configuration with safe defaults and bounded probabilities", () => {
    expect(
      makeBot(1, 100, 300, 8, { RANKED_BOTS_HIGHER_LEVEL_BPS: "10000" } as Env)
        .level,
    ).toBe(2);
    expect(
      makeBot(1, 100, 300, 8, { RANKED_BOTS_HIGHER_LEVEL_BPS: "0" } as Env)
        .level,
    ).toBe(1);
    expect(botDifficulty(0, 8, NaN).higherBps).toBe(3333);
    expect(botDifficulty(0, 8, -2).higherBps).toBe(0);
    expect(botDifficulty(0, 8, 12000).higherBps).toBe(10000);
  });
  it("does not modify RP, visible player rank or settlement amounts", () => {
    const rp = 650,
      before = rankFor(rp);
    const input = {
      rp,
      outcome: "WIN" as const,
      dailyWins: 0,
      dailyPositive: 0,
      dailyXpMatches: 0,
      valid: true,
    };
    const expected = botReward(input);
    for (const chance of [0, 3333, 10000]) {
      botIdentity("test", rp, 19, chance);
      expect(rankFor(rp)).toEqual(before);
      expect(botReward(input)).toEqual(expected);
    }
    expect(expected.rpDelta).toBe(10);
  });
  it("Diamond Elite+ adds tactical depth without raising nodes, CPU or turn limits", () => {
    const bot = botIdentity("diamond", 1700, 42, 10000);
    expect(bot.level).toBe(6);
    const normal = BOT_LEVELS[5],
      advanced = BOT_LEVELS[6];
    expect(advanced.name).toBe("Élite+");
    expect(advanced.depth).toBeGreaterThan(normal.depth);
    expect(advanced.cpuMs).toBe(normal.cpuMs);
    expect(advanced.nodes).toBe(normal.nodes);
    expect(advanced.width).toBeLessThanOrEqual(normal.width);
  });
  it("bounds total work with a frozen clock, retaining Diamond's existing budget", () => {
    for (let level = 0; level < BOT_LEVELS.length; level++) {
      const cap = botTurnBudget(level),
        profile = BOT_LEVELS[level]!;
      expect(cap.nodes).toBeLessThanOrEqual(
        Math.ceil((profile.nodes * 250) / profile.cpuMs),
      );
      expect(cap.maxActions).toBe(64);
      expect(cap.wallMs).toBe(250);
    }
    expect(botTurnBudget(6)).toEqual(botTurnBudget(5));
  });
});
