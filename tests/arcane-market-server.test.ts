import { generateDeck } from "../src/game/collection/auto-deck";
import {
  addCardIssue,
  addCard,
  validateDeck,
} from "../src/game/collection/deck-rules";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONTENT,
  COSMETICS,
  DECK_RULES,
  rarityOf,
  ownedFor,
} from "../src/game";
import { ARCANE_PACK_POLICY } from "../src/game/store/boosters";
import {
  boosterOffers,
  rollBooster,
  validBooster,
} from "../server/src/boosters";
import { releasedContent } from "../server/src/ritualRelease";
import { handle } from "../server/src/index";
import { memoryD1, addAccount } from "./support/d1";
import { qaGrantSql } from "../server/scripts/qa-grant-sql.mjs";
import { STORE_QUOTE_TEST_SECRET } from "./support/storeQuote";
import type { Env } from "../server/src/db";
import type { Catalog, PurchaseResponse } from "../src/presentation/shop/api";
import type { StoreDeps } from "../server/src/store";
const NOW = 1800000000000;
const flags = {
  ARCANE_MARKET_PACKS_ENABLED: "1",
  FREE_CATALOG_ENABLED: "1",
  SHAPESHIFTER_ENABLED: "1",
  WARRIOR_ENABLED: "1",
  SUMMONER_RITUALS_ENABLED: "1",
  PRIMORDIAL_DRAGON_ENABLED: "1",
  ARSENAL_CARDS_ENABLED: "1",
  TACTICAL_CARDS_ENABLED: "1",
  STORE_SHOWCASE_ENABLED: "1",
  STORE_QUOTE_SECRET: STORE_QUOTE_TEST_SECRET,
};
const content = releasedContent(DEFAULT_CONTENT, flags as Env),
  ctx = { content, cosmetics: COSMETICS, rules: DECK_RULES };
const packs = boosterOffers(ctx),
  pack = packs.find((o) => o.booster?.packs === 1 && !o.booster.freeGrant)!;
const owned = { copies: () => 5, hasCosmetic: () => false, purchases: () => 0 };
let db: ReturnType<typeof memoryD1>,
  account: ReturnType<typeof addAccount>,
  ids = 0,
  now = NOW,
  store: StoreDeps;
async function call(
  method: string,
  path: string,
  body?: unknown,
  enabled = true,
) {
  const res = await handle(
    new Request("https://qa.test/api/tactics" + path, {
      method,
      headers: {
        Authorization: "Bearer " + account.token,
        "Content-Type": "application/json",
      },
      body:
        body === undefined
          ? undefined
          : JSON.stringify({
              packFormat: "GENERAL_BATCH_V1",
              ...(body as object),
            }),
    }),
    { ...flags, ARCANE_MARKET_PACKS_ENABLED: enabled ? "1" : "0", DB: db },
    { content: DEFAULT_CONTENT, now: () => now, seed: () => 7, store },
  );
  return {
    status: res.status,
    data: (await res.json()) as PurchaseResponse &
      Catalog & { error?: { code: string } },
  };
}
const balance = () =>
  Number(
    (
      db.sql
        .prepare("SELECT balance FROM tactics_wallets WHERE user_id=?")
        .get(account.id) as { balance: number } | undefined
    )?.balance ?? 0,
  );
