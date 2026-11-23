import { competitiveFixture } from "./support/competitive-profile";
import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONTENT,
  DECK_RULES,
  heroProfile,
  validateDeck,
  ownedFor,
  type GameState,
  type GameEvent,
} from "../src/game";
import {
  createDuel,
  duelView,
  validateLoadout,
  duelEvents,
} from "../src/game/pvp/duel";
import { drawCards } from "../src/game/domain/cards/deck";
import { playCard } from "../src/game/domain/cards/play-card";
import { formatDeckSummaries } from "../src/game/collection/decks";
import { graveEntries } from "../src/presentation/battle/BattlePileZones";
const content = DEFAULT_CONTENT;
function duel() {
  const { profile } = competitiveFixture();
  const loadout = validateLoadout(profile, "mage", content, "competitive");
  return createDuel([loadout, loadout], 123);
}
function ctx(state: GameState) {
  const events: GameEvent[] = [];
  return {
    ctx: { state, content, emit: (e: GameEvent) => events.push(e) },
    events,
  };
}
describe("competitive formats leave Story unchanged", () => {
  for (const n of [39, 40, 41])
    it(`requires exactly 40, not ${n}`, () => {
      const { profile, cards } = competitiveFixture();
      const first = cards[0]!;
      if (n < 40) first.count--;
      if (n > 40) first.count++;
      heroProfile(profile, "mage", content).decks.find(
        (d) => d.id === "competitive",
      )!.cards = cards;
      if (n === 40)
        expect(() =>
          validateLoadout(profile, "mage", content, "competitive"),
        ).not.toThrow();
      else
        expect(() =>
          validateLoadout(profile, "mage", content, "competitive"),
        ).toThrow("INVALID_DECK");
    });
  it("old 30-card deck is preserved, accepted by Story and refused for PvP", () => {
    const { profile } = competitiveFixture(),
      h = heroProfile(profile, "mage", content),
      original = structuredClone(h.decks[0]!);
    expect(
      validateDeck(
        original.cards,
        "mage",
        ownedFor(profile, "mage", content),
        content,
        DECK_RULES,
      ),
    ).toEqual([]);
    expect(() => validateLoadout(profile, "mage")).toThrow("INVALID_DECK");
    expect(h.decks[0]).toEqual(original);
    expect(DECK_RULES.requiredSize).toBe(30);
    const summaries = formatDeckSummaries(profile, "mage", content, DECK_RULES);
    expect(summaries[0]).toMatchObject({
      maxCards: 30,
      storyValid: true,
      competitiveValid: false,
    });
    expect(summaries[1]).toMatchObject({
      maxCards: 40,
      storyValid: false,
      competitiveValid: true,
    });
  });
});
describe("authoritative attempted-draw defeat", () => {
  it("zero cards alone does not defeat; no HP fake damage, one terminal event only", () => {
    const s = duel(),
      { ctx: c, events } = ctx(s);
    s.player.deck = [];
    expect(s.outcome).toBeNull();
    const hp = s.units.map((u) => u.hp),
      loser = s.duel!.active;
    drawCards(c, 1);
    expect(s.outcome?.reason).toBe("DECK_OUT");
    expect(s.duel!.winner).toBe(1 - loser);
    expect(s.units.map((u) => u.hp)).toEqual(hp);
    expect(events.filter((e) => e.type === "BATTLE_LOST")).toHaveLength(1);
    drawCards(c, 2);
    expect(events.filter((e) => e.type === "BATTLE_LOST")).toHaveLength(1);
    for (const seat of [0, 1] as const)
      expect(duelView(s, seat).outcome?.result).toBe(
        seat === loser ? "LOST" : "WON",
      );
  });
  it("last valid draw succeeds; next impossible draw loses even with a nonempty discard", () => {
    const s = duel(),
      { ctx: c } = ctx(s);
    s.player.hand = [];
    s.player.deck = [{ uid: "last", cardId: "blink" }];
    s.player.discard = [
      { uid: "played", cardId: "barrier", publicDiscard: true },
    ];
    expect(drawCards(c, 1)).toBe(1);
    expect(s.outcome).toBeNull();
    drawCards(c, 1);
    expect(s.outcome?.reason).toBe("DECK_OUT");
    expect(s.player.discard).toHaveLength(1);
    expect(s.player.deckRecycles).toBe(0);
  });
  it("multi-draw stops at first unavailable card, also with a full hand", () => {
    for (const full of [false, true]) {
      const s = duel(),
        { ctx: c, events } = ctx(s);
      if (!full) s.player.hand = [];
      else
        while (s.player.hand.length < s.player.maxHandSize)
          s.player.hand.push({
            uid: "fill" + s.player.hand.length,
            cardId: "blink",
          });
      s.player.deck = [{ uid: "last", cardId: "barrier" }];
      drawCards(c, 3);
      expect(events.filter((e) => e.type === "CARD_DRAWN")).toHaveLength(1);
      expect(events.filter((e) => e.type === "BATTLE_LOST")).toHaveLength(1);
      expect(s.outcome?.reason).toBe("DECK_OUT");
    }
  });
  it("reconnect/JSON snapshot cannot reset the outcome or reshuffle", () => {
    const s = duel(),
      { ctx: c } = ctx(s);
    s.player.deck = [];
    drawCards(c, 1);
    const copy = JSON.parse(JSON.stringify(s)),
      next = ctx(copy);
    drawCards(next.ctx, 1);
    expect(next.events).toEqual([]);
    expect(copy).toEqual(s);
  });
  it("old PvP snapshots and Story keep the original recycle/fatigue semantics", () => {
    for (const oldDuel of [false, true]) {
      const s = duel();
      if (oldDuel) delete s.duel!.competitiveRules;
      else s.duel = undefined;
      s.player.deck = [];
      s.player.hand = [];
      s.player.discard = [{ uid: "recycle", cardId: "blink" }];
      const { ctx: c, events } = ctx(s);
      drawCards(c, 1);
      expect(s.outcome).toBeNull();
      expect(s.player.hand).toHaveLength(1);
      expect(events.some((e) => e.type === "DECK_RESHUFFLED")).toBe(true);
    }
  });
});
describe("discard zones and privacy", () => {
  it("publishes only revealed cards, never hand/draw order/private discards/altar", () => {
    const s = duel(),
      own = s.player.heroId;
    s.player.discard = [
      { uid: "shown", cardId: "fireball", publicDiscard: true },
      { uid: "secret", cardId: "blink" },
    ];
    s.player.banished = [{ uid: "ultra", cardId: "absolute_zero" }];
    s.player.altar = [{ uid: "piece", cardId: "rune_stone" }];
    const rival = (1 - s.duel!.active) as 0 | 1,
      v = duelView(s, rival);
    expect(v.opponentDiscard).toEqual([
      { uid: "shown", cardId: "fireball", publicDiscard: true },
    ]);
    expect(v.pileCounts.opponentDiscard).toBe(2);
    expect(v.player.deck).toEqual([]);
    expect(v.duel).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain("secret");
    expect(JSON.stringify(v)).not.toContain("piece");
    expect(JSON.stringify(v)).not.toContain("ultra");
    expect(
      duelEvents(s, rival, [
        {
          type: "CARD_DISCARDED",
          cardUid: "secret",
          cardId: "blink",
          reason: "HAND_FULL",
        },
      ]),
    ).toEqual([]);
    expect(own).toBeTruthy();
  });
  it("played regular cards go to discard; Unique Ultras are banished instead", () => {
    for (const id of ["barrier", "archmage_eruption"]) {
      const s = duel(),
        { ctx: c } = ctx(s);
      s.player.hand = [{ uid: "play", cardId: id }];
      s.player.energy = 10;
      const target = s.units.find((u) => u.id === s.player.heroId)!.pos;
      expect(playCard(c, "play", target).ok).toBe(true);
      if (id === "barrier") {
        expect(s.player.discard).toContainEqual({
          uid: "play",
          cardId: id,
          publicDiscard: true,
        });
        expect(s.player.banished ?? []).toEqual([]);
      } else {
        expect(s.player.discard.some((c) => c.uid === "play")).toBe(false);
        expect(s.player.banished).toContainEqual({ uid: "play", cardId: id });
      }
    }
  });
  it("recycled public cards become private again and groups only real zone copies", () => {
    const s = duel();
    delete s.duel!.competitiveRules;
    s.player.hand = [];
    s.player.deck = [];
    s.player.discard = [
      { uid: "a", cardId: "blink", publicDiscard: true },
      { uid: "b", cardId: "blink", publicDiscard: true },
    ];
    drawCards(ctx(s).ctx, 1);
    expect(s.player.hand[0]?.publicDiscard).toBeUndefined();
    expect(graveEntries(s.player.discard)).toEqual([]);
    expect(
      graveEntries([
        { uid: "a", cardId: "blink" },
        { uid: "b", cardId: "blink" },
        { uid: "c", cardId: "blink_ii" },
      ]),
    ).toEqual([
      { cardId: "blink", count: 2 },
      { cardId: "blink_ii", count: 1 },
    ]);
  });
});
