import { it, expect } from "vitest";
import { handle } from "../server/src/index";
import type { Env } from "../server/src/db";
import { memoryD1, addAccount } from "./support/d1";
import { DEFAULT_CONTENT } from "../src/game";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PvpVersus } from "../src/presentation/pvp/PvpVersus";
it("persists frame changes and none while preserving the chosen avatar and frame rights", async () => {
  const db = memoryD1({ legacyProfiles: true }),
    a = addAccount(db, "frame_profile_qa"),
    env = { DB: db } as Env;
  const call = (method: string, path: string, body?: unknown) =>
    handle(
      new Request(`https://api.test/api/tactics${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${a.token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      { content: DEFAULT_CONTENT, now: () => 1800000000000, seed: () => 7 },
    );
  try {
    expect((await call("POST", "/profile", {})).status).toBe(200);
    expect(
      (await call("PUT", "/profile/avatar", { avatarId: "mystic_fox" })).status,
    ).toBe(200);
    for (const id of ["frame_arcane_gilt", "frame_pact_grove"])
      db.sql
        .prepare(
          "INSERT INTO tactics_player_cosmetics(user_id,cosmetic_id,kind,source,acquired_at) VALUES(?,?,?,?,?)",
        )
        .run(a.id, id, "PROFILE_FRAME", "TEST", 1);
    for (const id of ["frame_arcane_gilt", "frame_pact_grove", null]) {
      expect(
        (
          await call("PUT", "/cosmetics/equip", {
            slot: "PROFILE_FRAME",
            cosmeticId: id,
          })
        ).status,
      ).toBe(200);
      const cosmetics = (await (await call("GET", "/cosmetics")).json()) as {
        equipped: Record<string, string | null>;
        owned: unknown[];
      };
      expect(cosmetics.equipped.PROFILE_FRAME).toBe(id);
      expect(cosmetics.owned).toHaveLength(2);
      expect(await (await call("GET", "/profile/avatar")).json()).toMatchObject(
        { avatarId: "mystic_fox" },
      );
      const html = renderToStaticMarkup(
        createElement(PvpVersus, {
          room: {
            code: "QA",
            seat: 0,
            mode: "DUEL",
            mapId: "classic",
            members: [
              {
                name: "A",
                heroId: "mage",
                avatarId: "mystic_fox",
                frameId: id,
                ready: false,
                connected: true,
              },
              { name: "B", heroId: "summoner", ready: false, connected: true },
            ],
          },
          onFinish: () => {},
          onCancel: () => {},
        }),
      );
      expect(html).toContain("/art/profile-avatars/mystic_fox.jpg");
      if (id) expect(html).toContain(`data-frame="${id}"`);
    }
    expect(
      (
        await call("PUT", "/cosmetics/equip", {
          slot: "PROFILE_FRAME",
          cosmeticId: "frame_executioner_oath",
        })
      ).status,
    ).toBe(403);
    expect(await (await call("GET", "/cosmetics")).json()).toMatchObject({
      equipped: { PROFILE_FRAME: null },
    });
  } finally {
    db.sql.close();
  }
});
