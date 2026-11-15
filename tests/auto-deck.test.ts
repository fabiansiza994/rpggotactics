import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONTENT,
  DECK_RULES,
  createProfile,
  ownedFor,
  validateDeck,
  createDeck,
  setDefaultDeck,
  heroProfile,
  serializeProfile,
  parseProfileSave,
  updateDeck,
} from "../src/game";
import { withShapeshifterRelease } from "../src/game/data/shapeshifter-release";
import {
  generateDeck,
  DECK_STYLES,
  analyzeDeck,
} from "../src/game/collection/auto-deck";
const C = withShapeshifterRelease(DEFAULT_CONTENT);
describe("Owned intelligent auto decks", () => {
  for (const hero of ["mage", "summoner", "shapeshifter"])
    for (const style of Object.keys(
      DECK_STYLES,
    ) as (keyof typeof DECK_STYLES)[])
      it(`${hero} ${style}: owned, legal and deterministic`, () => {
        const p = createProfile(C),
          before = JSON.stringify(p),
          own = ownedFor(p, hero, C),
          a = generateDeck(C, hero, own, DECK_RULES, style, 37),
          b = generateDeck(C, hero, own, DECK_RULES, style, 37);
        expect(a).toEqual(b);
        expect(a.ok).toBe(true);
        if (!a.ok) return;
        expect(a.cards.reduce((n, e) => n + e.count, 0)).toBe(30);
        expect(validateDeck(a.cards, hero, own, C, DECK_RULES)).toEqual([]);
        expect(a.cards.every((e) => e.count <= own(e.cardId))).toBe(true);
        expect(JSON.stringify(p)).toBe(before);
        expect(
          Object.values(a.analysis.scores).every((v) => v >= 0 && v <= 100),
        ).toBe(true);
        expect(a.analysis.simulation.samples).toBe(256);
      });
  it("explains an empty/incomplete inventory without fabricating cards", () => {
    const r = generateDeck(C, "mage", () => 0, DECK_RULES, "BALANCED");
    expect(r).toMatchObject({ ok: false, available: 0, required: 30 });
  });
  it("caps extra owned copies, neutrals and Ultras using the existing validator", () => {
    const own = () => 999;
    const r = generateDeck(C, "mage", own, DECK_RULES, "COMBOS", 7);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(validateDeck(r.cards, "mage", own, C, DECK_RULES)).toEqual([]);
  });
  it("never selects QA or an unreleased experimental expansion", () => {
    const c = C.cards.magic_missile!;
    const content = {
      ...C,
      cards: {
        ...C.cards,
        qa_test: { ...c, id: "qa_test", tags: ["qa"] },
        future: { ...c, id: "future", expansion: "future" },
      },
    };
    const r = generateDeck(content, "mage", () => 99, DECK_RULES, "AGGRESSIVE");
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(
        r.cards.some((e) => ["qa_test", "future"].includes(e.cardId)),
      ).toBe(false);
  });
  it("supports configured size without changing global rules", () => {
    const rules = { ...DECK_RULES, requiredSize: 20 };
    const r = generateDeck(C, "mage", () => 99, rules, "BALANCED");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cards.reduce((n, e) => n + e.count, 0)).toBe(20);
    expect(DECK_RULES.requiredSize).toBe(30);
  });
  it("bounded simulations are reproducible, even after reload", () => {
    const p = createProfile(C),
      r = generateDeck(
        C,
        "mage",
        ownedFor(p, "mage", C),
        DECK_RULES,
        "CONTROL",
        12,
      );
    if (!r.ok) throw Error("No deck");
    const a = analyzeDeck(r.cards, C, "mage", "CONTROL", 12, 99999);
    expect(a.simulation.samples).toBe(512);
    expect(analyzeDeck(r.cards, C, "mage", "CONTROL", 12, 99999)).toEqual(a);
  });
  it("saves a new deck, activates and round-trips with the normal profile without losing previous decks", () => {
    let p = createProfile(C);
    const r = generateDeck(
      C,
      "mage",
      ownedFor(p, "mage", C),
      DECK_RULES,
      "BALANCED",
    );
    if (!r.ok) throw Error("No deck");
    const before = structuredClone(heroProfile(p, "mage", C).decks);
    const made = createDeck(
      p,
      "mage",
      { name: "Auto", cards: r.cards },
      C,
      DECK_RULES,
      123,
    );
    if (!made.ok) throw Error(made.error);
    const activated = setDefaultDeck(made.profile, "mage", made.deckId, C);
    if (!activated.ok) throw Error(activated.error);
    p = activated.profile;
    expect(heroProfile(p, "mage", C).decks[0]).toEqual(before[0]);
    expect(heroProfile(p, "mage", C).activeDeckId).toBe(made.deckId);
    const parsed = parseProfileSave(serializeProfile(p), C);
    expect(parsed.status).toBe("OK");
    if (parsed.status === "OK")
      expect(heroProfile(parsed.profile, "mage", C).decks).toEqual(
        heroProfile(p, "mage", C).decks,
      );
  });
  it("replacement uses existing validation and leaves other decks/collection intact", () => {
    const p = createProfile(C),
      r = generateDeck(
        C,
        "mage",
        ownedFor(p, "mage", C),
        DECK_RULES,
        "DEFENSIVE",
      );
    if (!r.ok) throw Error("No deck");
    const id = heroProfile(p, "mage", C).activeDeckId;
    const saved = updateDeck(p, "mage", id, r.cards, C, DECK_RULES, 1);
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.profile.shared).toEqual(p.shared);
      expect(saved.profile.heroes.summoner).toEqual(p.heroes.summoner);
    }
  });
});

