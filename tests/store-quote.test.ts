import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONTENT,
  COSMETICS,
  PREMIUM_CURRENCY_ID,
  type StoreOffer,
} from "../src/game";
import { handle } from "../server/src/index";
import { ledgerStatement } from "../server/src/store";
import { STORE_QUOTE_TTL_MS, issueQuote } from "../server/src/storeQuote";
import type { Env } from "../server/src/db";
import { addAccount, memoryD1 } from "./support/d1";
import {
  purchaseError,
  readIntent,
  saveIntent,
  needsQuoteReview,
} from "../src/presentation/shop/presentation";
type Reply = {
  offers: { purchaseQuote: { token: string; expiresAt: number } }[];
  purchase: { price: number; purchaseId: string };
  error: { code: string };
  replayed: boolean;
};
const SECRET = "disposable-qa-quote-signing-key-not-a-production-secret";
const NOW = 1_800_000_000_000;
let now: number,
  ids: number,
  db: ReturnType<typeof memoryD1>,
  a: ReturnType<typeof addAccount>;
let offer: StoreOffer;
const deps = () => ({
  content: DEFAULT_CONTENT,
  now: () => now,
  seed: () => 7,
  store: {
    catalog: [offer],
    cosmetics: COSMETICS,
    newId: () => `quote-fixture-${++ids}`,
  },
});
const env = (): Env => ({ DB: db, STORE_QUOTE_SECRET: SECRET });
async function call(
  path: string,
  body?: unknown,
  token = a.token,
  settings = env(),
) {
  const r = await handle(
    new Request("https://qa.test/api/tactics" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    settings,
    deps(),
  );
  return {
    cacheControl: r.headers.get("Cache-Control"),
    status: r.status,
    body: (await r.json()) as Reply,
  };
}
const catalog = async () => (await call("/store/catalog")).body;
const tokenForOffer = async () =>
  (await catalog()).offers[0]!.purchaseQuote.token as string;
const purchase = (
  quoteToken?: unknown,
  key = "quote-key-0001",
  extra: Record<string, unknown> = {},
) =>
  call("/store/purchase", {
    offerId: offer.id,
    idempotencyKey: key,
    ...(quoteToken === undefined ? {} : { quoteToken }),
    ...extra,
  });
const snapshot = () =>
  JSON.stringify(
    [
      "tactics_player_cards",
      "tactics_wallets",
      "tactics_wallet_ledger",
      "tactics_store_purchases",
    ].map((t) => db.sql.prepare("SELECT * FROM " + t).all()),
  );
const copies = () =>
  (
    db.sql
      .prepare(
        "SELECT copies FROM tactics_player_cards WHERE user_id=? AND card_id='glacial_shell'",
      )
      .get(a.id) as { copies: number } | undefined
  )?.copies ?? 0;
const balance = () =>
  (
    db.sql
      .prepare("SELECT balance FROM tactics_wallets WHERE user_id=?")
      .get(a.id) as { balance: number }
  ).balance;
beforeEach(async () => {
  now = NOW;
  ids = 0;
  db = memoryD1({ legacyProfiles: true });
  a = addAccount(db, "tactics_qa_a");
  offer = {
    id: "quoted_rare",
    type: "CARD",
    title: "Rare",
    description: "",
    price: 250,
    currencyId: PREMIUM_CURRENCY_ID,
    heroId: "mage",
    contents: [{ kind: "CARD", cardId: "glacial_shell", copies: 1 }],
    categories: ["CARDS"],
    tags: [],
    startAt: null,
    endAt: null,
    purchaseLimit: null,
    sortOrder: 0,
  };
  expect((await call("/profile", {})).status).toBe(200);
  await db.batch([
    ledgerStatement(db, {
      userId: a.id,
      transactionId: "fund-quote-fixture",
      currencyId: PREMIUM_CURRENCY_ID,
      delta: 1000,
      reason: "QA_GRANT",
      referenceId: "local-only",
      note: "Disposable SQLite",
      now,
    }),
  ]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  db.sql.close();
});
describe("signed store quote confirmation", () => {
  it("does not cache personalized catalog quotes", async () => {
    expect((await call("/store/catalog")).cacheControl).toBe(
      "private, no-store",
    );
  });
  it("accepts a current quote and accumulates copies above deck capacity at the unchanged price", async () => {
    const cat = await catalog(),
      quote = cat.offers[0]!.purchaseQuote;
    expect(quote.expiresAt).toBe(NOW + STORE_QUOTE_TTL_MS);
    for (let i = 1; i <= 3; i++) {
      const r = await purchase(quote.token, `valid-quote-000${i}`);
      expect(r.status).toBe(200);
      expect(r.body.purchase.price).toBe(250);
      expect(copies()).toBe(i);
    }
    expect(balance()).toBe(250);
  });
  it("rejects an old tab without a quote, even if it sends the old price and release marker", async () => {
    const before = snapshot();
    const r = await purchase(undefined, "old-client-0001", {
      price: 1,
      clientRelease: "thunder-release-2",
    });
    expect(r.status).toBe(426);
    expect(r.body.error.code).toBe("QUOTE_REQUIRED");
    expect(snapshot()).toBe(before);
  });
  it("rejects expiration at its boundary without debit or grant", async () => {
    const quote = await tokenForOffer();
    now += STORE_QUOTE_TTL_MS;
    const before = snapshot();
    const r = await purchase(quote);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("QUOTE_EXPIRED");
    expect(snapshot()).toBe(before);
  });
  it("does not extend a quote past the authored end of an offer", async () => {
    offer.endAt = NOW + 30_000;
    const q = (await catalog()).offers[0]!.purchaseQuote;
    expect(q.expiresAt).toBe(offer.endAt);
    now = offer.endAt;
    expect((await purchase(q.token)).body.error.code).toBe("OFFER_UNAVAILABLE");
    expect(copies()).toBe(0);
    expect(balance()).toBe(1000);
  });
  for (const field of ["terms", "expiresAt", "userId", "offerId"])
    it(`rejects a manipulated ${field} with its old signature`, async () => {
      const token = await tokenForOffer(),
        [raw, sig] = token.split(".");
      const q = JSON.parse(Buffer.from(raw!, "base64url").toString());
      q[field] =
        field === "expiresAt"
          ? q.expiresAt + 999999
          : field === "userId"
            ? a.id + 1
            : field === "offerId"
              ? "another_offer"
              : "forged price and contents";
      const forged =
        Buffer.from(JSON.stringify(q)).toString("base64url") + "." + sig;
      const before = snapshot();
      expect((await purchase(forged)).body.error.code).toBe("QUOTE_INVALID");
      expect(snapshot()).toBe(before);
    });
  for (const bad of ["not-a-quote", 123, {}, "x".repeat(20_000)])
    it(`rejects malformed quote type/size ${typeof bad}/${String(bad).length}`, async () => {
      const before = snapshot();
      expect((await purchase(bad)).body.error.code).toBe("QUOTE_INVALID");
      expect(snapshot()).toBe(before);
    });
  it("binds the quote to the authenticated owner", async () => {
    const q = await tokenForOffer(),
      other = addAccount(db, "tactics_qa_b");
    await call("/profile", {}, other.token);
    const before = snapshot();
    const r = await call(
      "/store/purchase",
      { offerId: offer.id, idempotencyKey: "other-owner-01", quoteToken: q },
      other.token,
    );
    expect(r.body.error.code).toBe("QUOTE_INVALID");
    expect(snapshot()).toBe(before);
  });
  it("rejects an incompatible policy signed by an old server", async () => {
    const q = await tokenForOffer(),
      [raw] = q.split(".");
    const payload = JSON.parse(Buffer.from(raw!, "base64url").toString());
    payload.policy = "legacy-capped-policy";
    const changed = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = Buffer.from(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(changed)),
    ).toString("base64url");
    const before = snapshot();
    const r = await purchase(changed + "." + sig);
    expect(r.status).toBe(426);
    expect(r.body.error.code).toBe("QUOTE_UPDATE_REQUIRED");
    expect(snapshot()).toBe(before);
  });
  for (const changed of ["price", "currency", "contents"])
    it(`recomputes current ${changed} rather than trusting the signed old terms`, async () => {
      const q = await tokenForOffer();
      if (changed === "price") offer.price = 300;
      else if (changed === "currency") {
        // Keep a valid known currency; differing terms are covered through a direct signed old quote.
        const fakeOld = { ...offer, currencyId: "previous_currency" };
        const prior = await issueQuote(
          SECRET,
          a.id,
          fakeOld,
          { price: 250, contents: offer.contents },
          now,
        );
        const before = snapshot();
        expect((await purchase(prior.token)).body.error.code).toBe(
          "QUOTE_CHANGED",
        );
        expect(snapshot()).toBe(before);
        return;
      } else
        offer.contents = [{ kind: "CARD", cardId: "frost_nova", copies: 1 }];
      const before = snapshot();
      expect((await purchase(q)).body.error.code).toBe("QUOTE_CHANGED");
      expect(snapshot()).toBe(before);
    });
  it("rechecks expiration after asynchronous checks and before the transaction", async () => {
    const q = await tokenForOffer();
    let reads = 0;
    const d = deps();
    d.now = () => (++reads < 3 ? NOW : NOW + STORE_QUOTE_TTL_MS);
    const before = snapshot();
    const response = await handle(
      new Request("https://qa.test/api/tactics/store/purchase", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + a.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          offerId: offer.id,
          idempotencyKey: "late-submit-01",
          quoteToken: q,
        }),
      }),
      env(),
      d,
    );
    expect(((await response.json()) as Reply).error.code).toBe("QUOTE_EXPIRED");
    expect(snapshot()).toBe(before);
  });
  it("recovers a completed receipt before expiry, missing-secret and quote validation", async () => {
    const q = await tokenForOffer(),
      first = await purchase(q);
    expect(first.status).toBe(200);
    now += STORE_QUOTE_TTL_MS * 2;
    const before = snapshot();
    for (const body of [
      { offerId: offer.id, idempotencyKey: "quote-key-0001" },
      {
        offerId: offer.id,
        idempotencyKey: "quote-key-0001",
        quoteToken: "bad",
        receiptOnly: true,
      },
    ]) {
      const r = await call("/store/purchase", body, a.token, { DB: db });
      expect(r.status).toBe(200);
      expect(r.body.replayed).toBe(true);
      expect(r.body.purchase).toEqual(first.body.purchase);
    }
    expect(snapshot()).toBe(before);
  });
  it("recovers a receipt made by the old published contract without a quote", async () => {
    db.sql
      .prepare(
        "INSERT INTO tactics_store_purchases(purchase_id,user_id,idempotency_key,offer_id,currency_id,price,status,offer_json,granted_json,created_at,updated_at) VALUES('historic-receipt',?,'historic-key-01',?, ?,130,'COMPLETED','{}','{\"cards\":[],\"cosmetics\":[]}',?,?)",
      )
      .run(a.id, offer.id, PREMIUM_CURRENCY_ID, now, now);
    const before = snapshot();
    const r = await purchase(undefined, "historic-key-01");
    expect(r.status).toBe(200);
    expect(r.body.purchase.price).toBe(130);
    expect(snapshot()).toBe(before);
  });
  it("same-key concurrent confirmations debit and grant once", async () => {
    const q = await tokenForOffer();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => purchase(q)),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(results.map((r) => r.body.purchase.purchaseId)).size).toBe(
      1,
    );
    expect(balance()).toBe(750);
    expect(copies()).toBe(1);
  });
  it("same-key races still recover a receipt when the offer has a one-purchase commercial limit", async () => {
    offer.purchaseLimit = 1;
    const q = await tokenForOffer();
    const results = await Promise.all([purchase(q), purchase(q), purchase(q)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(copies()).toBe(1);
    expect(balance()).toBe(750);
  });
  it("distinct legitimate purchases can reuse still-current terms while commercial limits remain enforced", async () => {
    const q = await tokenForOffer();
    const result = await Promise.all([
      purchase(q, "distinct-key-01"),
      purchase(q, "distinct-key-02"),
    ]);
    expect(result.map((r) => r.status)).toEqual([200, 200]);
    expect(copies()).toBe(2);
    expect(balance()).toBe(500);
    offer.purchaseLimit = 2;
    const before = snapshot();
    expect((await purchase(q, "distinct-key-03")).status).toBe(409);
    expect(snapshot()).toBe(before);
  });
  it("same key for another offer does not expose or reinterpret the receipt", async () => {
    await purchase(await tokenForOffer());
    const before = snapshot();
    const r = await call("/store/purchase", {
      offerId: "other_offer",
      idempotencyKey: "quote-key-0001",
    });
    expect(r.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(snapshot()).toBe(before);
  });
  it("read-only recovery never initiates a new purchase, even with a valid quote", async () => {
    const q = await tokenForOffer(),
      before = snapshot();
    const r = await purchase(q, "unknown-key-01", { receiptOnly: true });
    expect(r.body.error.code).toBe("PURCHASE_NOT_FOUND");
    expect(snapshot()).toBe(before);
  });
  it("refreshed explicit confirmation keeps the same key; late old completion wins safely", async () => {
    const old = await tokenForOffer();
    now += STORE_QUOTE_TTL_MS;
    expect((await purchase(old)).body.error.code).toBe("QUOTE_EXPIRED");
    const fresh = await tokenForOffer();
    const done = await purchase(fresh);
    expect(done.status).toBe(200);
    expect((await purchase(old)).body.purchase.purchaseId).toBe(
      done.body.purchase.purchaseId,
    );
    expect(balance()).toBe(750);
    expect(copies()).toBe(1);
  });
  it("missing signing configuration fails closed for new purchases but not receipt recovery", async () => {
    const before = snapshot();
    const c = await call("/store/catalog", undefined, a.token, { DB: db });
    expect(c.status).toBe(503);
    const r = await call(
      "/store/purchase",
      { offerId: offer.id, idempotencyKey: "no-key-config-01" },
      a.token,
      { DB: db },
    );
    expect(r.status).toBe(503);
    expect(snapshot()).toBe(before);
  });
});
describe("frontend transport and pending intent safety", () => {
  it('gift requotes and retry recovery retain the same key for the same target',async()=>{
    const {giftConfirmation}=await import('../src/presentation/gifts/api');let ids=0;const mint=()=>`client-key-${++ids}`;
    const initial=giftConfirmation(null,'quoted_rare','bruno',mint);
    expect(giftConfirmation(initial,'quoted_rare',' Bruno ',mint)).toEqual(initial);
    expect(giftConfirmation(initial,'quoted_rare','carla',mint).key).not.toBe(initial.key);
    expect(giftConfirmation(null,'quoted_rare','bruno',mint).key).not.toBe(initial.key);
  });
  it("sends precisely the confirmed token and uses a separate receipt-only recovery", async () => {
    vi.stubEnv("VITE_TACTICS_API_URL", "https://qa.invalid");
    vi.resetModules();
    const { storeApi } = await import("../src/presentation/shop/api");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    await storeApi.purchase(
      "local-session",
      offer.id,
      "transport-key-01",
      "signed-original-quote",
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({
      offerId: offer.id,
      idempotencyKey: "transport-key-01",
      quoteToken: "signed-original-quote",
    });
    await storeApi.purchase(
      "local-session",
      offer.id,
      "transport-key-01",
      undefined,
      true,
    );
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual({
      offerId: offer.id,
      idempotencyKey: "transport-key-01",
      receiptOnly: true,
    });
  });
  it("preserves quote and stable identifier across reloads; legacy intents remain receipt-recoverable", () => {
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, v),
      removeItem: (k: string) => map.delete(k),
    });
    const pending = {
      username: "tactics_qa_a",
      offerId: offer.id,
      key: "persistent-key-01",
      quote: { token: "unchanged-token", expiresAt: NOW + 5000 },
    };
    saveIntent(pending);
    expect(readIntent(pending.username)).toEqual(pending);
    expect(readIntent("other")).toBeNull();
    const legacy = {
      username: pending.username,
      offerId: offer.id,
      key: "legacy-pending-01",
    };
    saveIntent(legacy);
    expect(readIntent(legacy.username)).toEqual(legacy);
  });
  it("does not discard a stable identifier on a quote rejection and explains recovery/update", () => {
    for (const code of [
      "QUOTE_REQUIRED",
      "QUOTE_UPDATE_REQUIRED",
      "QUOTE_INVALID",
      "QUOTE_EXPIRED",
      "QUOTE_CHANGED",
      "PURCHASE_NOT_FOUND",
    ]) {
      expect(needsQuoteReview(code)).toBe(true);
      expect(
        purchaseError({ kind: "REJECTED", status: 409, code, message: "" }),
      ).not.toContain("No se pudo completar la compra");
    }
    expect(needsQuoteReview("INSUFFICIENT_FUNDS")).toBe(false);
  });
});
