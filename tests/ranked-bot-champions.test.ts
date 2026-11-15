import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { PVP_CONTENT } from "../server/src/pvp";
import {
  playableBotChampions,
  selectBotChampion,
  botChampionAvatar,
  recentBotChampions,
  type BotChampion,
} from "../server/src/botChampions";
import { rankedBotCatalog } from "../server/src/rankedBotCatalog";
import { makeBot } from "../server/src/rankedBots";
import { botDeck } from "../src/game/ai/ranked-bot-deck";
import { botObservation, planBot } from "../src/game/ai/ranked-bot";
import { createDuel, applyDuel } from "../src/game/pvp/duel";
import {
  fallbackDiscardUid,
  DECK_RULES,
  copyLimit,
  validateDeck,
} from "../src/game";
import { profileAvatar } from "../src/shared/profileAvatars";
import { memoryD1, addAccount } from "./support/d1";
import type { Command } from "../src/game/engine/commands";
import type { Env } from "../server/src/db";
const env = {
  SHAPESHIFTER_ENABLED: "1",
  WARRIOR_ENABLED: "1",
  SUMMONER_RITUALS_ENABLED: "1",
  FREE_CATALOG_ENABLED: "1",
  RANKED_PRESEASON_ENABLED: "1",
} as Env;
const C = rankedBotCatalog(PVP_CONTENT, env),
  heroes = playableBotChampions(env, PVP_CONTENT);
describe("Independent authoritative bot champions", () => {
  it("uses actual released, AI-supported heroes; Warrior is independent and not yet AI-supported", () => {
    expect(PVP_CONTENT.heroes.warrior).toBeDefined();
    expect(heroes).toEqual(["mage", "summoner", "shapeshifter"]);
    expect(
      playableBotChampions(
        { ...env, SHAPESHIFTER_ENABLED: "0", SHAPESHIFTER_QA: "1" },
        PVP_CONTENT,
      ),
    ).not.toContain("shapeshifter");
  });
  it("excludes a champion whose published starter cannot form a legal bot deck", () => {
    const content = {
      ...PVP_CONTENT,
      cards: Object.fromEntries(
        Object.entries(PVP_CONTENT.cards).filter(
          ([, c]) => c.heroId !== "mage",
        ),
      ),
    };
    expect(playableBotChampions(env, content)).not.toContain("mage");
  });
  it("rejects an empty pool and accepts a one-champion pool without looping", () => {
    expect(() => selectBotChampion(1, [])).toThrow("NO_PLAYABLE");
    expect(selectBotChampion(3, ["mage"], ["mage", "mage"])).toBe("mage");
  });
  it("has broad reproducible distribution for adjacent and independently shuffled seeds", () => {
    for (const shuffled of [false, true]) {
      let seed = 7;
      const counts = { mage: 0, summoner: 0, shapeshifter: 0 };
      for (let i = 0; i < 12000; i++) {
        seed = shuffled ? (Math.imul(seed, 1664525) + 1013904223) >>> 0 : i;
        const hero = selectBotChampion(seed, heroes);
        counts[hero]++;
        expect(selectBotChampion(seed, heroes)).toBe(hero);
      }
      for (const n of Object.values(counts)) expect(n).toBeGreaterThan(3600);
      for (const n of Object.values(counts)) expect(n).toBeLessThan(4400);
    }
  });
  it("reduces repeat streaks without banning mirrors or making the next hero certain", () => {
    const counts = { mage: 0, summoner: 0, shapeshifter: 0 };
    let baseRuns = 0,
      protectedRuns = 0;
    const recent: BotChampion[] = [],
      base: BotChampion[] = [];
    for (let seed = 0; seed < 12000; seed++) {
      const h = selectBotChampion(seed, heroes, recent),
        b = selectBotChampion(seed, heroes);
      counts[h]++;
      if (recent[0] === h && recent[1] === h) protectedRuns++;
      if (base[0] === b && base[1] === b) baseRuns++;
      recent.unshift(h);
      recent.length = Math.min(2, recent.length);
      base.unshift(b);
      base.length = Math.min(2, base.length);
    }
    expect(protectedRuns).toBeLessThan(baseRuns * 0.65);
    expect(protectedRuns).toBeGreaterThan(0);
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(3500);
    const after = new Set(
      Array.from({ length: 300 }, (_, seed) =>
        selectBotChampion(seed, heroes, ["summoner", "summoner"]),
      ),
    );
    expect(after.size).toBe(3);
  });
  it("does not let player RP or account identity change champion selection for the same seed/pool", () => {
    for (let seed = 0; seed < 90; seed++) {
      const a = makeBot(1, 100, 0, seed, env, PVP_CONTENT),
        b = makeBot(99, 500, 1500, seed, env, PVP_CONTENT);
      expect(a.heroId).toBe(b.heroId);
    }
  });
  it("uses existing history with a fixed queue cutoff; future rows do not reroll selection", async () => {
    const db = memoryD1({ bots: true });
    try {
      const a = addAccount(db, "variety");
      for (const [id, time, hero] of [
        ["old-a", 10, "mage"],
        ["old-b", 20, "summoner"],
        ["old-c", 30, "summoner"],
        ["future", 60, "mage"],
      ] as const)
        db.sql
          .prepare(
            "INSERT INTO tactics_ranked_bot_encounters(match_id,user_id,room_code,bot_json,policy_json,hero_id,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            id,
            a.id,
            id,
            JSON.stringify({ heroId: hero }),
            "{}",
            "mage",
            time,
          );
      expect(await recentBotChampions(db, a.id, 50)).toEqual([
        "summoner",
        "summoner",
      ]);
      expect(await recentBotChampions(db, a.id, 50)).toEqual([
        "summoner",
        "summoner",
      ]);
    } finally {
      db.sql.close();
    }
  });
  it("assigns an existing free avatar consistently with each bot champion", () => {
    expect(new Set(heroes.map(botChampionAvatar)).size).toBe(3);
    for (const hero of heroes) {
      const id = botChampionAvatar(hero);
      expect(profileAvatar(id).id).toBe(id);
      expect(profileAvatar(id).unlockType).toBe("FREE");
    }
  });
});

