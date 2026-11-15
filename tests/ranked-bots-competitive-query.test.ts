import { it, expect } from "vitest";
import { memoryD1, addAccount } from "./support/d1";
it("timeline view equals the original conservative peak for multiple accounts, seasons and equal timestamps", () => {
  const db = memoryD1({ bots: true }),
    a = addAccount(db, "timeline-a"),
    b = addAccount(db, "timeline-b");
  for (const user of [a.id, b.id])
    for (const season of ["s1", "s2"])
      for (let i = 0; i < 30; i++) {
        const id = `${user}-${season}-${i}`,
          at = 1000 + Math.floor(i / 2) * 10,
          delta = i % 3 === 0 ? -6 : 10;
        db.sql
          .prepare(
            "INSERT INTO tactics_ranked_bot_encounters VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(id, user, id, "{}", "{}", "mage", at, at);
        db.sql
          .prepare(
            "INSERT INTO tactics_ranked_bot_results VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            user,
            season,
            delta > 0 ? "WIN" : "LOSS",
            "day",
            300,
            delta,
            300 + delta,
            0,
            1,
            at,
          );
        db.sql
          .prepare(
            "INSERT INTO tactics_ranked_results VALUES(?,?,?,?,'WIN',?, ?,10,0,?)",
          )
          .run(
            "h" + id,
            user,
            user === a.id ? b.id : a.id,
            season,
            300 + i * 7,
            310 + i * 7,
            at,
          );
      }
  const expected = db.sql
    .prepare(
      `SELECT r.*,MAX(0,r.rp_after-COALESCE((SELECT SUM(MAX(0,b.rp_delta)) FROM tactics_ranked_bot_results b WHERE b.user_id=r.user_id AND b.season_id=r.season_id AND b.finished_at<=r.finished_at),0)) AS competitive_rp FROM tactics_ranked_results r ORDER BY user_id,season_id,match_id`,
    )
    .all();
  const actual = db.sql
    .prepare(
      "SELECT * FROM tactics_ranked_competitive_results ORDER BY user_id,season_id,match_id",
    )
    .all();
  expect(actual).toEqual(expected);
  expect(
    db.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM tactics_ranked_competitive_results WHERE user_id=999",
      )
      .get()?.n,
  ).toBe(0);
  db.sql.close();
});
