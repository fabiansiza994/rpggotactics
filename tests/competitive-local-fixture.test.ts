import { it, expect } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { memoryD1, addAccount } from "./support/d1";
import { competitiveFixture } from "./support/competitive-profile";
import { createPlayer } from "../server/src/repo";
import { handle } from "../server/src/index";
import type { Env } from "../server/src/db";
it("local-only authenticated QA fixtures and normal API deck format validation", async () => {
  const db = memoryD1({ legacyProfiles: true });
  for (const file of [
    "0004_pvp.sql",
    "0005_pvp_dominion.sql",
    "0006_pvp_maps.sql",
    "0010_pvp_room_started.sql",
    "0019_tactics_pvp_history.sql",
    "0030_tactics_ranked_bots.sql",
  ])
    db.sql.exec(
      readFileSync(
        new URL("../server/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  const env = {
    DB: db,
    FREE_CATALOG_ENABLED: "1",
    TACTICAL_CARDS_ENABLED: "1",
    ARSENAL_CARDS_ENABLED: "1",
    SHAPESHIFTER_ENABLED: "1",
    WARRIOR_ENABLED: "1",
    STORE_SHOWCASE_ENABLED: "1",
  } as Env;
  for (const name of ["competitive_local_a", "competitive_local_b"]) {
    const acc = addAccount(db, name),
      { profile, cards } = competitiveFixture();
    await createPlayer(db, acc.id, name, profile, [], {
      source: "STARTER",
      importedAt: null,
      now: Date.now(),
    });
    for (const size of [39, 40, 41]) {
      const list = structuredClone(cards);
      list[0]!.count += size - 40;
      const r = await handle(
        new Request("http://local/api/tactics/decks/mage/competitive", {
          method: "PUT",
          headers: {
            Authorization: "Bearer " + acc.token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ cards: list, format: "COMPETITIVE" }),
        }),
        env,
      );
      expect(r.status, await r.clone().text()).toBe(size === 40 ? 200 : 422);
    }
  }
  const quote = (v: unknown) =>
    v === null
      ? "NULL"
      : typeof v === "number"
        ? String(v)
        : "'" + String(v).replaceAll("'", "''") + "'";
  const schema = db.sql
    .prepare(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type='table'",
    )
    .all()
    .map((r) => r.sql + ";")
    .join("\n");
  const tables = db.sql
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  let sql = "PRAGMA foreign_keys=OFF;\n" + schema + "\n";
  for (const t of tables) {
    const name = String(t.name);
    for (const row of db.sql.prepare("SELECT * FROM " + name).all())
      sql +=
        "INSERT INTO " +
        name +
        " (" +
        Object.keys(row).join(",") +
        ") VALUES (" +
        Object.values(row).map(quote).join(",") +
        ");\n";
  }
  sql += db.sql
    .prepare(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type='index' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((r) => r.sql + ";")
    .join("\n");
  if(process.env.BUILD_LOCAL_FIXTURE==='1'){writeFileSync("qa/competitive-zones/local/fixture.sql", sql);writeFileSync("qa/competitive-zones/local/objects.sql",db.sql.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('view','trigger')").all().map(r=>r.sql+";").join("\n"));}
});