async function quote() {
  return (await call("GET", "/store/catalog")).data.offers.find(
    (o) => o.id === pack.id,
  )!;
}
async function buy(key: string, extra: Record<string, unknown> = {}) {
  const q = await quote();
  return call("POST", "/store/purchase", {
    offerId: pack.id,
    idempotencyKey: key,
    quoteToken: q.purchaseQuote!.token,
    packRevision: q.booster!.revision,
    ...extra,
  });
}
beforeEach(async () => {
  db = memoryD1({ legacyProfiles: true });
  account = addAccount(db, "tactics_qa_market");
  now = NOW;
  store = {
    catalog: [],
    cosmetics: COSMETICS,
    newId: () => String(++ids).padStart(12, "0"),
  };
  await call("POST", "/profile", {});
  db.sql.exec(
    qaGrantSql({
      username: "tactics_qa_market",
      amount: 1000,
      reference: "market-smoke",
      transactionId: "txn_qa_00000000-0000-4000-8000-000000000001",
      now,
    }),
  );
});
describe("authoritative four-card packs", () => {
  it.each(["mage", "summoner", "warrior"])(
    "uses the general pool independently of human champion %s",
    async (heroId) => {
      const r = await buy("general-" + heroId, { heroId });
      expect(r.status).toBe(200);
      expect(r.data.purchase.granted.opening!.cards).toHaveLength(4);
      expect(
        r.data.purchase.granted.cards.every(
          (c) =>
            c.heroId ===
            (content.cards[c.cardId]!.heroId ?? content.defaultHeroId),
        ),
      ).toBe(true);
      expect(balance()).toBe(800);
    },
  );
  it("checks all real buckets and retains the approved 200 price / exact odds", async () => {
    expect(pack.price).toBe(200);
    expect(pack.booster).toEqual({
      ...ARCANE_PACK_POLICY,
      expansionId: "origins_arcanos",
      revision: "origins-arcane-v4",
      poolType: "GENERAL",
      packs: 1,
    });
    for (const p of packs) {
      expect(validBooster(p, ctx)).toBe(true);
      expect(
        p.contents.every(
          (c) =>
            c.kind === "CARD" &&
            !!content.heroes[content.cards[c.cardId]!.heroId ?? content.defaultHeroId!] &&
            rarityOf(content.cards[c.cardId]!) !== "ULTRA",
        ),
      ).toBe(true);
    }
    expect((await quote()).booster?.weights).toEqual({
      COMMON: 55,
      UNCOMMON: 30,
      RARE: 12,
      LEGENDARY: 3,
      ULTRA: 0,
    });
  });
  it("is OFF by default and rejects legacy clients before charging", async () => {
    expect(
      (await call("GET", "/store/catalog", undefined, false)).data.offers,
    ).toEqual([]);
    expect(
      (await buy("legacy-client", { packRevision: undefined })).data.error
        ?.code,
    ).toBe("PACK_CLIENT_UPDATE_REQUIRED");
    expect(balance()).toBe(1000);
  });
  it("persists four slots, charges once, accumulates all duplicates and returns the fresh collection", async () => {
    const r = await buy("first-pack");
    expect(r.status).toBe(200);
    expect(balance()).toBe(800);
    expect(r.data.purchase.granted.opening!.cards).toHaveLength(4);
    expect(
      r.data.purchase.granted.cards.reduce((n, c) => n + c.copies, 0),
    ).toBe(4);
    for (const c of r.data.purchase.granted.cards)
      expect(
        ownedFor(r.data.profile!, c.heroId, content)(c.cardId),
      ).toBeGreaterThanOrEqual(c.copies);
    expect(
      db.sql.prepare("SELECT COUNT(*) AS n FROM tactics_store_purchases").get(),
    ).toEqual({ n: 1 });
  });
  it("recovers the exact completed result after expiry, policy disable and quote removal", async () => {
    const first = await buy("recover-pack");
    now += 999999;
    const replay = await call(
      "POST",
      "/store/purchase",
      { offerId: pack.id, idempotencyKey: "recover-pack", receiptOnly: true },
      false,
    );
    expect(replay.status).toBe(200);
    expect(replay.data.purchase).toEqual(first.data.purchase);
    expect(replay.data.replayed).toBe(true);
    expect(balance()).toBe(800);
  });
  it("does not create a purchase during receipt-only recovery of an unknown key", async () => {
    expect(
      (
        await call("POST", "/store/purchase", {
          offerId: pack.id,
          idempotencyKey: "unknown-receipt",
          receiptOnly: true,
        })
      ).status,
    ).toBe(409);
    expect(balance()).toBe(1000);
  });
  it("rejects expired and manipulated quotes without a debit or grant", async () => {
    const q = await quote();
    const body = {
      offerId: pack.id,
      idempotencyKey: "expired-pack",
      quoteToken: q.purchaseQuote!.token,
      packRevision: q.booster!.revision,
    };
    now += 300001;
    expect((await call("POST", "/store/purchase", body)).data.error?.code).toBe(
      "QUOTE_EXPIRED",
    );
    expect(
      (await call("POST", "/store/purchase", { ...body, quoteToken: "fake" }))
        .data.error?.code,
    ).toBe("QUOTE_INVALID");
    expect(balance()).toBe(1000);
  });
  it("binds policy changes to the signed quote", async () => {
    const q = await quote();
    store.packPolicy = {
      ...ARCANE_PACK_POLICY,
      revision: q.booster!.revision,
      weights: { COMMON: 54, UNCOMMON: 31, RARE: 12, LEGENDARY: 3, ULTRA: 0 },
    };
    const r = await call("POST", "/store/purchase", {
      offerId: pack.id,
      idempotencyKey: "changed-policy",
      quoteToken: q.purchaseQuote!.token,
      packRevision: q.booster!.revision,
    });
    expect(r.data.error?.code).toBe("QUOTE_CHANGED");
    expect(balance()).toBe(1000);
  });
  it("ignores forged client prices, rewards and probabilities", async () => {
    const r = await buy("forged-payload", {
      price: 0,
      weights: { ULTRA: 100 },
      cards: ["fake_card"],
      balance: 99999,
    });
    expect(r.status).toBe(200);
    expect(r.data.purchase.price).toBe(200);
    expect(
      r.data.purchase.granted.opening!.cards.every(
        (c) =>
          content.cards[c.cardId] &&
          rarityOf(content.cards[c.cardId]!) !== "ULTRA",
      ),
    ).toBe(true);
  });
  it("same-key concurrent retries produce one receipt and one persisted roll", async () => {
    const q = await quote(),
      body = {
        offerId: pack.id,
        idempotencyKey: "same-concurrent",
        quoteToken: q.purchaseQuote!.token,
        packRevision: q.booster!.revision,
      };
    const rs = await Promise.all(
      Array.from({ length: 8 }, () => call("POST", "/store/purchase", body)),
    );
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(new Set(rs.map((r) => JSON.stringify(r.data.purchase))).size).toBe(
      1,
    );
    expect(balance()).toBe(800);
  });
  it("distinct purchases cannot overdraw the same wallet", async () => {
    const q = await quote();
    store.packPrice = 800;
    const fresh = await quote();
    const rs = await Promise.all(
      ["parallel-one", "parallel-two"].map((idempotencyKey) =>
        call("POST", "/store/purchase", {
          offerId: pack.id,
          idempotencyKey,
          quoteToken: fresh.purchaseQuote!.token,
          packRevision: q.booster!.revision,
        }),
      ),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(balance()).toBe(200);
  });
  it("insufficient funds never persist any grant or charge", async () => {
    store.packPrice = 1200;
    expect((await buy("insufficient-pack")).data.error?.code).toBe(
      "INSUFFICIENT_FUNDS",
    );
    expect(balance()).toBe(1000);
    expect(
      db.sql.prepare("SELECT COUNT(*) AS n FROM tactics_store_purchases").get(),
    ).toEqual({ n: 0 });
  });
  it("partial grant failures roll back receipt, debit and inventory together", async () => {
    const before = db.sql
      .prepare("SELECT SUM(copies) AS n FROM tactics_player_cards")
      .get();
    db.sql.exec(
      "CREATE TRIGGER fail_pack BEFORE INSERT ON tactics_player_cards BEGIN SELECT RAISE(ABORT,'QA rollback'); END;",
    );
    expect((await buy("failed-grant")).status).toBe(409);
    expect(balance()).toBe(1000);
    expect(
      db.sql.prepare("SELECT COUNT(*) AS n FROM tactics_store_purchases").get(),
    ).toEqual({ n: 0 });
    expect(
      db.sql.prepare("SELECT SUM(copies) AS n FROM tactics_player_cards").get(),
    ).toEqual(before);
  });
  it("all rarity boundaries follow the exact policy, with replacement and no guarantee", () => {
    const counts: Record<string, number> = {};
    for (let x = 0; x < 100; x++) {
      let i = 0;
      const plan = rollBooster(pack, owned, ctx, NOW, (n) =>
        n === 100 ? x : i++ * 0,
      );
      expect(plan.opening!.cards).toHaveLength(4);
      expect(plan.cards.reduce((n, c) => n + c.copies, 0)).toBe(4);
      const rarity = rarityOf(content.cards[plan.opening!.cards[0]!.cardId]!);
      counts[rarity] = (counts[rarity] ?? 0) + 1;
      expect(plan.cards[0]!.total).toBe(9);
      expect(plan.cards[0]!.cap).toBeLessThan(9);
    }
    expect(counts).toEqual({
      COMMON: 55,
      UNCOMMON: 30,
      RARE: 12,
      LEGENDARY: 3,
    });
  });
  it("makes all acquired cards available to the manual editor and existing auto-builder without auto-saving", async () => {
    const before = db.sql
      .prepare(
        "SELECT card_id,count FROM tactics_deck_cards WHERE user_id=? AND hero_id='mage' ORDER BY card_id",
      )
      .all(account.id);
    const r = await buy("editor-integration");
    const profile = r.data.profile!;
    const owned = ownedFor(profile, "mage", content);
    for (const grant of r.data.purchase.granted.cards) {
      expect(
        addCardIssue(
          [],
          grant.cardId,
          grant.heroId,
          ownedFor(profile, grant.heroId, content),
          content,
          DECK_RULES,
        ),
      ).toBe(null);
      expect(addCard([], grant.cardId)).toEqual([
        { cardId: grant.cardId, count: 1 },
      ]);
    }
    const draft = generateDeck(
      content,
      "mage",
      owned,
      DECK_RULES,
      "BALANCED",
      7,
    );
    expect(draft.ok).toBe(true);
    if (draft.ok)
      expect(
        validateDeck(draft.cards, "mage", owned, content, DECK_RULES),
      ).toEqual([]);
    expect(
      db.sql
        .prepare(
          "SELECT card_id,count FROM tactics_deck_cards WHERE user_id=? AND hero_id='mage' ORDER BY card_id",
        )
        .all(account.id),
    ).toEqual(before);
  });
  it("never redistributes odds when a bucket is missing or includes forbidden cards", () => {
    expect(
      validBooster(
        {
          ...pack,
          contents: pack.contents.filter(
            (c) =>
              c.kind === "CARD" &&
              rarityOf(content.cards[c.cardId]!) !== "LEGENDARY",
          ),
        },
        ctx,
      ),
    ).toBe(false);
    expect(validBooster({ ...pack, giftable: true }, ctx)).toBe(false);
    expect(
      validBooster(
        {
          ...pack,
          booster: {
            ...ARCANE_PACK_POLICY,
            weights: { ...ARCANE_PACK_POLICY.weights, ULTRA: 1 },
          },
        },
        ctx,
      ),
    ).toBe(false);
  });
});

describe("general expansion batches", () => {
  async function quantity(
    qty: 1 | 5 | 10,
    key: string,
    extra: Record<string, unknown> = {},
  ) {
    const q = (await call("GET", "/store/catalog")).data.offers.find(
      (o) => o.booster?.packs === qty && !o.booster.freeGrant,
    )!;
    return call("POST", "/store/purchase", {
      offerId: q.id,
      idempotencyKey: key,
      quoteToken: q.purchaseQuote!.token,
      packRevision: q.booster!.revision,
      ...extra,
    });
  }
  const inventory = () =>
    Number(
      (
        db.sql
          .prepare(
            "SELECT SUM(copies) AS n FROM tactics_player_cards WHERE user_id=?",
          )
          .get(account.id) as { n: number }
      ).n ?? 0,
    );
  it.each([1, 5, 10] as const)(
    "persists x%s as individual packs before returning, one debit and exact inventory increment",
    async (qty) => {
      db.sql
        .prepare("UPDATE tactics_wallets SET balance=? WHERE user_id=?")
        .run(qty * 200, account.id);
      const before = inventory();
      const r = await quantity(qty, "batch-exact-" + qty);
      expect(r.status).toBe(200);
      expect(r.data.purchase.price).toBe(qty * 200);
      expect(r.data.purchase.granted.openings).toHaveLength(qty);
      expect(
        r.data.purchase.granted.openings!.every((o) => o.cards.length === 4),
      ).toBe(true);
      expect(inventory() - before).toBe(qty * 4);
      expect(balance()).toBe(0);
      const recovered = await quantity(qty, "batch-exact-" + qty);
      expect(recovered.status).toBe(200);
      expect(recovered.data.purchase).toEqual(r.data.purchase);
      expect(inventory() - before).toBe(qty * 4);
    },
  );
  it("rejects x10 with insufficient funds without acquiring any cards", async () => {
    const before = inventory();
    const r = await quantity(10, "batch-poor");
    expect(r.status).toBe(409);
    expect(r.data.error?.code).toBe("INSUFFICIENT_FUNDS");
    expect(balance()).toBe(1000);
    expect(inventory()).toBe(before);
  });
  it.each([5, 10] as const)(
    "concurrent repeated x%s and receipt recovery never duplicate grants",
    async (qty) => {
      db.sql
        .prepare("UPDATE tactics_wallets SET balance=2000 WHERE user_id=?")
        .run(account.id);
      const before = inventory();
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => quantity(qty, "batch-race-" + qty)),
      );
      expect(responses.every((r) => r.status === 200)).toBe(true);
      expect(
        new Set(responses.map((r) => r.data.purchase.purchaseId)).size,
      ).toBe(1);
      expect(inventory() - before).toBe(qty * 4);
      expect(balance()).toBe(2000 - qty * 200);
      const receipt = responses[0]!.data.purchase;
      const replay = await call(
        "POST",
        "/store/purchase",
        {
          offerId: receipt.offerId,
          idempotencyKey: "batch-race-" + qty,
          receiptOnly: true,
        },
        false,
      );
      expect(replay.data.purchase).toEqual(receipt);
      expect(inventory() - before).toBe(qty * 4);
    },
  );
  it("rejects clients without general-batch support before debit", async () => {
    const r = await buy("legacy-general", { packFormat: undefined });
    expect(r.status).toBe(409);
    expect(r.data.error?.code).toBe("PACK_CLIENT_UPDATE_REQUIRED");
    expect(balance()).toBe(1000);
  });
  it("does not trust a client supplied quantity, champion or price", async () => {
    const r = await quantity(1, "batch-forgery", {
      quantity: 10,
      heroId: "mage",
      price: 1,
    });
    expect(r.status).toBe(200);
    expect(r.data.purchase.price).toBe(200);
    expect(r.data.purchase.granted.openings).toHaveLength(1);
    expect(balance()).toBe(800);
  });
  it("uses the complete published pool and independently draws cards for different champions", () => {
    const common = pack.contents.filter(
      (c) =>
        c.kind === "CARD" && rarityOf(content.cards[c.cardId]!) === "COMMON",
    );
    const indexes = ["mage", "summoner", "mage", "summoner"].map((hero) =>
      common.findIndex(
        (c) => c.kind === "CARD" && content.cards[c.cardId]!.heroId === hero,
      ),
    );
    let n = 0;
    const rolled = rollBooster(pack, owned, ctx, NOW, (bound) =>
      bound === 100 ? 0 : indexes[n++]!,
    );
    expect(new Set(rolled.opening!.cards.map((c) => c.heroId))).toEqual(
      new Set(["mage", "summoner"]),
    );
    expect(pack.contents).toHaveLength(21);
    expect(pack.heroId).toBeUndefined();
  });
});

