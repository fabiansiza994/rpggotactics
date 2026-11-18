import { createProfile } from "../src/game/collection/profile";
import {
  applyDuel,
  createDuel,
  duelView,
  validateLoadout,
} from "../src/game/pvp/duel";
import { spawnSummon } from "../src/game/domain/summons/summons";
import { it, expect } from "vitest";
import { MARKET_SEARCHERS } from "../src/game/data/market-box-cards";
import { makeEngine, mutable, setHand, ctxFor } from "./helpers";
import { GameEngine, DEFAULT_CONTENT } from "../src/game";
import { withArcher } from "../src/game/data/archer";
import { summonSearchChoices } from "../src/game/domain/cards/play-card";
const content = withArcher(DEFAULT_CONTENT);
for (const def of MARKET_SEARCHERS)
  it(`${def.id}: exact deck target, once/turn and card-ID lock survives zones and reconnect`, () => {
    const e = makeEngine(
      { hero: { heroId: def.heroId!, pos: { x: 0, y: 2 } } },
      content,
    );
    const s = mutable(e);
    setHand(e, [def.id]);
    s.player.energy = 10;
    s.player.maxEnergy = 10;
    const hero = s.units.find((u) => u.id === s.player.heroId)!;
    if (def.id === "arcane_resonance") hero.hp--;
    if (def.id === "warriors_oath") hero.shield = 1;
    if (def.id === "tempest_call")
      s.player.hand.push({
        uid: "thunder-support",
        cardId: "thunder_discharge",
      });
    if (def.id === "pact_link")
      spawnSummon(ctxFor(e, []), hero, "chicken", { x: 1, y: 2 });
    const target =
      typeof def.deckSearch === "object" ? def.deckSearch.targetCardId : "";
    s.player.deck = [
      { uid: "chosen", cardId: target },
      { uid: "other-copy", cardId: target },
      { uid: "wrong", cardId: "barrier" },
    ];
    expect(
      summonSearchChoices(e.state, content, def).map((c) => c.uid),
    ).toEqual(["chosen", "other-copy"]);
    const before = structuredClone(e.state);
    expect(
      e.dispatch({
        type: "SEARCH_SUMMON",
        cardUid: `test-${def.id}-0`,
        choiceUid: "wrong",
      }).ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
    expect(
      e.dispatch({
        type: "SEARCH_SUMMON",
        cardUid: `test-${def.id}-0`,
        choiceUid: "chosen",
      }).ok,
    ).toBe(true);
    mutable(e).player.hand.push(
      { uid: "another-search", cardId: def.id },
      { uid: "zone-change", cardId: target },
    );
    expect(e.getCardPlayability("another-search").playable).toBe(false);
    expect(e.getCardPlayability("chosen").playable).toBe(false);
    expect(e.getCardPlayability("zone-change").playable).toBe(false);
    const r = GameEngine.fromSnapshot(
      JSON.parse(JSON.stringify(e.state)),
      content,
      e.scenario,
    );
    expect(r.getCardPlayability("zone-change").playable).toBe(false);
    mutable(r).player.hand = mutable(r).player.hand.filter(
      (c) => c.uid !== "another-search",
    );
    expect(r.dispatch({ type: "END_TURN" }).ok).toBe(true);
    expect(r.state.player.searchUsesThisTurn).toBeUndefined();
    expect(r.state.player.searchBlockedCardIds).toBeUndefined();
  });
for (const def of MARKET_SEARCHERS.filter(
  (c) => typeof c.deckSearch === "object" && c.deckSearch.conditions?.length,
))
  it(`${def.id}: server rejects unsatisfied thematic condition without spending`, () => {
    const e = makeEngine(
      { hero: { heroId: def.heroId!, pos: { x: 0, y: 2 } } },
      content,
    );
    const s = mutable(e);
    setHand(e, [def.id]);
    s.player.energy = 10;
    const hero = s.units.find((u) => u.id === s.player.heroId)!;
    if (def.id === "hunter_trail") {
      const enemy = s.units.find((u) => u.faction === "ENEMY" && u.hp > 0);
      if (enemy) enemy.pos = { x: 1, y: 2 };
    }
    const target =
      typeof def.deckSearch === "object" ? def.deckSearch.targetCardId : "";
    s.player.deck = [{ uid: "target", cardId: target }];
    const before = structuredClone(e.state);
    expect(
      e.dispatch({
        type: "SEARCH_SUMMON",
        cardUid: `test-${def.id}-0`,
        choiceUid: "target",
      }).ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
    expect(hero.hp).toBeGreaterThan(0);
  });

it("two PvP seats receive private candidates and reconnect keeps the authoritative target lock", () => {
  const profile = createProfile(content);
  let s = createDuel(
    [
      validateLoadout(profile, "mage", content),
      validateLoadout(profile, "mage", content),
    ],
    7,
    "DUEL",
    "classic",
    content,
  );
  const owner = s.duel!.active,
    opponent = (1 - owner) as 0 | 1;
  s.player.energy = 10;
  s.player.hand = [{ uid: "search", cardId: "winter_call" }];
  s.player.deck = [
    { uid: "world", cardId: "absolute_zero" },
    { uid: "hidden", cardId: "barrier" },
  ];
  expect(
    duelView(s, owner, content).searchChoices?.map((c) => c.cardId),
  ).toEqual(["absolute_zero"]);
  expect(duelView(s, opponent, content).searchChoices ?? []).toEqual([]);
  s = applyDuel(
    s,
    { type: "SEARCH_SUMMON", cardUid: "search", choiceUid: "world" },
    content,
  ).state;
  s = JSON.parse(JSON.stringify(s));
  expect(duelView(s, owner, content).player.searchBlockedCardIds).toEqual([
    "absolute_zero",
  ]);
  expect(
    duelView(s, opponent, content).player.searchBlockedCardIds,
  ).toBeUndefined();
  expect(() =>
    applyDuel(
      s,
      { type: "PLAY_CARD", cardUid: "world", target: null },
      content,
    ),
  ).toThrow();
  expect(
    new Set(duelView(s, owner, content).player.hand.map((c) => c.uid)).size,
  ).toBe(duelView(s, owner, content).player.hand.length);
  s = applyDuel(s, { type: "END_TURN" }, content).state;
  s = applyDuel(s, { type: "END_TURN" }, content).state;
  expect(s.player.searchBlockedCardIds).toBeUndefined();
});