describe("Tactical differentiation and transparent estimates", () => {
  it("produces different strategies from the same sufficiently broad owned pool", () => {
    const decks = Object.keys(DECK_STYLES).map((style) => {
      const r = generateDeck(
        C,
        "mage",
        () => 99,
        DECK_RULES,
        style as keyof typeof DECK_STYLES,
        2,
      );
      if (!r.ok) throw Error(r.message);
      return JSON.stringify(
        [...r.cards].sort((a, b) => a.cardId.localeCompare(b.cardId)),
      );
    });
    expect(new Set(decks).size).toBeGreaterThan(2);
  });
  it("identifies real elemental conditional bonuses and complete ritual packages", () => {
    const r = generateDeck(C, "summoner", () => 99, DECK_RULES, "COMBOS", 4);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(
        validateDeck(r.cards, "summoner", () => 99, C, DECK_RULES),
      ).toEqual([]);
  });
  it("does not spend inventory when sharing legitimate copies across saved decks", () => {
    const p = createProfile(C),
      before = JSON.stringify(p),
      own = ownedFor(p, "mage", C);
    generateDeck(C, "mage", own, DECK_RULES, "COMBOS", 5);
    generateDeck(C, "mage", own, DECK_RULES, "CONTROL", 8);
    expect(JSON.stringify(p)).toBe(before);
  });
});

it("reports only verified status/terrain combinations, never invented elemental bonuses", () => {
  const base = C.cards.magic_missile!;
  const cards = {
    ...C.cards,
    producer: {
      ...base,
      id: "producer",
      name: "Preparación",
      effects: [
        {
          type: "APPLY_STATUS" as const,
          status: "BURNING" as const,
          duration: 2,
          to: "ENEMIES" as const,
        },
      ],
    },
    consumer: {
      ...base,
      id: "consumer",
      name: "Remate",
      effects: [
        {
          type: "DAMAGE" as const,
          amount: 2,
          damageType: "FIRE" as const,
          to: "ENEMIES" as const,
          bonus: {
            amount: 1,
            when: {
              type: "TARGET_HAS_STATUS" as const,
              statuses: ["BURNING" as const],
            },
          },
        },
      ],
    },
  };
  const a = analyzeDeck(
    [
      { cardId: "producer", count: 1 },
      { cardId: "consumer", count: 1 },
    ],
    { ...C, cards },
    "mage",
    "COMBOS",
    3,
    32,
  );
  expect(a.combinations).toContain(
    "Preparación → bonificación condicional de Remate.",
  );
  const b = analyzeDeck(
    [{ cardId: "consumer", count: 2 }],
    { ...C, cards },
    "mage",
    "COMBOS",
    3,
    32,
  );
  expect(b.combinations).not.toContain(
    "Preparación → bonificación condicional de Remate.",
  );
});
