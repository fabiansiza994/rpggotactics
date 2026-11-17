import { beforeEach, describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_CONTENT, COSMETICS, DECK_RULES } from "../src/game";
import { releasedContent } from "../server/src/ritualRelease";
import {
  boosterOffers,
  expansionViews,
  validBooster,
} from "../server/src/boosters";
import { MARKET_EXPANSIONS } from "../src/game/store/market-expansions";
import { PRIMARY_MARKET_EXPANSION } from "../src/game/store/market-primary";
import {
  STORE_CATALOG,
  LEGACY_STORE_CATALOG,
} from "../src/game/data/store-catalog";
import { describeCardAcquisition } from "../src/game/store/card-acquisition";
import {
  starterHeroProfile,
  starterShared,
} from "../src/game/collection/profile";
import { memoryD1 } from "./support/d1";
import { marketFixture, MARKET_FLAGS } from "./support/marketReorg";
const baseline = JSON.parse(
  readFileSync(
    new URL("./fixtures/market-reorg-baseline.json", import.meta.url),
    "utf8",
  ),
);
const content = releasedContent(DEFAULT_CONTENT, {
    ...MARKET_FLAGS,
    DB: memoryD1(),
  }),
  ctx = { content, cosmetics: COSMETICS, rules: DECK_RULES },
  packs = boosterOffers(ctx);
