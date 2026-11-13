import {issueQuote,readQuote,quotedTerms,quoteSecretReady,quoteFailure,quoteResponse} from './storeQuote';
import {
  collectionOwner,
  copyLimit,
  DECK_RULES,
  describePromoGrant,
  GIFT_LIMITS,
  GIFT_RESULT_LABEL,
  giftMessage,
  giftRarity,
  planGift,
  validOffers,
  type CardGrant,
  type GameContent,
  type GiftBlock,
  type GiftContext,
  type GiftResult,
  type GiftStatus,
  type PurchasePlan,
  type StoreContent,
  type StoreOffer,
  type StoreOwnership,
} from '../../src/game';
import type { D1Database, D1PreparedStatement, Env } from './db';
import { error, json } from './http';
import { loadPlayer, type PlayerRecord } from './repo';
import { canInteract, cleanMessage, normalizeUsername, notify, rateLimit } from './social';
import { cardInventoryGuards, cardGrantStatements, ledgerStatement, ownership, walletBalance, walletView, type StoreRequest } from './store';
import { championAllowed } from './warriorRelease';

/**
 * Store gifting (/api/tactics/store/gifts*). The sender names ONLY a product (store offer id), a
 * recipient username, an idempotency key and an optional note. Who sends (session), who receives
 * (username → users.id, friends only), the price, the contents and every eligibility rule come
 * from the server.
 *
 * Buying a gift is ONE D1 batch: gift row (PENDING, idempotency receipt) + its item lines + the
 * sender's ledger debit + a final guard that re-checks the recipient's caps (pending gifts
 * included), purchase limit, friendship/blocks and the sender's limits — all or nothing.
 * Claiming is another batch: PENDING → CLAIMED + grants into the recipient's collection + cap
 * guard. A gift the recipient cannot take right now (they got the card meanwhile) stays PENDING:
 * never destroyed, never converted.
 */

export interface GiftExtras {
  env: Env;
  username: string;
}

/** Sliding windows ([ms, max]) per gift action; the daily send limit is counted on tactics_gifts. */
export const GIFT_RATE: Record<'gift_send' | 'gift_quote' | 'gift_claim', [number, number][]> = {
  gift_send: [[60_000, 6]],
  gift_quote: [[60_000, 30]],
  gift_claim: [[60_000, 30]],
};

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const PRODUCT_ID = /^[a-z0-9_-]{1,64}$/;
const GIFT_ID = /^gft_[0-9a-f-]{36}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_PAGE = 50;

const STATUS: Record<GiftResult, number> = {
  PRODUCT_NOT_FOUND: 404,
  NOT_GIFTABLE: 409,
  PRODUCT_INACTIVE: 409,
  RECIPIENT_NOT_FOUND: 404,
  CANNOT_GIFT_SELF: 400,
  USER_BLOCKED: 403,
  NOT_FRIENDS: 403,
  RECIPIENT_CANNOT_RECEIVE: 409,
  RECIPIENT_CARD_AT_CAP: 409,
  RECIPIENT_ALREADY_OWNS: 409,
  RECIPIENT_LIMIT_REACHED: 409,
  GIFT_LIMIT_REACHED: 429,
  INSUFFICIENT_FUNDS: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  GIFT_NOT_FOUND: 404,
  GIFT_BLOCKED: 409,
  GIFT_UNAVAILABLE: 409,
  GIFT_CONFLICT: 409,
  RATE_LIMITED: 429,
};

const fail = (result: GiftResult, extra: Record<string, unknown> = {}) => error(STATUS[result], result, GIFT_RESULT_LABEL[result], { result, ...extra });

// ── Rows and views ───────────────────────────────────────────────────────────────────────
interface GiftRow {
  gift_id: string;
  sender_user_id: number | null;
  recipient_user_id: number;
  idempotency_key: string;
  product_id: string;
  status: GiftStatus;
  currency_id: string;
  price_snapshot: number;
  reward_snapshot: string;
  message: string | null;
  created_at: number;
  claimed_at: number | null;
  sender_name: string | null;
  recipient_name: string | null;
}

/** The offer as sold (what the gift delivers): stored once, never re-read from the catalog. */
type GiftSnapshot = Pick<StoreOffer, 'id' | 'type' | 'title' | 'description' | 'heroId' | 'contents'> & { plan: PurchasePlan };

