import { it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_CONTENT, fallbackDiscardUid } from "../src/game";
import { withShapeshifterRelease } from "../src/game/data/shapeshifter-release";
import { starterDeck } from "../src/game/collection/profile";
import { createDuel, applyDuel } from "../src/game/pvp/duel";
import { planBot, botObservation } from "../src/game/ai/ranked-bot";
import { botIdentity, botTurnBudget } from "../src/game/ai/ranked-bot-policy";
it.runIf(process.env.RANKED_FROZEN_CALIBRATION === "1")(
  "compares baseline/advanced and Diamond/Elite+ using deployed frozen-timer semantics and bounded work",
  () => {
    const content = withShapeshifterRelease(DEFAULT_CONTENT),
      rows = [];
    mkdirSync("qa/ranked-bots-local", { recursive: true });
    for (const heroId of ["mage", "summoner", "shapeshifter"] as const)
      for (const seed of [17, 37, 59, 83])
        for (const [low, high] of [
          [0, 6],
          [5, 6],
        ])
          for (const highSeat of [0, 1]) {
            const load = {
              heroId,
              cards: starterDeck(content.heroes[heroId]!),
            };
            let s = createDuel(
                [load, load],
                seed,
                "DUEL",
                "classic",
                content,
                true,
              ),
              commands = 0,
              lastTurn = -1,
              nodes = 0,
              actions = 0;
            const bots = [0, 1].map((seat) => ({
              ...botIdentity("frozen", 0, seed, 0),
              heroId,
              level: seat === highSeat ? high! : low!,
            }));
            while (!s.outcome && s.round <= 30 && commands < 400) {
              const seat = s.duel!.active;
              if (lastTurn !== s.duel!.turns) {
                nodes = 0;
                actions = 0;
                lastTurn = s.duel!.turns;
              }
              const cap = botTurnBudget(bots[seat]!.level),
                end = {
                  type: "END_TURN" as const,
                  discardUid: fallbackDiscardUid(s) ?? undefined,
                };
              const p =
                actions >= 63 || nodes >= cap.nodes
                  ? { command: end, nodes: 0 }
                  : planBot(
                      botObservation(s, seat, content),
                      content,
                      { ...bots[seat]!, seed: seed + commands * 113 },
                      { clock: () => 0, maxNodes: cap.nodes - nodes },
                    );
              nodes += p.nodes;
              actions++;
              expect(nodes).toBeLessThanOrEqual(cap.nodes);
              s = applyDuel(s, p.command, content).state;
              commands++;
            }
            rows.push({
              heroId,
              seed,
              low,
              high,
              highSeat,
              commands,
              rounds: s.round,
              outcome: s.outcome
                ? s.units.some((u) => u.id === s.duel!.champions[highSeat])
                  ? "HIGH_WIN"
                  : "LOW_WIN"
                : "CENSORED",
            });
            writeFileSync(
              "qa/ranked-bots-local/frozen-calibration.json",
              JSON.stringify(
                {
                  complete: rows.length === 48,
                  protocol:
                    "Identical starter deck/champion/combat seed; seats swapped; no synchronous timer advancement, node/action caps match Worker;30 rounds/400 commands censoring.",
                  rows,
                },
                null,
                2,
              ),
            );
          }
    expect(rows).toHaveLength(48);
  },
  1800000,
);
