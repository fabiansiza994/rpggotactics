import { it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { PVP_CONTENT } from "../server/src/pvp";
import { rankedBotCatalog } from "../server/src/rankedBotCatalog";
import { botDeck } from "../src/game/ai/ranked-bot-deck";
import { botIdentity, BOT_LEVELS } from "../src/game/ai/ranked-bot-policy";
import { botObservation, planBot } from "../src/game/ai/ranked-bot";
import { createDuel, applyDuel } from "../src/game/pvp/duel";
import type { Env } from "../server/src/db";
const content = rankedBotCatalog(PVP_CONTENT, {
  SHAPESHIFTER_ENABLED: "1",
  RANKED_PRESEASON_ENABLED: "1",
  FREE_CATALOG_ENABLED: "1",
  SUMMONER_RITUALS_ENABLED: "1",
  PRIMORDIAL_DRAGON_ENABLED: "1",
  ARSENAL_CARDS_ENABLED: "1",
  TACTICAL_CARDS_ENABLED: "1",
} as Env);
it("measures actual production planner limits without disabling the time fuse", () => {
  const reports = [];
  for (let level = 0; level < BOT_LEVELS.length; level++) {
    const wall: number[] = [],
      cpu: number[] = [],
      nodes: number[] = [];
    let cutoffs = 0;
    for (let sample = 0; sample < 12; sample++) {
      const heroId = (["mage", "summoner", "shapeshifter"] as const)[
          sample % 3
        ]!,
        bot = {
          ...botIdentity("budget", level * 300, 432 + sample),
          heroId,
          level,
        };
      const cards = botDeck(content, bot),
        state = createDuel(
          [
            { heroId, cards },
            { heroId, cards },
          ],
          sample + 1,
          "DUEL",
          "classic",
          content,
          true,
        );
      const before = process.cpuUsage(),
        start = performance.now();
      const plan = planBot(
        botObservation(state, state.duel!.active, content),
        content,
        bot,
      );
      wall.push(performance.now() - start);
      const usage = process.cpuUsage(before);
      cpu.push((usage.user + usage.system) / 1000);
      nodes.push(plan.nodes);
      if (plan.cutoff) cutoffs++;
      expect(plan.nodes).toBeLessThanOrEqual(BOT_LEVELS[level]!.nodes);
      expect(() => applyDuel(state, plan.command, content)).not.toThrow();
    }
    function stats(values: number[]) {
      const s = [...values].sort((a, b) => a - b);
      return {
        p50: s[Math.floor(s.length * 0.5)],
        p95: s[Math.floor(s.length * 0.95)],
        max: s.at(-1),
      };
    }
    reports.push({
      level,
      profile: BOT_LEVELS[level],
      samples: 12,
      decisionWallMs: stats(wall),
      processCpuMs: stats(cpu),
      nodes: stats(nodes),
      cutoffs,
    });
  }
  mkdirSync("qa/ranked-bots-local", { recursive: true });
  writeFileSync(
    "qa/ranked-bots-local/production-budget.json",
    JSON.stringify(
      {
        measurement:
          "Node local, 84 decisions; process CPU and elapsed time, not Cloudflare production CPU or Android FPS. Time fuse enabled.",
        reports,
      },
      null,
      2,
    ),
  );
}, 120000);
