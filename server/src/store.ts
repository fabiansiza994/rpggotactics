import {
  COSMETICS,
  cosmeticSlot,
  CURRENCIES,
  DECK_RULES,
  EQUIPPABLE_KINDS,
  collectionOwner,
  heroProfile,
  isOfferActive,
  ownedFor,
  sharedPool,
  SHARED_POOL_ID,
  offerView,
  planPurchase,
  PREMIUM_CURRENCY_ID,
  STORE_CATALOG,
  STORE_CATEGORIES,
  validOffers,
  type CosmeticDef,
  type GameContent,
  type LedgerReason,
  type PurchasePlan,
  type PurchaseQuote,
  type StoreContext,
  type StoreOffer,
  type StoreOwnership,
  type CardGrant,
} from '../../src/game';
import type { D1Database, D1PreparedStatement } from './db';
import { error, json } from './http';
import { loadPlayer, type CardSource, type PlayerRecord } from './repo';
import { equippableCosmetics } from '../../src/game/ranked/rankedCosmetics';

/**
 * Wallet + store (Phase 4A; prorated bundles + cosmetics equip in 4C). The client only ever names
 * an offer and an idempotency key: price, contents, currency, ownership and balance all come from
 * the catalog and the database. A partly-owned bundle's price is the SERVER's quote.
 * Every balance change is a ledger row (the D1 trigger applies it to the wallet), and a purchase
 * is ONE D1 batch: purchase row + debit + grants + a final guard — all or nothing.
 */
export interface StoreDeps {
  catalog: readonly StoreOffer[];
  cosmetics: Readonly<Record<string, CosmeticDef>>;
  /** Unique ids for purchases / ledger transactions. */
  newId(): string;
}

export const defaultStoreDeps: StoreDeps = {
  catalog: STORE_CATALOG,
  cosmetics: COSMETICS,
  newId: () => crypto.randomUUID(),
};

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const OFFER_ID = /^[a-z0-9_-]{1,64}$/;
const COSMETIC_ID = /^[a-z0-9_]{1,64}$/;
const LEDGER_PAGE = 20;

/**
 * One ledger row that moves `delta` (negative = debit). balance_before is read inside the same
 * statement; a debit below zero fails the balance_after CHECK, so it aborts its whole batch.
 */
