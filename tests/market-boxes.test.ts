import { it, expect } from "vitest";
import { memoryD1 } from "./support/d1";
import {
  boxTotal,
  createBoxStock,
  drawBox,
  validBoxSnapshot,
} from "../src/game/store/boxes";
import { DEFAULT_CONTENT } from "../src/game/data";
import { withArcher } from "../src/game/data/archer";
import { MARKET_EXPANSIONS } from "../src/game/store/market-expansions";
import {
  MARKET_BOX_ULTRAS,
  MARKET_SEARCHERS,
} from "../src/game/data/market-box-cards";
import { boosterOffers } from "../server/src/boosters";
import { releasedContent } from "../server/src/ritualRelease";
import { MARKET_FLAGS, marketFixture } from "./support/marketReorg";
import { COSMETICS, DECK_RULES, copyLimit, validateDeck } from "../src/game";
const referenceDb = memoryD1();
const content = releasedContent(withArcher(DEFAULT_CONTENT), {
  ...MARKET_FLAGS,
  DB: referenceDb,
});
referenceDb.sql.close();
const ctx = { content, cosmetics: COSMETICS, rules: DECK_RULES };
const packs = boosterOffers(ctx);
for (const e of MARKET_EXPANSIONS.filter((e) => e.status === "AVAILABLE"))
  it(`${e.id}: exactly one of each Ultra, complete 80-card stock, no replacement`, () => {
    const offer = packs.find((o) => o.booster?.expansionId === e.id)!;
    expect(offer, `Missing ${e.id}`).toBeTruthy();
    const cards = offer.contents.flatMap((c) =>
      c.kind === "CARD" ? [content.cards[c.cardId]!] : [],
    );
    const stock = createBoxStock(cards);
    expect(boxTotal(stock)).toBe(80);
    const ultras = cards.filter((c) => c.rarity === "ULTRA");
    expect(ultras.length).toBeGreaterThanOrEqual(2);
    for (const u of ultras) expect(stock[u.id]).toBe(1);
    const drawn = drawBox(stock, 80, () => 0);
    expect(boxTotal(drawn.remaining)).toBe(0);
    for (const u of ultras)
      expect(drawn.slots.filter((id) => id === u.id)).toHaveLength(1);
    expect(() => drawBox(drawn.remaining, 4, () => 0)).toThrow();
    expect(boxTotal(stock)).toBe(80);
  });
