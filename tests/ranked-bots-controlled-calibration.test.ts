import { fallbackDiscardUid } from "../src/game";
import { it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_CONTENT } from "../src/game/data";
import { withShapeshifterRelease } from "../src/game/data/shapeshifter-release";
import { starterDeck } from "../src/game/collection/profile";
import { createDuel, applyDuel } from "../src/game/pvp/duel";
import { botObservation, planBot } from "../src/game/ai/ranked-bot";
import { planBot as before } from "./support/ranked-bot-before";
import { botIdentity, botTurnBudget } from "../src/game/ai/ranked-bot-policy";
const content = withShapeshifterRelease(DEFAULT_CONTENT);
it.runIf(process.env.RANKED_CONTROLLED_CALIBRATION === "1")(
  "compares adjacent profiles on identical champions/decks/seeds and swapped seats before/after",
  () => {
    const versions = process.env.RANKED_CONTROLLED_VERSION
      ? [process.env.RANKED_CONTROLLED_VERSION]
      : ["before", "after"];
    const rows: Array<Record<string, unknown>> = [];
    mkdirSync("qa/ranked-bots-local", { recursive: true });
    for (const version of versions)
      for (const heroId of ["mage", "summoner", "shapeshifter"] as const)
        for (const seed of [17, 37])
          for (let lower = 0; lower < 6; lower++)
            for (const higherSeat of [0, 1]) {
              const load = {
                heroId,
                cards: starterDeck(content.heroes[heroId]!),
              };
              let state = createDuel(
                  [load, load],
                  seed,
                  "DUEL",
                  "classic",
                  content,
                  true,
                ),
                commands = 0,
                turnActions = 0,
                turnNodes = 0,
                turnWallMs = 0,
                lastTurn = -1,
                unusedEnergy = 0,
                ends = 0,
                cards = 0,
                forms = 0,
                summons = 0;
              const depths: number[] = [],
                bots = [0, 1].map((seat) => ({
                  ...botIdentity("controlled", 0, seed, 0),
                  heroId,
                  level: seat === higherSeat ? lower + 1 : lower,
                }));
              const start = performance.now();
              while (!state.outcome && state.round <= 30 && commands < 400) {
                const seat = state.duel!.active;
                if (lastTurn !== state.duel!.turns) {
                  turnActions = 0;
                  turnNodes = 0;
                  turnWallMs = 0;
                  lastTurn = state.duel!.turns;
                }
                const limits = botTurnBudget(bots[seat]!.level);
                const exhausted =
                  turnActions >= limits.maxActions - 1 ||
                  turnNodes >= limits.nodes ||
                  turnWallMs >= limits.wallMs;
                const p = exhausted
                  ? {
                      command: {
                        type: "END_TURN" as const,
                        discardUid: fallbackDiscardUid(state) ?? undefined,
                      },
                      nodes: 0,
                      cpuMs: 0,
                      depths: [],
                    }
                  : (version === "before" ? before : planBot)(
                      botObservation(state, seat, content),
                      content,
                      { ...bots[seat]!, seed: (seed + commands * 113) >>> 0 },
                      {
                        maxNodes: limits.nodes - turnNodes,
                        maxCpuMs: Math.max(1, limits.wallMs - turnWallMs),
                      },
                    );
                turnNodes += p.nodes;
                turnWallMs += p.cpuMs;
                if (seat === higherSeat)
                  depths.push(p.depths.filter(Boolean).length);
                let command = p.command;
                if (++turnActions >= 64)
                  command = {
                    type: "END_TURN",
                    discardUid: fallbackDiscardUid(state) ?? undefined,
                  };
                if (command.type === "END_TURN" && seat === higherSeat) {
                  unusedEnergy += state.player.energy;
                  ends++;
                }
                if (command.type === "PLAY_CARD" && seat === higherSeat)
                  cards++;
                const applied = applyDuel(state, command, content);
                state = applied.state;
                commands++;
                forms += applied.events.filter(
                  (e) => e.type === "FORM_CHANGED",
                ).length;
                summons += applied.events.filter(
                  (e) => e.type === "UNIT_SPAWNED" && e.kind === "SUMMON",
                ).length;
              }
              const won = state.outcome
                ? state.units.some(
                    (u) => u.id === state.duel!.champions[higherSeat],
                  )
                : null;
              rows.push({
                version,
                heroId,
                seed,
                lower,
                higherSeat,
                outcome:
                  won === null ? "CENSORED" : won ? "HIGHER_WIN" : "LOWER_WIN",
                rounds: state.round,
                commands,
                cards,
                forms,
                summons,
                unusedEnergyPerTurn: ends ? unusedEnergy / ends : null,
                meanDepth: depths.reduce((a, b) => a + b, 0) / depths.length,
                wallMs: performance.now() - start,
              });
              writeFileSync(
                "qa/ranked-bots-local/controlled-calibration.json",
                JSON.stringify(
                  {
                    complete: rows.length === versions.length * 72,
                    protocol:
                      "Same starter deck/champion and combat seed; both seat assignments; same per-decision and cumulative per-turn work/time/action caps. 30 rounds/400 commands censoring. Not a human rank equivalence test.",
                    rows,
                  },
                  null,
                  2,
                ),
              );
            }
    expect(rows).toHaveLength(versions.length * 72);
  },
  1800000,
);
