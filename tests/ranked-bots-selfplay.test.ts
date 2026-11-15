import { it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { PVP_CONTENT } from "../server/src/pvp";
import { rankedBotCatalog } from "../server/src/rankedBotCatalog";
import { botDeck } from "../src/game/ai/ranked-bot-deck";
import { botObservation, planBot } from "../src/game/ai/ranked-bot";
import { botIdentity } from "../src/game/ai/ranked-bot-policy";
import { createDuel, applyDuel } from "../src/game/pvp/duel";
import type { Command } from "../src/game/engine/commands";
import type { Env } from "../server/src/db";
const content = rankedBotCatalog(PVP_CONTENT, {
  SHAPESHIFTER_ENABLED: "1",
  RANKED_PRESEASON_ENABLED: "1",
  FREE_CATALOG_ENABLED: "1",
  TACTICAL_CARDS_ENABLED: "1",
  ARSENAL_CARDS_ENABLED: "1",
  SUMMONER_RITUALS_ENABLED: "1",
  PRIMORDIAL_DRAGON_ENABLED: "1",
  STORE_SHOWCASE_ENABLED: "1",
} as Env);
it("self-play accepted commands reproduce exactly; record CPU, duration and champion usage", () => {
  const reports = [];
  const heroes = ["mage", "summoner", "shapeshifter"] as const;
  for (let pair = 0; pair < 6; pair++) {
    const bots = [
      {
        ...botIdentity("a", 0, 17 + pair),
        heroId: heroes[pair % 3]!,
        level: pair < 3 ? 0 : 5,
      },
      {
        ...botIdentity("b", 900, 91 + pair),
        heroId: heroes[(pair + 1) % 3]!,
        level: pair < 3 ? 3 : 1,
      },
    ] as const;
    const loadouts = bots.map((b) => ({
      heroId: b.heroId,
      cards: botDeck(content, b),
    })) as Parameters<typeof createDuel>[0];
    let state = createDuel(
      loadouts,
      73 + pair,
      "DUEL",
      "classic",
      content,
      true,
    );
    const initial = structuredClone(state),
      commands: Command[] = [],
      times: number[] = [],
      nodes: number[] = [];
    const formNames = new Set<string>();
    let forms = 0,
      spells = 0,
      summons = 0,
      turnActions = 0,
      lastTurn = -1;
    const start = performance.now();
    while (!state.outcome && state.round <= 24 && commands.length < 300) {
      const seat = state.duel!.active,
        bot = {
          ...bots[seat],
          seed: (bots[seat].seed + commands.length * 113) >>> 0,
        };
      const t = performance.now();
      const planned = planBot(
        botObservation(state, seat, content),
        content,
        bot,
        { clock: () => 0, maxNodes: seat === 0 ? 40 : 120 },
      );
      times.push(performance.now() - t);
      nodes.push(planned.nodes);
      if (lastTurn !== state.duel!.turns) {
        turnActions = 0;
        lastTurn = state.duel!.turns;
      }
      turnActions++;
      let command = planned.command;
      if (turnActions > 30) command = { type: "END_TURN" };
      if (command.type === "PLAY_CARD") {
        spells++;
        const card = state.player.hand.find((c) => c.uid === command.cardUid);
        if (
          card &&
          content.cards[card.cardId]!.effects.some(
            (e) => e.type === "TRANSFORM",
          )
        )
          forms++;
      }
      const applied = applyDuel(state, command, content);
      summons += applied.events.filter(
        (e) => e.type === "UNIT_SPAWNED" && e.kind === "SUMMON",
      ).length;
      for (const e of applied.events)
        if (e.type === "FORM_CHANGED" && e.to) formNames.add(e.to);
      state = applied.state;
      commands.push(command);
      expect(state.player.energy).toBeGreaterThanOrEqual(0);
    }
    let replay = initial;
    for (const command of commands)
      replay = applyDuel(replay, command, content).state;
    expect(replay).toEqual(state);
    const sorted = [...times].sort((a, b) => a - b);
    const p = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    reports.push({
      heroes: bots.map((b) => b.heroId),
      levels: bots.map((b) => b.level),
      seed: 73 + pair,
      rounds: state.round,
      outcome: state.outcome,
      commands: commands.length,
      spells,
      forms,
      formNames: [...formNames],
      summons,
      winnerSeat: state.outcome
        ? state.units.some((u) => u.id === state.duel!.champions[0])
          ? 0
          : 1
        : null,
      durationMs: performance.now() - start,
      cpu: { p50: p(0.5), p95: p(0.95), p99: p(0.99) },
      maxNodes: Math.max(...nodes),
      replayExact: true,
      trace: commands,
    });
  }
  mkdirSync("qa/ranked-bots-local", { recursive: true });
  writeFileSync(
    "qa/ranked-bots-local/selfplay.json",
    JSON.stringify(
      {
        calibrated: false,
        measurement:
          "Local process elapsed decision time; deterministic node cap, CPU fuse disabled in this test only. Not Cloudflare CPU billing.",
        reports,
      },
      null,
      2,
    ),
  );
  expect(reports.length).toBe(6);
}, 120000);
