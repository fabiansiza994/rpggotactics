import {
  OpponentNotices,
  type OpponentNotice,
} from "../src/presentation/mobile/OpponentNotices";
import { it, expect } from "vitest";
import { summonFixture } from "../qa/ranked21-ux-20261115/summonFixture";
import { compileTimeline } from "../src/presentation/vfx/spellTimeline";
import { DEFAULT_CONTENT } from "../src/game";
it("two legal PvP summons have distinct IDs, positions and separate public presentation cues", () => {
  const f = summonFixture(),
    spawns = f.events.filter((e) => e.type === "UNIT_SPAWNED");
  expect(spawns).toHaveLength(2);
  expect(new Set(spawns.map((e) => e.unitId)).size).toBe(2);
  expect(f.after.units.filter((u) => u.kind === "SUMMON")).toHaveLength(2);
  const plan = compileTimeline(
      f.events,
      (id) => DEFAULT_CONTENT.cards[id]!.presentation.visualKey,
      false,
      true,
    ),
    casts = plan.cues.filter((c) => c.kind === "cast");
  expect(casts).toHaveLength(2);
  expect(casts[1]!.at - casts[0]!.at).toBeGreaterThan(900);
  expect(f.after.player.hand.some((c) => c.cardId === "summon_chicken")).toBe(
    false,
  );
});

it("public opponent summon notices use the viewer unit faction and show the real creature name once", () => {
  const f = summonFixture();
  let rows: OpponentNotice[] = [];
  const notices = new OpponentNotices(
    (value) => {
      rows = value;
    },
    () => 0,
  );
  notices.register(
    f.events,
    f.after,
    DEFAULT_CONTENT,
    f.after.player.heroId,
    f.before,
  );
  for (const event of f.events) notices.present(event, f.after);
  expect(rows).toHaveLength(2);
  expect(
    rows.every((r) => r.text.includes("Invocador") && r.text.includes("Pollo")),
  ).toBe(true);
  const before = JSON.stringify(rows);
  for (const event of f.events) notices.present(event, f.after);
  expect(JSON.stringify(rows)).toBe(before);
  notices.destroy();
});