describe("five free packs per player and expansion", () => {
  const inventory = () =>
    Number(
      (
        db.sql
          .prepare(
            "SELECT SUM(copies) AS n FROM tactics_player_cards WHERE user_id=?",
          )
          .get(account.id) as { n: number }
      ).n ?? 0,
    );
  async function freeQuote() {
    return (await call("GET", "/store/catalog")).data.offers.find(
      (o) => o.booster?.freeGrant,
    )!;
  }
  async function claim(key: string, extra: Record<string, unknown> = {}) {
    const q = await freeQuote();
    return call("POST", "/store/purchase", {
      offerId: q.id,
      idempotencyKey: key,
      quoteToken: q.purchaseQuote?.token,
      packRevision: q.booster!.revision,
      ...extra,
    });
  }
  it("grants five individually, never touches the wallet, then the next paid pack costs200", async () => {
    const before = inventory();
    for (let i = 0; i < 5; i++) {
      expect((await freeQuote()).freeRemaining).toBe(5 - i);
      const r = await claim("free-step-" + i);
      expect(r.status).toBe(200);
      expect(r.data.purchase.price).toBe(0);
      expect(r.data.purchase.granted.openings).toHaveLength(1);
      expect(balance()).toBe(1000);
    }
    expect((await freeQuote()).freeRemaining).toBe(0);
    expect(inventory() - before).toBe(20);
    expect((await claim("free-sixth")).status).toBe(409);
    const paid = await buy("paid-after-five");
    expect(paid.status).toBe(200);
    expect(paid.data.purchase.price).toBe(200);
    expect(balance()).toBe(800);
  });
  it("same-key simultaneous requests consume one free pack and replay its persisted cards", async () => {
    const before = inventory();
    const q = await freeQuote();
    const body = {
      offerId: q.id,
      idempotencyKey: "free-same",
      quoteToken: q.purchaseQuote!.token,
      packRevision: q.booster!.revision,
    };
    const rs = await Promise.all(
      Array.from({ length: 8 }, () => call("POST", "/store/purchase", body)),
    );
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(new Set(rs.map((r) => r.data.purchase.purchaseId)).size).toBe(1);
    expect(inventory() - before).toBe(4);
    expect((await freeQuote()).freeRemaining).toBe(4);
    const replay = await call(
      "POST",
      "/store/purchase",
      { offerId: q.id, idempotencyKey: "free-same", receiptOnly: true },
      false,
    );
    expect(replay.data.purchase).toEqual(rs[0]!.data.purchase);
    expect(balance()).toBe(1000);
  });
  it("different-key concurrent claims cannot exceed five, including the last available pack", async () => {
    const before = inventory();
    const q = await freeQuote();
    const rs = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        call("POST", "/store/purchase", {
          offerId: q.id,
          idempotencyKey: "free-race-" + i,
          quoteToken: q.purchaseQuote!.token,
          packRevision: q.booster!.revision,
        }),
      ),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(5);
    expect(inventory() - before).toBe(20);
    expect(balance()).toBe(1000);
    expect((await freeQuote()).freeRemaining).toBe(0);
    expect(
      (
        db.sql
          .prepare(
            "SELECT COUNT(*) AS n FROM tactics_wallet_ledger WHERE user_id=? AND reason='STORE_PURCHASE'",
          )
          .get(account.id) as { n: number }
      ).n,
    ).toBe(0);
  });
  it("retains the free counter under a fresh authenticated session", async () => {
    await claim("free-session-1");
    await claim("free-session-2");
    db.sql.prepare("DELETE FROM sessions WHERE token=?").run(account.token);
    const token = "new-unit-session";
    db.sql
      .prepare("INSERT INTO sessions VALUES (?, ?, 0, ?)")
      .run(token, "tactics_qa_market", 4000000000000);
    account = { ...account, token };
    expect((await freeQuote()).freeRemaining).toBe(3);
    expect((await claim("free-session-3")).status).toBe(200);
    expect((await freeQuote()).freeRemaining).toBe(2);
  });
  it("counters are independent for another player and another configured expansion", async () => {
    for (let i = 0; i < 5; i++) await claim("free-origin-" + i);
    const source = boosterOffers(ctx).find((o) => o.booster?.freeGrant)!;
    const another = {
      ...source,
      id: "booster_qa_second_free",
      booster: { ...source.booster!, expansionId: "qa_second" },
    };
    store.catalog = [another];
    const q = (await call("GET", "/store/catalog")).data.offers.find(
      (o) => o.id === another.id,
    )!;
    expect(q.freeRemaining).toBe(5);
    expect(
      (
        await call("POST", "/store/purchase", {
          offerId: q.id,
          idempotencyKey: "second-expansion",
          quoteToken: q.purchaseQuote!.token,
          packRevision: q.booster!.revision,
        })
      ).status,
    ).toBe(200);
    expect((await freeQuote()).freeRemaining).toBe(0);
    account = addAccount(db, "tactics_qa_other");
    await call("POST", "/profile", {});
    expect((await freeQuote()).freeRemaining).toBe(5);
  });
  it("free and paid pools and weights are identical, and excluded cards stay owned", async () => {
    const free = boosterOffers(ctx).find((o) => o.booster?.freeGrant)!;
    expect(free.contents).toEqual(pack.contents);
    expect(free.booster!.weights).toEqual(pack.booster!.weights);
    db.sql
      .prepare(
        "UPDATE tactics_player_cards SET copies=5 WHERE user_id=? AND hero_id='mage' AND card_id='ice_wall'",
      )
      .run(account.id);
    const r = await claim("free-no-loss");
    expect(r.status).toBe(200);
    expect(ownedFor(r.data.profile!, "mage", content)("ice_wall")).toBe(5);
    expect(
      r.data.purchase.granted.cards.every((c) =>
        pack.contents.some((p) => p.kind === "CARD" && p.cardId === c.cardId),
      ),
    ).toBe(true);
  });
});

