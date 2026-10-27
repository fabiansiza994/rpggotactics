import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCard,
  contentValue,
  copyLimit,
  COSMETICS,
  DECK_RULES,
  DEFAULT_CONTENT,
  PREMIUM_CURRENCY_ID,
  PRICE_LADDER,
  rarityOf,
  removeCard,
  starterDeck,
  STORE_CATALOG,
  STORE_CATEGORIES,
  validateCatalog,
  type CosmeticDef,
  type PlayerProfile,
  type StoreContext,
  type StoreOffer,
} from '../src/game';
import { handle } from '../server/src/index';
import type { StoreDeps } from '../server/src/store';
import { qaGrantSql } from '../server/scripts/qa-grant-sql.mjs';
import { addAccount, memoryD1 } from './support/d1';
import { ALL_RELEASED, droppableThroughPlay } from './support/drops';

type Body = {
  profile: PlayerProfile;
  wallet: { currencyId: string; name: string; balance: number };
  ledger: { reason: string; amountDelta: number; balanceBefore: number; balanceAfter: number; referenceId: string }[];
  offers: (StoreOffer & { availability: { purchasable: boolean; reason?: { code: string } } })[];
  purchase: { purchaseId: string; offerId: string; price: number; granted: { cards: { cardId: string; copies: number }[] } };
  purchases: { purchaseId: string }[];
  replayed: boolean;
  categories: { id: string }[];
  error?: { code: string; reason?: { code: string } };
};

const NOW = 1_800_000_000_000; // inside no window in particular; offers below set their own
const ctx: StoreContext = { content: DEFAULT_CONTENT, rules: DECK_RULES, cosmetics: COSMETICS };
/** Every card set released: the authoring view of the catalog (unreleased sets are only hidden). */
const releasedCtx: StoreContext = { ...ctx, content: ALL_RELEASED };
const offer = (patch: Partial<StoreOffer> & { id: string }): StoreOffer => ({
  type: 'CARD',
  title: patch.id,
  description: '',
  price: 150,
  currencyId: PREMIUM_CURRENCY_ID,
  heroId: 'mage',
  contents: [{ kind: 'CARD', cardId: 'frost_nova', copies: 1 }],
  categories: ['CARDS'],
  tags: [],
  startAt: null,
  endAt: null,
  purchaseLimit: null,
  sortOrder: 0,
  ...patch,
});

const SKIN: CosmeticDef = { id: 'skin_chicken_spectral', kind: 'SUMMON_SKIN', name: 'Pollo espectral', heroId: 'summoner', targetId: 'chicken' };
const TEST_CATALOG: StoreOffer[] = [
  ...STORE_CATALOG.map((o) => ({ ...o, startAt: null, endAt: null })),
  offer({ id: 'expired', startAt: 0, endAt: NOW - 1 }),
  offer({ id: 'future', startAt: NOW + 1, endAt: null }),
  // Champion restriction: a Mage offer that tries to sell a Summoner card is never sold.
  offer({ id: 'wrong_hero', contents: [{ kind: 'CARD', cardId: 'summon_turtle', copies: 1 }] }),
  offer({ id: 'skin', type: 'COSMETIC', heroId: 'summoner', price: 400, contents: [{ kind: 'COSMETIC', cosmeticId: SKIN.id }], categories: ['COSMETICS'] }),
  offer({
    id: 'skin_bundle',
    type: 'BUNDLE',
    heroId: 'summoner',
    price: 500,
    contents: [
      { kind: 'COSMETIC', cosmeticId: SKIN.id },
      { kind: 'CARD', cardId: 'summon_wolf', copies: 1 },
    ],
  }),
];

