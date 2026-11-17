import { COSMETICS, DEFAULT_CONTENT } from "../../src/game";
import { STORE_CATALOG } from "../../src/game/data/store-catalog";
import { handle } from "../../server/src/index";
import { memoryD1, addAccount } from "./d1";
import { STORE_QUOTE_TEST_SECRET } from "./storeQuote";
type LocalFixturePayload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const MARKET_FLAGS = {
  ARCANE_MARKET_PACKS_ENABLED: "1",
  FREE_CATALOG_ENABLED: "1",
  SHAPESHIFTER_ENABLED: "1",
  ARCHER_ENABLED: "1",
  ARCHER_CAMPAIGN_ENABLED: "1",
  WARRIOR_ENABLED: "1",
  SUMMONER_RITUALS_ENABLED: "1",
  PRIMORDIAL_DRAGON_ENABLED: "1",
  ARSENAL_CARDS_ENABLED: "1",
  TACTICAL_CARDS_ENABLED: "1",
  STORE_SHOWCASE_ENABLED: "1",
  STORE_QUOTE_SECRET: STORE_QUOTE_TEST_SECRET,
};
export async function marketFixture(options: { legacyProfiles?: boolean } = {}) {
  const db = memoryD1({ legacyProfiles: options.legacyProfiles ?? true });
  let ids = 0;
  const account = addAccount(db, "market_local_qa");
  const env = { ...MARKET_FLAGS, DB: db };
  const deps = {
    content: DEFAULT_CONTENT,
    now: () => Date.now(),
    seed: () => 7,
    store: {
      catalog: STORE_CATALOG,
      cosmetics: COSMETICS,
      newId: () => `reorg_${++ids}_${crypto.randomUUID()}`,
    },
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await handle(
      new Request("http://127.0.0.1/api/tactics" + path, {
        method,
        headers: {
          Authorization: "Bearer " + account.token,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      deps,
    );
    return {
      status: res.status,
      data: (await res.json()) as LocalFixturePayload,
    };
  };
  await call("POST", "/profile", {});
  db.sql
    .prepare(
      `INSERT INTO tactics_wallet_ledger(transaction_id,user_id,currency_id,amount_delta,balance_before,balance_after,reason,reference_id,created_at) VALUES('local-fund',?,'arcane_crystals',30000,0,30000,'QA_GRANT','local-only',0)`,
    )
    .run(account.id);
  const catalog = async () => (await call("GET", "/store/catalog")).data;
  const buy = async (offerId: string, key: string) => {
    const cat = await catalog(),
      offer = cat.offers.find((o: { id: string }) => o.id === offerId);
    if (!offer) throw Error("Missing offer " + offerId);
    return call("POST", "/store/purchase", {
      offerId,
      idempotencyKey: key,
      quoteToken: offer.purchaseQuote?.token,
      packRevision: offer.booster.revision,
      packFormat: "GENERAL_BATCH_V1",
    });
  };
  return { db, env, deps, account, call, catalog, buy };
}
