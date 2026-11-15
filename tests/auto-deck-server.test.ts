import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { memoryD1, addAccount } from "./support/d1";
import { handle } from "../server/src/index";
import {
  DEFAULT_CONTENT as C,
  DECK_RULES,
  createProfile,
  ownedFor,
  loadoutDeck,
  type DeckEntry,
} from "../src/game";
import { generateDeck } from "../src/game/collection/auto-deck";
import { validateLoadout, createDuel } from "../src/game/pvp/duel";
import type { Env } from "../server/src/db";
let db: ReturnType<typeof memoryD1>;
beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
});
afterEach(() => db.sql.close());
async function request(
  token: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await handle(
    new Request("https://qa.invalid/api/tactics" + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { DB: db } as Env,
    { content: C, now: () => Date.now(), seed: () => 7 },
  );
  return {
    status: response.status,
    data: (await response.json()) as {
      deckId: string;
      decks: { deckId: string; isDefault: boolean }[];
    },
  };
}
async function fixture() {
  const account = addAccount(db, "auto_qa");
  expect((await request(account.token, "POST", "/profile", {})).status).toBe(
    200,
  );
  const r = generateDeck(
    C,
    "mage",
    ownedFor(createProfile(C), "mage", C),
    DECK_RULES,
    "BALANCED",
    3,
  );
  if (!r.ok) throw Error(r.message);
  return { ...account, cards: r.cards };
}
const inventory = () =>
  db.sql
    .prepare(
      "SELECT * FROM tactics_player_cards ORDER BY user_id,hero_id,card_id",
    )
    .all();
describe("Generated decks use unchanged authoritative endpoints", () => {
  it("creates, replays the same receipt, persists and activates without modifying inventory", async () => {
    const p = await fixture(),
      before = inventory();
    const body = {
      name: "Auto QA",
      cards: p.cards,
      requestId: "auto-request-1",
    };
    const a = await request(p.token, "POST", "/decks/mage", body),
      retry = await request(p.token, "POST", "/decks/mage", body);
    expect(a.status).toBe(200);
    expect(retry.data.deckId).toBe(a.data.deckId);
    expect(
      (await request(p.token, "PUT", `/decks/mage/${a.data.deckId}/default`))
        .status,
    ).toBe(200);
    const list = await request(p.token, "GET", "/decks/mage");
    expect(list.data.decks).toHaveLength(2);
    expect(
      list.data.decks.find((d) => d.deckId === a.data.deckId)?.isDefault,
    ).toBe(true);
    expect(inventory()).toEqual(before);
  });
  it("server rejects forged extra copies and preserves existing decks", async () => {
    const p = await fixture(),
      before = inventory();
    const a = await request(p.token, "POST", "/decks/mage", {
      name: "Illegal",
      cards: [{ cardId: "magic_missile", count: 30 }],
      requestId: "illegal-1",
    });
    expect(a.status).toBe(422);
    expect(
      (await request(p.token, "GET", "/decks/mage")).data.decks,
    ).toHaveLength(1);
    expect(inventory()).toEqual(before);
  });
  it("replacement and per-mode loadout use the same legal saved cards", async () => {
    const p = await fixture();
    expect(
      (await request(p.token, "PUT", "/decks/mage/main", { cards: p.cards }))
        .status,
    ).toBe(200);
    const rows = db.sql
      .prepare(
        "SELECT card_id AS cardId,count FROM tactics_deck_cards WHERE user_id=? AND hero_id='mage' AND deck_id='main'",
      )
      .all(p.id) as unknown as DeckEntry[];
    expect([...rows].sort((a, b) => a.cardId.localeCompare(b.cardId))).toEqual(
      [...p.cards].sort((a, b) => a.cardId.localeCompare(b.cardId)),
    );
    const profile = createProfile(C);
    profile.heroes.mage!.decks[0]!.cards = rows;
    for (const mode of ["CASUAL", "RANKED"] as const) {
      const result = loadoutDeck(
        profile,
        { championId: "mage", deckId: "main" },
        C,
        DECK_RULES,
      );
      expect(result.source, mode).toBe("SAVED");
      const loadout = validateLoadout(profile, "mage", C, "main");
      const duel = createDuel(
        [loadout, loadout],
        4,
        "DUEL",
        "classic",
        C,
        mode === "RANKED",
      );
      expect(duel.player.hand).toHaveLength(5);
      expect(duel.duel!.other.hand).toHaveLength(5);
      expect(
        new Set(
          [...duel.player.hand, ...duel.duel!.other.hand].map((c) => c.uid),
        ).size,
      ).toBe(10);
    }
  });
});
