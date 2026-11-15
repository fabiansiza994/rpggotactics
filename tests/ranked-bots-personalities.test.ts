import { it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { PVP_CONTENT } from "../server/src/pvp";
import { rankedBotCatalog } from "../server/src/rankedBotCatalog";
import { botDeck } from "../src/game/ai/ranked-bot-deck";
import {
  botIdentity,
  BOT_PERSONALITIES,
} from "../src/game/ai/ranked-bot-policy";
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
it("records all six personalities against one fixed balanced champion with deterministic seeds", () => {
  const reports = [];
  for (const personality of BOT_PERSONALITIES) {
    const bot = {
      ...botIdentity("personality", 600, 0x9e3779b9),
      heroId: "summoner" as const,
      personality,
      level: 2,
    };
    const other = {
      ...botIdentity("fixed", 600, 0x31415926),
      heroId: "summoner" as const,
      personality: "BALANCED" as const,
      level: 2,
    };
    const a = botDeck(content, bot),
      b = botDeck(content, other);
    let state = createDuel(
      [
        { heroId: "summoner", cards: a },
        { heroId: "summoner", cards: b },
      ],
      29,
      "DUEL",
      "classic",
      content,
      true,
    );
    const trace = [];
    let cards = 0,
      moves = 0,
      turns = 0;
    const start = performance.now();
    while (!state.outcome && state.round <= 20 && trace.length < 240) {
      const seat = state.duel!.active,
        actor = seat === 0 ? bot : other;
      const plan = planBot(
        botObservation(state, seat, content),
        content,
        { ...actor, seed: (actor.seed + trace.length * 113) >>> 0 },
        { clock: () => 0, maxNodes: 100 },
      );
      if (seat === 0) {
        if (plan.command.type === "PLAY_CARD") cards++;
        if (plan.command.type === "MOVE_UNIT") moves++;
        if (plan.command.type === "END_TURN") turns++;
      }
      trace.push({ seat, command: plan.command });
      state = applyDuel(state, plan.command, content).state;
    }
    reports.push({
      personality,
      deck: a,
      rounds: state.round,
      completed: !!state.outcome,
      winnerSeat: state.outcome
        ? state.units.some((u) => u.id === state.duel!.champions[0])
          ? 0
          : 1
        : null,
      cards,
      moves,
      turns,
      wallMs: performance.now() - start,
      trace,
    });
  }
  expect(
    new Set(reports.map((r) => JSON.stringify(r.deck))).size,
  ).toBeGreaterThan(1);
  expect(
    new Set(reports.map((r) => JSON.stringify(r.trace))).size,
  ).toBeGreaterThan(1);
  mkdirSync("qa/ranked-bots-local", { recursive: true });
  writeFileSync(
    "qa/ranked-bots-local/personalities.json",
    JSON.stringify(
      {
        calibrated: false,
        controlled:
          "Same champion, map, combat seed, balanced opponent and decision node cap. Decks vary by personality as intended; not an isolated evaluator-weights experiment.",
        reports,
      },
      null,
      2,
    ),
  );
}, 120000);