describe("legacy starter ownership must be preserved by real acquisitions", () => {
  it("regresses Blink: persisted 2 is visible as starter 3, so one delivered copy must become 4", async () => {
    db.sql
      .prepare(
        "UPDATE tactics_player_cards SET copies=2 WHERE user_id=? AND hero_id='mage' AND card_id='blink'",
      )
      .run(account.id);
    const before = await call("GET", "/state");
    expect(ownedFor(before.data.profile!, "mage", content)("blink")).toBe(3);
    // A real published single-card SKU, same authoritative grant path as packs.
    store.catalog = [
      {
        ...pack,
        id: "qa_blink_regression",
        booster: undefined,
        type: "CARD",
        heroId: "mage",
        contents: [{ kind: "CARD", cardId: "blink", copies: 1 }],
        purchaseLimit: null,
      },
    ];
    const q = (await call("GET", "/store/catalog")).data.offers.find(
      (o) => o.id === "qa_blink_regression",
    )!;
    const r = await call("POST", "/store/purchase", {
      offerId: q.id,
      idempotencyKey: "blink-floor-regression",
      quoteToken: q.purchaseQuote!.token,
    });
    expect(r.status).toBe(200);
    expect(r.data.purchase.granted.cards[0]!.total).toBe(4);
    expect(ownedFor(r.data.profile!, "mage", content)("blink")).toBe(4);
    const fresh = await call("GET", "/state");
    expect(ownedFor(fresh.data.profile!, "mage", content)("blink")).toBe(4);
  });
});