export function ledgerStatement(
  db: D1Database,
  e: {
    transactionId: string;
    userId: number;
    currencyId: string;
    delta: number;
    reason: LedgerReason;
    referenceId: string;
    note?: string | null;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, note, created_at)
       SELECT ?, ?, ?, ?, b, b + ?, ?, ?, ?, ?
       FROM (SELECT COALESCE((SELECT balance FROM tactics_wallets WHERE user_id = ? AND currency_id = ?), 0) AS b)`,
    )
    .bind(
      e.transactionId,
      e.userId,
      e.currencyId,
      e.delta,
      e.delta,
      e.reason,
      e.referenceId,
      e.note ?? null,
      e.now,
      e.userId,
      e.currencyId,
    );
}

export async function walletBalance(db: D1Database, userId: number, currencyId: string): Promise<number> {
  const row = await db
    .prepare('SELECT balance FROM tactics_wallets WHERE user_id = ? AND currency_id = ?')
    .bind(userId, currencyId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}

export async function walletView(db: D1Database, userId: number, currencyId = PREMIUM_CURRENCY_ID) {
  return {
    currencyId,
    name: CURRENCIES[currencyId]?.name ?? currencyId,
    balance: await walletBalance(db, userId, currencyId),
  };
}

interface PurchaseRow {
  purchase_id: string;
  idempotency_key: string;
  offer_id: string;
  currency_id: string;
  price: number;
  status: string;
  granted_json: string;
  created_at: number;
}

const purchaseView = (r: PurchaseRow) => ({
  purchaseId: r.purchase_id,
  offerId: r.offer_id,
  price: r.price,
  currencyId: r.currency_id,
  status: r.status,
  createdAt: r.created_at,
  granted: JSON.parse(r.granted_json) as PurchasePlan,
});

const PURCHASE_COLUMNS =
  'purchase_id, idempotency_key, offer_id, currency_id, price, status, granted_json, created_at';

const purchaseByKey = (db: D1Database, userId: number, key: string) =>
  db
    .prepare(`SELECT ${PURCHASE_COLUMNS} FROM tactics_store_purchases WHERE user_id = ? AND idempotency_key = ?`)
    .bind(userId, key)
    .first<PurchaseRow>();

/** The caller's ownership as stored in D1 (collection from the loaded record). */
export async function ownership(
  db: D1Database,
  userId: number,
  record: PlayerRecord,
  content: GameContent,
): Promise<StoreOwnership> {
  const [cosmetics, purchases] = await Promise.all([
    db.prepare('SELECT cosmetic_id FROM tactics_player_cosmetics WHERE user_id = ?').bind(userId).all<{ cosmetic_id: string }>(),
    db
      .prepare(
        "SELECT offer_id, COUNT(*) AS n FROM tactics_store_purchases WHERE user_id = ? AND status = 'COMPLETED' GROUP BY offer_id",
      )
      .bind(userId)
      .all<{ offer_id: string; n: number }>(),
  ]);
  const ownedCosmetics = new Set(cosmetics.results.map((c) => c.cosmetic_id));
  const counts = new Map(purchases.results.map((p) => [p.offer_id, p.n]));
  return {
    copies: (heroId, cardId) => ownedFor(record.profile, heroId, content)(cardId),
    hasCosmetic: (id) => ownedCosmetics.has(id),
    purchases: (offerId) => counts.get(offerId) ?? 0,
  };
}

/**
 * Adds granted copies to the ONE collection (neutral cards to the shared pool, each owner with
 * its own acquisition counter). Shared by store purchases and promo codes.
 */
export function cardGrantStatements(
  db: D1Database,
  userId: number,
  record: PlayerRecord,
  content: GameContent,
  cards: readonly CardGrant[],
  source: CardSource,
  now: number,
): D1PreparedStatement[] {
  const acquisitions = new Map<string, number>();
  return cards.map((g) => {
    const owner = collectionOwner(content, g.heroId, g.cardId);
    const counter = owner === SHARED_POOL_ID ? sharedPool(record.profile, content).acquisitions : heroProfile(record.profile, g.heroId, content).acquisitions;
    const next = (acquisitions.get(owner) ?? counter) + 1;
    acquisitions.set(owner, next);
    return db
      .prepare(
        `INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, hero_id, card_id) DO UPDATE SET copies = copies + excluded.copies, acquired = excluded.acquired, source = excluded.source`,
      )
      .bind(userId, owner, g.cardId, g.copies, next, source, now);
  });
}

/**
 * SQL conditions re-checking every copy cap inside the granting transaction (a concurrent grant
 * may have added copies since the plan was made).
 */
export function cardCapGuards(userId: number, content: GameContent, cards: readonly CardGrant[]): { guards: string[]; binds: unknown[] } {
  const guards: string[] = [];
  const binds: unknown[] = [];
  for (const g of cards) {
    guards.push('(SELECT copies FROM tactics_player_cards WHERE user_id = ? AND hero_id = ? AND card_id = ?) <= ?');
    binds.push(userId, collectionOwner(content, g.heroId, g.cardId), g.cardId, g.cap);
  }
  return { guards, binds };
}

function purchaseStatements(
  db: D1Database,
  userId: number,
  record: PlayerRecord,
  content: GameContent,
  offer: StoreOffer,
  plan: PurchasePlan,
  quote: PurchaseQuote,
  ids: { purchaseId: string; transactionId: string; key: string },
  now: number,
): D1PreparedStatement[] {
  // Snapshot = what was sold to THIS buyer: final price + final contents (+ what was left out).
  const sold = { ...offer, price: quote.price, contents: quote.contents, basePrice: quote.basePrice, excluded: quote.excluded };
  const out: D1PreparedStatement[] = [
    // First: the idempotency receipt (UNIQUE (user_id, idempotency_key)).
    db
      .prepare(
        `INSERT INTO tactics_store_purchases (purchase_id, user_id, idempotency_key, offer_id, currency_id, price, status, offer_json, granted_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)`,
      )
      .bind(ids.purchaseId, userId, ids.key, offer.id, offer.currencyId, quote.price, JSON.stringify(sold), JSON.stringify(plan), now, now),
    ledgerStatement(db, {
      transactionId: ids.transactionId,
      userId,
      currencyId: offer.currencyId,
      delta: -quote.price,
      reason: 'STORE_PURCHASE',
      referenceId: ids.purchaseId,
      note: offer.id,
      now,
    }),
  ];
  out.push(...cardGrantStatements(db, userId, record, content, plan.cards, 'STORE_PURCHASE', now));
  for (const c of plan.cosmetics)
    out.push(
      db
        .prepare(
          "INSERT INTO tactics_player_cosmetics (user_id, cosmetic_id, kind, source, reference_id, acquired_at) VALUES (?, ?, ?, 'STORE_PURCHASE', ?, ?)",
        )
        .bind(userId, c.cosmeticId, c.kind, ids.purchaseId, now),
    );
  // Last: re-check, inside the transaction, what a concurrent request could have changed since
  // the plan was made (copy caps, purchase limit). A failed guard nulls the NOT NULL status,
  // which aborts the whole batch: no charge, no grant.
  const { guards, binds } = cardCapGuards(userId, content, plan.cards);
  if (offer.purchaseLimit !== null) {
    guards.push(
      "(SELECT COUNT(*) FROM tactics_store_purchases WHERE user_id = ? AND offer_id = ? AND status = 'COMPLETED') <= ?",
    );
    binds.push(userId, offer.id, offer.purchaseLimit);
  }
  if (guards.length)
    out.push(
      db
        .prepare(
          `UPDATE tactics_store_purchases SET status = CASE WHEN ${guards.join(' AND ')} THEN status ELSE NULL END WHERE purchase_id = ?`,
        )
        .bind(...binds, ids.purchaseId),
    );
  out.push(db.prepare('UPDATE tactics_profiles SET updated_at = ? WHERE user_id = ?').bind(now, userId));
  return out;
}

/**
 * Owned + equipped cosmetics of the caller. Rows whose id left the registry are hidden (never
 * equipped or shown) but kept: ownership history is not deleted.
 */
async function cosmeticsView(db: D1Database, userId: number, store: StoreDeps) {
  const registry = equippableCosmetics(store.cosmetics);
  const [owned, equipped] = await Promise.all([
    db
      .prepare('SELECT cosmetic_id, kind, acquired_at FROM tactics_player_cosmetics WHERE user_id = ? ORDER BY acquired_at, cosmetic_id')
      .bind(userId)
      .all<{ cosmetic_id: string; kind: string; acquired_at: number }>(),
    db.prepare('SELECT slot, cosmetic_id FROM tactics_equipped_cosmetics WHERE user_id = ?').bind(userId).all<{ slot: string; cosmetic_id: string }>(),
  ]);
  return {
    owned: owned.results
      .filter((c) => registry[c.cosmetic_id])
      .map((c) => ({ cosmeticId: c.cosmetic_id, kind: c.kind, acquiredAt: c.acquired_at })),
    equipped: Object.fromEntries(
      EQUIPPABLE_KINDS.map((slot) => {
        const id = equipped.results.find((e) => e.slot === slot)?.cosmetic_id;
        return [slot, id && registry[id] ? id : null];
      }),
    ) as Record<string, string | null>,
  };
}

/** Public cosmetic data of a player (what an opponent may see): the equipped frame id only. */
export async function equippedFrame(db: D1Database, userId: number, cosmetics: StoreDeps['cosmetics'] = COSMETICS): Promise<string | null> {
  return (await equippedPublic(db, userId, cosmetics)).frameId;
}

/** Every public slot of a player (PvP members): frame, Ranked crest, victory badge. Unknown ids → null. */
export async function equippedPublic(
  db: D1Database,
  userId: number,
  cosmetics: StoreDeps['cosmetics'] = COSMETICS,
): Promise<{ frameId: string | null; crestId: string | null; badgeId: string | null }> {
  const registry = equippableCosmetics(cosmetics);
  const { results } = await db
    .prepare("SELECT slot, cosmetic_id FROM tactics_equipped_cosmetics WHERE user_id = ? AND slot IN ('PROFILE_FRAME', 'RANKED_CREST', 'VICTORY_BADGE')")
    .bind(userId)
    .all<{ slot: string; cosmetic_id: string }>();
  const pick = (slot: string) => {
    const id = results.find((r) => r.slot === slot)?.cosmetic_id;
    return id && registry[id]?.kind === slot ? id : null;
  };
  return { frameId: pick('PROFILE_FRAME'), crestId: pick('RANKED_CREST'), badgeId: pick('VICTORY_BADGE') };
}

export interface StoreRequest {
  db: D1Database;
  userId: number;
  record: PlayerRecord;
  body: Record<string, unknown>;
  now: number;
  content: GameContent;
  store: StoreDeps;
  /**
   * Champion release gate (e.g. the QA-only Warrior): offers naming a champion this caller may not
   * see are neither listed nor sold, exactly as if they did not exist. Omitted = every champion.
   */
  heroAllowed?(heroId: string): boolean;
  /** Fresh player state (collection, decks…) to merge into the response. */
  state(): Promise<Record<string, unknown>>;
}

/** Wallet / store routes; null = not a store route. */
export async function storeRoute(route: string, r: StoreRequest): Promise<Response | null> {
  const { db, userId, now } = r;
  const ctx: StoreContext = { content: r.content, rules: DECK_RULES, cosmetics: r.store.cosmetics };
  const offers = () =>
    validOffers(r.store.catalog, ctx).filter((o) => o.heroId === undefined || (r.heroAllowed?.(o.heroId) ?? true));

  if (route === 'GET /api/tactics/wallet') {
    const ledger = await db
      .prepare(
        'SELECT transaction_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, created_at FROM tactics_wallet_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?',
      )
      .bind(userId, LEDGER_PAGE)
      .all<Record<string, unknown>>();
    return json({
      wallet: await walletView(db, userId),
      ledger: ledger.results.map((l) => ({
        transactionId: l.transaction_id,
        currencyId: l.currency_id,
        amountDelta: l.amount_delta,
        balanceBefore: l.balance_before,
        balanceAfter: l.balance_after,
        reason: l.reason,
        referenceId: l.reference_id,
        createdAt: l.created_at,
      })),
    });
  }

  if (route === 'GET /api/tactics/store/catalog') {
    const owned = await ownership(db, userId, r.record, r.content);
    return json({
      serverTime: now,
      currencies: Object.values(CURRENCIES),
      categories: STORE_CATEGORIES,
      offers: offers()
        .filter((o) => isOfferActive(o, now))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
        .map((o) => offerView(o, owned, ctx, now)),
      wallet: await walletView(db, userId),
      cosmetics: await cosmeticsView(db, userId, r.store),
    });
  }

  if (route === 'GET /api/tactics/cosmetics') return json(await cosmeticsView(db, userId, r.store));

  if (route === 'PUT /api/tactics/cosmetics/equip') {
    // Ownership comes from D1, never from the body; the composite FK refuses an unowned row too.
    const cosmeticId = r.body.cosmeticId;
    const slot = r.body.slot;
    if (typeof slot !== 'string' || !EQUIPPABLE_KINDS.includes(slot as never))
      return error(400, 'BAD_REQUEST', 'Espacio cosmético inválido.');
    if (cosmeticId === null) {
      await db.prepare('DELETE FROM tactics_equipped_cosmetics WHERE user_id = ? AND slot = ?').bind(userId, slot).run();
      return json(await cosmeticsView(db, userId, r.store));
    }
    if (typeof cosmeticId !== 'string' || !COSMETIC_ID.test(cosmeticId)) return error(400, 'BAD_REQUEST', 'Cosmético inválido.');
    // Store registry + the earned-only Ranked cosmetics (never sold: they are not in r.store.cosmetics).
    const def = equippableCosmetics(r.store.cosmetics)[cosmeticId];
    if (!def) return error(404, 'UNKNOWN_COSMETIC', 'Ese cosmético no existe.');
    if (cosmeticSlot(def) !== slot) return error(400, 'BAD_REQUEST', 'Ese cosmético no va en ese espacio.');
    const owned = await db
      .prepare('SELECT 1 AS ok FROM tactics_player_cosmetics WHERE user_id = ? AND cosmetic_id = ?')
      .bind(userId, cosmeticId)
      .first();
    if (!owned) return error(403, 'NOT_OWNED', 'Todavía no tienes ese cosmético.');
    await db
      .prepare(
        `INSERT INTO tactics_equipped_cosmetics (user_id, slot, cosmetic_id, equipped_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, slot) DO UPDATE SET cosmetic_id = excluded.cosmetic_id, equipped_at = excluded.equipped_at`,
      )
      .bind(userId, slot, cosmeticId, now)
      .run();
    return json(await cosmeticsView(db, userId, r.store));
  }

  if (route === 'GET /api/tactics/store/purchases') {
    const rows = await db
      .prepare(`SELECT ${PURCHASE_COLUMNS} FROM tactics_store_purchases WHERE user_id = ? ORDER BY created_at DESC, purchase_id LIMIT 50`)
      .bind(userId)
      .all<PurchaseRow>();
    return json({ purchases: rows.results.map(purchaseView) });
  }

  if (route === 'POST /api/tactics/store/purchase') {
    // Only these two fields are read; price/contents/balance/userId in the body are ignored.
    const offerId = r.body.offerId;
    const key = r.body.idempotencyKey;
    if (typeof offerId !== 'string' || !OFFER_ID.test(offerId))
      return error(400, 'BAD_REQUEST', 'Oferta inválida.');
    if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key))
      return error(400, 'BAD_REQUEST', 'Clave de idempotencia inválida.');

    const replay = async (row: PurchaseRow) =>
      row.offer_id !== offerId
        ? error(409, 'IDEMPOTENCY_KEY_REUSED', 'Esa clave ya se usó para otra compra.')
        : json({ ...(await r.state()), purchase: purchaseView(row), replayed: true, wallet: await walletView(db, userId, row.currency_id) });

    const previous = await purchaseByKey(db, userId, key);
    if (previous) return replay(previous);

    const offer = offers().find((o) => o.id === offerId);
    if (!offer) return error(404, 'UNKNOWN_OFFER', 'Esa oferta no existe.');
    const check = async (record: PlayerRecord) => {
      const plan = planPurchase(offer, await ownership(db, userId, record, r.content), ctx, now);
      if (!plan.ok)
        return {
          ok: false as const,
          fail: error(409, plan.reason.code === 'OFFER_INACTIVE' ? 'OFFER_UNAVAILABLE' : 'ALREADY_OWNED', 'Esta oferta no está disponible.', {
            reason: plan.reason,
          }),
        };
      const balance = await walletBalance(db, userId, offer.currencyId);
      if (balance < plan.quote.price)
        return { ok: false as const, fail: error(409, 'INSUFFICIENT_FUNDS', 'Saldo insuficiente.', { balance, price: plan.quote.price }) };
      return { ok: true as const, plan: plan.plan, quote: plan.quote };
    };
    const checked = await check(r.record);
    if (!checked.ok) return checked.fail;

    const purchaseId = `pur_${r.store.newId()}`;
    try {
      await db.batch(
        purchaseStatements(
          db,
          userId,
          r.record,
          r.content,
          offer,
          checked.plan,
          checked.quote,
          { purchaseId, transactionId: `txn_${r.store.newId()}`, key },
          now,
        ),
      );
    } catch {
      // Rolled back entirely. Either the same key won a concurrent race (→ return that purchase),
      // or the state changed under us (funds / caps / limit) → report it from fresh state.
      const raced = await purchaseByKey(db, userId, key);
      if (raced) return replay(raced);
      const fresh = await loadPlayer(db, userId, r.content);
      const again = fresh ? await check(fresh) : null;
      if (again && !again.ok) return again.fail;
      return error(409, 'PURCHASE_CONFLICT', 'La compra no se completó; inténtalo de nuevo.');
    }
    const row = await purchaseByKey(db, userId, key);
    return json({ ...(await r.state()), purchase: purchaseView(row!), replayed: false, wallet: await walletView(db, userId, offer.currencyId) });
  }

  return null;
}