it("only Mundo Gélido is reclassified; its effect and cost remain and two copies are legal", () => {
  const c = content.cards.absolute_zero!;
  expect(c.cost).toBe(4);
  expect(c.rarity).toBe("ULTRA");
  expect(copyLimit(c, DECK_RULES)).toBe(2);
  expect(c.effects).toEqual([
    {
      type: "APPLY_STATUS",
      status: "ABSOLUTE_ZERO",
      duration: 10,
      to: "CASTER",
    },
  ]);
  expect(
    validateDeck(
      [{ cardId: c.id, count: 2 }],
      "mage",
      () => 100,
      content,
      DECK_RULES,
    ).some((i) => ["COPY_LIMIT", "ULTRA_LIMIT"].includes(i.code)),
  ).toBe(false);
  expect(MARKET_BOX_ULTRAS).toHaveLength(8);
  expect(MARKET_SEARCHERS).toHaveLength(6);
});
it("invalid rolls and corrupt inventories fail closed", () => {
  expect(() => drawBox({ x: 1 }, 1, () => NaN)).toThrow();
  expect(() => drawBox({ x: 1 }, 2, () => 0)).toThrow();
  expect(
    validBoxSnapshot({
      generation: 1,
      version: 0,
      revision: "v1",
      initial: { a: 1 },
      remaining: { a: 2 },
    }),
  ).toBe(false);
});
async function fixture() {
  const f = await marketFixture();
  return f;
}
it("free, paid, reset CAS and historical receipt recovery are atomic in real SQLite", async () => {
  const f = await fixture();
  try {
    const id = "booster_antarctic_magic_free";
    const cat = await f.catalog();
    expect(cat.offers?.length).toBeGreaterThan(0);
    const offer = cat.offers.find((o: { id: string }) => o.id === id);
    expect(offer.booster.box.generation).toBe(1);
    const body = {
      offerId: id,
      idempotencyKey: "finite-free-first",
      quoteToken: offer.purchaseQuote.token,
      packRevision: offer.booster.revision,
      packFormat: "GENERAL_BATCH_V1",
      boxFormat: "FINITE_BOX_V1",
    };
    const r = await f.call("POST", "/store/purchase", body);
    expect(r.status).toBe(200);
    expect(r.data.purchase.price).toBe(0);
    expect(r.data.purchase.granted.opening.cards).toHaveLength(4);
    const after = await f.catalog(),
      next = after.offers.find((o: { id: string }) => o.id === id);
    expect(boxTotal(next.booster.box.remaining)).toBe(76);
    expect(next.freeRemaining).toBe(2);
    const replay = await f.call("POST", "/store/purchase", {
      ...body,
      receiptOnly: true,
    });
    expect(replay.data.replayed).toBe(true);
    expect(replay.data.purchase).toEqual(r.data.purchase);
    const reset = {
      expansionId: "antarctic_magic",
      idempotencyKey: "reset-first",
      generation: 1,
      version: 1,
    };
    expect((await f.call("POST", "/store/box/reset", reset)).status).toBe(200);
    expect(
      (await f.call("POST", "/store/box/reset", reset)).data.replayed,
    ).toBe(true);
    const fresh = await f.catalog(),
      o = fresh.offers.find((o: { id: string }) => o.id === id);
    expect(o.booster.box.generation).toBe(2);
    expect(boxTotal(o.booster.box.remaining)).toBe(80);
    expect(o.freeRemaining).toBe(2);
    expect(
      (
        await f.call("POST", "/store/purchase", {
          ...body,
          idempotencyKey: "stale-after-reset",
        })
      ).status,
    ).toBe(409);
    expect(
      (await f.call("POST", "/store/purchase", { ...body, receiptOnly: true }))
        .data.purchase,
    ).toEqual(r.data.purchase);
  } finally {
    f.db.sql.close();
  }
});
it("concurrent purchases and resets share generation CAS; same-key retries never duplicate grants", async () => {
  const f = await fixture();
  try {
    const id = "booster_thunder_god_free";
    const o = (await f.catalog()).offers.find(
      (o: { id: string }) => o.id === id,
    );
    const payload = {
      offerId: id,
      quoteToken: o.purchaseQuote.token,
      packRevision: o.booster.revision,
      packFormat: "GENERAL_BATCH_V1",
      boxFormat: "FINITE_BOX_V1",
    };
    const attempts = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        f.call("POST", "/store/purchase", {
          ...payload,
          idempotencyKey: "tab-finite-" + i,
        }),
      ),
    );
    expect(attempts.filter((r) => r.status === 200)).toHaveLength(1);
    const win = attempts.find((r) => r.status === 200)!.data.purchase;
    const row = f.db.sql
      .prepare(
        "SELECT idempotency_key FROM tactics_store_purchases WHERE purchase_id=?",
      )
      .get(win.purchaseId)!;
    const replays = await Promise.all(
      Array.from({ length: 6 }, () =>
        f.call("POST", "/store/purchase", {
          ...payload,
          idempotencyKey: row.idempotency_key,
          receiptOnly: true,
        }),
      ),
    );
    expect(
      replays.every(
        (r) =>
          r.status === 200 &&
          r.data.replayed &&
          r.data.purchase.purchaseId === win.purchaseId,
      ),
    ).toBe(true);
    const next = (await f.catalog()).offers.find(
      (o: { id: string }) => o.id === id,
    );
    expect(boxTotal(next.booster.box.remaining)).toBe(76);
    expect(next.freeRemaining).toBe(2);
    const purchase = {
      ...payload,
      quoteToken: next.purchaseQuote.token,
      idempotencyKey: "race-purchase",
    };
    const reset = {
      expansionId: "thunder_god",
      idempotencyKey: "race-reset",
      generation: 1,
      version: 1,
    };
    const race = await Promise.all([
      f.call("POST", "/store/purchase", purchase),
      f.call("POST", "/store/box/reset", reset),
    ]);
    expect(race.filter((r) => r.status === 200)).toHaveLength(1);
    const final = (await f.catalog()).offers.find(
      (o: { id: string }) => o.id === id,
    );
    expect([72, 80]).toContain(boxTotal(final.booster.box.remaining));
    expect((await f.call("GET", "/wallet")).data.wallet.balance).toBe(30000);
  } finally {
    f.db.sql.close();
  }
});
it("x1/x5/x10 have exact debit and stock consumption; full exhaustion contains both Ultras", async () => {
  const f = await fixture();
  try {
    for (const [n, left] of [
      [10, 40],
      [5, 20],
      [1, 16],
      [1, 12],
      [1, 8],
      [1, 4],
      [1, 0],
    ]) {
      const id = `booster_origins_arcanos_x${n}`,
        before = (await f.call("GET", "/wallet")).data.wallet.balance;
      const r = await f.buy(id, `stock-case-${left}`);
      expect(r.status).toBe(200);
      expect(r.data.purchase.price).toBe(n! * 50);
      expect(r.data.purchase.granted.openings).toHaveLength(n!);
      expect((await f.call("GET", "/wallet")).data.wallet.balance).toBe(
        before - n! * 50,
      );
      const o = (await f.catalog()).offers.find(
        (o: { id: string }) => o.id === id,
      );
      expect(boxTotal(o.booster.box.remaining)).toBe(left);
    }
    const cat = await f.catalog();
    expect(
      cat.offers
        .filter(
          (o: { booster?: { expansionId: string } }) =>
            o.booster?.expansionId === "origins_arcanos",
        )
        .every(
          (o: { availability: { purchasable: boolean } }) =>
            !o.availability.purchasable,
        ),
    ).toBe(true);
    const cards = f.db.sql
      .prepare("SELECT granted_json FROM tactics_store_purchases")
      .all()
      .flatMap((r) =>
        JSON.parse(r.granted_json as string).openings.flatMap(
          (o: { cards: { cardId: string }[] }) => o.cards,
        ),
      );
    for (const id of ["arcane_confluence", "arcane_balance"])
      expect(
        cards.filter((c: { cardId: string }) => c.cardId === id),
      ).toHaveLength(1);
    const other = (await f.catalog()).offers.find(
      (o: { id: string }) => o.id === "booster_thunder_god_x1",
    );
    expect(boxTotal(other.booster.box.remaining)).toBe(80);
  } finally {
    f.db.sql.close();
  }
});
it("existing history, five Origins freebies, independent counters and reset-only changes", async () => {
  const f = await fixture();
  try {
    await f.call("POST", "/store/launch-reward/claim", {});
    f.db.sql
      .prepare(
        `INSERT INTO tactics_store_purchases(purchase_id,user_id,idempotency_key,offer_id,currency_id,price,status,offer_json,granted_json,created_at,updated_at) VALUES('historic-paid',?,'historic-key','booster_thunder_god_x1','arcane_crystals',200,'COMPLETED','{}','{"cards":[],"cosmetics":[]}',1,1)`,
      )
      .run(f.account.id);
    const c = await f.catalog();
    for (const o of c.offers.filter(
      (o: { booster?: { freeGrant: boolean } }) => o.booster?.freeGrant,
    )) {
      expect(o.freeRemaining).toBe(o.id.includes("origins_arcanos") ? 5 : 3);
      expect(boxTotal(o.booster.box.remaining)).toBe(80);
    }
    const receipt = (
      await f.call("POST", "/store/purchase", {
        offerId: "booster_thunder_god_x1",
        idempotencyKey: "historic-key",
        receiptOnly: true,
      })
    ).data.purchase;
    expect(receipt.price).toBe(200);
    const before = (await f.call("GET", "/state")).data.profile,
      wallet = (await f.call("GET", "/wallet")).data.wallet.balance,
      grant = (await f.call("GET", "/store/launch-reward")).data;
    for (let n = 1; n <= 3; n++)
      expect(
        (
          await f.call("POST", "/store/box/reset", {
            expansionId: "thunder_god",
            generation: n,
            version: n - 1,
            idempotencyKey: "consecutive-reset-" + n,
          })
        ).status,
      ).toBe(200);
    expect((await f.call("GET", "/state")).data.profile).toEqual(before);
    expect((await f.call("GET", "/wallet")).data.wallet.balance).toBe(wallet);
    expect((await f.call("GET", "/store/launch-reward")).data).toEqual(grant);
    const current = await f.catalog();
    expect(
      current.offers.find(
        (o: { id: string }) => o.id === "booster_thunder_god_free",
      ).booster.box.generation,
    ).toBe(4);
    expect(
      current.offers.find(
        (o: { id: string }) => o.id === "booster_origins_arcanos_free",
      ).booster.box.generation,
    ).toBe(1);
  } finally {
    f.db.sql.close();
  }
});
it("late transaction failure rolls back stock, money, collection and receipt together", async () => {
  const f = await fixture();
  try {
    const c = await f.catalog(),
      before = (await f.call("GET", "/state")).data.profile,
      wallet = (await f.call("GET", "/wallet")).data.wallet.balance;
    f.db.sql.exec(
      "CREATE TRIGGER fail_late BEFORE UPDATE ON tactics_profiles BEGIN SELECT RAISE(ABORT,'QA late failure'); END;",
    );
    expect((await f.buy("booster_thunder_god_x1", "late-failure")).status).toBe(
      409,
    );
    expect((await f.call("GET", "/wallet")).data.wallet.balance).toBe(wallet);
    expect((await f.call("GET", "/state")).data.profile).toEqual(before);
    const next = await f.catalog();
    expect(
      next.offers.find((o: { id: string }) => o.id === "booster_thunder_god_x1")
        .booster.box,
    ).toEqual(
      c.offers.find((o: { id: string }) => o.id === "booster_thunder_god_x1")
        .booster.box,
    );
    expect(
      f.db.sql
        .prepare("SELECT COUNT(*) AS n FROM tactics_store_purchases")
        .get()?.n,
    ).toBe(0);
  } finally {
    f.db.sql.close();
  }
});
it("advertises the actual next-draw Ultra probability, never legacy zero weights", async () => {
  const f = await fixture();
  try {
    for (const o of (await f.catalog()).offers.filter(
      (o: { booster?: { inventory: string } }) =>
        o.booster?.inventory === "FINITE",
    )) {
      expect(o.booster.weights.ULTRA).toBe(2.5);
      expect(
        Object.values(o.booster.weights).reduce(
          (n: number, v) => n + Number(v),
          0,
        ),
      ).toBeCloseTo(100, 10);
    }
  } finally {
    f.db.sql.close();
  }
});
it('pool revision never replenishes stock or freebies; only an explicit reset starts a new pool',async()=>{
 const f=await fixture();try{
 await f.buy('booster_antarctic_magic_free','revision-free');const before=(await f.catalog()).offers.find((o:{id:string})=>o.id==='booster_antarctic_magic_free');
 Object.assign(f.deps.store,{packPolicy:{...before.booster,box:undefined,revision:'qa-future-pool-revision'}});
 const after=(await f.catalog()).offers.find((o:{id:string})=>o.id==='booster_antarctic_magic_free');expect(after.freeRemaining).toBe(2);expect(after.booster.box).toEqual(before.booster.box);
 expect((await f.call('POST','/store/box/reset',{expansionId:'antarctic_magic',generation:1,version:1,idempotencyKey:'revision-reset'})).status).toBe(200);
 const reset=(await f.catalog()).offers.find((o:{id:string})=>o.id==='booster_antarctic_magic_free');expect(reset.freeRemaining).toBe(2);expect(reset.booster.box.revision).toBe('qa-future-pool-revision');expect(boxTotal(reset.booster.box.remaining)).toBe(80);
 }finally{f.db.sql.close();}
});
it('old clients cannot buy from a finite box and lose no balance, stock or cards',async()=>{
 const f=await fixture();try{const offer=(await f.catalog()).offers.find((o:{id:string})=>o.id==='booster_origins_arcanos_x1'),before=(await f.call('GET','/state')).data.profile;
 const response=await f.call('POST','/store/purchase',{offerId:offer.id,idempotencyKey:'legacy-client-attempt',quoteToken:offer.purchaseQuote.token,packRevision:offer.booster.revision,packFormat:'GENERAL_BATCH_V1'});
 expect(response.status).toBe(409);expect(response.data.error.code).toBe('PACK_CLIENT_UPDATE_REQUIRED');expect((await f.call('GET','/wallet')).data.wallet.balance).toBe(30000);expect((await f.call('GET','/state')).data.profile).toEqual(before);expect((await f.catalog()).offers.find((o:{id:string})=>o.id===offer.id).booster.box).toEqual(offer.booster.box);
 }finally{f.db.sql.close();}
});