let db: ReturnType<typeof memoryD1>;
let ids = 0;
const store: StoreDeps = { catalog: TEST_CATALOG, cosmetics: { [SKIN.id]: SKIN }, newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` };
const deps = { content: DEFAULT_CONTENT, now: () => NOW, seed: () => 7, store };

async function call(token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://api.test/api/tactics${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handle(req, { DB: db }, deps);
  return { status: res.status, body: (await res.json()) as Body };
}

let grants = 0;
/** Funds an account exactly like scripts/qa-grant.mjs does in production. */
function qaGrant(username: string, amount: number, reference = `ref-${++grants}`) {
  return db.sql
    .prepare(qaGrantSql({ username, amount, reference, transactionId: `txn_qa_00000000-0000-4000-8000-${String(++grants).padStart(12, '0')}`, now: NOW }))
    .run().changes;
}

async function player(username = 'tactics_qa_a') {
  const account = addAccount(db, username);
  await call(account.token, 'POST', '/profile', {});
  return account;
}
const buy = (token: string, offerId: string, idempotencyKey: string, extra: Record<string, unknown> = {}) =>
  call(token, 'POST', '/store/purchase', { offerId, idempotencyKey, ...extra });
const balance = async (token: string) => (await call(token, 'GET', '/wallet')).body.wallet.balance;
const copies = (body: Body, heroId: string, cardId: string) => body.profile.heroes[heroId]!.collection[cardId]?.copies ?? 0;
const ledgerRows = (userId: number) =>
  db.sql.prepare('SELECT amount_delta, balance_before, balance_after FROM tactics_wallet_ledger WHERE user_id = ? ORDER BY id').all(userId) as {
    amount_delta: number;
    balance_before: number;
    balance_after: number;
  }[];

beforeEach(() => {
  db = memoryD1({ legacyProfiles: true });
});

describe('seed catalog (authoring rules)', () => {
  it('is valid: known cards of the right champion, legal copies, known currency', () => {
    expect(validateCatalog(STORE_CATALOG, releasedCtx)).toEqual([]);
    // Today only unreleased-set offers are held back, and only for that reason.
    expect(validateCatalog(STORE_CATALOG, ctx).every((i) => i.code === 'UNRELEASED_CARD')).toBe(true);
    expect(STORE_CATALOG.some((o) => o.type === 'CARD')).toBe(true);
    expect(STORE_CATALOG.some((o) => o.heroId === 'summoner' && o.contents.length > 1)).toBe(true);
    expect(STORE_CATALOG.some((o) => o.heroId === 'mage' && o.contents.length > 1)).toBe(true);
    for (const o of STORE_CATALOG) for (const c of o.categories) expect(STORE_CATEGORIES.map((x) => x.id)).toContain(c);
  });

  it('rejects unknown cards, other-champion cards, over-cap copies, fake cosmetics and bad prices', () => {
    const codes = validateCatalog(
      [
        offer({ id: 'a', contents: [{ kind: 'CARD', cardId: 'meteor', copies: 1 }] }),
        offer({ id: 'b', contents: [{ kind: 'CARD', cardId: 'summon_wolf', copies: 1 }] }),
        offer({ id: 'c', contents: [{ kind: 'CARD', cardId: 'frost_nova', copies: 3 }] }),
        offer({ id: 'd', contents: [{ kind: 'COSMETIC', cosmeticId: 'skin_chicken_spectral' }] }),
        offer({ id: 'e', price: 0 }),
        offer({ id: 'f', heroId: undefined }),
        offer({ id: 'g', currencyId: 'gold' }),
      ],
      ctx,
    ).map((i) => i.code);
    expect(codes).toEqual(['UNKNOWN_CARD', 'WRONG_HERO', 'OVER_COPY_LIMIT', 'UNKNOWN_COSMETIC', 'BAD_PRICE', 'WRONG_HERO', 'UNKNOWN_CURRENCY']);
  });

  it('no pay-to-win: every store card is also a normal reward drop for its champion', () => {
    for (const o of STORE_CATALOG)
      for (const c of o.contents) {
        if (c.kind !== 'CARD') continue;
        // Starter-held copies (30-card starters) count from the moment the rest of the pool is collected.
        // A QA-set card is checked as the store would sell it: with its set released.
        const content = DEFAULT_CONTENT.cards[c.cardId]!.expansion ? ALL_RELEASED : DEFAULT_CONTENT;
        expect(droppableThroughPlay(o.heroId!, c.cardId, 300, content), `${c.cardId} must be obtainable through play`).toBe(true);
      }
  });


  it('prices follow the ladder: single cards at rarity price, bundles cheaper than parts but above the priciest part', () => {
    for (const o of STORE_CATALOG) {
      const parts = o.contents.map((c) => contentValue(c, ctx));
      if (o.contents.length === 1) expect(o.price).toBe(parts[0]);
      else {
        expect(o.price).toBeLessThan(parts.reduce((a, b) => a + b, 0));
        expect(o.price).toBeGreaterThan(Math.max(...parts));
      }
    }
    expect(PRICE_LADDER.card.RARE).toBeLessThan(Math.min(...Object.values(PRICE_LADDER.cosmetic)));
  });
});

describe('wallet', () => {
  it('starts at 0 with an empty ledger; QA grants are audited and idempotent per reference', async () => {
    const { token, id } = await player();
    expect((await call(token, 'GET', '/wallet')).body.wallet).toEqual({ currencyId: 'arcane_crystals', name: 'Cristales Arcanos', balance: 0 });
    expect(qaGrant('tactics_qa_a', 500, 'smoke-1')).toBe(1);
    expect(qaGrant('tactics_qa_a', 500, 'smoke-1')).toBe(0); // same reference: no second grant
    const w = await call(token, 'GET', '/wallet');
    expect(w.body.wallet.balance).toBe(500);
    expect(w.body.ledger).toEqual([expect.objectContaining({ reason: 'QA_GRANT', amountDelta: 500, balanceBefore: 0, balanceAfter: 500, referenceId: 'smoke-1' })]);
    expect(ledgerRows(id)).toHaveLength(1);
  });

  it('QA grant tooling refuses non-QA accounts and unbounded amounts', () => {
    const base = { amount: 100, reference: 'ref-x', transactionId: 'txn_qa_00000000-0000-4000-8000-000000000001', now: NOW };
    expect(() => qaGrantSql({ ...base, username: 'ana' })).toThrow(/tactics_qa_/);
    expect(() => qaGrantSql({ ...base, username: "tactics_qa_a' OR 1=1 --" })).toThrow();
    expect(() => qaGrantSql({ ...base, username: 'tactics_qa_a', amount: 1_000_000 })).toThrow();
    expect(() => qaGrantSql({ ...base, username: 'tactics_qa_a', amount: -5 })).toThrow();
  });

  it('the ledger is append-only and always consistent with the balance', async () => {
    const { token, id } = await player();
    qaGrant('tactics_qa_a', 400);
    await buy(token, 'card_frost_nova', 'key-00000001');
    await buy(token, 'card_frost_nova', 'key-00000002');
    const rows = ledgerRows(id);
    expect(rows.map((r) => r.amount_delta)).toEqual([400, -150, -150]);
    rows.forEach((r, i) => i && expect(r.balance_before).toBe(rows[i - 1]!.balance_after));
    expect(rows.reduce((n, r) => n + r.amount_delta, 0)).toBe(await balance(token));
    expect(() => db.sql.prepare('UPDATE tactics_wallet_ledger SET amount_delta = 9999').run()).toThrow(/append-only/);
    expect(() => db.sql.prepare('DELETE FROM tactics_wallet_ledger').run()).toThrow(/append-only/);
    // A row that does not start from the real balance is refused (no forged history).
    expect(() =>
      db.sql
        .prepare(
          "INSERT INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, created_at) VALUES ('t', ?, 'arcane_crystals', 5000, 0, 5000, 'ADMIN_ADJUSTMENT', 'x', 0)",
        )
        .run(id),
    ).toThrow(/does not match/);
    expect(await balance(token)).toBe(100);
  });

  it('account deletion in RPG-GO cascades to wallet, ledger, purchases and cosmetics', async () => {
    const { token, id } = await player();
    qaGrant('tactics_qa_a', 400);
    await buy(token, 'skin', 'key-00000001');
    db.sql.prepare('DELETE FROM users WHERE id = ?').run(id);
    for (const table of ['tactics_wallets', 'tactics_wallet_ledger', 'tactics_store_purchases', 'tactics_player_cosmetics'])
      expect(db.sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(id)).toEqual(expect.objectContaining({ n: 0 }));
  });
});

describe('purchases', () => {
  it('single card: charges the catalog price and the copy joins the collection and the Deck Builder', async () => {
    const { token } = await player();
    qaGrant('tactics_qa_a', 1000);
    const res = await buy(token, 'card_frost_nova', 'key-00000001');
    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(false);
    expect(res.body.wallet.balance).toBe(850);
    expect(res.body.purchase).toMatchObject({ offerId: 'card_frost_nova', price: 150, granted: { cards: [{ cardId: 'frost_nova', copies: 1 }] } });
    expect(copies(res.body, 'mage', 'frost_nova')).toBe(1);
    // Not equipped automatically; but now a deck with it is legal (server-validated).
    const mage = DEFAULT_CONTENT.heroes.mage!;
    expect(res.body.profile.heroes.mage!.decks[0]!.cards).not.toContainEqual(expect.objectContaining({ cardId: 'frost_nova' }));
    const deck = addCard(removeCard(starterDeck(mage), 'blink'), 'frost_nova');
    expect((await call(token, 'PUT', '/decks/mage/main', { cards: deck })).status).toBe(200);
    const state = await call(token, 'GET', '/state');
    expect(copies(state.body, 'mage', 'frost_nova')).toBe(1);
    expect((await call(token, 'GET', '/store/purchases')).body.purchases).toHaveLength(1);
  });

  it('Summoner bundle grants every card once; the purchase limit then closes it', async () => {
    const { token } = await player();
    qaGrant('tactics_qa_a', 1000);
    const res = await buy(token, 'pack_summoner_bestiary', 'key-00000001');
    expect(res.status).toBe(200);
    // Each is in the 30-card starter once: the bundle adds the second copy (the UNCOMMON cap).
    for (const id of ['summon_turtle', 'summon_raven', 'familiar_aegis']) expect(copies(res.body, 'summoner', id)).toBe(2);
    expect(res.body.wallet.balance).toBe(620);
    const again = await buy(token, 'pack_summoner_bestiary', 'key-00000002');
    expect(again.status).toBe(409);
    expect(again.body.error!.reason!.code).toBe('PURCHASE_LIMIT');
    expect(await balance(token)).toBe(620);
    const catalog = await call(token, 'GET', '/store/catalog');
    expect(catalog.body.offers.find((o) => o.id === 'pack_summoner_bestiary')!.availability).toEqual({ purchasable: false, reason: { code: 'PURCHASE_LIMIT', limit: 1 } });
  });

  it('legacy Mage Arcane Surge ownership folds once without granting crystals or purchases', async () => {
    const {id, token}=await player();
    db.sql.prepare("INSERT INTO tactics_player_cards VALUES (?, 'mage', 'arcane_surge', 2, 9, 'NORMAL_DROP', 0)").run(id);
    const first=await call(token,'GET','/state');
    expect(first.body.profile.shared!.collection.arcane_surge!.copies).toBe(2);
    expect(first.body.profile.heroes.mage!.collection.arcane_surge).toBeUndefined();
    const second=await call(token,'GET','/state');
    expect(second.body.profile.shared!.collection.arcane_surge!.copies).toBe(2);
    expect(await balance(token)).toBe(0);
    expect((await call(token,'GET','/store/purchases')).body.purchases).toHaveLength(0);
  });

  it('Mage bundle keeps its price and grants Arcane Surge to the shared collection once', async () => {
    const { token } = await player();
    qaGrant('tactics_qa_a', 1000);
    const res = await buy(token, 'pack_mage_arcanist', 'key-00000001');
    expect(res.status).toBe(200);
    expect(copies(res.body, 'mage', 'dispel')).toBe(1);
    expect(res.body.profile.shared!.collection.arcane_surge!.copies).toBe(1);
    expect(res.body.profile.heroes.mage!.collection.arcane_surge).toBeUndefined();
    expect(res.body.wallet.balance).toBe(660);
    const retry = await buy(token, 'pack_mage_arcanist', 'key-00000001');
    expect(retry.body.profile.shared!.collection.arcane_surge!.copies).toBe(1);
    expect(retry.body.wallet.balance).toBe(660);
    expect(copies(res.body, 'mage', 'flame_tile')).toBe(3); // 2 from the 30-card starter + 1
    expect(res.body.profile.heroes.summoner!.collection.dispel).toBeUndefined();
  });

  it('copy cap: a card at its cap cannot be bought (no charge for an unusable duplicate)', async () => {
    const { token } = await player();
    qaGrant('tactics_qa_a', 1000);
    expect(copyLimit(DEFAULT_CONTENT.cards.frost_nova!, DECK_RULES)).toBe(2);
    expect((await buy(token, 'card_frost_nova', 'key-00000001')).status).toBe(200);
    expect((await buy(token, 'card_frost_nova', 'key-00000002')).status).toBe(200);
    const third = await buy(token, 'card_frost_nova', 'key-00000003');
    expect(third.status).toBe(409);
    expect(third.body.error).toMatchObject({ code: 'ALREADY_OWNED', reason: { code: 'CARD_AT_CAP', owned: 2, cap: 2 } });
    expect(await balance(token)).toBe(700);
  });

  it('a bundle with a capped part sells the rest at a server-prorated price (Phase 4C)', async () => {
    const { token, id } = await player();
    qaGrant('tactics_qa_a', 2000);
    // Wolf (RARE, cap 1) earned through play first: only the skin is left to sell.
    db.sql.prepare("INSERT INTO tactics_player_cards VALUES (?, 'summoner', 'summon_wolf', 1, 9, 'NORMAL_DROP', 0)").run(id);
    const res = await buy(token, 'skin_bundle', 'key-00000001');
    // 500 × skin 400 / (skin 400 + wolf 250) = 307.7 → 310.
    expect(res.body.purchase.price).toBe(310);
    expect(res.body.purchase.granted).toEqual({ cards: [], cosmetics: [{ cosmeticId: SKIN.id, kind: 'SUMMON_SKIN' }] });
    expect(await balance(token)).toBe(1690);
    expect(copies(res.body, 'summoner', 'summon_wolf')).toBe(1);
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM tactics_player_cosmetics').get()).toEqual(expect.objectContaining({ n: 1 }));
  });

  it('cosmetics are unique: owned once, never stacked or charged twice', async () => {
    const { token } = await player();
    qaGrant('tactics_qa_a', 2000);
    expect((await buy(token, 'skin', 'key-00000001')).status).toBe(200);
    const dup = await buy(token, 'skin', 'key-00000002');
    expect(dup.body.error).toMatchObject({ code: 'ALREADY_OWNED', reason: { code: 'COSMETIC_OWNED' } });
    expect(await balance(token)).toBe(1600);
  });

  it('expired, not-yet-started, unknown and invalid-champion offers are refused and not listed', async () => {
    const { token } = await player();
    qaGrant('tactics_qa_a', 1000);
    expect((await buy(token, 'expired', 'key-00000001')).body.error).toMatchObject({ code: 'OFFER_UNAVAILABLE', reason: { code: 'OFFER_INACTIVE' } });
    expect((await buy(token, 'future', 'key-00000002')).body.error!.code).toBe('OFFER_UNAVAILABLE');
    expect((await buy(token, 'meteor_pack', 'key-00000003')).status).toBe(404);
    expect((await buy(token, 'wrong_hero', 'key-00000004')).status).toBe(404);
    const listed = (await call(token, 'GET', '/store/catalog')).body.offers.map((o) => o.id);
    expect(listed).not.toContain('expired');
    expect(listed).not.toContain('future');
    expect(listed).not.toContain('wrong_hero');
    expect(listed).toContain('pack_summoner_bestiary');
    expect(await balance(token)).toBe(1000);
  });

  it('insufficient funds: refused, nothing granted, nothing charged', async () => {
    const { token } = await player();
    qaGrant('tactics_qa_a', 100);
    const res = await buy(token, 'pack_summoner_bestiary', 'key-00000001');
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_FUNDS', balance: 100, price: 380 });
    const state = await call(token, 'GET', '/state');
    expect(copies(state.body, 'summoner', 'summon_turtle')).toBe(1); // the starter copy only
    expect(await balance(token)).toBe(100);
    expect((await call(token, 'GET', '/store/purchases')).body.purchases).toEqual([]);
  });

  it('idempotency: a retried request returns the same purchase without charging again', async () => {
    const { token, id } = await player();
    qaGrant('tactics_qa_a', 1000);
    const first = await buy(token, 'card_frost_nova', 'retry-key-0001');
    const retry = await buy(token, 'card_frost_nova', 'retry-key-0001');
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.purchase).toEqual(first.body.purchase);
    expect(retry.body.wallet.balance).toBe(850);
    expect(copies(retry.body, 'mage', 'frost_nova')).toBe(1);
    expect(ledgerRows(id)).toHaveLength(2);
    // Same key for a different offer is a client bug, not a second purchase.
    expect((await buy(token, 'pack_mage_arcanist', 'retry-key-0001')).body.error!.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await buy(token, 'card_frost_nova', 'short')).status).toBe(400);
  });

  it('concurrent retries with one key charge once', async () => {
    const { token, id } = await player();
    qaGrant('tactics_qa_a', 1000);
    const results = await Promise.all([1, 2, 3].map(() => buy(token, 'card_frost_nova', 'same-key-0001')));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => r.body.purchase.purchaseId)).size).toBe(1);
    expect(await balance(token)).toBe(850);
    expect(ledgerRows(id)).toHaveLength(2);
  });

  it('concurrent purchases cannot overdraw the wallet or exceed a copy cap', async () => {
    const { token } = await player();
    qaGrant('tactics_qa_a', 150); // enough for exactly one
    const funds = await Promise.all([buy(token, 'card_frost_nova', 'race-a-0001'), buy(token, 'card_frost_nova', 'race-b-0001')]);
    expect(funds.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(funds.find((r) => r.status === 409)!.body.error!.code).toBe('INSUFFICIENT_FUNDS');
    expect(await balance(token)).toBe(0);

    qaGrant('tactics_qa_a', 1000); // owned 1 of cap 2: only one more fits
    const caps = await Promise.all([buy(token, 'card_frost_nova', 'race-c-0001'), buy(token, 'card_frost_nova', 'race-d-0001')]);
    expect(caps.map((r) => r.status).sort()).toEqual([200, 409]);
    const state = await call(token, 'GET', '/state');
    expect(copies(state.body, 'mage', 'frost_nova')).toBe(2);
    expect(await balance(token)).toBe(850);
  });
});

describe('security', () => {
  it('forged price, contents, balance, currency and user ids in the body are ignored', async () => {
    const { token } = await player();
    const other = await player('tactics_qa_b');
    qaGrant('tactics_qa_a', 400);
    const res = await buy(token, 'pack_summoner_bestiary', 'forge-key-001', {
      price: 1,
      currencyId: 'gold',
      contents: [{ kind: 'CARD', cardId: 'summon_wolf', copies: 1 }],
      balance: 99_999,
      heroId: 'mage',
      userId: other.id,
    });
    expect(res.body.purchase.price).toBe(380);
    expect(res.body.wallet.balance).toBe(20);
    expect(copies(res.body, 'summoner', 'summon_wolf')).toBe(0);
    expect(copies(res.body, 'summoner', 'summon_turtle')).toBe(2); // starter copy + the bundle's
    expect(await balance(other.token)).toBe(0);
  });

  it("wallets and purchases are per account: one player cannot read or spend another's", async () => {
    const a = await player();
    const b = await player('tactics_qa_b');
    qaGrant('tactics_qa_a', 500);
    await buy(a.token, 'card_frost_nova', 'shared-key-01');
    expect(await balance(b.token)).toBe(0);
    expect((await call(b.token, 'GET', '/store/purchases')).body.purchases).toEqual([]);
    expect((await call(b.token, 'GET', `/wallet?userId=${a.id}`)).body.ledger).toEqual([]);
    // B reusing A's idempotency key is B's own (unfunded) request, not a replay of A's purchase.
    expect((await buy(b.token, 'card_frost_nova', 'shared-key-01')).body.error!.code).toBe('INSUFFICIENT_FUNDS');
    expect(await balance(a.token)).toBe(350);
  });

  it('there is no client endpoint that grants or sets currency; signed-out callers get nothing', async () => {
    const { token } = await player();
    for (const [method, path] of [
      ['POST', '/wallet'],
      ['PUT', '/wallet'],
      ['POST', '/wallet/grant'],
      ['POST', '/store/grant'],
      ['POST', '/qa/grant'],
      ['PUT', '/store/catalog'],
    ] as const)
      expect((await call(token, method, path, { amount: 5000, balance: 5000, reason: 'QA_GRANT' })).status).toBe(404);
    expect(await balance(token)).toBe(0);
    expect((await call(null, 'GET', '/wallet')).status).toBe(401);
    expect((await call(null, 'POST', '/store/purchase', { offerId: 'card_frost_nova', idempotencyKey: 'key-00000001' })).status).toBe(401);
  });

  it('catalog payload is platform-neutral and carries what the store UI needs', async () => {
    const { token } = await player();
    const catalog = await call(token, 'GET', '/store/catalog');
    expect(catalog.body.categories.map((c) => c.id)).toEqual(['FEATURED', 'PREMIUM', 'MAGE', 'SUMMONER', 'WARRIOR', 'CARDS', 'DEALS', 'COSMETICS']);
    const card = catalog.body.offers.find((o) => o.id === 'card_frost_nova')!;
    expect(card).toMatchObject({ price: 150, currencyId: 'arcane_crystals', heroId: 'mage', availability: { purchasable: true } });
    expect(rarityOf(DEFAULT_CONTENT.cards.frost_nova!)).toBe('UNCOMMON');
  });
});

it('over-neutral persisted decks remain visible but cannot start a campaign or be saved unchanged', async () => {
  const {id, token} = await player();
  const cards = [{cardId:'arcane_surge',count:1},{cardId:'take_cover',count:2},{cardId:'first_aid',count:2}];
  db.sql.prepare("DELETE FROM tactics_deck_cards WHERE user_id = ? AND hero_id = 'mage'").run(id);
  for(const card of cards) db.sql.prepare("INSERT INTO tactics_deck_cards (user_id,hero_id,deck_id,card_id,count) VALUES (?, 'mage', 'main', ?, ?)").run(id,card.cardId,card.count);
  const before = (await call(token,'GET','/state')).body.profile.heroes.mage!.decks;
  expect(before[0]!.cards).toEqual(expect.arrayContaining(cards));
  const rejected = await call(token,'POST','/campaign/start',{heroId:'mage'});
  expect(rejected.status).toBe(422);
  expect(rejected.body.error?.code).toBe('INVALID_DECK');
  expect((await call(token,'PUT','/decks/mage/main',{cards})).status).toBe(422);
  expect((await call(token,'GET','/state')).body.profile.heroes.mage!.decks).toEqual(before);
  expect(await balance(token)).toBe(0);
});