const expected = {
  origins_arcanos: 34,
  thunder_god: 16,
  antarctic_magic: 22,
  pack_pact: 40,
  warrior_promise: 27,
  reserva_cazador: 23,
};
describe("approved commercial reorganization", () => {
  it("keeps all 224 IDs, card mechanics, acquisition and starter grants exactly", () => {
    expect(Object.keys(content.cards).sort()).toEqual(
      baseline.cards.map((c: { id: string }) => c.id).sort(),
    );
    for (const old of baseline.cards) {
      const c = content.cards[old.id]!;
      for (const key of [
        "rarity",
        "cost",
        "effects",
        "acquisition",
        "heroId",
        "maxCopies",
      ])
        expect(c[key as keyof typeof c], old.id + " " + key).toEqual(old[key]);
    }
    for (const h of Object.values(content.heroes))
      expect(starterHeroProfile(h, content)).toEqual(baseline.starters[h.id]);
    expect(starterShared(content)).toEqual(baseline.sharedStarter);
  });
  it("has exactly one approved home per card and no missing target", () => {
    expect(PRIMARY_MARKET_EXPANSION).toEqual(baseline.primary);
    expect(Object.keys(PRIMARY_MARKET_EXPANSION)).toHaveLength(224);
    for (const e of Object.values(PRIMARY_MARKET_EXPANSION))
      expect(MARKET_EXPANSIONS.some((x) => x.id === e)).toBe(true);
  });
  for (const [id, count] of Object.entries(expected))
    it(id + " has approved membership and all positive-weight buckets", () => {
      expect(MARKET_EXPANSIONS.find((x) => x.id === id)?.cardIds).toHaveLength(
        count,
      );
      const p = packs.find((o) => o.booster?.expansionId === id)!;
      expect(p).toBeTruthy();
      expect(validBooster(p, ctx)).toBe(true);
      for (const rarity of ["COMMON", "UNCOMMON", "RARE", "LEGENDARY"])
        expect(
          p.contents.some(
            (x) =>
              x.kind === "CARD" && content.cards[x.cardId]?.rarity === rarity,
          ),
        ).toBe(true);
      expect(p.booster?.weights).toEqual({
        COMMON: 55,
        UNCOMMON: 30,
        RARE: 12,
        LEGENDARY: 3,
        ULTRA: 0,
      });
      expect(
        p.contents.every(
          (x) =>
            x.kind !== "CARD" || content.cards[x.cardId]?.rarity !== "ULTRA",
        ),
      ).toBe(true);
    });
  it("allows campaign overlap but keeps acquisition and technical drop gates unchanged", () => {
    for (const id of [
      "storm_avatar",
      "ice_arrow",
      "summon_ash_hound",
      "threshold_call",
    ])
      expect(
        packs.some((p) =>
          p.contents.some((x) => x.kind === "CARD" && x.cardId === id),
        ),
      ).toBe(true);
    expect(content.releasedExpansions).not.toContain("archer_hunt");
    expect(content.releasedExpansions).not.toContain("forbidden_bond");
  });
  it("keeps Ranked, Premium and Ultra out", () => {
    for (const p of packs)
      for (const x of p.contents) {
        if (x.kind !== "CARD") continue;
        expect(["RANKED_TRACK", "RANKED_PREMIUM"]).not.toContain(
          content.cards[x.cardId]?.acquisition?.source,
        );
        expect(content.cards[x.cardId]?.rarity).not.toBe("ULTRA");
      }
  });
  it("cleans public metadata and does not sell future expansions", () => {
    const views = expansionViews(ctx, packs);
    expect(views.filter((x) => x.packs.length)).toHaveLength(6);
    expect(
      views.some((x) =>
        /Pendiente|Reserva|sin sobres/i.test(x.name + " " + x.description),
      ),
    ).toBe(false);
    expect(views.find((x) => x.id === "furia_elemental")?.cardIds).toHaveLength(
      8,
    );
    expect(views.find((x) => x.id === "furia_elemental")?.packs).toHaveLength(
      0,
    );
    expect(views.some((x) => x.id.includes("cambiaformas"))).toBe(false);
  });
  it("retires all 26 individual and 14 deterministic offers, keeps CARD history definitions", () => {
    expect(LEGACY_STORE_CATALOG.filter((x) => x.type === "CARD")).toHaveLength(
      26,
    );
    expect(
      LEGACY_STORE_CATALOG.filter((x) => x.type === "CHAMPION_PACK"),
    ).toHaveLength(14);
    expect(STORE_CATALOG).toHaveLength(3);
    expect(
      STORE_CATALOG.every((x) => x.contents.every((y) => y.kind !== "CARD")),
    ).toBe(true);
  });
  for (const [id, booster, source] of [
    ["frost_nova", true, ""],
    ["fireball", false, "Copia inicial"],
    ["magic_missile", true, "Copia inicial"],
    ["ice_arrow", true, "campaña"],
    ["arcane_exchange", false, "Ranked"],
    ["ash_eclipse", false, "Premium"],
    ["archmage_eruption", false, "El Ascenso"],
  ] as const)
    it("truthful how-to-get " + id, () => {
      const v = describeCardAcquisition(id, content)!;
      expect(v.inBooster).toBe(booster);
      if (source) expect(v.sources.join(" ")).toContain(source);
      expect(v.expansionId).toBe(PRIMARY_MARKET_EXPANSION[id]);
    });
});
let f: Awaited<ReturnType<typeof marketFixture>>;
beforeEach(async () => {
  f = await marketFixture();
});
describe("authoritative store compatibility", () => {
  for (const id of Object.keys(expected))
    for (const n of [1, 5, 10])
      it(`${id} x${n}: price, grants, refresh and receipt replay`, async () => {
        const before = (await f.call("GET", "/state")).data.profile;
        const out = await f.buy(`booster_${id}_x${n}`, "buy-" + id + "-" + n);
        expect(out.status).toBe(200);
        expect(out.data.purchase.price).toBe(n * 50);
        expect(out.data.wallet.balance).toBe(30000 - n * 50);
        expect(out.data.purchase.granted.openings).toHaveLength(n);
        expect(
          out.data.purchase.granted.openings.flatMap(
            (p: { cards: unknown[] }) => p.cards,
          ),
        ).toHaveLength(n * 4);
        const replay = await f.call("POST", "/store/purchase", {
          offerId: `booster_${id}_x${n}`,
          idempotencyKey: "buy-" + id + "-" + n,
          receiptOnly: true,
        });
        expect(replay.data.replayed).toBe(true);
        expect(replay.data.purchase).toEqual(out.data.purchase);
        expect(replay.data.wallet.balance).toBe(30000 - n * 50);
        const reload = (await f.call("GET", "/state")).data.profile;
        expect(reload).toEqual(out.data.profile);
        for (const h of Object.keys(before.heroes))
          expect(reload.heroes[h].decks).toEqual(before.heroes[h].decks);
      });
  it("concurrent same key gives only one purchase and one debit", async () => {
    const cat = await f.catalog(),
      o = cat.offers.find(
        (x: { id: string }) => x.id === "booster_pack_pact_x10",
      );
    const body = {
      offerId: o.id,
      idempotencyKey: "concurrent-same",
      quoteToken: o.purchaseQuote.token,
      packRevision: o.booster.revision,
      packFormat: "GENERAL_BATCH_V1",
    };
    const out = await Promise.all([
      f.call("POST", "/store/purchase", body),
      f.call("POST", "/store/purchase", body),
    ]);
    expect(out.every((x) => x.status === 200)).toBe(true);
    expect(out[0]!.data.purchase.purchaseId).toBe(
      out[1]!.data.purchase.purchaseId,
    );
    expect((await f.call("GET", "/wallet")).data.wallet.balance).toBe(29500);
  });
  it("keeps five free Origins packs under the same historic offer id", async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (await f.buy("booster_origins_arcanos_free", "free-claim-" + i)).status,
      ).toBe(200);
    expect((await f.call("GET", "/wallet")).data.wallet.balance).toBe(30000);
    const c = await f.catalog();
    const o = c.offers.find(
      (x: { id: string }) => x.id === "booster_origins_arcanos_free",
    );
    expect(o.freeRemaining).toBe(0);
    expect(o.availability.purchasable).toBe(false);
    expect(
      c.offers.filter(
        (x: { booster?: { freeGrant?: boolean } }) => x.booster?.freeGrant,
      ),
    ).toHaveLength(6);
  });
  it("preserves prior launch claim while new packs are purchased", async () => {
    expect(
      (await f.call("POST", "/store/launch-reward/claim", {})).data.credited,
    ).toBe(500);
    await f.buy("booster_origins_arcanos_x1", "after-launch");
    expect(
      (await f.call("POST", "/store/launch-reward/claim", {})).data,
    ).toMatchObject({ credited: 0, wallet: { balance: 30450 } });
  });
  it("rejects new deterministic purchases even with injected legacy catalog", async () => {
    f.deps.store.catalog = LEGACY_STORE_CATALOG;
    for (const o of LEGACY_STORE_CATALOG.filter((x) =>
      x.contents.some((y) => y.kind === "CARD"),
    )) {
      const r = await f.call("POST", "/store/purchase", {
        offerId: o.id,
        idempotencyKey: "retired-" + o.id,
      });
      expect(r.status, o.id).toBe(404);
    }
    expect((await f.call("GET", "/wallet")).data.wallet.balance).toBe(30000);
  });
  it.each(["card_frost_nova", "pack_summoner_shadow_pack"])(
    "recovers historical %s before checking retired catalog or quotes",
    async (offerId) => {
      const offer = LEGACY_STORE_CATALOG.find((x) => x.id === offerId)!,
        granted = {
          cards: [
            {
              heroId: "mage",
              cardId: "frost_nova",
              copies: 1,
              total: 5,
              cap: 2,
            },
          ],
          cosmetics: [],
        };
      f.db.sql
        .prepare(
          `INSERT INTO tactics_store_purchases VALUES('old-purchase',?,'historical-key',?,'arcane_crystals',150,'COMPLETED',?,?,0,0)`,
        )
        .run(
          f.account.id,
          offer.id,
          JSON.stringify(offer),
          JSON.stringify(granted),
        );
      const r = await f.call("POST", "/store/purchase", {
        offerId: offer.id,
        idempotencyKey: "historical-key",
        receiptOnly: true,
      });
      expect(r.status).toBe(200);
      expect(r.data.replayed).toBe(true);
      expect(r.data.purchase.granted).toEqual(granted);
      expect(r.data.wallet.balance).toBe(30000);
    },
  );
  it("acquisition endpoint agrees with real pools and never grants", async () => {
    const before = (await f.call("GET", "/state")).data.profile,
      r = await f.call("GET", "/store/acquisition");
    expect(Object.keys(r.data.cards)).toHaveLength(224);
    for (const id of Object.keys(content.cards))
      expect(r.data.cards[id].inBooster).toBe(
        packs.some((p) =>
          p.contents.some((x) => x.kind === "CARD" && x.cardId === id),
        ),
      );
    expect((await f.call("GET", "/state")).data.profile).toEqual(before);
  });
  it("claims an old pending CARD gift from its snapshot after the SKU is retired", async () => {
    for (const file of [
      "0009_tactics_social.sql",
      "0015_tactics_store_gifts.sql",
    ])
      f.db.sql.exec(
        readFileSync(
          new URL("../server/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    const offer = LEGACY_STORE_CATALOG.find((o) => o.id === "card_frost_nova")!;
    const plan = {
      cards: [
        { heroId: "mage", cardId: "frost_nova", copies: 1, total: 1, cap: 2 },
      ],
      cosmetics: [],
    };
    f.db.sql
      .prepare(
        `INSERT INTO tactics_gifts(gift_id,sender_user_id,recipient_user_id,idempotency_key,product_id,status,currency_id,price_snapshot,reward_snapshot,transaction_id,created_at,updated_at) VALUES('gft_00000000-0000-4000-8000-000000000099',NULL,?,'old-gift-key',?,'PENDING','arcane_crystals',150,?,'old-gift-txn',0,0)`,
      )
      .run(f.account.id, offer.id, JSON.stringify({ ...offer, plan }));
    f.db.sql
      .prepare(
        "INSERT INTO tactics_gift_items VALUES('gft_00000000-0000-4000-8000-000000000099',0,'CARD','frost_nova','mage','mage',1)",
      )
      .run();
    const claim = await f.call(
      "POST",
      "/store/gifts/gft_00000000-0000-4000-8000-000000000099/claim",
      {},
    );
    expect(claim.status).toBe(200);
    const again = await f.call(
      "POST",
      "/store/gifts/gft_00000000-0000-4000-8000-000000000099/claim",
      {},
    );
    expect(again.status).toBe(200);
    const cards = f.db.sql
      .prepare(
        "SELECT copies FROM tactics_player_cards WHERE user_id=? AND card_id='frost_nova'",
      )
      .get(f.account.id) as { copies: number };
    expect(cards.copies).toBe(1);
    expect((await f.call("GET", "/wallet")).data.wallet.balance).toBe(30000);
  });
  it("rejects new gifts of retired card products without deleting the gift infrastructure", async () => {
    for (const file of [
      "0009_tactics_social.sql",
      "0015_tactics_store_gifts.sql",
    ])
      f.db.sql.exec(
        readFileSync(
          new URL("../server/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    f.deps.store.catalog = LEGACY_STORE_CATALOG;
    const r = await f.call("POST", "/store/gifts/quote", {
      productId: "card_frost_nova",
      recipientUsername: "other_local",
    });
    expect(r.status).toBe(404);
    expect(r.data.error.code).toBe("PRODUCT_NOT_FOUND");
    expect((await f.call("GET", "/wallet")).data.wallet.balance).toBe(30000);
  });

  it("old free-pack receipts keep their counter and original revision", async () => {
    const offerId = "booster_origins_arcanos_free";
    const old = {
      cards: [],
      cosmetics: [],
      opening: { packId: offerId, revision: "origins-arcane-v4", cards: [] },
    };
    for (let i = 0; i < 2; i++)
      f.db.sql
        .prepare(
          `INSERT INTO tactics_store_purchases VALUES(?,?,?,?,'arcane_crystals',0,'COMPLETED','{}',?,0,0)`,
        )
        .run(
          "prior-free-" + i,
          f.account.id,
          "prior-free-key-" + i,
          offerId,
          JSON.stringify(old),
        );
    expect(
      (await f.catalog()).offers.find((x: { id: string }) => x.id === offerId)
        .freeRemaining,
    ).toBe(3);
    const replay = await f.call("POST", "/store/purchase", {
      offerId,
      idempotencyKey: "prior-free-key-0",
      receiptOnly: true,
    });
    expect(replay.data.purchase.granted).toEqual(old);
    for (let i = 0; i < 3; i++)
      expect((await f.buy(offerId, "new-free-key-" + i)).status).toBe(200);
    expect(
      (await f.catalog()).offers.find((x: { id: string }) => x.id === offerId)
        .freeRemaining,
    ).toBe(0);
    expect((await f.call("GET", "/wallet")).data.wallet.balance).toBe(30000);
  });
});

if (process.env.MARKET_REORG_REPORT)
  writeFileSync(
    process.env.MARKET_REORG_REPORT,
    JSON.stringify(
      {
        expansions: MARKET_EXPANSIONS.map((e) => ({
          ...e,
          eligible: [
            ...new Set(
              packs
                .filter((p) => p.booster?.expansionId === e.id)
                .flatMap((p) =>
                  p.contents.flatMap((c) =>
                    c.kind === "CARD" ? [c.cardId] : [],
                  ),
                ),
            ),
          ],
        })),
        acquisitions: Object.fromEntries(
          Object.keys(content.cards).map((id) => [
            id,
            describeCardAcquisition(id, content),
          ]),
        ),
        revisions: packs.map((p) => ({
          id: p.id,
          revision: p.booster?.revision,
        })),
      },
      null,
      2,
    ),
  );
