import { it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { PVP_CONTENT } from "../server/src/pvp";
import { rankedBotCatalog } from "../server/src/rankedBotCatalog";
import { botDeck } from "../src/game/ai/ranked-bot-deck";
import { botIdentity } from "../src/game/ai/ranked-bot-policy";
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
function interval(wins: number, n: number) {
  const z = 1.96,
    p = wins / n,
    d = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [center - half, center + half];
}
it.runIf(process.env.RANKED_BOT_CALIBRATION === "1")(
  "measures paired base/higher encounter outcomes without forcing wins or changing combat probabilities",
  () => {
    const trials = 30;
    const games: Array<Record<string, unknown>> = [];
    const summaries: Array<Record<string, unknown>> = [];
    mkdirSync("qa/ranked-bots-local", { recursive: true });
    const save = () =>
      writeFileSync(
        "qa/ranked-bots-local/difficulty-calibration.json",
        JSON.stringify(
          {
            design:
              "30 paired seeds per rank, same champions/combat seed and baseline opponent; balanced seat assignment. Production planner time fuse and limits enabled. 360 games total.",
            limitation:
              "Bot baseline, not human rank equivalence. Classic map only. Wall-clock cutoffs can change a final considered node; no result is forced. Censored games count separately, never as draws or losses.",
            complete: games.length === 360,
            games,
            summaries,
          },
          null,
          2,
        ),
      );
    for (let tier = 0; tier < 6; tier++) {
      for (let trial = 0; trial < trials; trial++) {
        const seed = (0x31415926 + tier * 997 + trial * 7919) >>> 0;
        const base = botIdentity("encounter", tier * 300, seed, 0);
        const baseline = botIdentity(
          "baseline",
          tier * 300,
          seed ^ 0x9653a17b,
          0,
        );
        const testedSeat = trial % 2;
        for (const higherBps of [0, 10000]) {
          const tested = botIdentity("encounter", tier * 300, seed, higherBps);
          expect(tested.heroId).toBe(base.heroId);
          const bots =
            testedSeat === 0 ? [tested, baseline] : [baseline, tested];
          const loadouts = bots.map((bot) => ({
            heroId: bot.heroId,
            cards: botDeck(content, bot),
          })) as Parameters<typeof createDuel>[0];
          let state = createDuel(
            loadouts,
            seed ^ 0x45984521,
            "DUEL",
            "classic",
            content,
            true,
          );
          let commands = 0,
            turnCommands = 0,
            lastTurn = -1;
          const start = performance.now();
          while (!state.outcome && state.round <= 40 && commands < 500) {
            const seat = state.duel!.active;
            if (lastTurn !== state.duel!.turns) {
              turnCommands = 0;
              lastTurn = state.duel!.turns;
            }
            const planned = planBot(
              botObservation(state, seat, content),
              content,
              {
                ...bots[seat]!,
                seed: (bots[seat]!.seed + commands * 113) >>> 0,
              },
            );
            const command =
              ++turnCommands >= 64
                ? { type: "END_TURN" as const }
                : planned.command;
            state = applyDuel(state, command, content).state;
            commands++;
          }
          const winner = state.outcome
            ? state.units.some(
                (u) => u.id === state.duel!.champions[testedSeat],
              )
              ? "WIN"
              : "LOSS"
            : "CENSORED";
          games.push({
            tier,
            trial,
            seed,
            testedSeat,
            heroes: bots.map((b) => b.heroId),
            levels: bots.map((b) => b.level),
            higher: higherBps > 0,
            result: winner,
            rounds: state.round,
            commands,
            wallMs: performance.now() - start,
          });
        }
        save();
      }
      for (const higher of [false, true]) {
        const rows = games.filter(
          (g) => g.tier === tier && g.higher === higher,
        );
        const wins = rows.filter((g) => g.result === "WIN").length;
        const losses = rows.filter((g) => g.result === "LOSS").length;
        summaries.push({
          tier,
          higher,
          n: rows.length,
          wins,
          losses,
          censored: rows.length - wins - losses,
          winRateAll: wins / rows.length,
          lossRateAll: losses / rows.length,
          winWilson95: interval(wins, rows.length),
        });
      }
      save();
    }
    expect(games).toHaveLength(360);
  },
  1800000,
);
