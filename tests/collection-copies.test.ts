import { beforeEach, describe, it, expect } from "vitest";
import {
  ASCENT_CAMPAIGN,
  DEFAULT_CONTENT,
  DECK_RULES,
  COSMETICS,
  PREMIUM_CURRENCY_ID,
  createProfile,
  createRun,
  serializeRun,
  serializeProfile,
  parseProfileSave,
  grantCard,
  ownedFor,
  usableCopies,
  validateDeck,
  rollReward,
  PITY_THRESHOLD,
  type PlayerProfile,
  type StoreOffer,
} from "../src/game";
import { handle } from "../server/src/index";
import {
  loadPlayer,
  saveCampaignStep,
  worldCompletionStatements,
} from "../server/src/repo";
import { cardGrantStatements, ledgerStatement } from "../server/src/store";
import { sanitizeLocalImport } from "../server/src/importLocal";
import { addAccount, memoryD1 } from "./support/d1";
let db: ReturnType<typeof memoryD1>;
let serial = 0;
const now = 1_800_000_000_000;
const offer: StoreOffer = {
  id: "rare_copy",
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
const deps = {
  content: DEFAULT_CONTENT,
  now: () => now,
  seed: () => 7,
  store: {
    catalog: [offer],
    cosmetics: COSMETICS,
    newId: () => `test-copy-${++serial}`,
  },
};
const QUOTE_TEST_SECRET = 'disposable-collection-quote-fixture-not-production';
async function call(token: string, path: string, body?: unknown) {
  if (path === '/store/purchase' && body && typeof body === 'object' && !('quoteToken' in body)) {
    const response = await call(token, '/store/catalog');
    const offers = (response.body as unknown as {offers:{id:string;purchaseQuote:{token:string}}[]}).offers;
    const sale = body as {offerId:string};
    body = {...body,quoteToken:offers.find(o=>o.id===sale.offerId)?.purchaseQuote.token};
  }
  const r = await handle(
    new Request("https://qa.test/api/tactics" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { DB: db, STORE_QUOTE_SECRET:QUOTE_TEST_SECRET },
    deps,
  );
  return {
    status: r.status,
    body: (await r.json()) as {
      profile: PlayerProfile;
      error?: { code: string };
      purchase?: { price: number };
    },
  };
}
async function account() {
  const a = addAccount(db, "tactics_qa_a");
  await call(a.token, "/profile", {});
  return a;
}
const count = (id: number, card = "glacial_shell") =>
  (
    db.sql
      .prepare(
        "SELECT copies FROM tactics_player_cards WHERE user_id=? AND hero_id=? AND card_id=?",
      )
      .get(id, "mage", card) as { copies: number } | undefined
  )?.copies ?? 0;
async function pending(id: number) {
  const base = createRun(ASCENT_CAMPAIGN, DEFAULT_CONTENT, 7);
  const reward = {
    id: "copy-offer-r1",
    kind: "ADD_CARD" as const,
    cardId: "glacial_shell",
    rarity: "RARE" as const,
  };
  const run = {
    ...base,
    status: "CHOOSING_REWARD" as const,
    rewardOptions: [reward],
    completedEncounterIds: [base.currentEncounterId],
  };
  db.sql
    .prepare(
      "INSERT INTO tactics_hero_campaign_runs(user_id,campaign_id,hero_id,run_json,save_version,updated_at) VALUES(?,?,?,?,1,?) ON CONFLICT(user_id,campaign_id,hero_id) DO UPDATE SET run_json=excluded.run_json",
    )
    .run(id, run.campaignId, "mage", serializeRun(run), now);
  return run;
}
beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
  serial = 0;
});
describe("accumulated ownership stays independent from deck rules", () => {
  it("preserves first, second and third rare copies through serialization and hypothetical deck-limit changes", () => {
    let profile = createProfile(DEFAULT_CONTENT);
    for (let n = 1; n <= 3; n++) {
      const g = grantCard(
        profile,
        "summoner",
        "summon_ash_hound",
        DEFAULT_CONTENT,
      );
      if (!g.ok) throw Error(g.error);
      profile = g.profile;
      const parsed = parseProfileSave(
        serializeProfile(profile),
        DEFAULT_CONTENT,
      );
      expect(parsed.status).toBe("OK");
      if (parsed.status !== "OK") throw Error("parse");
      profile = parsed.profile;
      const owns = ownedFor(profile, "summoner", DEFAULT_CONTENT);
      expect(owns("summon_ash_hound")).toBe(n);
      expect(
        usableCopies("summon_ash_hound", owns, DEFAULT_CONTENT, DECK_RULES),
      ).toBe(1);
    }
    const changed = {
      ...DECK_RULES,
      maxCopiesByRarity: { ...DECK_RULES.maxCopiesByRarity, RARE: 2 },
    };
    const owns = ownedFor(profile, "summoner", DEFAULT_CONTENT);
    expect(
      usableCopies("summon_ash_hound", owns, DEFAULT_CONTENT, changed),
    ).toBe(2);
    expect(owns("summon_ash_hound")).toBe(3);
    expect(
      validateDeck(
        [{ cardId: "summon_ash_hound", count: 2 }],
        "summoner",
        owns,
        DEFAULT_CONTENT,
        DECK_RULES,
      ).some((i) => i.code === "COPY_LIMIT"),
    ).toBe(true);
    expect(
      validateDeck(
        [{ cardId: "summon_ash_hound", count: 4 }],
        "summoner",
        owns,
        DEFAULT_CONTENT,
        changed,
      ).length,
    ).toBeGreaterThan(0);
  });
  it("authored drops remain available above deck capacity without changing chance or quantity", () => {
    const result = rollReward({
      content: DEFAULT_CONTENT,
      heroId: "mage",
      owned: () => 5,
      pity: PITY_THRESHOLD,
      rules: DECK_RULES,
      poolId: "NORMAL",
      seed: 1,
      count: 3,
      authored: ["glacial_shell"],
    });
    expect(result.options).toEqual([
      expect.objectContaining({
        kind: "ADD_CARD",
        cardId: "glacial_shell",
        isNew: false,
      }),
    ]);
  });
  it("keeps legacy import allowance independent of future deck caps and refuses unverifiable excess", () => {
    const profile = createProfile(DEFAULT_CONTENT);
    profile.heroes.mage!.collection.glacial_shell = {
      copies: 500,
      acquired: 1,
    };
    const rules = {
      ...DECK_RULES,
      maxCopiesByRarity: { ...DECK_RULES.maxCopiesByRarity, RARE: 5 },
    };
    const imported = sanitizeLocalImport(
      serializeProfile(profile),
      {},
      DEFAULT_CONTENT,
      rules,
    );
    expect(imported.profile.heroes.mage!.collection.glacial_shell!.copies).toBe(
      1,
    );
    expect(imported.notes.some((n) => n.includes("unverified surplus"))).toBe(
      true,
    );
  });
  it("legitimate repeated purchases increment 0→1→2→3 and survive state reload without changing price", async () => {
    const a = await account();
    await db.batch([
      ledgerStatement(db, {
        transactionId: `fund-${++serial}`,
        userId: a.id,
        currencyId: PREMIUM_CURRENCY_ID,
        delta: 2000,
        reason: "QA_GRANT",
        referenceId: "local-fixture",
        note: "Disposable SQLite test",
        now,
      }),
    ]);
    for (let n = 1; n <= 3; n++) {
      const r = await call(a.token, "/store/purchase", {
        offerId: offer.id,
        idempotencyKey: `rare-copy-key-${n}`,
      });
      expect(r.status).toBe(200);
      expect(r.body.purchase!.price).toBe(250);
      expect(
        (await call(a.token, "/state")).body.profile.heroes.mage!.collection
          .glacial_shell!.copies,
      ).toBe(n);
    }
  });
  it("duplicate request keys grant once; distinct concurrent purchases both increment", async () => {
    const a = await account();
    await db.batch([
      ledgerStatement(db, {
        transactionId: `fund-${++serial}`,
        userId: a.id,
        currencyId: PREMIUM_CURRENCY_ID,
        delta: 2000,
        reason: "QA_GRANT",
        referenceId: "local-fixture",
        note: "Disposable SQLite test",
        now,
      }),
    ]);
    const buy = (key: string) =>
      call(a.token, "/store/purchase", {
        offerId: offer.id,
        idempotencyKey: key,
      });
    expect(
      (
        await Promise.all([buy("duplicate-key-01"), buy("duplicate-key-01")])
      ).map((r) => r.status),
    ).toEqual([200, 200]);
    expect(count(a.id)).toBe(1);
    expect(
      (
        await Promise.all([buy("different-key-02"), buy("different-key-03")])
      ).map((r) => r.status),
    ).toEqual([200, 200]);
    expect(count(a.id)).toBe(3);
  });
  it("campaign and purchase use atomic deltas despite both planning from the same inventory", async () => {
    const a = await account();
    const run = await pending(a.id);
    const record = (await loadPlayer(db, a.id, DEFAULT_CONTENT))!;
    const next = {
      ...run,
      status: "IN_BATTLE" as const,
      rewardOptions: [],
      chosenRewards: [
        { encounterId: run.currentEncounterId, reward: run.rewardOptions[0]! },
      ],
    };
    const step = {
      run: next,
      expectedRevision: record.campaignRevisions![`${run.campaignId}:mage`],
      grant: {
        ownerId: "mage",
        cardId: "glacial_shell",
        copies: 1,
        acquired: 1,
        source: "NORMAL_DROP" as const,
      },
      log: {
        campaignId: run.campaignId,
        heroId: "mage",
        runSeed: run.seed,
        encounterId: run.currentEncounterId,
        pool: "NORMAL",
        event: "CLAIMED" as const,
        offered: null,
        chosen: run.rewardOptions[0],
        pityBefore: 0,
        pityAfter: 0,
      },
    };
    const storeGrant = () =>
      db.batch(
        cardGrantStatements(
          db,
          a.id,
          record,
          DEFAULT_CONTENT,
          [
            {
              heroId: "mage",
              cardId: "glacial_shell",
              copies: 1,
              total: 1,
              cap: 1,
            },
          ],
          "STORE_PURCHASE",
          now,
        ),
      );
    await Promise.all([storeGrant(), saveCampaignStep(db, a.id, now, step)]);
    expect(count(a.id)).toBe(2);
    await expect(saveCampaignStep(db, a.id, now, step)).rejects.toThrow();
    expect(count(a.id)).toBe(2);
    expect(
      db.sql
        .prepare(
          "SELECT COUNT(*) n FROM tactics_reward_log WHERE event='CLAIMED'",
        )
        .get(),
    ).toMatchObject({ n: 1 });
  });
  it("two concurrent campaign claims produce one acquisition and identical loaded totals", async () => {
    const a = await account();
    const run = await pending(a.id);
    const payload = {
      encounterId: run.currentEncounterId,
      optionId: run.rewardOptions[0]!.id,
    };
    const result = await Promise.all([
      call(a.token, "/campaign/reward", payload),
      call(a.token, "/campaign/reward", payload),
    ]);
    expect(result.map((r) => r.status)).toEqual([200, 200]);
    expect(count(a.id)).toBe(1);
    await call(a.token, "/campaign/reward", payload);
    expect(count(a.id)).toBe(1);
  });
  it("every run write advances server revision even when the serialized seed is repeated", async () => {
    const a = await account();
    const run = await pending(a.id);
    const before = (await loadPlayer(db, a.id, DEFAULT_CONTENT))!
      .campaignRevisions![`${run.campaignId}:mage`];
    db.sql
      .prepare(
        "UPDATE tactics_hero_campaign_runs SET run_json=? WHERE user_id=?",
      )
      .run(serializeRun(run), a.id);
    const after = (await loadPlayer(db, a.id, DEFAULT_CONTENT))!
      .campaignRevisions![`${run.campaignId}:mage`];
    expect(after).toBe(before! + 1);
  });
  it("world reward adds to existing inventory once and does not make repeated campaign completion repeatable", async () => {
    const a = await account();
    db.sql
      .prepare(
        "INSERT INTO tactics_player_cards VALUES(?,'summoner','summon_ash_hound',5,1,'PROMO_CODE',0)",
      )
      .run(a.id);
    const completion = {
      heroId: "summoner",
      worldId: "world_2",
      crystals: 0,
      payReward: true,
      transactionId: "",
      now,
      card: { cardId: "summon_ash_hound", acquired: 2, cap: 1 },
    };
    await db.batch(worldCompletionStatements(db, a.id, completion));
    await db.batch(worldCompletionStatements(db, a.id, completion));
    expect(
      db.sql
        .prepare(
          "SELECT copies FROM tactics_player_cards WHERE user_id=? AND card_id='summon_ash_hound'",
        )
        .get(a.id),
    ).toMatchObject({ copies: 6 });
  });
  it("one-time import never overwrites an existing account inventory", async () => {
    const a = await account();
    db.sql
      .prepare(
        "INSERT INTO tactics_player_cards VALUES(?,'mage','glacial_shell',5,1,'STORE_PURCHASE',0)",
      )
      .run(a.id);
    const forged = createProfile(DEFAULT_CONTENT);
    forged.heroes.mage!.collection.glacial_shell = { copies: 999, acquired: 1 };
    expect(
      (await call(a.token, "/import", { profile: serializeProfile(forged) }))
        .status,
    ).toBe(409);
    expect(count(a.id)).toBe(5);
  });
  it("missing or stale campaign revision fails closed and rolls back all writes", async () => {
    const a = await account();
    const run = await pending(a.id);
    const step = {
      run,
      expectedRevision: 999,
      grant: {
        ownerId: "mage",
        cardId: "glacial_shell",
        copies: 1,
        acquired: 1,
        source: "NORMAL_DROP" as const,
      },
    };
    await expect(saveCampaignStep(db, a.id, now, step)).rejects.toThrow();
    expect(count(a.id)).toBe(0);
    db.sql
      .prepare("DELETE FROM tactics_hero_campaign_runs WHERE user_id=?")
      .run(a.id);
    await expect(saveCampaignStep(db, a.id, now, step)).rejects.toThrow();
    expect(count(a.id)).toBe(0);
  });

  it("unverifiable imported totals are rejected without saving a clipped collection or consuming import", async () => {
    const a = addAccount(db, "unverified_import");
    const p = createProfile(DEFAULT_CONTENT);
    p.heroes.mage!.collection.glacial_shell = { copies: 5, acquired: 1 };
    const raw = serializeProfile(p);
    const result = await call(a.token, "/import", { profile: raw });
    expect(result.status).toBe(422);
    expect(result.body.error!.code).toBe("IMPORT_REQUIRES_REVIEW");
    expect(serializeProfile(p)).toBe(raw);
    expect(
      db.sql
        .prepare("SELECT COUNT(*) n FROM tactics_profiles WHERE user_id=?")
        .get(a.id),
    ).toMatchObject({ n: 0 });
    expect(count(a.id)).toBe(0);
  });
  it('exclusive world cards supplied by an import require proof instead of being silently discarded', async () => {
    const a = addAccount(db, 'exclusive_import');
    const p = createProfile(DEFAULT_CONTENT);
    p.heroes.summoner!.collection.summon_ash_hound = {copies:2, acquired:1};
    const result = await call(a.token, '/import', {profile:serializeProfile(p)});
    expect(result.status).toBe(422);
    expect(result.body.error!.code).toBe('IMPORT_REQUIRES_REVIEW');
    expect(db.sql.prepare('SELECT COUNT(*) n FROM tactics_profiles WHERE user_id=?').get(a.id)).toMatchObject({n:0});
  });

});
