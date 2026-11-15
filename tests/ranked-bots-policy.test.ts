import { describe, it, expect } from "vitest";
import {
  BOT_POLICY,
  botReward,
  botIdentity,
} from "../src/game/ai/ranked-bot-policy";
import { botSettlementStatements, botResult } from "../server/src/rankedBots";
import { memoryD1, addAccount } from "./support/d1";
const reward = (
  rp: number,
  outcome: "WIN" | "LOSS" | "ABANDON" | "DRAW" = "WIN",
  extra = {},
) =>
  botReward({
    rp,
    outcome,
    dailyWins: 0,
    dailyPositive: 0,
    dailyXpMatches: 0,
    valid: true,
    ...extra,
  });
describe("ranked bots reward policy", () => {
  it.each([
    0, 95, 99, 100, 195, 199, 200, 289, 290, 295, 299, 300, 599, 600, 899, 900,
    1199, 1200, 1499, 1500, 1699, 1700,
  ])("respects divisions and tier boundaries at %i", (rp) => {
    const r = reward(rp);
    expect(r.rpDelta).toBe(
      Math.min(10, rp < 1500 ? Math.ceil((rp + 1) / 300) * 300 - 1 - rp : 10),
    );
    expect(r.xp).toBe(22);
  });
  it("caps daily positive and wins independent of identity", () => {
    expect(reward(30, "WIN", { dailyWins: 3 }).rpDelta).toBe(0);
    expect(reward(30, "WIN", { dailyPositive: 28 }).rpDelta).toBe(2);
    expect(reward(30, "WIN", { dailyPositive: 30 }).rpDelta).toBe(0);
  });
  it("handles losses and no negative RP", () => {
    expect(reward(20, "LOSS").rpDelta).toBe(-6);
    expect(reward(20, "ABANDON").rpDelta).toBe(-10);
    expect(reward(3, "ABANDON").rpDelta).toBe(-3);
    expect(reward(30, "DRAW").xp).toBe(0);
    expect(reward(30, "WIN", { valid: false }).rpDelta).toBe(0);
    expect(reward(30, "WIN", { dailyXpMatches: 6 }).xp).toBe(0);
  });
  it("stable curated identities cover champions and all six levels", () => {
    for (let tier = 0; tier < 6; tier++) {
      const b = botIdentity("encounter", tier * 300, 581, 0);
      expect(b.level).toBe(tier);
      expect(b.name).toContain("IA");
      expect(botIdentity("encounter", tier * 300, 581, 0)).toEqual(b);
    }
    expect(
      new Set([1, 49, 97].map((seed) => botIdentity("x", 0, seed).heroId)).size,
    ).toBe(3);
  });
  it("settles once with SQLite triggers, keeps human record untouched and grants mastery once", async () => {
    const db = memoryD1({ bots: true });
    const a = addAccount(db, "bot-test");
    db.sql
      .prepare(
        "INSERT INTO tactics_ranked_players(user_id,season_id,rp,updated_at) VALUES(?,'preseason_0',295,0)",
      )
      .run(a.id);
    const bot = botIdentity("bot", 295, 1);
    const now = Date.UTC(2026, 10, 14);
    async function settle(id: string) {
      db.sql
        .prepare(
          "INSERT INTO tactics_ranked_bot_encounters VALUES(?,?,?,?,?,?,?,NULL)",
        )
        .run(
          id,
          a.id,
          id,
          JSON.stringify(bot),
          JSON.stringify(BOT_POLICY),
          "mage",
          now,
        );
      const m = {
        matchId: id,
        userId: a.id,
        heroId: "mage",
        bot,
        outcome: "WIN" as const,
        now,
        valid: true,
        policy: BOT_POLICY,
      };
      await db.batch(botSettlementStatements(db, m));
      await db.batch(botSettlementStatements(db, m));
      return botResult(db, id);
    }
    expect(await settle("one")).toMatchObject({
      rpBefore: 295,
      rpAfter: 299,
      rpDelta: 4,
      xp: 22,
    });
    expect(await settle("two")).toMatchObject({
      rpBefore: 299,
      rpAfter: 299,
      rpDelta: 0,
    });
    expect(
      db.sql.prepare("SELECT COUNT(*) AS n FROM tactics_ranked_results").get()
        ?.n,
    ).toBe(0);
    expect(
      db.sql.prepare("SELECT COUNT(*) AS n FROM tactics_mastery_ledger").get()
        ?.n,
    ).toBe(2);
    expect(
      db.sql
        .prepare("SELECT rp FROM tactics_ranked_players WHERE user_id=?")
        .get(a.id)?.rp,
    ).toBe(299);
    db.sql.close();
  });
  it("enforces three positive wins, 30 RP and six XP grants across bot names and champions, then resets UTC day", async () => {
    const db = memoryD1({ bots: true }),
      a = addAccount(db, "daily-bot");
    const now = Date.UTC(2026, 10, 14, 23, 59);
    const deltas: number[] = [],
      xp: number[] = [];
    for (let i = 0; i < 8; i++) {
      const id = "daily-" + i,
        bot = botIdentity(id, 0, i * 417);
      db.sql
        .prepare(
          "INSERT INTO tactics_ranked_bot_encounters VALUES(?,?,?,?,?,?,?,NULL)",
        )
        .run(
          id,
          a.id,
          id,
          JSON.stringify(bot),
          JSON.stringify(BOT_POLICY),
          i % 2 ? "mage" : "summoner",
          now,
        );
      const m = {
        matchId: id,
        userId: a.id,
        heroId: i % 2 ? "mage" : "summoner",
        bot,
        outcome: "WIN" as const,
        now: now + i,
        valid: true,
        policy: BOT_POLICY,
      };
      await Promise.all([
        db.batch(botSettlementStatements(db, m)),
        db.batch(botSettlementStatements(db, m)),
      ]);
      const r = (await botResult(db, id))!;
      deltas.push(r.rpDelta);
      xp.push(r.xp);
    }
    expect(deltas).toEqual([10, 10, 10, 0, 0, 0, 0, 0]);
    expect(xp.reduce((a, b) => a + b, 0)).toBe(22 * 6);
    const id = "next-day",
      bot = botIdentity(id, 0, 9);
    db.sql
      .prepare(
        "INSERT INTO tactics_ranked_bot_encounters VALUES(?,?,?,?,?,?,?,NULL)",
      )
      .run(
        id,
        a.id,
        id,
        JSON.stringify(bot),
        JSON.stringify(BOT_POLICY),
        "mage",
        now + 120000,
      );
    await db.batch(
      botSettlementStatements(db, {
        matchId: id,
        userId: a.id,
        heroId: "mage",
        bot,
        outcome: "WIN",
        now: now + 120000,
        valid: true,
        policy: BOT_POLICY,
      }),
    );
    expect((await botResult(db, id))?.rpDelta).toBe(10);
    db.sql.close();
  });
  it("excludes AI RP from competitive peak and grants no human result on server errors", async () => {
    const db = memoryD1({ bots: true }),
      a = addAccount(db, "peak-bot");
    const now = Date.UTC(2026, 10, 14),
      bot = botIdentity("err", 0, 2);
    db.sql
      .prepare(
        "INSERT INTO tactics_ranked_bot_encounters VALUES(?,?,?,?,?,?,?,NULL)",
      )
      .run(
        "err",
        a.id,
        "err",
        JSON.stringify(bot),
        JSON.stringify(BOT_POLICY),
        "mage",
        now,
      );
    await db.batch(
      botSettlementStatements(db, {
        matchId: "err",
        userId: a.id,
        heroId: "mage",
        bot,
        outcome: "SERVER_ERROR",
        now,
        valid: false,
        policy: BOT_POLICY,
      }),
    );
    expect(await botResult(db, "err")).toMatchObject({ rpDelta: 0, xp: 0 });
    db.sql
      .prepare(
        "INSERT INTO tactics_ranked_bot_encounters VALUES(?,?,?,?,?,?,?,NULL)",
      )
      .run(
        "win",
        a.id,
        "win",
        JSON.stringify(bot),
        JSON.stringify(BOT_POLICY),
        "mage",
        now + 1,
      );
    await db.batch(
      botSettlementStatements(db, {
        matchId: "win",
        userId: a.id,
        heroId: "mage",
        bot,
        outcome: "WIN",
        now: now + 1,
        valid: true,
        policy: BOT_POLICY,
      }),
    );
    db.sql
      .prepare(
        "INSERT INTO tactics_ranked_results VALUES(?,?,?,'preseason_0','WIN',10,30,20,0,?)",
      )
      .run("human", a.id, 999, now + 2);
    expect(
      db.sql
        .prepare(
          "SELECT competitive_rp FROM tactics_ranked_competitive_results WHERE match_id=?",
        )
        .get("human")?.competitive_rp,
    ).toBe(20);
    db.sql.close();
  });
});