const GIFT_SELECT = `SELECT g.gift_id, g.sender_user_id, g.recipient_user_id, g.idempotency_key, g.product_id, g.status, g.currency_id,
  g.price_snapshot, g.reward_snapshot, g.message, g.created_at, g.claimed_at, s.username AS sender_name, r.username AS recipient_name
  FROM tactics_gifts g LEFT JOIN users s ON s.id = g.sender_user_id JOIN users r ON r.id = g.recipient_user_id`;

const giftById = (db: D1Database, giftId: string) => db.prepare(`${GIFT_SELECT} WHERE g.gift_id = ?`).bind(giftId).first<GiftRow>();
const giftByKey = (db: D1Database, senderId: number, key: string) =>
  db.prepare(`${GIFT_SELECT} WHERE g.sender_user_id = ? AND g.idempotency_key = ?`).bind(senderId, key).first<GiftRow>();

/**
 * What either side may see. The recipient sees who sent it (username only), what it is and its
 * state; only the sender sees the price they paid. No user ids, no ledger internals.
 */
function giftView(row: GiftRow, perspective: 'SENT' | 'RECEIVED', content: GameContent, cosmetics: StoreRequest['store']['cosmetics'], blocked?: GiftBlock | null) {
  const snap = JSON.parse(row.reward_snapshot) as GiftSnapshot;
  return {
    giftId: row.gift_id,
    status: row.status,
    productId: row.product_id,
    productName: snap.title,
    productType: snap.type,
    heroId: snap.heroId ?? null,
    /** Art key for the client: the store offer id (StoreArt renders offers by id/type/contents). */
    artId: row.product_id,
    product: { id: snap.id, type: snap.type, heroId: snap.heroId, contents: snap.contents },
    rarity: giftRarity(snap, content),
    rewardSummary: describePromoGrant({ crystals: 0, cards: snap.plan.cards, cosmetics: snap.plan.cosmetics }, content, cosmetics),
    message: row.message,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    ...(perspective === 'RECEIVED'
      ? {
          // A deleted sender account still leaves the gift claimable.
          senderUsername: row.sender_name ?? 'Un jugador',
          ...(row.status === 'PENDING' ? { claimable: !blocked, blockedReason: blocked ?? null } : {}),
        }
      : { recipientUsername: row.recipient_name, price: row.price_snapshot, currencyId: row.currency_id }),
  };
}

// ── Recipient ownership (gifts already waiting count as owned) ───────────────────────────
interface PendingLine {
  kind: 'CARD' | 'COSMETIC';
  item_id: string;
  owner_id: string | null;
  copies: number;
}

async function recipientOwnership(db: D1Database, recipientId: number, record: PlayerRecord, content: GameContent): Promise<StoreOwnership> {
  const [base, pending, gifted] = await Promise.all([
    ownership(db, recipientId, record, content),
    db
      .prepare(
        `SELECT i.kind, i.item_id, i.owner_id, i.copies FROM tactics_gift_items i JOIN tactics_gifts g ON g.gift_id = i.gift_id
         WHERE g.recipient_user_id = ? AND g.status = 'PENDING'`,
      )
      .bind(recipientId)
      .all<PendingLine>(),
    db
      .prepare("SELECT product_id, COUNT(*) AS n FROM tactics_gifts WHERE recipient_user_id = ? AND status IN ('PENDING', 'CLAIMED') GROUP BY product_id")
      .bind(recipientId)
      .all<{ product_id: string; n: number }>(),
  ]);
  const giftCounts = new Map(gifted.results.map((g) => [g.product_id, g.n]));
  return {
    copies: (heroId, cardId) => {
      const owner = collectionOwner(content, heroId, cardId);
      const waiting = pending.results.filter((p) => p.kind === 'CARD' && p.item_id === cardId && p.owner_id === owner).reduce((n, p) => n + p.copies, 0);
      return base.copies(heroId, cardId) + waiting;
    },
    hasCosmetic: (id) => base.hasCosmetic(id) || pending.results.some((p) => p.kind === 'COSMETIC' && p.item_id === id),
    // A gift counts against the recipient's purchase limit exactly like buying it themselves.
    purchases: (offerId) => base.purchases(offerId) + (giftCounts.get(offerId) ?? 0),
  };
}

// ── Gift creation ────────────────────────────────────────────────────────────────────────
interface Recipient {
  id: number;
  username: string;
}