it("all nine human/bot champion pairs execute legal cards and turns, not just names", () => {
  const reports = [];
  const totals = { mage: 0, summoner: 0, shapeshifter: 0 };
  for (const human of heroes)
    for (const botHero of heroes) {
      const seed = Array.from({ length: 100 }, (_, i) => i + 1).find(
        (seed) =>
          makeBot(1, 100, 600, seed, env, PVP_CONTENT).heroId === botHero,
      )!;
      const bot = makeBot(1, 100, 600, seed, env, PVP_CONTENT),
        deck = botDeck(C, bot);
      expect(
        validateDeck(
          deck,
          botHero,
          (id) => (C.cards[id] ? copyLimit(C.cards[id]!, DECK_RULES) : 0),
          C,
          DECK_RULES,
        ),
      ).toEqual([]);
      let state = createDuel(
        [
          { heroId: human, cards: C.heroes[human]!.deck },
          { heroId: botHero, cards: deck },
        ],
        seed,
        "DUEL",
        "classic",
        C,
        true,
      );
      let cards = 0,
        actions = 0,
        turnActions = 0,
        lastTurn = -1,
        spawned = 0,
        forms = 0,
        damage = 0;
      const commands: Command[] = [];
      const initial = structuredClone(state);
      while (!state.outcome && state.round <= 7 && commands.length < 140) {
        const seat = state.duel!.active;
        if (lastTurn !== state.duel!.turns) {
          lastTurn = state.duel!.turns;
          turnActions = 0;
        }
        turnActions++;
        let command: Command;
        if (seat === 1 && turnActions <= 16) {
          const p = planBot(
            botObservation(state, 1, C),
            C,
            { ...bot, seed: bot.seed + commands.length },
            { clock: () => 0, maxNodes: 100 },
          );
          expect(p.nodes).toBeLessThanOrEqual(100);
          command = p.command;
          actions++;
          if (command.type === "PLAY_CARD") {
            cards++;
            const uid = command.cardUid;
            const def =
              C.cards[state.player.hand.find((c) => c.uid === uid)!.cardId]!;
            expect(!def.heroId || def.heroId === botHero).toBe(true);
          }
        } else {
          const discard = fallbackDiscardUid(state);
          command = {
            type: "END_TURN",
            ...(discard ? { discardUid: discard } : {}),
          };
        }
        const result = applyDuel(state, command, C);
        damage += result.events.reduce(
          (n, e) => n + (e.type === "UNIT_DAMAGED" ? e.hpLost : 0),
          0,
        );
        spawned += result.events.filter(
          (e) => e.type === "UNIT_SPAWNED" && e.kind === "SUMMON",
        ).length;
        forms += result.events.filter((e) => e.type === "FORM_CHANGED").length;
        state = result.state;
        commands.push(command);
        expect(state.player.energy).toBeGreaterThanOrEqual(0);
      }
      expect(actions).toBeGreaterThan(0);
      expect(cards, `${human} vs ${botHero}`).toBeGreaterThan(0);
      if (botHero === "summoner") expect(spawned).toBeGreaterThan(0);
      if (botHero === "shapeshifter") expect(forms).toBeGreaterThan(0);
      if (botHero === "mage") expect(damage).toBeGreaterThan(0);
      totals[botHero] += cards;
      let replay = initial;
      for (const cmd of commands) replay = applyDuel(replay, cmd, C).state;
      expect(replay).toEqual(state);
      reports.push({
        human,
        bot: botHero,
        seed,
        cards,
        actions,
        spawned,
        forms,
        damage,
        round: state.round,
        commands: commands.length,
      });
    }
  expect(totals.mage).toBeGreaterThan(0);
  expect(totals.summoner).toBeGreaterThan(0);
  expect(totals.shapeshifter).toBeGreaterThan(0);
  if (process.env.BOT_VARIETY_REPORT)
    writeFileSync(
      process.env.BOT_VARIETY_REPORT,
      JSON.stringify(reports, null, 2),
    );
}, 60000);

it("records repeat protection across a reproducible sequence without a rigid rotation", () => {
  const counts = { mage: 0, summoner: 0, shapeshifter: 0 },
    recent: BotChampion[] = [];
  let triples = 0,
    unprotectedTriples = 0;
  const base: BotChampion[] = [];
  for (let seed = 0; seed < 12000; seed++) {
    const chosen = selectBotChampion(seed, heroes, recent),
      plain = selectBotChampion(seed, heroes);
    counts[chosen]++;
    if (recent[0] === chosen && recent[1] === chosen) triples++;
    if (base[0] === plain && base[1] === plain) unprotectedTriples++;
    recent.unshift(chosen);
    base.unshift(plain);
    recent.length = Math.min(2, recent.length);
    base.length = Math.min(2, base.length);
  }
  expect(triples).toBeLessThan(unprotectedTriples);
  if (process.env.BOT_VARIETY_DISTRIBUTION)
    writeFileSync(
      process.env.BOT_VARIETY_DISTRIBUTION,
      JSON.stringify(
        {
          selections: 12000,
          seeds: "adjacent 0…11999, independent champion hash domain",
          counts,
          triples,
          unprotectedTriples,
          afterTwoSameWeights: [1, 1, 0.2],
          schemaChanges: 0,
        },
        null,
        2,
      ),
    );
});
