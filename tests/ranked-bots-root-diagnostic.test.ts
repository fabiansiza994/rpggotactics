import { it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { DEFAULT_CONTENT } from "../src/game/data";
import { withShapeshifterRelease } from "../src/game/data/shapeshifter-release";
import { starterDeck } from "../src/game/collection/profile";
import { createDuel, applyDuel } from "../src/game/pvp/duel";
import { botObservation, planBot } from "./support/ranked-bot-before";
import { botIdentity } from "../src/game/ai/ranked-bot-policy";
const content = withShapeshifterRelease(DEFAULT_CONTENT);
it("records catalog-order starvation with fixed hands and public board", () => {
  const rows = [];
  for (const hero of ["mage", "summoner", "shapeshifter"] as const)
    for (const seed of [17, 37, 59]) {
      const load = { heroId: hero, cards: starterDeck(content.heroes[hero]!) };
      const s = createDuel([load, load], seed, "DUEL", "classic", content, true);
      const own = s.units.find((u) => u.id === s.player.heroId)!,
        enemy = s.units.find((u) => u.kind === "HERO" && u.id !== own.id)!;
      own.pos = { x: 2, y: 2 };
      enemy.pos = { x: 5, y: 2 };
      for (const level of [0, 3, 5, 6]) {
        const b = {
          ...botIdentity("diagnostic", 0, seed, 0),
          heroId: hero,
          level,
        };
        const p = planBot(
          botObservation(s, s.duel!.active, content),
          content,
          b,
        );
        expect(() => applyDuel(s, p.command, content)).not.toThrow();
        rows.push({
          hero,
          seed,
          level,
          depths: p.depths,
          invalid: p.invalid,
          candidates: p.candidates,
          cutoff: p.cutoff,
          command: p.command,
        });
      }
    }
  mkdirSync("qa/ranked-bots-local", { recursive: true });
  writeFileSync(
    "qa/ranked-bots-local/root-before.json",
    JSON.stringify(rows, null, 2),
  );
});