describe("receipt, persisted collection and useful deck progress", () => {
  const raw = (hero: string, id: string) =>
    (
      db.sql
        .prepare(
          "SELECT copies FROM tactics_player_cards WHERE user_id=? AND hero_id=? AND card_id=?",
        )
        .get(account.id, hero, id) as { copies: number } | undefined
    )?.copies ?? 0;
  const repeatBlink = () => {
    const common = pack.contents.filter(
      (c) =>
        c.kind === "CARD" && rarityOf(content.cards[c.cardId]!) === "COMMON",
    );
    const idx = common.findIndex(
      (c) => c.kind === "CARD" && c.cardId === "blink",
    );
    let n = 0;
    return vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = n++ % 2 === 0 ? 0 : idx;
      return array;
    });
  };
  async function purchase(offerId: string, key: string) {
    const q = (await call("GET", "/store/catalog")).data.offers.find(
      (o) => o.id === offerId,
    )!;
    return call("POST", "/store/purchase", {
      offerId,
      idempotencyKey: key,
      quoteToken: q.purchaseQuote!.token,
      packRevision: q.booster?.revision,
    });
  }
  it.each([0, 1, 2, 3, 5])(
    "a real non-starter common at %s/3 gains a copy without a collection cap",
    async (count) => {
      expect(content.cards.grapple!.rarity).toBe("COMMON");
      if (count)
        db.sql
          .prepare(
            "INSERT INTO tactics_player_cards(user_id,hero_id,card_id,copies,acquired,source,unlocked_at) VALUES (?,'warrior','grapple',?,0,'QA_BALANCE',?) ON CONFLICT(user_id,hero_id,card_id) DO UPDATE SET copies=excluded.copies",
          )
          .run(account.id, count, now);
      store.catalog = [
        {
          ...pack,
          id: "qa_grapple_copy",
          booster: undefined,
          type: "CARD",
          heroId: "warrior",
          contents: [{ kind: "CARD", cardId: "grapple", copies: 1 }],
          purchaseLimit: null,
        },
      ];
      const before = (await call("GET", "/state")).data;
      expect(ownedFor(before.profile!, "warrior", content)("grapple")).toBe(
        count,
      );
      const r = await purchase("qa_grapple_copy", "grapple-copy-" + count);
      expect(r.status).toBe(200);
      expect(r.data.purchase.granted.cards[0]!.copies).toBe(1);
      expect(r.data.purchase.granted.cards[0]!.total).toBe(count + 1);
      expect(raw("warrior", "grapple")).toBe(count + 1);
      expect(
        ownedFor(
          (await call("GET", "/state")).data.profile!,
          "warrior",
          content,
        )("grapple"),
      ).toBe(count + 1);
      expect(balance()).toBe(800);
      const replay = await purchase("qa_grapple_copy", "grapple-copy-" + count);
      expect(replay.data.purchase).toEqual(r.data.purchase);
      expect(raw("warrior", "grapple")).toBe(count + 1);
      expect(balance()).toBe(800);
    },
  );
  it.each([
    ["free", 1, 0],
    ["paid", 1, 200],
    ["paid", 5, 1000],
    ["paid", 10, 2000],
  ] as const)(
    "%s x%s: repeated Blink, reload, receipt-only recovery and concurrent same-key retry",
    async (kind, qty, price) => {
      db.sql.exec(
        qaGrantSql({
          username: "tactics_qa_market",
          amount: 5000,
          reference: "pack-regression",
          transactionId: "txn_qa_00000000-0000-4000-8000-000000000009",
          now,
        }),
      );
      db.sql
        .prepare(
          "UPDATE tactics_player_cards SET copies=2 WHERE user_id=? AND hero_id='mage' AND card_id='blink'",
        )
        .run(account.id);
      // This is specifically the Blink/Orígenes receipt regression, independent of catalog ordering.
      const q = (await call("GET", "/store/catalog")).data.offers.find((o) =>
        o.booster?.expansionId === "origins_arcanos" && (kind === "free"
          ? o.booster?.freeGrant
          : !o.booster?.freeGrant && o.booster?.packs === qty),
      )!;
      const payload = {
        offerId: q.id,
        idempotencyKey: "all-blink-" + kind + "-" + qty,
        quoteToken: q.purchaseQuote!.token,
        packRevision: q.booster!.revision,
      };
      const rng = repeatBlink();
      let r;
      try {
        r = await call("POST", "/store/purchase", payload);
      } finally {
        rng.mockRestore();
      }
      expect(r.status).toBe(200);
      expect(r.data.purchase.price).toBe(price);
      expect(r.data.purchase.granted.cards).toHaveLength(1);
      expect(r.data.purchase.granted.cards[0]).toMatchObject({
        cardId: "blink",
        copies: qty * 4,
        total: 3 + qty * 4,
      });
      const slots = r.data.purchase.granted.openings!.flatMap((o) => o.cards);
      expect(slots).toHaveLength(qty * 4);
      expect(slots.map((s) => s.total)).toEqual(
        Array.from({ length: qty * 4 }, (_, i) => 4 + i),
      );
      expect(raw("mage", "blink")).toBe(3 + qty * 4);
      expect(balance()).toBe(6000 - price);
      const fresh = (await call("GET", "/state")).data;
      expect(ownedFor(fresh.profile!, "mage", content)("blink")).toBe(
        3 + qty * 4,
      );
      const recoveries = await Promise.all(
        Array.from({ length: 6 }, () =>
          call("POST", "/store/purchase", {
            ...payload,
            quoteToken: undefined,
            receiptOnly: true,
          }),
        ),
      );
      for (const replay of recoveries) {
        expect(replay.status).toBe(200);
        expect(replay.data.purchase).toEqual(r.data.purchase);
        expect(ownedFor(replay.data.profile!, "mage", content)("blink")).toBe(
          3 + qty * 4,
        );
      }
      expect(raw("mage", "blink")).toBe(3 + qty * 4);
      expect(balance()).toBe(6000 - price);
      const after = (await call("GET", "/store/catalog")).data.offers.find(
        (o) => o.booster?.freeGrant,
      )!;
      expect(after.freeRemaining).toBe(kind === "free" ? 4 : 5);
      const history = await call("GET", "/store/purchases");
      expect(
        (history.data as unknown as { purchases: unknown[] }).purchases,
      ).toContainEqual(r.data.purchase);
    },
  );
  it("a missing starter row is materialized plus grant, never just the new copy", async () => {
    db.sql
      .prepare(
        "DELETE FROM tactics_player_cards WHERE user_id=? AND hero_id='mage' AND card_id='blink'",
      )
      .run(account.id);
    const rng = repeatBlink();
    let r;
    try {
      r = await purchase(pack.id, "missing-blink-starter");
    } finally {
      rng.mockRestore();
    }
    expect(r.status).toBe(200);
    expect(raw("mage", "blink")).toBe(7);
    expect(
      ownedFor(
        (await call("GET", "/state")).data.profile!,
        "mage",
        content,
      )("blink"),
    ).toBe(7);
  });
});

