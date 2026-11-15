import { DEFAULT_CONTENT, GameEngine } from "../../src/game";
import {
  createDuel,
  applyDuel,
  duelView,
  duelEvents,
} from "../../src/game/pvp/duel";
import { mapScenario, pvpMap } from "../../src/game/pvp/maps";
/** Arranged local QA hand from a legal published deck; both commands resolve through real PvP rules. */
export function summonFixture() {
  const loadouts = [
    { heroId: "mage", cards: DEFAULT_CONTENT.heroes.mage!.deck },
    { heroId: "summoner", cards: DEFAULT_CONTENT.heroes.summoner!.deck },
  ] as Parameters<typeof createDuel>[0];
  let state = createDuel(loadouts, 1);
  for (let seed = 2; state.duel!.active !== 1 && seed < 100; seed++)
    state = createDuel(loadouts, seed);
  if (state.duel!.active !== 1) throw Error("QA seed");
  state.player.hand = [
    { uid: "qa-chicken-1", cardId: "summon_chicken" },
    { uid: "qa-chicken-2", cardId: "summon_chicken" },
  ];
  const before = duelView(state, 0),
    scenario = mapScenario(pvpMap("classic", "DUEL"), "DUEL");
  const firstEngine = GameEngine.fromSnapshot(state, DEFAULT_CONTENT, scenario);
  const first = applyDuel(state, {
    type: "PLAY_CARD",
    cardUid: "qa-chicken-1",
    target: firstEngine.getValidTargets("qa-chicken-1")[0]!,
  });
  const secondEngine = GameEngine.fromSnapshot(
    first.state,
    DEFAULT_CONTENT,
    scenario,
  );
  const second = applyDuel(first.state, {
    type: "PLAY_CARD",
    cardUid: "qa-chicken-2",
    target: secondEngine.getValidTargets("qa-chicken-2")[0]!,
  });
  return {
    before,
    after: duelView(second.state, 0),
    events: duelEvents(second.state, 0, [...first.events, ...second.events]),
    scenario,
  };
}