/** Only accounts that play Tactics can receive gifts (same lookup as friend search). */
const userByName = (db: D1Database, username: string) =>
  db
    .prepare('SELECT u.id AS id, u.username AS username FROM users u JOIN tactics_profiles p ON p.user_id = u.id WHERE u.username = ?')
    .bind(username)
    .first<Recipient>();

const pairOf = (a: number, b: number) => (a < b ? [a, b] : [b, a]);

function giftStatements(
  r: StoreRequest,
  recipient: Recipient,
  offer: StoreOffer,
  plan: PurchasePlan,
  price: number,
  message: string | null,
  ids: { giftId: string; transactionId: string; key: string },
): D1PreparedStatement[] {
  const { db, userId, now, content } = r;
  const snapshot: GiftSnapshot = {
    id: offer.id,
    type: offer.type,
    title: offer.title,
    description: offer.description,
    ...(offer.heroId ? { heroId: offer.heroId } : {}),
    contents: offer.contents as StoreContent[],
    plan,
  };
  const out: D1PreparedStatement[] = [
    // First: the receipt (UNIQUE (sender_user_id, idempotency_key)).
    db
      .prepare(
        `INSERT INTO tactics_gifts (gift_id, sender_user_id, recipient_user_id, idempotency_key, product_id, status, currency_id, price_snapshot, reward_snapshot, transaction_id, message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(ids.giftId, userId, recipient.id, ids.key, offer.id, offer.currencyId, price, JSON.stringify(snapshot), ids.transactionId, message, now, now),
  ];
  let line = 0;
  for (const c of plan.cards)
    out.push(
      db
        .prepare("INSERT INTO tactics_gift_items (gift_id, line, kind, item_id, hero_id, owner_id, copies) VALUES (?, ?, 'CARD', ?, ?, ?, ?)")
        .bind(ids.giftId, line++, c.cardId, c.heroId, collectionOwner(content, c.heroId, c.cardId), c.copies),
    );
  for (const c of plan.cosmetics)
    out.push(
      db
        .prepare("INSERT INTO tactics_gift_items (gift_id, line, kind, item_id, hero_id, owner_id, copies) VALUES (?, ?, 'COSMETIC', ?, NULL, NULL, 1)")
        .bind(ids.giftId, line++, c.cosmeticId),
    );
  out.push(
    ledgerStatement(db, {
      transactionId: ids.transactionId,
      userId,
      currencyId: offer.currencyId,
      delta: -price,
      reason: 'STORE_GIFT_PURCHASE',
      referenceId: ids.giftId,
      note: offer.id,
      now,
    }),
  );
  // Last: re-check inside the transaction everything a concurrent request could have changed.
  // A failed guard nulls the NOT NULL status, which aborts the batch: no charge, no gift.
  const pendingFor = "SELECT COALESCE(SUM(i.copies), 0) FROM tactics_gift_items i JOIN tactics_gifts g ON g.gift_id = i.gift_id WHERE g.recipient_user_id = ? AND g.status = 'PENDING'";
  const guards: string[] = [];
  const binds: unknown[] = [];
  for (const c of plan.cosmetics) {
    guards.push(`NOT EXISTS (SELECT 1 FROM tactics_player_cosmetics WHERE user_id = ? AND cosmetic_id = ?) AND (${pendingFor} AND i.kind = 'COSMETIC' AND i.item_id = ?) <= 1`);
    binds.push(recipient.id, c.cosmeticId, recipient.id, c.cosmeticId);
  }
  const limit = Math.min(offer.purchaseLimit ?? Infinity, offer.giftLimitPerRecipient ?? Infinity);
  if (Number.isFinite(limit)) {
    guards.push(
      "(SELECT COUNT(*) FROM tactics_store_purchases WHERE user_id = ? AND offer_id = ? AND status = 'COMPLETED') + (SELECT COUNT(*) FROM tactics_gifts WHERE recipient_user_id = ? AND product_id = ? AND status IN ('PENDING', 'CLAIMED')) <= ?",
    );
    binds.push(recipient.id, offer.id, recipient.id, offer.id, limit);
  }
  const [low, high] = pairOf(userId, recipient.id);
  guards.push(
    "EXISTS (SELECT 1 FROM tactics_social_relationships WHERE user_low = ? AND user_high = ? AND status = 'ACCEPTED')",
    'NOT EXISTS (SELECT 1 FROM tactics_social_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?))',
    '(SELECT COUNT(*) FROM tactics_gifts WHERE sender_user_id = ? AND created_at > ?) <= ?',
    "(SELECT COUNT(*) FROM tactics_gifts WHERE sender_user_id = ? AND recipient_user_id = ? AND status = 'PENDING') <= ?",
  );
  binds.push(low, high, userId, recipient.id, recipient.id, userId, userId, now - DAY_MS, GIFT_LIMITS.perSenderDay, userId, recipient.id, GIFT_LIMITS.pendingPerPair);
  out.push(db.prepare(`UPDATE tactics_gifts SET status = CASE WHEN ${guards.join(' AND ')} THEN status ELSE NULL END WHERE gift_id = ?`).bind(...binds, ids.giftId));
  return out;
}

type Checked =
  | { ok: true; recipient: Recipient; offer: StoreOffer; plan: PurchasePlan; price: number; balance: number }
  | { ok: false; fail: Response };

/** Every pre-charge rule, from the server's state. Nothing is written here. */
async function checkGift(r: StoreRequest, x: GiftExtras, productId: string, recipientName: string): Promise<Checked> {
  const { db, userId, now } = r;
  const no = (result: GiftResult, extra?: Record<string, unknown>) => ({ ok: false as const, fail: fail(result, extra) });
  // The product as the SENDER may see it (validated catalog + the sender's champion gate).
  const ctx = { content: r.content, rules: DECK_RULES, cosmetics: r.store.cosmetics };
  const offer = validOffers(r.store.catalog, ctx).find((o) => o.id === productId && (o.heroId === undefined || (r.heroAllowed?.(o.heroId) ?? true)));
  if (!offer) return no('PRODUCT_NOT_FOUND');
  if (offer.giftable !== true) return no('NOT_GIFTABLE');
  if (recipientName === x.username) return no('CANNOT_GIFT_SELF');
  const recipient = await userByName(db, recipientName);
  if (!recipient) return no('RECIPIENT_NOT_FOUND');
  if (recipient.id === userId) return no('CANNOT_GIFT_SELF');
  // Only the caller's own block is named; a block BY the recipient already removed the
  // friendship, so it reads as NOT_FRIENDS (never revealed).
  const mine = await db.prepare('SELECT 1 AS b FROM tactics_social_blocks WHERE blocker_id = ? AND blocked_id = ?').bind(userId, recipient.id).first();
  if (mine) return no('USER_BLOCKED');
  if (!(await canInteract(db, userId, recipient.id))) return no('NOT_FRIENDS');
  const [sentToday, pendingPair] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM tactics_gifts WHERE sender_user_id = ? AND created_at > ?').bind(userId, now - DAY_MS).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM tactics_gifts WHERE sender_user_id = ? AND recipient_user_id = ? AND status = 'PENDING'").bind(userId, recipient.id).first<{ n: number }>(),
  ]);
  if ((sentToday?.n ?? 0) >= GIFT_LIMITS.perSenderDay || (pendingPair?.n ?? 0) >= GIFT_LIMITS.pendingPerPair) return no('GIFT_LIMIT_REACHED');
  const recipientRecord = await loadPlayer(db, recipient.id, r.content);
  if (!recipientRecord) return no('RECIPIENT_NOT_FOUND');
  const giftCtx: GiftContext = { ...ctx, heroAllowed: (heroId) => championAllowed(heroId, x.env, recipient.username) };
  const planned = planGift(offer, await recipientOwnership(db, recipient.id, recipientRecord, r.content), giftCtx, now);
  if (!planned.ok) return no(planned.reason, { recipientUsername: recipient.username });
  const balance = await walletBalance(db, userId, offer.currencyId);
  if (balance < planned.price) return no('INSUFFICIENT_FUNDS', { balance, price: planned.price });
  return { ok: true, recipient, offer, plan: planned.plan, price: planned.price, balance };
}

// ── Claim ────────────────────────────────────────────────────────────────────────────────
interface ItemRow {
  kind: 'CARD' | 'COSMETIC';
  item_id: string;
  hero_id: string | null;
  copies: number;
}

const giftItems = async (db: D1Database, giftId: string) =>
  (await db.prepare('SELECT kind, item_id, hero_id, copies FROM tactics_gift_items WHERE gift_id = ? ORDER BY line').bind(giftId).all<ItemRow>()).results;

/**
 * Can the recipient take this gift NOW (their real collection, without pending gifts)? The
 * grants carry today's caps. null grants = blocked, with the reason.
 */
async function claimPlan(
  r: StoreRequest,
  x: GiftExtras,
  row: GiftRow,
  owned?: StoreOwnership,
): Promise<{ ok: true; cards: CardGrant[]; cosmetics: { cosmeticId: string; kind: string }[] } | { ok: false; reason: GiftBlock }> {
  const items = await giftItems(r.db, row.gift_id);
  owned ??= await ownership(r.db, r.userId, r.record, r.content);
  const cards: CardGrant[] = [];
  const cosmetics: { cosmeticId: string; kind: string }[] = [];
  for (const i of items) {
    if (i.kind === 'CARD') {
      const card = r.content.cards[i.item_id];
      const heroId = i.hero_id!;
      if (!card || !championAllowed(heroId, x.env, x.username)) return { ok: false, reason: 'RECIPIENT_CANNOT_RECEIVE' };
      const cap = copyLimit(card, DECK_RULES);
      const have = owned.copies(heroId, i.item_id);
      cards.push({ heroId, cardId: i.item_id, copies: i.copies, total: have + i.copies, cap });
    } else {
      const def = r.store.cosmetics[i.item_id];
      if (!def) return { ok: false, reason: 'RECIPIENT_CANNOT_RECEIVE' };
      if (owned.hasCosmetic(i.item_id)) return { ok: false, reason: 'RECIPIENT_ALREADY_OWNS' };
      cosmetics.push({ cosmeticId: i.item_id, kind: def.kind });
    }
  }
  return { ok: true, cards, cosmetics };
}

function claimStatements(r: StoreRequest, giftId: string, cards: CardGrant[], cosmetics: { cosmeticId: string; kind: string }[]): D1PreparedStatement[] {
  const { db, userId, now } = r;
  const out: D1PreparedStatement[] = [
    // First: PENDING → CLAIMED. Anything else (already claimed by a concurrent request) nulls
    // the status and aborts the whole batch: the reward can only be granted once.
    db
      .prepare(
        "UPDATE tactics_gifts SET status = CASE WHEN status = 'PENDING' THEN 'CLAIMED' ELSE NULL END, claimed_at = ?, updated_at = ? WHERE gift_id = ? AND recipient_user_id = ?",
      )
      .bind(now, now, giftId, userId),
    ...cardGrantStatements(db, userId, r.record, r.content, cards, 'STORE_GIFT', now),
  ];
  for (const c of cosmetics)
    out.push(
      db
        .prepare("INSERT INTO tactics_player_cosmetics (user_id, cosmetic_id, kind, source, reference_id, acquired_at) VALUES (?, ?, ?, 'STORE_GIFT', ?, ?)")
        .bind(userId, c.cosmeticId, c.kind, giftId, now),
    );
  const { guards, binds } = cardInventoryGuards(userId, r.content, cards);
  if (guards.length)
    out.push(db.prepare(`UPDATE tactics_gifts SET status = CASE WHEN ${guards.join(' AND ')} THEN status ELSE NULL END WHERE gift_id = ?`).bind(...binds, giftId));
  out.push(db.prepare('UPDATE tactics_profiles SET updated_at = ? WHERE user_id = ?').bind(now, userId));
  return out;
}

/** Optional note: absent/blank → null; not plain text or too long → undefined (rejected). */
function parseMessage(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  if (!raw.trim()) return null;
  const cleaned = cleanMessage(raw);
  return cleaned === null ? undefined : giftMessage(cleaned);
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────
/** Gift routes; null = not a gift route. */
export async function giftRoute(route: string, r: StoreRequest, x: GiftExtras): Promise<Response | null> {
  if (!route.includes(' /api/tactics/store/gifts')) return null;
  const { db, userId, now } = r;
  const view = (row: GiftRow, perspective: 'SENT' | 'RECEIVED', blocked?: GiftBlock | null) => giftView(row, perspective, r.content, r.store.cosmetics, blocked);
  const limited = async (action: keyof typeof GIFT_RATE) => !(await rateLimit(db, userId, action, now, GIFT_RATE[action]));

  // Body fields read: productId, recipientUsername, idempotencyKey, message. Ids, prices,
  // rewards or a recipientId in the body are ignored.
  const input = () => {
    const productId = r.body.productId;
    const recipient = normalizeUsername(r.body.recipientUsername);
    if (typeof productId !== 'string' || !PRODUCT_ID.test(productId)) return { bad: error(400, 'BAD_REQUEST', 'Producto inválido.') };
    if (!recipient || recipient.length > 32) return { bad: error(400, 'BAD_REQUEST', 'Escribe el nombre de usuario de tu amigo.') };
    return { productId, recipient };
  };

  if (route === 'POST /api/tactics/store/gifts/quote') {
    // Eligibility + price for the confirm step. Writes nothing (except the rate-limit event).
    const parsed = input();
    if ('bad' in parsed) return parsed.bad!;
    if (await limited('gift_quote')) return fail('RATE_LIMITED');
    const checked = await checkGift(r, x, parsed.productId, parsed.recipient);
    if (!checked.ok) return checked.fail;
    if (!quoteSecretReady(r.quoteSecret)) return error(503,'STORE_QUOTE_UNAVAILABLE','La tienda está temporalmente en actualización. No se ha enviado el regalo.');
    return quoteResponse({
      purchaseQuote: await issueQuote(r.quoteSecret,userId,checked.offer,{price:checked.price,contents:checked.offer.contents},r.quoteNow?.() ?? now,`GIFT:${checked.recipient.id}`),
      productId: checked.offer.id,
      productName: checked.offer.title,
      recipientUsername: checked.recipient.username,
      price: checked.price,
      currencyId: checked.offer.currencyId,
      balance: checked.balance,
      rewardSummary: describePromoGrant({ crystals: 0, ...checked.plan }, r.content, r.store.cosmetics),
    });
  }

  if (route === 'POST /api/tactics/store/gifts') {
    const parsed = input();
    if ('bad' in parsed) return parsed.bad!;
    const key = r.body.idempotencyKey;
    if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) return error(400, 'BAD_REQUEST', 'Clave de idempotencia inválida.');
    const message = parseMessage(r.body.message);
    if (message === undefined) return error(400, 'BAD_MESSAGE', `El mensaje admite hasta ${GIFT_LIMITS.messageMaxChars} caracteres de texto.`);

    // A retry / double click with the same key returns the first gift and never charges again
    // (answered before the rate limit, so a timed-out request can always be recovered).
    const replay = async (row: GiftRow) =>
      row.product_id !== parsed.productId || row.recipient_name !== parsed.recipient
        ? fail('IDEMPOTENCY_KEY_REUSED')
        : json({ gift: view(row, 'SENT'), replayed: true, wallet: await walletView(db, userId, row.currency_id) });
    const previous = await giftByKey(db, userId, key);
    if (previous) return replay(previous);
    const reject = async (response:Response) => {
      const completed = await giftByKey(db,userId,key);
      return completed ? replay(completed) : response;
    };
    if (!quoteSecretReady(r.quoteSecret)) return error(503,'STORE_QUOTE_UNAVAILABLE','La tienda está temporalmente en actualización. Conserva el identificador del regalo.');
    if (await limited('gift_send')) return reject(fail('RATE_LIMITED'));

    const checked = await checkGift(r, x, parsed.productId, parsed.recipient);
    if (!checked.ok) return reject(checked.fail);
    const signed = await readQuote(r.quoteSecret,r.body.quoteToken,userId,checked.offer.id,r.quoteNow?.() ?? now,`GIFT:${checked.recipient.id}`);
    if (!signed.ok) return reject(quoteFailure(signed.code));
    if (signed.quote.terms !== quotedTerms(checked.offer,{price:checked.price,contents:checked.offer.contents})) return reject(quoteFailure('QUOTE_CHANGED'));
    if ((r.quoteNow?.() ?? now) >= signed.quote.expiresAt) return reject(quoteFailure('QUOTE_EXPIRED'));
    const giftId = `gft_${r.store.newId()}`;
    try {
      await db.batch(
        giftStatements(r, checked.recipient, checked.offer, checked.plan, checked.price, message, {
          giftId,
          transactionId: `txn_${r.store.newId()}`,
          key,
        }),
      );
    } catch {
      // Rolled back entirely: the same key won a concurrent race, or state changed under us.
      const raced = await giftByKey(db, userId, key);
      if (raced) return replay(raced);
      const again = await checkGift(r, x, parsed.productId, parsed.recipient);
      if (!again.ok) return reject(again.fail);
      return fail('GIFT_CONFLICT');
    }
    const row = (await giftById(db, giftId))!;
    // Best effort: an offline recipient sees it from REST (badge + inbox) on their next visit.
    await notify(x.env, checked.recipient.id, {
      event: 'GIFT_RECEIVED',
      gift: { giftId, senderUsername: x.username, productName: checked.offer.title, artId: checked.offer.id, createdAt: now },
    });
    return json({ gift: view(row, 'SENT'), replayed: false, wallet: await walletView(db, userId, checked.offer.currencyId) });
  }

  if (route === 'GET /api/tactics/store/gifts/received') {
    const { results } = await db
      .prepare(`${GIFT_SELECT} WHERE g.recipient_user_id = ? ORDER BY (g.status = 'PENDING') DESC, g.created_at DESC, g.gift_id LIMIT ?`)
      .bind(userId, HISTORY_PAGE)
      .all<GiftRow>();
    const owned = await ownership(db, userId, r.record, r.content);
    const gifts = [];
    for (const row of results) {
      const plan = row.status === 'PENDING' ? await claimPlan(r, x, row, owned) : null;
      gifts.push(view(row, 'RECEIVED', plan && !plan.ok ? plan.reason : null));
    }
    return json({ gifts, pending: gifts.filter((g) => g.status === 'PENDING').length });
  }

  if (route === 'GET /api/tactics/store/gifts/sent') {
    const { results } = await db
      .prepare(`${GIFT_SELECT} WHERE g.sender_user_id = ? ORDER BY g.created_at DESC, g.gift_id LIMIT ?`)
      .bind(userId, HISTORY_PAGE)
      .all<GiftRow>();
    return json({ gifts: results.map((row) => view(row, 'SENT')) });
  }

  const match = /^(GET|POST) \/api\/tactics\/store\/gifts\/([^/]+)(\/claim)?$/.exec(route);
  if (!match) return null;
  const [, method, giftId, claim] = match;
  if (!GIFT_ID.test(giftId!)) return fail('GIFT_NOT_FOUND');
  const row = await giftById(db, giftId!);
  // Someone else's gift is indistinguishable from a missing one.
  const mineAs = row?.recipient_user_id === userId ? 'RECEIVED' : row && row.sender_user_id === userId ? 'SENT' : null;

  if (method === 'GET' && !claim) {
    if (!row || !mineAs) return fail('GIFT_NOT_FOUND');
    const plan = mineAs === 'RECEIVED' && row.status === 'PENDING' ? await claimPlan(r, x, row) : null;
    return json({ gift: view(row, mineAs, plan && !plan.ok ? plan.reason : null) });
  }
  if (method !== 'POST' || !claim) return null;

  // Only the recipient can claim. The sender (or anyone else) gets GIFT_NOT_FOUND.
  if (!row || mineAs !== 'RECEIVED') return fail('GIFT_NOT_FOUND');
  const claimed = async (gift: GiftRow, replayed: boolean) => json({ ...(await r.state()), gift: view(gift, 'RECEIVED'), replayed });
  if (row.status === 'CLAIMED') return claimed(row, true);
  if (row.status !== 'PENDING') return fail('GIFT_UNAVAILABLE');
  if (await limited('gift_claim')) return fail('RATE_LIMITED');
  const plan = await claimPlan(r, x, row);
  // Kept PENDING (not destroyed, not converted): the player can claim it once there is room.
  if (!plan.ok) return fail('GIFT_BLOCKED', { reason: plan.reason, gift: view(row, 'RECEIVED', plan.reason) });
  try {
    await db.batch(claimStatements(r, row.gift_id, plan.cards, plan.cosmetics));
  } catch {
    const fresh = await giftById(db, row.gift_id);
    if (fresh?.status === 'CLAIMED') return claimed(fresh, true);
    const record = await loadPlayer(db, userId, r.content);
    const again = record && fresh ? await claimPlan({ ...r, record }, x, fresh) : null;
    if (again && !again.ok) return fail('GIFT_BLOCKED', { reason: again.reason, gift: view(fresh!, 'RECEIVED', again.reason) });
    return fail('GIFT_CONFLICT');
  }
  return claimed((await giftById(db, row.gift_id))!, false);
}