it("concurrent distinct free receipts retain all copies and get transaction-local reveal totals", async () => {
  db.sql
    .prepare(
      "UPDATE tactics_player_cards SET copies=2 WHERE user_id=? AND hero_id='mage' AND card_id='blink'",
    )
    .run(account.id);
  const q = (await call("GET", "/store/catalog")).data.offers.find(
    (o) => o.booster?.freeGrant,
  )!;
  const common = pack.contents.filter(
    (c) => c.kind === "CARD" && rarityOf(content.cards[c.cardId]!) === "COMMON",
  );
  const idx = common.findIndex(
    (c) => c.kind === "CARD" && c.cardId === "blink",
  );
  let n = 0;
  const rng = vi
    .spyOn(crypto, "getRandomValues")
    .mockImplementation((array) => {
      (array as Uint32Array)[0] = n++ % 2 === 0 ? 0 : idx;
      return array;
    });
  let results;
  try {
    results = await Promise.all(
      ["a", "b"].map((k) =>
        call("POST", "/store/purchase", {
          offerId: q.id,
          idempotencyKey: "concurrent-blink-" + k,
          quoteToken: q.purchaseQuote!.token,
          packRevision: q.booster!.revision,
        }),
      ),
    );
  } finally {
    rng.mockRestore();
  }
  expect(results.every((r) => r.status === 200)).toBe(true);
  expect(
    results
      .map((r) => r.data.purchase.granted.cards[0]!.total)
      .sort((a, b) => a - b),
  ).toEqual([7, 11]);
  expect(
    results
      .map((r) =>
        r.data.purchase.granted.openings![0]!.cards.map((c) => c.total),
      )
      .sort((a, b) => a[0]! - b[0]!),
  ).toEqual([
    [4, 5, 6, 7],
    [8, 9, 10, 11],
  ]);
  expect(
    ownedFor(
      (await call("GET", "/state")).data.profile!,
      "mage",
      content,
    )("blink"),
  ).toBe(11);
  expect(balance()).toBe(1000);
  expect(
    (await call("GET", "/store/catalog")).data.offers.find(
      (o) => o.booster?.freeGrant,
    )!.freeRemaining,
  ).toBe(3);
});
