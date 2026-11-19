import { rarityOf } from '../../src/game/collection/deck-rules';
import {loadExpansionBox,boxDebitStatements,resetExpansionBox} from './expansionBoxes';
import {boxTotal,type BoxSnapshot} from '../../src/game/store/boxes';
import {describeCardAcquisition} from '../../src/game/store/card-acquisition';
import {freePackOfferId} from '../../src/game/store/market-expansions';
import {newStoreSaleAllowed,completedOfferClaims} from '../../src/game/store/store';
import { boosterOffers, rollBooster, expansionViews, validBooster } from './boosters';
import type { BoosterPolicy } from '../../src/game/store/boosters';
import {issueQuote,readQuote,quotedTerms,quoteSecretReady,quoteFailure,quoteResponse} from './storeQuote';
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
  starterHeroProfile,
  starterShared,
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
  packPolicy?: BoosterPolicy;
  packPrice?: number;
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
  guard?: { sql: string; bindings: unknown[] },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO tactics_wallet_ledger (transaction_id, user_id, currency_id, amount_delta, balance_before, balance_after, reason, reference_id, note, created_at)
       SELECT ?, ?, ?, ?, b, b + ?, ?, ?, ?, ?
       FROM (SELECT COALESCE((SELECT balance FROM tactics_wallets WHERE user_id = ? AND currency_id = ?), 0) AS b)
       ${guard ? 'WHERE ' + guard.sql : ''}`,
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
      ...(guard?.bindings ?? []),
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
  const [cosmetics, purchases, freeClaims] = await Promise.all([
    db.prepare('SELECT cosmetic_id FROM tactics_player_cosmetics WHERE user_id = ?').bind(userId).all<{ cosmetic_id: string }>(),
    db
      .prepare(
        "SELECT offer_id, COUNT(*) AS n FROM tactics_store_purchases WHERE user_id = ? AND status = 'COMPLETED' GROUP BY offer_id",
      )
      .bind(userId)
      .all<{ offer_id: string; n: number }>(),
    db.prepare(`SELECT CASE WHEN json_extract(offer_json, '$.booster.freeGrant') = 1 AND json_extract(offer_json, '$.booster.expansionId') IS NOT NULL THEN json_extract(offer_json, '$.booster.expansionId') ELSE substr(offer_id, 9, length(offer_id) - 13) END AS expansion_id, COUNT(*) AS n
      FROM tactics_store_purchases WHERE user_id = ? AND status = 'COMPLETED'
      AND (offer_id GLOB 'booster_*_free' OR json_extract(offer_json, '$.booster.freeGrant') = 1)
      GROUP BY expansion_id`).bind(userId).all<{expansion_id:string;n:number}>(),
  ]);
  const ownedCosmetics = new Set(cosmetics.results.map((c) => c.cosmetic_id));
  const counts = new Map(purchases.results.map((p) => [p.offer_id, p.n]));
  const freeCounts = new Map(freeClaims.results.map(p=>[p.expansion_id,p.n]));
  return {
    copies: (heroId, cardId) => ownedFor(record.profile, heroId, content)(cardId),
    hasCosmetic: (id) => ownedCosmetics.has(id),
    purchases: (offerId) => counts.get(offerId) ?? 0,
    freeClaims: expansionId => freeCounts.get(expansionId) ?? 0,
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
  const starterFloors = new Map<string, Record<string, {copies: number}>>();
  return cards.map((g) => {
    const owner = collectionOwner(content, g.heroId, g.cardId);
    const counter = owner === SHARED_POOL_ID ? sharedPool(record.profile, content).acquisitions : heroProfile(record.profile, g.heroId, content).acquisitions;
    if (!starterFloors.has(owner)) starterFloors.set(owner, owner === SHARED_POOL_ID
      ? starterShared(content).collection
      : starterHeroProfile(content.heroes[g.heroId]!, content).collection);
    const floor = starterFloors.get(owner)![g.cardId]?.copies ?? 0;
    const next = (acquisitions.get(owner) ?? counter) + 1;
    acquisitions.set(owner, next);
    return db
      .prepare(
        `INSERT INTO tactics_player_cards (user_id, hero_id, card_id, copies, acquired, source, unlocked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, hero_id, card_id) DO UPDATE SET copies = MAX(copies, ?) + ?, acquired = MAX(acquired, excluded.acquired), source = excluded.source`,
      )
      // Reads already guarantee starter ownership, including missing/legacy rows.
      // Materialize that SAME floor and add only the new grant atomically. Never
      // use a deck cap or an old request snapshot as an inventory ceiling.
      .bind(userId, owner, g.cardId, floor + g.copies, next, source, now, floor, g.copies);
  });
}

/**
 * SQL conditions protecting the numeric storage domain inside the granting transaction.
 * Deck copy limits never constrain inventory.
 */
export function cardInventoryGuards(userId: number, content: GameContent, cards: readonly CardGrant[]): { guards: string[]; binds: unknown[] } {
  const guards: string[] = [];
  const binds: unknown[] = [];
  for (const g of cards) {
    guards.push(`(SELECT typeof(copies) = 'integer' AND copies BETWEEN 1 AND 9007199254740991 FROM tactics_player_cards WHERE user_id = ? AND hero_id = ? AND card_id = ?)`);
    binds.push(userId, collectionOwner(content, g.heroId, g.cardId), g.cardId);
  }
  return { guards, binds };
}

/** Receipt totals are finalized from rows INSIDE the granting transaction, not a stale
 * preflight snapshot. Each reveal keeps its own position among repeated copies. */
function finalizePurchaseReceipt(db: D1Database, userId: number, purchaseId: string, openings: boolean): D1PreparedStatement[] {
  const count = (alias: string) => `(SELECT copies FROM tactics_player_cards WHERE user_id = ? AND card_id = json_extract(${alias}.value, '$.cardId') AND hero_id IN ('*', json_extract(${alias}.value, '$.heroId')) ORDER BY (hero_id = '*') DESC LIMIT 1)`;
  const cards = `json((SELECT json_group_array(json_set(g.value, '$.total', ${count('g')})) FROM json_each(p.granted_json, '$.cards') g))`;
  const packs = openings ? `, '$.openings', json((SELECT json_group_array(json_set(op.value, '$.cards', json((SELECT json_group_array(json_set(slot.value, '$.total', ${count('slot')} - (SELECT COUNT(*) FROM json_each(p.granted_json, '$.openings') later_op, json_each(later_op.value, '$.cards') later_slot WHERE json_extract(later_slot.value, '$.cardId') = json_extract(slot.value, '$.cardId') AND (CAST(later_op.key AS INTEGER) > CAST(op.key AS INTEGER) OR (later_op.key = op.key AND CAST(later_slot.key AS INTEGER) > CAST(slot.key AS INTEGER)))))) FROM json_each(op.value, '$.cards') slot)))) FROM json_each(p.granted_json, '$.openings') op))` : '';
  const out = [db.prepare(`UPDATE tactics_store_purchases AS p SET granted_json = json_set(p.granted_json, '$.cards', ${cards}${packs}) WHERE purchase_id = ?`).bind(userId, ...(openings ? [userId] : []), purchaseId)];
  if (openings) out.push(db.prepare("UPDATE tactics_store_purchases SET granted_json = json_set(granted_json, '$.opening', json_extract(granted_json, '$.openings[0]')) WHERE purchase_id = ?").bind(purchaseId));
  return out;
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
  const sold = { ...offer, price: quote.price, contents: plan.opening ? plan.cards.map(c=>({kind:'CARD',cardId:c.cardId,copies:c.copies})) : quote.contents, possibleContents: plan.opening ? quote.contents : undefined, basePrice: quote.basePrice, excluded: quote.excluded };
  const out: D1PreparedStatement[] = [
    // First: the idempotency receipt (UNIQUE (user_id, idempotency_key)).
    db
      .prepare(
        `INSERT INTO tactics_store_purchases (purchase_id, user_id, idempotency_key, offer_id, currency_id, price, status, offer_json, granted_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)`,
      )
      .bind(ids.purchaseId, userId, ids.key, offer.id, offer.currencyId, quote.price, JSON.stringify(sold), JSON.stringify(plan), now, now),

  ];
  out.push(...boxDebitStatements(db,userId,plan,ids.purchaseId,now));
  if(quote.price>0)out.push(ledgerStatement(db, {
      transactionId: ids.transactionId,
      userId,
      currencyId: offer.currencyId,
      delta: -quote.price,
      reason: 'STORE_PURCHASE',
      referenceId: ids.purchaseId,
      note: offer.id,
      now,
    }));
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
  // the plan was made (inventory integrity, purchase limit). A failed guard nulls the NOT NULL status,
  // which aborts the whole batch: no charge, no grant.
  const { guards, binds } = cardInventoryGuards(userId, content, plan.cards);
  if (offer.purchaseLimit !== null) {
    if (offer.booster?.freeGrant && offer.booster.expansionId) {
      // Same stable account+expansion limit for all variants/revisions, including legacy Origins receipts.
      guards.push("(SELECT COUNT(*) FROM tactics_store_purchases WHERE user_id = ? AND status = 'COMPLETED' AND (offer_id = ? OR (json_extract(offer_json, '$.booster.freeGrant') = 1 AND json_extract(offer_json, '$.booster.expansionId') = ?))) <= ?");
      binds.push(userId, freePackOfferId(offer.booster.expansionId), offer.booster.expansionId, offer.purchaseLimit);
    } else {
      guards.push("(SELECT COUNT(*) FROM tactics_store_purchases WHERE user_id = ? AND offer_id = ? AND status = 'COMPLETED') <= ?");
      binds.push(userId, offer.id, offer.purchaseLimit);
    }
  }
  if (guards.length)
    out.push(
      db
        .prepare(
          `UPDATE tactics_store_purchases SET status = CASE WHEN ${guards.join(' AND ')} THEN status ELSE NULL END WHERE purchase_id = ?`,
        )
        .bind(...binds, ids.purchaseId),
    );
  out.push(...finalizePurchaseReceipt(db, userId, ids.purchaseId, !!plan.openings));
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
  quoteSecret?: string;
  packsEnabled?: boolean;
  quoteNow?(): number;
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
  const boxStates=new Map<string,BoxSnapshot>();
  const baseOffers = () =>
    validOffers([...r.store.catalog, ...(r.packsEnabled ? boosterOffers(ctx,r.store.packPolicy,r.store.packPrice) : [])], ctx).filter(newStoreSaleAllowed).filter(o=>!o.booster||(r.packsEnabled&&validBooster(o,ctx))).filter((o) => o.heroId === undefined || (r.heroAllowed?.(o.heroId) ?? true));


  const offers=()=>baseOffers().map(o=>{
    const box=o.booster?.inventory==='FINITE'?boxStates.get(o.booster.expansionId!):undefined;
    if(!box)return o;
    const total=boxTotal(box.remaining);
    const weights={COMMON:0,UNCOMMON:0,RARE:0,LEGENDARY:0,ULTRA:0};
    for(const [id,count] of Object.entries(box.remaining))if(total&&r.content.cards[id])weights[rarityOf(r.content.cards[id]!)]+=count*100/total;
    return {...o,booster:{...o.booster!,box,weights}};
  });
  if(route==='GET /api/tactics/store/catalog'||route==='POST /api/tactics/store/purchase'){
    // Receipts recover before touching the new tables, including pre-box historical purchases.
    const replayKey=r.body.idempotencyKey;
    const recovering=route.endsWith('/purchase')&&typeof replayKey==='string'&&await purchaseByKey(db,userId,replayKey);
    if(!recovering && r.body.receiptOnly!==true){
      for(const offer of baseOffers().filter(o=>o.booster?.inventory==='FINITE')){
        const id=offer.booster!.expansionId!;if(!boxStates.has(id))boxStates.set(id,await loadExpansionBox(db,userId,offer,r.content,now));
      }
    }
  }
  if(route==='POST /api/tactics/store/box/reset'){
    const {expansionId,idempotencyKey,generation,version}=r.body;
    if(typeof expansionId!=='string'||typeof idempotencyKey!=='string'||!IDEMPOTENCY_KEY.test(idempotencyKey)||!Number.isSafeInteger(generation)||!Number.isSafeInteger(version))return error(400,'BAD_REQUEST','Reinicio inválido.');
    const offer=baseOffers().find(o=>o.booster?.inventory==='FINITE'&&o.booster.expansionId===expansionId);
    if(!offer)return error(404,'UNKNOWN_BOX','Esta expansión no tiene una caja comercial.');
    try{return json(await resetExpansionBox(db,userId,offer,r.content,idempotencyKey,generation as number,version as number,now));}
    catch{return error(409,'BOX_CHANGED','La caja cambió. Actualiza antes de reiniciar; no se entregaron cartas ni se cobraron Cristales.');}
  }

  if(route==='GET /api/tactics/store/acquisition'){
    const pool=new Set(offers().filter(o=>!!o.booster).flatMap(o=>o.contents.flatMap(c=>c.kind==='CARD'?[c.cardId]:[])));
    const response=json({cards:Object.fromEntries(Object.keys(r.content.cards).map(id=>[id,describeCardAcquisition(id,r.content,pool)]))});
    response.headers.set('Cache-Control','private, no-store');return response;
  }
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
    if (!quoteSecretReady(r.quoteSecret)) return error(503, 'STORE_QUOTE_UNAVAILABLE', 'La tienda está temporalmente en actualización. No se ha realizado ninguna compra.');
    const secret = r.quoteSecret;
    const owned = await ownership(db, userId, r.record, r.content);
    return quoteResponse({
      serverTime: now,
      currencies: Object.values(CURRENCIES),
      categories: STORE_CATEGORIES,
      expansions: expansionViews(ctx,offers().filter(o=>!!o.booster)),
      offers: await Promise.all(offers()
        .filter((o) => isOfferActive(o, now))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
        .map(async (o) => {
          const view = offerView(o, owned, ctx, now);
          return {...view,...(o.booster?.box&&boxTotal(o.booster.box.remaining)<4*(o.booster.packs??1)?{availability:{...view.availability,purchasable:false}}:{}),freeRemaining:o.booster?.freeGrant?Math.max(0,(o.purchaseLimit??0)-completedOfferClaims(o,owned)):undefined, purchaseQuote: view.availability.purchasable && (!o.booster?.box || boxTotal(o.booster.box.remaining)>=4*(o.booster.packs??1)) ? await issueQuote(secret,userId,o,view,r.quoteNow?.() ?? now) : undefined};
        })),
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
    // Price/contents/balance/userId are never trusted. Existing receipts are recovered before quote validation.
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
    const reject = async (response:Response) => {
      // Another same-key request may have committed while signature/ownership checks awaited.
      const completed = await purchaseByKey(db,userId,key);
      return completed ? replay(completed) : response;
    };

    // Recovery is read-only: never turn an uncertain/legacy intent into a new debit.
    if (r.body.receiptOnly === true) return reject(error(409,'PURCHASE_NOT_FOUND','Todavía no hay un recibo confirmado. Revisa las condiciones actuales antes de volver a confirmar esta misma compra.'));
    const offer = offers().find((o) => o.id === offerId);
    if (!offer) return error(404, 'UNKNOWN_OFFER', 'Esa oferta no existe.');
    if (!quoteSecretReady(r.quoteSecret)) return error(503,'STORE_QUOTE_UNAVAILABLE','La tienda está temporalmente en actualización. Conserva tu compra pendiente y reintenta más tarde.');
    const secret = r.quoteSecret;
    const check = async (record: PlayerRecord) => {
      const plan = planPurchase(offer, await ownership(db, userId, record, r.content), ctx, now);
      if (!plan.ok)
        return {
          ok: false as const,
          fail: error(409, plan.reason.code === 'OFFER_INACTIVE' ? 'OFFER_UNAVAILABLE' : 'ALREADY_OWNED', 'Esta oferta no está disponible.', {
            reason: plan.reason,
          }),
        };
      const signed = await readQuote(secret,r.body.quoteToken,userId,offerId,r.quoteNow?.() ?? now);
      if (!signed.ok) return {ok:false as const,fail:quoteFailure(signed.code)};
      if (signed.quote.terms !== quotedTerms(offer,plan.quote)) return {ok:false as const,fail:quoteFailure('QUOTE_CHANGED')};
      const balance = await walletBalance(db, userId, offer.currencyId);
      if (balance < plan.quote.price)
        return { ok: false as const, fail: error(409, 'INSUFFICIENT_FUNDS', 'Saldo insuficiente.', { balance, price: plan.quote.price }) };
      return { ok: true as const, plan: plan.plan, quote: plan.quote, expiresAt:signed.quote.expiresAt };
    };
    if(offer.booster?.inventory==='FINITE'&&r.body.boxFormat!=='FINITE_BOX_V1')return reject(error(409,'PACK_CLIENT_UPDATE_REQUIRED','Actualiza para abrir tu caja. No se ha cobrado.'));
    if(offer.booster?.box&&boxTotal(offer.booster.box.remaining)<4*(offer.booster.packs??1))return reject(error(409,'BOX_EXHAUSTED','No quedan suficientes cartas; reinicia la caja o elige menos sobres.'));
    if(offer.booster?.poolType==='GENERAL'&&r.body.packFormat!=='GENERAL_BATCH_V1')return reject(error(409,'PACK_CLIENT_UPDATE_REQUIRED','Actualiza la página para revisar este sobre general. No se ha cobrado.'));
    if (offer.booster && r.body.packRevision !== offer.booster.revision) return reject(error(409,'PACK_CLIENT_UPDATE_REQUIRED','Actualiza la página para revisar y abrir este sobre. No se ha cobrado.'));
    const checked = await check(r.record);
    if (!checked.ok) return reject(checked.fail);

    if ((r.quoteNow?.() ?? now) >= checked.expiresAt) return reject(quoteFailure('QUOTE_EXPIRED'));
    let granted = checked.plan;
    if (offer.booster) {
      try { granted = rollBooster(offer,await ownership(db,userId,r.record,r.content),ctx,now); }
      catch { return reject(error(503,'PACK_UNAVAILABLE','El sobre no está disponible. No se ha cobrado.')); }
    }
    if ((r.quoteNow?.() ?? now) >= checked.expiresAt) return reject(quoteFailure('QUOTE_EXPIRED'));
    const purchaseId = `pur_${r.store.newId()}`;
    try {
      await db.batch(
        purchaseStatements(
          db,
          userId,
          r.record,
          r.content,
          offer,
          granted,
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
      if (again && !again.ok) return reject(again.fail);
      return error(409, 'PURCHASE_CONFLICT', 'La compra no se completó; inténtalo de nuevo.');
    }
    const row = await purchaseByKey(db, userId, key);
    return json({ ...(await r.state()), purchase: purchaseView(row!), replayed: false, wallet: await walletView(db, userId, offer.currencyId) });
  }

  return null;
}
