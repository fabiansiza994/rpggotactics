import { it, expect } from "vitest";
import { memoryD1, addAccount } from "./support/d1";
import { botSettlementStatements, botResult } from "../server/src/rankedBots";
import {
  BOT_POLICY,
  botIdentity,
  type BotOutcome,
} from "../src/game/ai/ranked-bot-policy";
it.each<[BotOutcome, boolean, number, number]>([
  ["WIN", true, 10, 22],
  ["LOSS", true, -6, 15],
  ["ABANDON", true, -10, 0],
  ["DRAW", true, 0, 0],
  ["SERVER_ERROR", false, 0, 0],
  ["WIN", false, 0, 0],
  ["LOSS", false, -6, 0],
])(
  "authoritative SQL settlement %s valid=%s",
  async (outcome, valid, delta, xp) => {
    const db = memoryD1({ bots: true }),
      a = addAccount(db, "settlement-qa"),
      bot = botIdentity("s", 300, 7),
      now = Date.UTC(2026, 10, 14);
    db.sql
      .prepare(
        "INSERT INTO tactics_ranked_players(user_id,season_id,rp,updated_at) VALUES(?,'preseason_0',320,0)",
      )
      .run(a.id);
    db.sql
      .prepare(
        "INSERT INTO tactics_ranked_bot_encounters VALUES(?,?,?,?,?,?,?,NULL)",
      )
      .run(
        "s",
        a.id,
        "s",
        JSON.stringify(bot),
        JSON.stringify(BOT_POLICY),
        "mage",
        now,
      );
    const finish = {
      matchId: "s",
      userId: a.id,
      heroId: "mage",
      bot,
      outcome,
      now,
      valid,
      policy: BOT_POLICY,
    };
    await db.batch(botSettlementStatements(db, finish));
    await db.batch(botSettlementStatements(db, finish));
    expect(await botResult(db, "s")).toMatchObject({
      outcome,
      rpBefore: 320,
      rpAfter: 320 + delta,
      rpDelta: delta,
      xp,
    });
    expect(
      db.sql
        .prepare("SELECT rp FROM tactics_ranked_players WHERE user_id=?")
        .get(a.id)?.rp,
    ).toBe(320 + delta);
    expect(
      db.sql.prepare("SELECT COUNT(*) AS n FROM tactics_ranked_results").get()
        ?.n,
    ).toBe(0);
    db.sql.close();
  },
);
