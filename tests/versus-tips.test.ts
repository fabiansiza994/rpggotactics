import { describe, it, expect } from "vitest";
import {
  chooseVersusTip,
  versusTips,
} from "../src/presentation/pvp/versusTips";
import { PVP_MAPS, mapScenario } from "../src/game/pvp/maps";
import { DEFAULT_CONTENT } from "../src/game";
import type { LobbyRoom } from "../src/presentation/pvp/PvpLobby";
const room = (
  own = "mage",
  rival = "summoner",
  mapId = "classic",
): LobbyRoom => ({
  code: "QA",
  mapId,
  mode: "DUEL",
  seat: 0,
  members: [
    { name: "A", heroId: own, connected: true, ready: false },
    { name: "B", heroId: rival, connected: true, ready: false },
  ],
});
describe("verified VS advice", () => {
  it("prioritizes actual arena symbols and alternates them", () => {
    const r = room("mage", "mage", "shattered_sanctum");
    expect(versusTips(r).map((t) => t.id)).toEqual(["hazard", "arcane"]);
    expect(chooseVersusTip(r, "hazard", () => 0).id).toBe("arcane");
    const scenario = mapScenario(
      PVP_MAPS.find((m) => m.id === r.mapId)!,
      "DUEL",
    );
    expect(scenario.legend.H?.terrain).toBe("HAZARD");
    expect(scenario.legend.A?.terrain).toBe("ARCANE");
    expect(DEFAULT_CONTENT.terrain.HAZARD.endTurnDamage).toBe(1);
    expect(DEFAULT_CONTENT.terrain.ARCANE.startEnergyBonus).toBe(1);
  });
  for (const hero of ["mage", "summoner", "shapeshifter"])
    it(`uses local ${hero} and opponent context`, () => {
      const a = versusTips(room(hero, "mage")).map((t) => t.id);
      expect(a).toContain(hero === "shapeshifter" ? "forms" : hero);
      expect(
        versusTips(room("mage", "shapeshifter")).map((t) => t.id),
      ).toContain("counter");
    });
  it("does not claim backstab bonus in PvP or show absent symbols", () => {
    const t = versusTips(room());
    expect(t.find((t) => t.id === "rear")?.text).toContain("no concede");
    expect(t.some((t) => ["hazard", "arcane"].includes(t.id))).toBe(false);
  });
  it("varies eligible tips without immediate repetition and accepts unknown arena safely", () => {
    const r = room("mage", "mage", "unknown");
    const first = chooseVersusTip(r, undefined, () => 0);
    expect(chooseVersusTip(r, first.id, () => 0).id).not.toBe(first.id);
    expect(chooseVersusTip(r, undefined, () => 0.99).id).not.toBe(first.id);
  });
  it("supports reversed seats, public mode and terrain-specific tips", () => {
    const r = room("mage", "summoner", "broken_bridge");
    r.seat = 1;
    r.mode = "DOMINION";
    const ids = versusTips(r).map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining(["summoner", "cover", "void", "dominion"]),
    );
    expect(ids).not.toContain("mage");
  });
});
